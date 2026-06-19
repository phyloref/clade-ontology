/*
 * lib/phylogenies.js: Shared helpers for the standalone reference-phylogeny store.
 *
 * Reference phylogenies are curated Newick trees used to validate that phyloreferences
 * resolve to the clade their authors intended. Historically each tree was embedded in the
 * Phyx file(s) that cited it, which duplicated trees across files and entangled curated
 * phylogenies with phyloreferences that are regenerated wholesale from PhyloRegnum.
 *
 * The store in `phylogenies/` holds one deduplicated tree per file. Each store file is a
 * valid Phyx file (a top-level `phylogenies` array with a single phylogeny) plus a custom
 * top-level `referenceFor` array mapping the tree to the phyloreferences it is a reference
 * for, keyed by the stable `CLADO_NNNNNNN` filename stem / `regnumId`.
 *
 * This module deliberately avoids importing `@phyloref/phyx`'s package index (which pulls in
 * PhyxWrapper → jsonld; see regnum2phyx/regnum2phyx.js), so it stays loadable from plain
 * scripts.
 */

const fs = require('node:fs');
const path = require('node:path');

// Default location of the reference-phylogeny store, relative to the repository root.
const PHYLOGENIES_DIR = 'phylogenies';

/**
 * Recursively collect every `*.json` file under a directory. Mirrors the walkers in
 * test/test_phyx.js and phyx2ontology/phyx2ontology.js so the same files are seen.
 */
function findJSONFiles(dirPath) {
  return fs.readdirSync(dirPath).flatMap((filename) => {
    const filePath = path.join(dirPath, filename);
    if (fs.lstatSync(filePath).isDirectory()) return findJSONFiles(filePath);
    if (filePath.endsWith('.json')) return [filePath];
    return [];
  });
}

/**
 * Canonicalize a Newick string for deduplication and verification. Phylonym newicks contain
 * incidental whitespace and newlines that are not semantically meaningful, so we collapse all
 * whitespace runs to a single space and trim. This is intentionally conservative: it does not
 * reorder clades or strip whitespace adjacent to punctuation.
 */
function normalizeNewick(newick) {
  return String(newick).replace(/\s+/g, ' ').trim();
}

/**
 * Load every store file under `dir`. Returns an array of { file, data } where `data` is the
 * parsed JSON.
 */
function loadStore(dir = PHYLOGENIES_DIR) {
  if (!fs.existsSync(dir)) return [];
  return findJSONFiles(dir).map((file) => ({
    file,
    data: JSON.parse(fs.readFileSync(file, 'utf8')),
  }));
}

/**
 * Build a reverse index from a loaded store: Map<cladoId, Array<{ file, phylogeny, entry }>>,
 * where `entry` is the matching `referenceFor` element and `phylogeny` is the store file's
 * (single) phylogeny object.
 */
function buildReferenceIndex(store) {
  const index = new Map();
  for (const { file, data } of store) {
    const phylogeny = (data.phylogenies || [])[0];
    for (const entry of data.referenceFor || []) {
      const list = index.get(entry.clado) || [];
      list.push({ file, phylogeny, entry });
      index.set(entry.clado, list);
    }
  }
  return index;
}

module.exports = {
  PHYLOGENIES_DIR,
  findJSONFiles,
  normalizeNewick,
  loadStore,
  buildReferenceIndex,
};
