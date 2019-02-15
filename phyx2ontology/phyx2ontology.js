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
const PHYX_CONTEXT_JSON = 'http://www.phyloref.org/phyx.js/context/v0.1.0/phyx.json';
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

// Load phyx.js, our PHYX library.
const phyx = require('@phyloref/phyx');

// Helper methods.
function hasOwnProperty(obj, propName) {
  return Object.prototype.hasOwnProperty.call(obj, propName);
}

function convertTUtoRestriction(tunit) {
  // If we're called with a specifier, use the first TU in that specifier (for now).
  if(hasOwnProperty(tunit, 'referencesTaxonomicUnits')) {
    return convertTUtoRestriction(tunit.referencesTaxonomicUnits[0] || {});
  }

  // We can only do this for scientific names currently.
  const results = [];
  if(hasOwnProperty(tunit, 'scientificNames')) {
    tunit.scientificNames.forEach(sciname => {
      const wrappedSciname = new phyx.ScientificNameWrapper(sciname);

      results.push({
        '@type': 'owl:Restriction',
        'onProperty': 'http://rs.tdwg.org/ontology/voc/TaxonConcept#hasName',
        'someValuesFrom': {
          '@type': 'owl:Class',
          'intersectionOf': [
            { '@id':'obo:NOMEN_0000107' }, // ICZN -- TODO replace with a check once we close phyloref/phyx.js#5.
            {
              '@type':'owl:Restriction',
              'onProperty': 'dwc:scientificName',
              'hasValue': wrappedSciname.binomialName, // TODO: We really want the "canonical name" here: binomial or trinomial, but without any additional authority information.
            }
          ]
        }
      });
    });
  }

  return results;
}

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
const phylorefsByLabel = {};
const additionalClassesByLabel = {};

const phylorefs = [];
let specifiers = [];
for (let phyxFile of jsons) {
  for (let phyloref of phyxFile.phylorefs) {
    entityIndex += 1;
    const phylorefWrapper = new phyx.PhylorefWrapper(phyloref);
    const jsonld = phylorefWrapper.asJSONLD(getIdentifier(entityIndex));

    // Record the label of the phylorefs. We'll need this to link phylogenies to
    // the phylorefs they expect to resolve to.
    if(phylorefWrapper.label !== undefined) {
      phylorefsByLabel[phylorefWrapper.label.toString()] = jsonld;
    }

    // In Model 2.0, phyloreferences are not punned, but are specifically subclasses
    // of class Phyloreference. So let's set that up.
    delete jsonld['@type'];
    jsonld['subClassOf'] = 'phyloref:Phyloreference';

    // We also no longer use the additional classes system or the equivalent class
    // definitions, so let's get rid of those too.
    delete jsonld['equivalentClass'];
    delete jsonld['hasAdditionalClass'];

    // Finally, we still have the clade definition and other terms, but we call them by different names now.
    jsonld['obo:IAO_0000115'] = jsonld['cladeDefinition'];
    delete jsonld['cladeDefinition'];

    // Instead, from the specifiers, we construct different kinds of definitions in
    // This code will be moved into phyx.js once we're fully committed to Model 2.0,
    // but is here so we can see what the Clade Ontology would look like in Model 2.0.
    const internalSpecifiers = jsonld.internalSpecifiers || [];
    const externalSpecifiers = jsonld.externalSpecifiers || [];

    if (internalSpecifiers.length === 1 && externalSpecifiers.length === 1) {
      jsonld['equivalentClass'] = {
        '@type': 'owl:Class',
        'intersectionOf': [
          {
            '@type': 'owl:Restriction',
            'onProperty': 'phyloref:excludes_TU',
            'someValuesFrom': convertTUtoRestriction(externalSpecifiers[0])[0],
          },
          {
            '@type': 'owl:Restriction',
            'onProperty': 'phyloref:includes_TU',
            'someValuesFrom': convertTUtoRestriction(internalSpecifiers[0])[0],
          }
        ]
      }
    } else if(internalSpecifiers.length === 2 && externalSpecifiers.length === 0) {
      jsonld['equivalentClass'] = {
        '@type': 'owl:Restriction',
        'onProperty': 'obo:CDAO_0000149', // cdao:has_Child
        'someValuesFrom': {
          '@type': 'owl:Class',
          'intersectionOf': [
            {
              '@type': 'owl:Restriction',
              'onProperty': 'phyloref:excludes_TU',
              'someValuesFrom': convertTUtoRestriction(internalSpecifiers[0])[0],
            },
            {
              '@type': 'owl:Restriction',
              'onProperty': 'phyloref:includes_TU',
              'someValuesFrom': convertTUtoRestriction(internalSpecifiers[1])[0],
            }
          ]
        }
      }
    } else if(externalSpecifiers.length === 0 && internalSpecifiers.length > 0) {
      // The overall pattern here is going to be:
      // equivalentClass: [
      //  has_Child some (excludes_lineage_to some (A, B, C) and includes_TU some (D_as_restriction) ),
      //  has_Child some (excludes_lineage_to some (A, B, D) and includes_TU some (C_as_restriction) ),
      //  ...
      // ]
      // where (A, B) uses the standard 1-int 1-ext form.
      let additionalClassCount = 0;
      jsonld['hasAdditionalClass'] = [];
      function createMRCAAdditionalClass(internals, remaining) {
        // This can only really work when internals.length === 2; any more than
        // that, and we need to pass this back to createEquivalentClasses to break
        // it down further.
        if(internals.length > 2) {
          // TODO We need to replace this with an actual object-based comparison,
          // rather than trusting the labels to tell us everything.
          const additionalClassLabel = '(' + internals
            .map(i => convertTUtoRestriction(i)[0].someValuesFrom.intersectionOf[1].hasValue || '(error)')
            .sort()
            .join(',') + ')';

          if(hasOwnProperty(additionalClassesByLabel, additionalClassLabel)) {
            return { '@id': additionalClassesByLabel[additionalClassLabel]['@id'] };
          }

          additionalClassCount += 1;
          const additionalClass = {};
          additionalClass['@id'] = jsonld['@id'] + '_additional' + additionalClassCount;
          additionalClass['@type'] = 'owl:Class';
          additionalClass['subClassOf'] = 'phyloref:PhyloreferenceUsingMaximumClade';
          additionalClass['equivalentClass'] = createEquivalentClasses(internals, []);
          additionalClass['label'] = additionalClassLabel;
          jsonld['hasAdditionalClass'].push(additionalClass);

          additionalClassesByLabel[additionalClassLabel] = additionalClass;

          return {'@id': additionalClass['@id']};
        } else if(internals.length === 2) {
          return {
            '@type': 'owl:Restriction',
            'onProperty': 'obo:CDAO_0000149', // cdao:has_Child
            'someValuesFrom': {
              '@type': 'owl:Class',
              'intersectionOf': [
                {
                  '@type': 'owl:Restriction',
                  'onProperty': 'phyloref:excludes_TU',
                  'someValuesFrom': convertTUtoRestriction(internals[0])[0],
                },
                {
                  '@type': 'owl:Restriction',
                  'onProperty': 'phyloref:includes_TU',
                  'someValuesFrom': convertTUtoRestriction(internals[1])[0],
                }
              ]
            }
          }
        } else if(internals.length === 1) {
          return {
            '@type': 'owl:Restriction',
            'onProperty': 'phyloref:includes_TU',
            'someValuesFrom': convertTUtoRestriction(internals[0])[0]
          };
        } else {
          throw new Error('impossible branch');
        }
      }

      function createEquivalentClasses(remaining, selectedParam) {
        const selected = selectedParam || [];
        const results = [];

        // process.stderr.write("Remaining: "+remaining.length +", selected: " +selected.length+"\n");

        // Recursively call ourselves as long as there are more remaining.
        if(remaining.length >= selected.length) {
          remaining.forEach(newlySelected => {
            createEquivalentClasses(
              remaining.filter(i => i !== newlySelected),
              selected.concat([newlySelected]),
            ).forEach(cls => results.push(cls));
              // results.push(
              //.reduce((acc, val) => acc.concat(val), []));
          });
        }

        // Finally, add this particular set of remaining and selected.
        if(selected.length > 0) {
          results.push({
            '@type': 'owl:Restriction',
            'onProperty':'obo:CDAO_0000149', // cdao:has_Child
            'someValuesFrom': {
              '@type': 'owl:Class',
              'intersectionOf': [{
                '@type': 'owl:Restriction',
                'onProperty': 'phyloref:excludes_lineage_to',
                'someValuesFrom': createMRCAAdditionalClass(remaining)
              }, createMRCAAdditionalClass(selected, remaining)]
            }
          });
        }

        return results;
      }

      jsonld['equivalentClass'] = createEquivalentClasses(internalSpecifiers, []);
    }

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

    // Change name for including Newick.
    phylogenyAsJSONLD['phyloref:newick_expression'] = phylogenyAsJSONLD['newick'];
    delete phylogenyAsJSONLD['newick'];

    // Change how nodes are represented.
    (phylogenyAsJSONLD.nodes || []).forEach(node => {
      // Make sure this node has a '@type'.
      if(!hasOwnProperty(node, '@type')) node['@type'] = [];
      if(!Array.isArray(node['@type'])) node['@type'] = [node['@type']];

      // For every internal node in this phylogeny, check to see if it's expected to
      // resolve to a phylogeny we know about. If so, add an rdf:type to that effect.
      let expectedToResolveTo = node.labels || [];

      // Are there any phyloreferences expected to resolve here?
      if(hasOwnProperty(node, 'expectedPhyloreferenceNamed')) {
        expectedToResolveTo = expectedToResolveTo.concat(node.expectedPhyloreferenceNamed);
      }

      expectedToResolveTo.forEach(phylorefLabel => {
        if(!hasOwnProperty(phylorefsByLabel, phylorefLabel)) return;

        // This node is expected to match phylorefLabel, which is a phyloreference we know about.
        const phylorefId = phylorefsByLabel[phylorefLabel]['@id'];
        node['@type'].push({
          '@type':'owl:Restriction',
          'onProperty': 'obo:OBI_0000312', // obi:is_specified_output_of
          'someValuesFrom': {
            '@type': 'owl:Class',
            'intersectionOf': [
              { '@id':'obo:OBI_0302910' }, // obi:prediction
              {
                '@type': 'owl:Restriction',
                'onProperty': 'obo:OBI_0000293', // obi:has_specified_input
                'someValuesFrom': { '@id': phylorefId }
              }
            ]
          }
        });
      });

      // Does this node have taxonomic units? If so, convert them into class expressions.
      if(hasOwnProperty(node, 'representsTaxonomicUnits')) {
        node.representsTaxonomicUnits.forEach(tunit => {
          convertTUtoRestriction(tunit).forEach(restriction => {
            node['@type'].push({
              '@type': 'owl:Restriction',
              'onProperty': 'obo:CDAO_0000187',
              'someValuesFrom': restriction
            });
          });
        });
      }
    });

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
      'http://ontology.phyloref.org/2018-12-14/phyloref.owl',
      'http://ontology.phyloref.org/2018-12-14/tcan.owl',
    ]
  }
];
console.log(JSON.stringify(
  cladeOntology.concat(phylorefs).concat(phylogenies).concat(tunitMatches),
  null,
  4
));
