/*
 * phyx2ontology.js: A tool for synthesizing all PHYX files into a single
 * Clade Ontology in JSON-LD.
 *
 * Synopsis: phyx2ontology.js [files or directories to process] > ontology.json
 */

// Configuration options.
const PHYX_CONTEXT_JSON = 'http://www.phyloref.org/phyx.js/context/v0.2.0/phyx.json';
const CLADE_ONTOLOGY_BASEURI = 'http://phyloref.org/clade-ontology/clado.owl';

// Configuration.
/* Maximum number of internal specifiers to test. */
const MAX_INTERNAL_SPECIFIERS = process.env.MAX_INTERNAL_SPECIFIERS || 7;
/* Maximum number of external specifiers to test. */
const MAX_EXTERNAL_SPECIFIERS = process.env.MAX_EXTERNAL_SPECIFIERS || 10;

// Load necessary modules.
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');

// Load phyx.js, our PHYX library.
const phyx = require('@phyloref/phyx');

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
    if (filePath.endsWith('.json')) {
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
    // console.log(`Reading Phyx file ${filename} as JSON.`);
    const content = fs.readFileSync(filename);

    // Some of these Phyx files are encrypted! We need to ignore those.
    if (content.slice(0, 9).equals(Buffer.from('\x00GITCRYPT'))) {
      console.warn(`Could not process git-crypted Phyx file ${filename}, skipping.`);
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

    // Figure out if we should convert this phyloref.
    if (phylorefWrapper.internalSpecifiers.length > MAX_INTERNAL_SPECIFIERS) {
      console.warn(`Phyloreference ${phylorefWrapper.label} has `
        + `${phylorefWrapper.internalSpecifiers.length} internal specifiers but `
        + `the limit is ${MAX_INTERNAL_SPECIFIERS}`);
      return;
    }
    if (phylorefWrapper.externalSpecifiers.length > MAX_EXTERNAL_SPECIFIERS) {
      console.warn(`Phyloreference ${phylorefWrapper.label} has `
        + `${phylorefWrapper.externalSpecifiers.length} external specifiers but `
        + `the limit is ${MAX_EXTERNAL_SPECIFIERS}`);
      return;
    }

    // Convert to OWL/JSON-LD.
    const jsonld = phylorefWrapper.asJSONLD(getIdentifier(entityIndex));

    // Record the label of the phylorefs. We'll need this to link phylogenies to
    // the phylorefs they expect to resolve to.
    if (phylorefWrapper.label !== undefined) {
      phylorefsByLabel[phylorefWrapper.label.toString()] = jsonld;
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
