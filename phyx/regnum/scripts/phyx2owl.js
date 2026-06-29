#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const phyx = require('@phyloref/phyx');

/*
 * An application for converting input Phyx files to OWL ontologies.
 */

// Read command line arguments.
const argv = require('yargs')
  .usage("$0 [files to convert into OWL ontologies]")
  .describe('max-internal-specifiers', 'The maximum number of internal specifiers (phylorefs with more than this number will be ignored)')
  .default('max-internal-specifiers', 8)
  .describe('max-external-specifiers', 'The maximum number of external specifiers (phylorefs with more than this number will be ignored)')
  .default('max-external-specifiers', 8)
  .help()
  .alias('h', 'help')
  .argv

const filenames = argv._;

/*
 * Get a list of all files in a directory. We will recurse into directories and choose files that meet the
 * criteria in the function `check(filename) => boolean`.
 */
function getFilesInDir(dir, check = (filename => filename.toLowerCase().endsWith(".json"))) {
  // console.debug(`Processing file: ${dir}`)
  if (!fs.existsSync(dir)) return [];

  const lsync = fs.lstatSync(dir);
  if (lsync.isFile()) {
    if (!check(dir)) {
      // console.log(`Skipping ${dir}.`)
      return [];
    } else {
      return [dir];
    }
  } else if (lsync.isDirectory()) {
    const files = fs.readdirSync(dir);
    return files.map(file => getFilesInDir(path.join(dir, file), check))
      .reduce((acc, curr) => acc.concat(curr), [])
      .filter(filename => filename);
  } else {
    // console.debug(`${dir} is neither a file nor a directory; skipping.`);
    return [];
  }
}
const files = filenames.map(filename => getFilesInDir(filename)).reduce((acc, curr) => acc.concat(curr), []);
// console.debug(`Files to process: ${files.join(", ")}`);

/*
 * Convert the input file into the output filename.
 * If no argOutputFilename is given, we generate one from the input
 * filename: either by replacing '.json' with '.owl', or by concatenating
 * '.owl' at the end.
 */
function convertFileToOWL(filename, argOutputFilename = "") {
  // console.debug(`Starting with ${filename}.`);
  let outputFilename;
  if (argOutputFilename != "") {
    outputFilename = argOutputFilename;
  } else if (filename.toLowerCase().endsWith(".json")) {
    outputFilename = filename.substring(0, filename.length - 5) + ".owl";
  } else {
    outputFilename = filename + ".owl";
  }

  try {
    // Parse the input file into JSON.
    let phyxContent = JSON.parse(fs.readFileSync(filename));

    // Remove any phylorefs that have too many specifiers.
    const phylorefCount = (phyxContent.phylorefs || []).length;
    filteredPhylorefs = (phyxContent.phylorefs || []).filter(phyloref => {
      const wrappedPhyloref = new phyx.PhylorefWrapper(phyloref);
      const internalSpecifiersCount = wrappedPhyloref.internalSpecifiers.length;
      const externalSpecifiersCount = wrappedPhyloref.externalSpecifiers.length;
      if (internalSpecifiersCount > argv.maxInternalSpecifiers) {
        console.warn(`Phyloreference ${wrappedPhyloref.label} was skipped, since it has ${internalSpecifiersCount} internal specifiers.`);
        return false;
      } else if (externalSpecifiersCount > argv.maxExternalSpecifiers) {
        console.warn(`Phyloreference ${wrappedPhyloref.label} was skipped, since it has ${externalSpecifiersCount} external specifiers.`);
        return false;
      }
      return true;
    });
    phyxContent.phylorefs = filteredPhylorefs;

    const wrappedPhyx = new phyx.PhyxWrapper(phyxContent);
    const owlOntology = wrappedPhyx.asJSONLD();
    const owlOntologyStr = JSON.stringify(owlOntology, null, 2);
    fs.writeFileSync(
      outputFilename,
      owlOntologyStr
    );

    if (filteredPhylorefs.length == 0) {
        console.warn(`No phyloreferences in ${filename} were converted to ${outputFilename}, as they were all filtered out.`);
        return false;
    } else if (phylorefCount > filteredPhylorefs.length) {
        console.warn(`Only ${filteredPhylorefs.length} out of ${phylorefCount} were converted from ${filename} to ${outputFilename}.`);
        return true;
    } else {
        console.info(`Converted ${filename} to ${outputFilename}.`);
        return true;
    }

    return true;
  } catch(e) {
    console.error(`Could not convert ${filename} to ${outputFilename}: ${e}`);
  }
  return false;
}
const successes = files.map(file => convertFileToOWL(file));
if(successes.every(x => x)) {
  console.log(`${successes.length} files converted successfully.`);
} else {
  console.log(`Errors occurred; ${successes.filter(x => x).length} files converted successfully, ${successes.filter(x => !x).length} files failed.`);
}
