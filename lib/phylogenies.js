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

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Default location of the reference-phylogeny store, relative to the repository root.
const PHYLOGENIES_DIR = 'phylogenies';

// Store files are named PHYLO_NNNN.json and live directly in the store directory. Everything
// else there (README.md, the CSV report, the id ledger) is not a tree.
const STORE_FILE_REGEX = /^PHYLO_\d+\.json$/;

// The id ledger (see loadIdLedger) lives alongside the store files.
const ID_LEDGER_FILENAME = 'phylo-ids.json';

/**
 * Canonicalize a Newick string for deduplication and verification. Phylonym newicks contain
 * incidental whitespace and newlines that are not semantically meaningful, so we collapse all
 * whitespace runs to a single space and trim. This is intentionally conservative: it does not
 * reorder clades or strip whitespace adjacent to punctuation.
 */
function normalizeNewick(newick) {
  return String(newick).replace(/\s+/g, ' ').trim();
}

/** Stable fingerprint of a Newick string, used to tie a tree to its PHYLO id in the ledger. */
function newickFingerprint(newick) {
  return crypto.createHash('sha256').update(normalizeNewick(newick)).digest('hex');
}

/**
 * Scan a list of source Phyx files and return one occurrence per Newick-bearing phylogeny:
 * { file, cladoId, regnumId, phyloIndex, phylogeny }. Files that fail to parse are skipped
 * with a warning. Shared by the extraction script and the faithfulness test so both see the
 * source trees identically.
 */
function scanSourcePhylogenies(files) {
  const occurrences = [];
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      process.stderr.write(`Warning: could not parse ${file}: ${e.message}\n`);
      continue;
    }
    const cladoId = path.basename(file, '.json');
    const regnumId = (json.phylorefs || [])[0]?.regnumId;
    (json.phylogenies || []).forEach((phylogeny, phyloIndex) => {
      if (phylogeny.newick) occurrences.push({ file, cladoId, regnumId, phyloIndex, phylogeny });
    });
  }
  return occurrences;
}

/** List the store files (PHYLO_NNNN.json) in `dir`, sorted by id. */
function findStoreFiles(dir = PHYLOGENIES_DIR) {
  if (!fs.existsSync(dir)) return [];
  // Deliberately flat and pattern-matched: the store is one directory of PHYLO_NNNN.json files,
  // so a README, the CSV report, the id ledger or a stray working file cannot be mistaken for
  // a tree (compare the `phyx/` glob hazard documented in AGENTS.md).
  return fs.readdirSync(dir)
    .filter((filename) => STORE_FILE_REGEX.test(filename))
    .sort()
    .map((filename) => path.join(dir, filename));
}

/**
 * Load every store file under `dir`. Returns an array of { file, data } where `data` is the
 * parsed JSON, sorted by PHYLO id.
 */
function loadStore(dir = PHYLOGENIES_DIR) {
  return findStoreFiles(dir).map((file) => ({
    file,
    data: JSON.parse(fs.readFileSync(file, 'utf8')),
  }));
}

/**
 * The single phylogeny held by a store file. Throws an error naming the file if it is not
 * shaped like a store file, so a malformed store fails with a diagnosis rather than a
 * `Cannot read properties of undefined` further down the call stack.
 */
function storePhylogeny({ file, data }) {
  const phylogeny = (data.phylogenies || [])[0];
  if (!phylogeny || typeof phylogeny.newick !== 'string') {
    throw new Error(`${file} is not a store file: expected phylogenies[0].newick to be a string`);
  }
  return phylogeny;
}

/**
 * Build a reverse index from a loaded store: Map<cladoId, Array<{ file, phylogeny, entry }>>,
 * where `entry` is the matching `referenceFor` element and `phylogeny` is the store file's
 * (single) phylogeny object.
 */
function buildReferenceIndex(store) {
  const index = new Map();
  for (const { file, data } of store) {
    const phylogeny = storePhylogeny({ file, data });
    for (const entry of data.referenceFor || []) {
      const list = index.get(entry.clado) || [];
      list.push({ file, phylogeny, entry });
      index.set(entry.clado, list);
    }
  }
  return index;
}

/**
 * Read the PHYLO id ledger from a store directory, or an empty ledger if there is none.
 *
 * The ledger records every id the store has *ever* assigned, alive or retired, as
 * { nextId, ids: { PHYLO_NNNN: { newickSHA256, label?, retired? } } }. The store files alone
 * cannot carry this: once a tree is dropped from `phyx/` its store file is deleted, and an id
 * known only by the files on disk would be handed straight back out to an unrelated tree on
 * the next run. Keeping the ledger in the repository is what makes a PHYLO id a permanent
 * handle for one tree.
 */
function loadIdLedger(dir = PHYLOGENIES_DIR) {
  const file = path.join(dir, ID_LEDGER_FILENAME);
  if (!fs.existsSync(file)) return { nextId: 1, ids: {} };
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { nextId: ledger.nextId || 1, ids: ledger.ids || {} };
}

/** Write the PHYLO id ledger back to a store directory. */
function saveIdLedger(dir, ledger) {
  const contents = {
    comment: 'Every PHYLO id ever assigned by scripts/phylogenies/extract-phylogenies.js, so that '
      + 'retired ids are never recycled onto a different tree. Generated: do not edit by hand.',
    nextId: ledger.nextId,
    // Sorted so the committed ledger diffs minimally between runs.
    ids: Object.fromEntries(Object.keys(ledger.ids).sort().map((id) => [id, ledger.ids[id]])),
  };
  fs.writeFileSync(
    path.join(dir, ID_LEDGER_FILENAME),
    `${JSON.stringify(contents, null, 4)}\n`,
  );
}

module.exports = {
  PHYLOGENIES_DIR,
  STORE_FILE_REGEX,
  ID_LEDGER_FILENAME,
  findStoreFiles,
  normalizeNewick,
  newickFingerprint,
  scanSourcePhylogenies,
  loadStore,
  storePhylogeny,
  buildReferenceIndex,
  loadIdLedger,
  saveIdLedger,
};
