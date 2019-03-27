/*
 * phyx2ontology.js: A tool for synthesizing all PHYX files into a single
 * Clade Ontology in JSON-LD.
 *
 * Synopsis: phyx2ontology.js [files or directories to process] > ontology.json
 */

// Configuration options.
const PHYX_CONTEXT_JSON = 'http://www.phyloref.org/phyx.js/context/v0.1.0/phyx.json';
const CLADE_ONTOLOGY_BASEURI = 'http://phyloref.org/clade-ontology/clado.owl';

// Load necessary modules.
const process = require('process');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { has } = require('lodash');

// Load phyx.js, our PHYX library.
const phyx = require('@phyloref/phyx');

// Load some methods we use to convert from Model 1.0 to Model 2.0 on the fly.
// These will be moved into phyx.js in https://github.com/phyloref/phyx.js/issues/4
const {
  convertTUtoRestriction,
  getIncludesRestrictionForTU,
  createClassExpressionsForInternals,
  createClassExpressionsForExternals,
} = require('./model2.js');

/*
 * Returns a list of PHYX files that we can test in the provided directory.
 */
function findPHYXFiles(dirPath) {
  // Read all files from the provided directory and look for '.json' files.
  const filesFound = fs.readdirSync(dirPath).map((filename) => {
    const filePath = path.join(dirPath, filename);

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      // Recurse into every directory in the provided directory.
      return findPHYXFiles(filePath);
    }

    // Look for .json files (but not for '_as_owl.json' files, for historical reasons).
    if (filePath.endsWith('.json') && !filePath.endsWith('_as_owl.json')) {
      return [filePath];
    }

    return [];
  }).reduce((x, y) => x.concat(y), []); // This flattens the list of results.

  // If no files could be found, the user might have made a mistake by entering
  // the wrong directory name, so let them know that it failed.
  if (filesFound.length === 0) process.stderr.write(`Warning: directory ${dirPath} contains no JSON files.`);

  return filesFound;
}

// Read command-line arguments.
const argv = yargs.usage('Usage: $0 <directories or files to convert> [--no-phylogenies]')
  .demandCommand(1) // Make sure there's at least one directory or file!
  .option('no-phylogenies', {
    // --no-phylogenies: Flag for turning off including phylogenies in the produced ontology.
    describe: 'Do not include phylogenies in the produced ontology',
    default: false,
  })
  .help('h')
  .alias('h', 'help')
  .argv;

// Treat unnamed commands as files or directories to be scanned for JSON files.
const phyxFiles = argv._.map((filenameOrDirname) => {
  const stats = fs.statSync(filenameOrDirname);
  if (stats.isDirectory()) return findPHYXFiles(filenameOrDirname);
  if (stats.isFile()) return [filenameOrDirname];
  throw new Error(`Argument ${filenameOrDirname} is neither a file nor a directory!`);
}).reduce((acc, val) => acc.concat(val), []);

if (phyxFiles.length === 0) throw new Error('No arguments provided!');

/* Start producing the output ontology */

// Every entity in the output ontology should have a unique CLADO identifier.
// getIdentifier() provides these given a unique entityIndex.
let entityIndex = 0;
function getIdentifier(index) {
  return `${CLADE_ONTOLOGY_BASEURI}#CLADO_${index.toString().padStart(8, '0')}`;
}

// Loop through our files (ignoring GITCRYPT-encrypted files) and read them as JSON.
const jsons = phyxFiles
  .map((filename) => {
    const content = fs.readFileSync(filename);

    // Some of these Phyx files are encrypted! We need to ignore those.
    if (content.slice(0, 9).equals(Buffer.from('\x00GITCRYPT'))) {
      return [];
    }

    // Try to read this Phyx file as a JSON file.
    let json;
    try {
      json = JSON.parse(content.toString('utf8'));
    } catch (err) {
      process.stderr.write(`WARNING: ${filename} could not be read as JSON, skipping.`);
      return [];
    }
    return [json];
  })
  // Flatten map to remove files that could not be read or parsed.
  .reduce((a, b) => a.concat(b), []);

/* Convert every phyloreference (from every Phyx file) into a JSON-LD object. */
const phylorefsByLabel = {};
const phylorefs = [];
jsons.forEach((phyxFile) => {
  phyxFile.phylorefs.forEach((phyloref) => {
    // Convert phyloreference to JSON-LD.
    entityIndex += 1;
    const phylorefWrapper = new phyx.PhylorefWrapper(phyloref);
    const jsonld = phylorefWrapper.asJSONLD(getIdentifier(entityIndex));

    // Record the label of the phylorefs. We'll need this to link phylogenies to
    // the phylorefs they expect to resolve to.
    if (phylorefWrapper.label !== undefined) {
      phylorefsByLabel[phylorefWrapper.label.toString()] = jsonld;
    }

    // In Model 2.0, phyloreferences are not punned, but are specifically subclasses
    // of class Phyloreference. So let's set that up.
    delete jsonld['@type'];
    jsonld.subClassOf = 'phyloref:Phyloreference';

    // We also no longer use the additional classes system or the equivalent class
    // definitions, so let's get rid of those too.
    delete jsonld.equivalentClass;
    delete jsonld.hasAdditionalClass;

    // Finally, we still have the clade definition, but we call it IAO_0000115 now.
    // To be fixed in https://github.com/phyloref/curation-tool/issues/94.
    jsonld['obo:IAO_0000115'] = jsonld.cladeDefinition;
    delete jsonld.cladeDefinition;

    // Construct the OWL restrictions for the equivalentClass using Model 2.0 code.
    const internalSpecifiers = jsonld.internalSpecifiers || [];
    const externalSpecifiers = jsonld.externalSpecifiers || [];

    // We might be create additional classes, so get going.
    jsonld.hasAdditionalClass = [];
    if (internalSpecifiers.length === 0) {
      // We can't handle phyloreferences without at least one internal specifier.
      jsonld.malformedPhyloreference = 'No internal specifiers provided';
    } else {
      // Step 1. Construct an expression for all internal specifiers.
      const expressionsForInternals = (internalSpecifiers.length === 1)
        ? [getIncludesRestrictionForTU(internalSpecifiers[0])]
        : createClassExpressionsForInternals(jsonld, internalSpecifiers, []);

      if (externalSpecifiers.length === 0) {
        // If we don't have external specifiers, we can just use the expression
        // for the internal specifier.
        jsonld.equivalentClass = expressionsForInternals;
      } else {
        // Step 2. Create alternate class expressions for external specifiers.
        jsonld.equivalentClass = expressionsForInternals.map(
          exprForInternal => createClassExpressionsForExternals(
            jsonld, exprForInternal, externalSpecifiers, []
          )
        ).reduce((acc, val) => acc.concat(val), []);
      }
    }

    // Set a JSON-LD context so this block can be interpreted in isolation.
    jsonld['@context'] = PHYX_CONTEXT_JSON;
    phylorefs.push(jsonld);
  });
});

/* Convert every phylogeny (from every Phyx file) into a JSON-LD object. */
const phylogenies = [];
jsons.forEach((phyxFile) => {
  phyxFile.phylogenies.forEach((phylogeny) => {
    // Convert phylogenies into JSON-LD.
    entityIndex += 1;
    const phylogenyAsJSONLD = new phyx.PhylogenyWrapper(phylogeny)
      .asJSONLD(getIdentifier(entityIndex));

    // Change name for including Newick.
    // To be fixed in https://github.com/phyloref/phyx.js/issues/9
    phylogenyAsJSONLD['phyloref:newick_expression'] = phylogenyAsJSONLD.newick;
    delete phylogenyAsJSONLD.newick;

    // Change how nodes are represented.
    (phylogenyAsJSONLD.nodes || []).forEach((nodeAsParam) => {
      const node = nodeAsParam;

      // Make sure this node has a '@type'.
      if (!has(node, '@type')) node['@type'] = [];
      if (!Array.isArray(node['@type'])) node['@type'] = [node['@type']];

      // We replace "parent" with "obo:CDAO_0000179" so we get has_Parent
      // relationships in our output ontology.
      // To be fixed in https://github.com/phyloref/phyx.js/issues/10
      if (has(node, 'parent')) node['obo:CDAO_0000179'] = { '@id': node.parent };

      // For every internal node in this phylogeny, check to see if it's expected to
      // resolve to a phylogeny we know about. If so, add an rdf:type to that effect.
      let expectedToResolveTo = node.labels || [];

      // Are there any phyloreferences expected to resolve here?
      if (has(node, 'expectedPhyloreferenceNamed')) {
        expectedToResolveTo = expectedToResolveTo.concat(node.expectedPhyloreferenceNamed);
      }

      expectedToResolveTo.forEach((phylorefLabel) => {
        if (!has(phylorefsByLabel, phylorefLabel)) return;

        // This node is expected to match phylorefLabel, which is a phyloreference we know about.
        const phylorefId = phylorefsByLabel[phylorefLabel]['@id'];
        node['@type'].push({
          '@type': 'owl:Restriction',
          onProperty: 'obo:OBI_0000312', // obi:is_specified_output_of
          someValuesFrom: {
            '@type': 'owl:Class',
            intersectionOf: [
              { '@id': 'obo:OBI_0302910' }, // obi:prediction
              {
                '@type': 'owl:Restriction',
                onProperty: 'obo:OBI_0000293', // obi:has_specified_input
                someValuesFrom: { '@id': phylorefId },
              },
            ],
          },
        });
      });

      // Does this node have taxonomic units? If so, convert them into class expressions.
      if (has(node, 'representsTaxonomicUnits')) {
        node.representsTaxonomicUnits.forEach((tunit) => {
          convertTUtoRestriction(tunit).forEach((restriction) => {
            node['@type'].push({
              '@type': 'owl:Restriction',
              onProperty: 'obo:CDAO_0000187',
              someValuesFrom: restriction,
            });
          });
        });
      }
    });

    // Set a '@context' so it can be interpreted from other objects in the output file.
    phylogenyAsJSONLD['@context'] = PHYX_CONTEXT_JSON;
    phylogenies.push(phylogenyAsJSONLD);
  });
});

/* Construct an object to represent the Clade Ontology itself. */
let cladeOntologyObjects = [
  {
    '@context': PHYX_CONTEXT_JSON,
    '@id': CLADE_ONTOLOGY_BASEURI,
    '@type': 'owl:Ontology',
    'owl:imports': [
      'http://raw.githubusercontent.com/phyloref/curation-workflow/develop/ontologies/phyloref_testcase.owl',
      'http://ontology.phyloref.org/2018-12-14/phyloref.owl',
      'http://ontology.phyloref.org/2018-12-14/tcan.owl',
    ],
  },
];

/* Add all the phyloreferences and phylogenies to the JSON-LD file being prepared. */
cladeOntologyObjects = cladeOntologyObjects.concat(phylorefs);
if (!argv.no_phylogenies) { // if the --no-phylogenies command line option was NOT true
  cladeOntologyObjects = cladeOntologyObjects.concat(phylogenies);
}

/* Write the list of Clade Ontology objects to STDOUT. */
process.stdout.write(JSON.stringify(
  cladeOntologyObjects,
  null,
  4
));
