/*
 * phyx2ontology.js: A tool for synthesizing all PHYX files into a single
 * Clade Ontology in JSON-LD.
 *
 * Synopsis: phyx2ontology.js [-d root] > ontology.json
 *
 * Arguments:
 *  - `-d`: Set the directory to look for PHYX files in.
 */

// Configuration options.
const PHYX_CONTEXT_JSON = 'http://www.phyloref.org/curation-tool/json/phyx.json';
const CLADE_ONTOLOGY_BASEURI = 'http://phyloref.org/clade-ontology/clado.owl';

// Load necessary modules.
const process = require('process');
const fs = require('fs');
const path = require('path');

/*
 * phyx.js uses some code (in particular through phylotree.js) that expects certain
 * Javascript libraries to be loaded via the browser using <script>. To replicate
 * this in Node, we load them and add them to the global object.
 */

// Load moment as a global variable so it can be accessed by phyx.js.
global.moment = require('moment');

// Load jQuery.extend as a global variable so it can be accessed by phyx.js.
global.jQuery = {};
global.jQuery.extend = require('extend');

// Load d3 as a global variable so it can be accessed by both phylotree.js (which
// needs to add additional objects to it) and phyx.js (which needs to call it).
global.d3 = require('d3');

// Define hasOwnProperty() so we can use it on all classes.
function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// phylotree.js does not export functions itself, but adds them to global.d3.layout.
// So we set up a global.d3.layout object for them to be added to, and then we include
// phylotree.js ourselves.
if (!hasOwnProperty(global.d3, 'layout')) {
  global.d3.layout = {};
}
require('../curation-tool/lib/phylotree.js/phylotree.js');

// Load phyx.js, our PHYX library.
const phyx = require('../curation-tool/js/phyx');

// Helper methods.

/*
 * Returns a list of PHYX files that we can test in the provided directory.
 *
 * We use a simple flatMap to search for these files. Since flatMap isn't in
 * Node.js yet, I use a map to recursively find the files and then flatten it
 * using reduce() and concat().
 *
 * This could be implemented asynchronously, but we need a list of files to
 * test each one individually in Mocha, so we need a synchronous implementation
 * to get that list before we start testing.
 */
function findPHYXFiles(dirPath) {
    return fs.readdirSync(dirPath).map(function(filename) {
        const filePath = path.join(dirPath, filename);

        if(fs.lstatSync(filePath).isDirectory()) {
            // Recurse into this directory.
            return findPHYXFiles(filePath);
        } else {
            // Look for .json files (but not for '_as_owl.json' files, for historical reasons).
            if(filePath.endsWith('.json') && !filePath.endsWith('_as_owl.json')) {
                return [filePath];
            } else {
                return [];
            }
        }
   }).reduce((x, y) => x.concat(y), []); // This flattens the list of results.
}

// Read command-line arguments.
const argv = require('yargs')
  .usage('Usage: $0 [-d root]')
  .alias('d', 'dir')
  .nargs('d', 1)
  .describe('d', 'Directory to look for PHYX files in')
  .help('h')
  .alias('h', 'help')
  .argv;

// Make sure there are no unknown arguments.
if (argv._.length > 0) {
  throw new Error('Unknown arguments: ' + argv._);
}

// Determine the directory to process.
const dir = argv.dir || process.cwd();
// process.stderr.write(`Searching directory: ${dir}\n`);

// Get list of PHYX files to process.
const phyxFiles = findPHYXFiles(dir);
// process.stderr.write(`PHYX files to combine: ${phyxFiles}`);

// It would be pretty easy to convert each individual PHYX file into a JSON-LD file by
// using the phyx2jsonld module. However, we would then have to identify every URI in
// the file and rename all of them, which could be confusing.
let entityIndex = 0;
function getIdentifier(index) {
  return `${CLADE_ONTOLOGY_BASEURI}#CLADO_${index.toString().padStart(8, '0')}`;
}

// Loop through our files and assemble a combined ontology.
const jsons = phyxFiles
  .map(filename => {
    const content = fs.readFileSync(filename);

    // Some of these PHYX files are encrypted! We need to ignore those.
    if(content.slice(0, 9).equals(Buffer.from("\x00GITCRYPT"))) {
      return [];
    }

    // Try to read this PHYX file as a JSON file.
    let json;
    try {
      json = JSON.parse(content.toString('utf8'));
    } catch(err) {
      process.stderr.write(`WARNING: ${filename} could not be read as JSON, skipping.`);
      return [];
    }

    // If not encrypted, we can treat this file as UTF-8 and read it as a string.
    return [json];
  })
  // Flatten map to remove files that could not be read or parsed.
  .reduce((a, b) => a.concat(b), []);

/*
 * We'd like our combine JSON-LD file to be in this format:
 * [{
 *    '@context': 'http://phyloref.org/curation-tool/json/phyx.json',
 *    '@id': 'http://vocab.phyloref.org/clado/',
 *    '@type': 'owl:Ontology'
 *    [... ontology metadata ...]
 * }, {
 *    '@context': 'http://phyloref.org/curation-tool/json/phyx.json',
 *    '@id': 'http://vocab.phyloref.org/clado/CLADO_PHYLOREF_1',
 *    '@type': 'phyloref:Phyloreference',
 *    'label': '...',
 *    'hasInternalSpecifier': ...,
 *    'internalSpecifiers': ...
 * }, {
 *    '@context': 'http://phyloref.org/curation-tool/json/phyx.json',
 *    '@id': 'http://vocab.phyloref.org/clado/CLADO_PHYLOGENY_1',
 *    '@type': 'cdao:???',
 *    'includesNodes': [
 *      {'@id': 'http://vocab.phyloref.org/clado/CLADO_PHYLOGENY_1_node1', ...},
 *      {'@id': 'http://vocab.phyloref.org/clado/CLADO_PHYLOGENY_1_node2', ...}
 *    ]
 * }]
 */
const phylorefs = [];
let specifiers = [];
for (let phyxFile of jsons) {
  for (let phyloref of phyxFile.phylorefs) {
    entityIndex += 1;
    const jsonld = new phyx.PhylorefWrapper(phyloref).asJSONLD(getIdentifier(entityIndex));

    jsonld['@context'] = PHYX_CONTEXT_JSON;
    phylorefs.push(jsonld);
  }
}

const phylogenies = [];
const tunitMatches = [];
for (let phyxFile of jsons) {
  for (let phylogeny of phyxFile.phylogenies) {
    entityIndex += 1;
    const phylogenyAsJSONLD = new phyx.PhylogenyWrapper(phylogeny).asJSONLD(getIdentifier(entityIndex));

    phylogenyAsJSONLD['@context'] = PHYX_CONTEXT_JSON;
    phylogenies.push(phylogenyAsJSONLD);
  }
}

for(let phyloref of phylorefs) {
  let specifiers = [];
  if (hasOwnProperty(phyloref, 'internalSpecifiers')) specifiers = phyloref.internalSpecifiers;
  if (hasOwnProperty(phyloref, 'externalSpecifiers')) specifiers = specifiers.concat(phyloref.externalSpecifiers);

  for(let specifier of specifiers) {
    let countMatchedNodes = 0;

    if (hasOwnProperty(specifier, 'referencesTaxonomicUnits')) {
      for(let specifierTU of specifier.referencesTaxonomicUnits) {

        for(let phylogenyAsJSONLD of phylogenies) {
          for(let node of phylogenyAsJSONLD.nodes) {
            if (!hasOwnProperty(node, 'representsTaxonomicUnits')) continue;

            for(let nodeTU of node.representsTaxonomicUnits) {
              const matcher = new phyx.TaxonomicUnitMatcher(specifierTU, nodeTU);
              if (matcher.matched) {
                entityIndex += 1;
                const tuMatchAsJSONLD = matcher.asJSONLD(getIdentifier(entityIndex));

                countMatchedNodes += 1;
                tuMatchAsJSONLD['@context'] = PHYX_CONTEXT_JSON;
                tunitMatches.push(tuMatchAsJSONLD);
              }
            }
          }
        }
      }

      // If this specifier could not be matched, record it as an unmatched specifier.
      if(countMatchedNodes == 0) {
        if (!hasOwnProperty(phyloref, 'hasUnmatchedSpecifiers')) phyloref.hasUnmatchedSpecifiers = [];
        phyloref.hasUnmatchedSpecifiers.push({'@id': specifier['@id']});
      }
    }
  }
}

const cladeOntology = [
  {
    '@context': PHYX_CONTEXT_JSON,
    '@id': CLADE_ONTOLOGY_BASEURI,
    '@type': 'owl:Ontology',
    'owl:imports': [
      'http://raw.githubusercontent.com/phyloref/curation-workflow/develop/ontologies/phyloref_testcase.owl',
      'http://ontology.phyloref.org/phyloref.owl',
      'http://purl.obolibrary.org/obo/bco.owl'
    ]
  }
];
console.log(JSON.stringify(
  cladeOntology.concat(phylorefs).concat(phylogenies).concat(tunitMatches),
  null,
  4
));
