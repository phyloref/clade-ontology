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
  if (hasOwnProperty(tunit, 'referencesTaxonomicUnits')) {
    return convertTUtoRestriction(tunit.referencesTaxonomicUnits[0] || {});
  }

  const results = [];
  if (hasOwnProperty(tunit, 'scientificNames')) {
    tunit.scientificNames.forEach((sciname) => {
      const wrappedSciname = new phyx.ScientificNameWrapper(sciname);

      results.push({
        '@type': 'owl:Restriction',
        onProperty: 'http://rs.tdwg.org/ontology/voc/TaxonConcept#hasName',
        someValuesFrom: {
          '@type': 'owl:Class',
          intersectionOf: [
            { '@id': 'obo:NOMEN_0000107' }, // ICZN -- TODO replace with a check once we close phyloref/phyx.js#5.
            {
              '@type': 'owl:Restriction',
              onProperty: 'dwc:scientificName',
              hasValue: wrappedSciname.binomialName, // TODO: We really want the "canonical name" here: binomial or trinomial, but without any additional authority information.
            },
          ],
        },
      });
    });
  } else if (hasOwnProperty(tunit, 'includesSpecimens')) {
    tunit.includesSpecimens.forEach((specimen) => {
      const wrappedSpecimen = new phyx.SpecimenWrapper(specimen);

      results.push({
        '@type': 'owl:Restriction',
        onProperty: 'http://rs.tdwg.org/ontology/voc/TaxonConcept#circumscribedBy',
        someValuesFrom: {
          '@type': 'owl:Restriction',
          onProperty: 'dwc:organismID', // TODO Technically, this should be a token. Probably.
          hasValue: wrappedSpecimen.occurrenceID,
        },
      });
    });
  } else {
    process.stderr.write(`WARNING: taxonomic unit could not be converted into restriction: ${JSON.stringify}`);
    results.push({});
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
  const filesFound = fs.readdirSync(dirPath).map((filename) => {
    const filePath = path.join(dirPath, filename);

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      // Recurse into this directory.
      return findPHYXFiles(filePath);
    }

    if (!stats.isFile()) {
      throw new Error(`Attempted to select non-file object: ${filePath}`);
    }

    // Look for .json files (but not for '_as_owl.json' files, for historical reasons).
    if (filePath.endsWith('.json') && !filePath.endsWith('_as_owl.json')) {
      return [filePath];
    }
    return [];
  }).reduce((x, y) => x.concat(y), []); // This flattens the list of results.
  if (filesFound.length === 0) process.stderr.write(`Warning: directory ${dirPath} contains no JSON files.`);
  return filesFound;
}

// Read command-line arguments.
const argv = require('yargs')
  .usage('Usage: $0 <directories or files to convert>')
  .demandCommand(1) // Make sure there's at least one directory or file!
  .help('h')
  .alias('h', 'help')
  .argv;

// Unnamed arguments should be files or directories to be processed.
const phyxFiles = argv._.map((filenameOrDirname) => {
  const stats = fs.statSync(filenameOrDirname);
  if (stats.isDirectory()) return findPHYXFiles(filenameOrDirname);
  if (stats.isFile()) return [filenameOrDirname];
  throw new Error(`Argument ${filenameOrDirname} is neither a file nor a directory!`);
}).reduce((acc, val) => acc.concat(val), []);

if (phyxFiles.length === 0) throw new Error('No arguments provided!');

// process.stderr.write(`PHYX files to combine: ${phyxFiles}.`);

// It would be pretty easy to convert each individual PHYX file into a JSON-LD file by
// using the phyx2jsonld module. However, we would then have to identify every URI in
// the file and rename all of them, which could be confusing.
let entityIndex = 0;
function getIdentifier(index) {
  return `${CLADE_ONTOLOGY_BASEURI}#CLADO_${index.toString().padStart(8, '0')}`;
}

// Loop through our files and assemble a combined ontology.
const jsons = phyxFiles
  .map((filename) => {
    const content = fs.readFileSync(filename);

    // Some of these PHYX files are encrypted! We need to ignore those.
    if (content.slice(0, 9).equals(Buffer.from('\x00GITCRYPT'))) {
      return [];
    }

    // Try to read this PHYX file as a JSON file.
    let json;
    try {
      json = JSON.parse(content.toString('utf8'));
    } catch (err) {
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

let additionalClassCount = 0;
const additionalClassesByLabel = {};
function createAdditionalClass(jsonld, internalSpecifiers, externalSpecifiers, equivalentClassFunc) {
  // This function creates an additional class for the set of internal and external
  // specifiers provided for the equivalentClass expression provided. If one already
  // exists for this set of internal and external specifiers, we just return that
  // instead of creating a new one.
  //
  // For some reason this acts strange if equivalentClass is a string, so instead
  // I've made it into a function here.

  if (internalSpecifiers.length === 0) throw new Error('Cannot create additional class without any internal specifiers');
  if (internalSpecifiers.length === 1 && externalSpecifiers.length === 0) throw new Error('Cannot create additional class with a single internal specifiers and no external specifiers');

  // TODO We need to replace this with an actual object-based comparison,
  // rather than trusting the labels to tell us everything.
  const externalSpecifierLabel = ` ~ ${externalSpecifiers
    .map(i => convertTUtoRestriction(i)[0].someValuesFrom.intersectionOf[1].hasValue || '(error)')
    .sort()
    .join(' V ')}`;

  // Add the internal specifiers to this.
  const additionalClassLabel = `(${internalSpecifiers
    .map(i => convertTUtoRestriction(i)[0].someValuesFrom.intersectionOf[1].hasValue || '(error)')
    .sort()
    .join(' & ')
  }${externalSpecifiers.length > 0 ? externalSpecifierLabel : ''
  })`;

  process.stderr.write(`Additional class label: ${additionalClassLabel}\n`);

  if (hasOwnProperty(additionalClassesByLabel, additionalClassLabel)) {
    process.stderr.write(`Found additional class with id: ${additionalClassesByLabel[additionalClassLabel]['@id']}\n`);
    return { '@id': additionalClassesByLabel[additionalClassLabel]['@id'] };
  }

  additionalClassCount += 1;
  const additionalClass = {};
  additionalClass['@id'] = `${jsonld['@id']}_additional${additionalClassCount}`;
  process.stderr.write(`Creating new additionalClass with id: ${additionalClass['@id']}`);

  additionalClass['@type'] = 'owl:Class';
  additionalClass.subClassOf = (
    externalSpecifiers.length > 0 ? 'phyloref:PhyloreferenceUsingMinimumClade' : 'phyloref:PhyloreferenceUsingMaximumClade'
  );
  additionalClass.equivalentClass = equivalentClassFunc();
  additionalClass.label = additionalClassLabel;
  jsonld.hasAdditionalClass.push(additionalClass);

  additionalClassesByLabel[additionalClassLabel] = additionalClass;

  return { '@id': additionalClass['@id'] };
}

function getMRCA2Expression(tu1, tu2) {
  return {
    '@type': 'owl:Restriction',
    onProperty: 'obo:CDAO_0000149', // cdao:has_Child
    someValuesFrom: {
      '@type': 'owl:Class',
      intersectionOf: [
        {
          '@type': 'owl:Restriction',
          onProperty: 'phyloref:excludes_TU',
          someValuesFrom: convertTUtoRestriction(tu1)[0],
        },
        getIncludesRestrictionForTU(tu2),
      ],
    },
  };
}

function getIncludesRestrictionForTU(tu) {
  return {
    '@type': 'owl:Restriction',
    onProperty: 'phyloref:includes_TU',
    someValuesFrom: convertTUtoRestriction(tu)[0],
  };
}

function createClassExpressionsForInternals(jsonld, remainingInternals, selected) {
  // Create a class expression for a phyloref made up entirely of internal specifiers.
  //  - additionalClasses: used to store additional classes as needed.
  //  - remainingInternals: taxonomic units remaining to be included.
  //  - selected: taxonomic units that have been selected already.

  // This algorithm works like this:
  //  - 1. We start with everything remaining and nothing selected.
  //  - 2. We recurse into this method, moving everything in remaining into selected one by one.
  //    - Think of it as a tree: the root node selects each internal once, and then each child node
  //      selects one additional item from remaining, and so on.
  process.stderr.write(`@id [${jsonld['@id']}] Remaining internals: ${remainingInternals.length}, selected: ${selected.length}\n`);

  // Quick special case: if we have two 'remainingInternals' and zero selecteds,
  // we can just return the MRCA for two internal specifiers.
  if (selected.length === 0) {
    if (remainingInternals.length === 2) {
      return [getMRCA2Expression(remainingInternals[0], remainingInternals[1])];
    } if (remainingInternals.length === 1) {
      throw new Error('Cannot determine class expression for a single specifier');
    } else if (remainingInternals.length === 0) {
      throw new Error('Cannot determine class expression for zero specifiers');
    }
  }

  // Step 1. If we've already selected something, create an expression for it.
  const classExprs = [];
  if (selected.length > 0) {
    let remainingInternalsExpr = [];
    if (remainingInternals.length === 1) {
      remainingInternalsExpr = getIncludesRestrictionForTU(remainingInternals[0]);
    } else if (remainingInternals.length === 2) {
      remainingInternalsExpr = getMRCA2Expression(remainingInternals[0], remainingInternals[1]);
    } else {
      remainingInternalsExpr = createAdditionalClass(
        jsonld,
        remainingInternals,
        [],
        () => createClassExpressionsForInternals(jsonld, remainingInternals, [])
      );
    }

    let selectedExpr = [];
    if (selected.length === 1) {
      selectedExpr = getIncludesRestrictionForTU(selected[0]);
    } else if (selected.length === 2) {
      selectedExpr = getMRCA2Expression(selected[0], selected[1]);
    } else {
      selectedExpr = createAdditionalClass(
        jsonld,
        selected,
        [],
        () => createClassExpressionsForInternals(jsonld, selected, [])
      );
    }

    classExprs.push({
      '@type': 'owl:Restriction',
      onProperty: 'obo:CDAO_0000149', // cdao:has_Child
      someValuesFrom: {
        '@type': 'owl:Class',
        intersectionOf: [{
          '@type': 'owl:Restriction',
          onProperty: 'phyloref:excludes_lineage_to',
          someValuesFrom: remainingInternalsExpr,
        }, selectedExpr],
      },
    });
  }

  // Step 2. Now select everything from remaining once, and start recursing through
  // every possibility.
  // Note that we only process cases where there are more remainingInternals than
  // selected internals -- when there are fewer, we'll just end up with the inverses
  // of the previous comparisons, which we'll already have covered.
  // TODO: the other way around that would be to wrap *everything* into additional
  // classes, which might be a useful thing to do anyway.
  if (remainingInternals.length > 1 && selected.length <= remainingInternals.length) {
    remainingInternals.map((newlySelected) => {
      process.stderr.write(`Selecting new object, remaining now at: ${remainingInternals.filter(i => i !== newlySelected).length}, selected: ${selected.concat([newlySelected]).length}\n`);
      return createClassExpressionsForInternals(
        jsonld,
        remainingInternals.filter(i => i !== newlySelected), // The new remaining is the old remaining minus the selected TU.
        selected.concat([newlySelected]) // The new selected is the old selected plus the selected TU.
      );
    })
      .reduce((acc, val) => acc.concat(val), [])
      .forEach(expr => classExprs.push(expr));
  }

  return classExprs;
}

function getExclusionsForExprAndTU(includedExpr, tu) {
  if (!includedExpr) throw new Error('Exclusions require an included expression');

  const exprs = [{
    '@type': 'owl:Class',
    intersectionOf: [
      includedExpr,
      {
        '@type': 'owl:Restriction',
        onProperty: 'phyloref:excludes_TU',
        someValuesFrom: convertTUtoRestriction(tu)[0],
      },
    ],
  }];

  if (!Array.isArray(includedExpr) && hasOwnProperty(includedExpr, 'onProperty') && includedExpr.onProperty === 'phyloref:includes_TU') {
    // In this specific set of circumstances, we do NOT need to add the has_Ancestor check.
  } else {
    // Add the has_Ancestor check!
    exprs.push({
      '@type': 'owl:Class',
      intersectionOf: [
        includedExpr,
        {
          '@type': 'owl:Restriction',
          onProperty: 'obo:CDAO_0000144', // has_Ancestor
          someValuesFrom: {
            '@type': 'owl:Restriction',
            onProperty: 'phyloref:excludes_TU',
            someValuesFrom: convertTUtoRestriction(tu)[0],
          },
        },
      ],
    });
  }

  return exprs;
}

function createClassExpressionsForExternals(jsonld, accumulatedExpr, remainingExternals, selected) {
  // When creating a class expression with external specifiers, we can treat the
  // internal expression as evaluating to a particular set of nodes. Each external
  // specifier can have one of two relationships with the internal expression node:
  //  - It could directly excludes_TU the external specifier, or
  //  - It could have an ancestor that excludes_TU the external specifier.
  // For the single case, this is straightforward. But when there are multiple
  // external specifiers, we must use the same recursive algorithm we use to
  // ensure that we try them out in every possible combination.
  process.stderr.write(`@id [${jsonld['@id']}] Remaining externals: ${remainingExternals.length}, selected: ${selected.length}\n`);

  // Step 1. If we only have one external remaining, we can provide our two-case example
  // to detect it.
  const classExprs = [];
  if (remainingExternals.length === 0) {
    throw new Error('Cannot create class expression when no externals remain');
  } else if (remainingExternals.length === 1) {
    const remainingExternalsExprs = getExclusionsForExprAndTU(accumulatedExpr, remainingExternals[0], selected.length > 0);
    remainingExternalsExprs.forEach(expr => classExprs.push(expr));
  }

  // Recurse into remaining externals. Every time we select a single entry,
  // we create a class expression for that.
  else { // if(remainingExternals.length > 1)
    remainingExternals.map((newlySelected) => {
      process.stderr.write(`Selecting new object, remaining now at: ${remainingExternals.filter(i => i !== newlySelected).length}, selected: ${selected.concat([newlySelected]).length}\n`);

      const newlyAccumulatedExpr = createAdditionalClass(
        jsonld,
        jsonld.internalSpecifiers,
        selected.concat([newlySelected]),
        () => getExclusionsForExprAndTU(accumulatedExpr, newlySelected, selected.length > 0)
      );

      return createClassExpressionsForExternals(
        jsonld,
        newlyAccumulatedExpr,
        remainingExternals.filter(i => i !== newlySelected), // The new remaining is the old remaining minus the selected TU.
        selected.concat([newlySelected]) // The new selected is the old selected plus the selected TU.
      );
    })
      .reduce((acc, val) => acc.concat(val), [])
      .forEach(expr => classExprs.push(expr));
  }

  // console.dir(classExprs, { depth: null })

  return classExprs;
}

const phylorefs = [];
const specifiers = [];
for (const phyxFile of jsons) {
  for (const phyloref of phyxFile.phylorefs) {
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

    // Finally, we still have the clade definition and other terms, but we call them by different names now.
    jsonld['obo:IAO_0000115'] = jsonld.cladeDefinition;
    delete jsonld.cladeDefinition;

    // Instead, from the specifiers, we construct different kinds of definitions in
    // This code will be moved into phyx.js once we're fully committed to Model 2.0,
    // but is here so we can see what the Clade Ontology would look like in Model 2.0.
    const internalSpecifiers = jsonld.internalSpecifiers || [];
    const externalSpecifiers = jsonld.externalSpecifiers || [];

    // We might be create additional classes, so get going.
    jsonld.hasAdditionalClass = [];

    // Step 1. Figure out what the node is for all our internal specifiers.
    if (internalSpecifiers.length === 0) {
      jsonld.malformedPhyloreference = 'No internal specifiers provided';
    } else {
      const expressionsForInternals = (internalSpecifiers.length === 1)
        ? [getIncludesRestrictionForTU(internalSpecifiers[0])]
        : createClassExpressionsForInternals(jsonld, internalSpecifiers, []);

      if (externalSpecifiers.length === 0) {
        jsonld.equivalentClass = expressionsForInternals;
      } else {
        jsonld.equivalentClass = expressionsForInternals.map(
          exprForInternal => createClassExpressionsForExternals(jsonld, exprForInternal, externalSpecifiers, [])
        ).reduce((acc, val) => acc.concat(val), []);
      }
    }

    jsonld['@context'] = PHYX_CONTEXT_JSON;
    phylorefs.push(jsonld);
  }
}

const phylogenies = [];
const tunitMatches = [];
for (const phyxFile of jsons) {
  for (const phylogeny of phyxFile.phylogenies) {
    entityIndex += 1;
    const phylogenyAsJSONLD = new phyx.PhylogenyWrapper(phylogeny).asJSONLD(getIdentifier(entityIndex));

    // Change name for including Newick.
    phylogenyAsJSONLD['phyloref:newick_expression'] = phylogenyAsJSONLD.newick;
    delete phylogenyAsJSONLD.newick;

    // Change how nodes are represented.
    (phylogenyAsJSONLD.nodes || []).forEach((node) => {
      // Make sure this node has a '@type'.
      if (!hasOwnProperty(node, '@type')) node['@type'] = [];
      if (!Array.isArray(node['@type'])) node['@type'] = [node['@type']];

      // TODO remove hack: replace "parent" with "obo:CDAO_0000179" so we get has_Parent
      // relationships in our output ontology.
      if (hasOwnProperty(node, 'parent')) node['obo:CDAO_0000179'] = { '@id': node.parent };

      // For every internal node in this phylogeny, check to see if it's expected to
      // resolve to a phylogeny we know about. If so, add an rdf:type to that effect.
      let expectedToResolveTo = node.labels || [];

      // Are there any phyloreferences expected to resolve here?
      if (hasOwnProperty(node, 'expectedPhyloreferenceNamed')) {
        expectedToResolveTo = expectedToResolveTo.concat(node.expectedPhyloreferenceNamed);
      }

      expectedToResolveTo.forEach((phylorefLabel) => {
        if (!hasOwnProperty(phylorefsByLabel, phylorefLabel)) return;

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
      if (hasOwnProperty(node, 'representsTaxonomicUnits')) {
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

    phylogenyAsJSONLD['@context'] = PHYX_CONTEXT_JSON;
    phylogenies.push(phylogenyAsJSONLD);
  }
}

for (const phyloref of phylorefs) {
  let specifiers = [];
  if (hasOwnProperty(phyloref, 'internalSpecifiers')) specifiers = phyloref.internalSpecifiers;
  if (hasOwnProperty(phyloref, 'externalSpecifiers')) specifiers = specifiers.concat(phyloref.externalSpecifiers);

  for (const specifier of specifiers) {
    let countMatchedNodes = 0;

    if (hasOwnProperty(specifier, 'referencesTaxonomicUnits')) {
      for (const specifierTU of specifier.referencesTaxonomicUnits) {
        for (const phylogenyAsJSONLD of phylogenies) {
          for (const node of phylogenyAsJSONLD.nodes) {
            if (!hasOwnProperty(node, 'representsTaxonomicUnits')) continue;

            for (const nodeTU of node.representsTaxonomicUnits) {
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
      if (countMatchedNodes == 0) {
        if (!hasOwnProperty(phyloref, 'hasUnmatchedSpecifiers')) phyloref.hasUnmatchedSpecifiers = [];
        phyloref.hasUnmatchedSpecifiers.push({ '@id': specifier['@id'] });
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
    ],
  },
];
console.log(JSON.stringify(
  cladeOntology.concat(phylorefs).concat(phylogenies).concat(tunitMatches),
  null,
  4
));
