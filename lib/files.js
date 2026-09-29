/*
 * lib/files.js: Filesystem helpers shared by every tool that walks this repository.
 *
 * The Phyx directories are walked by the test suite (test/test_phyx.js), the ontology build
 * (phyx2ontology/phyx2ontology.js) and the phylogeny tooling (lib/phylogenies.js). They used to
 * carry three near-identical copies of the walker below, which had already drifted apart
 * (`statSync` vs `lstatSync`); keep the single copy here so they cannot drift again.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Recursively collect every `*.json` file under a directory, in `readdir` order.
 *
 * Uses `lstatSync`, so a symlink is never followed: a symlinked directory is ignored rather
 * than recursed into (no risk of a cycle), and a symlink whose name ends in `.json` is
 * returned as a file.
 */
function findJSONFiles(dirPath) {
  return fs.readdirSync(dirPath).flatMap((filename) => {
    const filePath = path.join(dirPath, filename);
    if (fs.lstatSync(filePath).isDirectory()) return findJSONFiles(filePath);
    if (filePath.endsWith('.json')) return [filePath];
    return [];
  });
}

module.exports = { findJSONFiles };
