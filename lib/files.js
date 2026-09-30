/*
 * lib/files.js: Filesystem helpers shared by every tool that walks this repository.
 *
 * The Phyx directories are walked by the test suite (test/test_phyx.js), the ontology build
 * (phyx2ontology/phyx2ontology.js) and the phylogeny tooling (lib/phylogenies.js). They used to
 * carry three near-identical copies of the walker below, which had already drifted apart
 * (phyx2ontology.js followed symlinks, test_phyx.js did not); keep the single copy here so
 * they cannot drift again.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Recursively collect every `*.json` file under a directory, in `readdir` order.
 *
 * Symlinks are followed, as phyx2ontology.js's own walker (`statSync`) always did, so a
 * symlinked subdirectory is built and tested like any other. Each directory is visited once
 * by its real path, so a symlink back up the tree cannot send the walk into a loop.
 */
function findJSONFiles(dirPath, visited = new Set()) {
  const realPath = fs.realpathSync(dirPath);
  if (visited.has(realPath)) return [];
  visited.add(realPath);
  return fs.readdirSync(dirPath).flatMap((filename) => {
    const filePath = path.join(dirPath, filename);
    if (fs.statSync(filePath).isDirectory()) return findJSONFiles(filePath, visited);
    if (filePath.endsWith('.json')) return [filePath];
    return [];
  });
}

module.exports = { findJSONFiles };
