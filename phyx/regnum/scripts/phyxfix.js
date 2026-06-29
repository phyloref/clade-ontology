#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const lodash = require('lodash');

/*
 * An application for fixing Phyx files.
 */

// Read command line arguments.
const argv = require('yargs')
  .usage("$0 [source files]")
  .describe('compare-to', 'A directory containing "fixed" Phyx files.')
  .required('compare-to')
  .help()
  .alias('h', 'help')
  .argv

const filenames = argv._;

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

function readJSON(filename) {
  return JSON.parse(fs.readFileSync(filename));
}

function fixSpecifiers(phyloref, source, comparison) {
  console.info(`For phyloref ${phyloref.label} (Regnum ID ${phyloref.regnumId})`);
  if(source === undefined || comparison === undefined) return;
  source.forEach((specifier, index) => {
    if (!lodash.has(specifier, 'hasName')) return;
    if (!lodash.has(comparison[index], 'hasName')) return;

    const sourceName = specifier.hasName.nameComplete;
    const sourceLabel = specifier.hasName.label;

    const comparisonName = comparison[index].hasName.nameComplete;
    const comparisonLabel = comparison[index].hasName.label;

    console.info(` - Comparing ${sourceLabel} with ${comparisonLabel}`);

    if (sourceName !== "" && sourceName === comparisonName) {
      // Safe to replace old label with new label!
      source[index].hasName.label = comparisonLabel;
    } else {
      console.warn(`Cannot fix ${sourceLabel}: ${sourceName} doesn't match ${comparisonName}`)
    }
  });
}

function fixJSON(source, comparison) {
  source.phylorefs.forEach((phyloref, index) => {
    const comparisonPhyloref = comparison.phylorefs[index];
    fixSpecifiers(phyloref, phyloref.internalSpecifiers, comparisonPhyloref.internalSpecifiers);
    fixSpecifiers(phyloref, phyloref.externalSpecifiers, comparisonPhyloref.externalSpecifiers);
  });

  return source;
}

files.forEach(file => {
  // Is there a comparison? If not, no fixing is possible.
  const filename = path.basename(file);
  const comparisonFile = path.join(argv.compareTo, filename)
  if (!fs.existsSync(comparisonFile)) {
    console.warn(`Could not find a comparison for file ${filename} at ${comparisonFile}.`);
  } else {
    // console.info(`Comparing ${file} with ${comparisonFile}.`);
    const content = readJSON(file);
    const comparison = readJSON(comparisonFile);
    const fixedJSON = fixJSON(content, comparison);
    if (fixedJSON !== undefined) {
      const fixedJSONString = JSON.stringify(fixedJSON, null, 4);
      fs.writeFileSync(
        file,
        fixedJSONString
      );
    } else {
      console.info(`No corrections made to ${file}`);
    }
  }
});
