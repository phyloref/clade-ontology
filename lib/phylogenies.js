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

// Recognized citation keys on a phylogeny entry, in order of preference: the primary citation is
// the publication the reference phylogeny was taken from, the rest are related phylogenies.
const CITATION_KEYS = ['primaryPhylogenyCitation', 'phylogenyCitation'];

/** The first DOI identifier recorded on a citation, exactly as a curator entered it. */
function rawCitationDOI(citation) {
  const doi = (citation?.identifier || []).find((i) => i.type === 'doi');
  return doi ? String(doi.id).trim() : undefined;
}

/**
 * Return the first DOI found in a citation's identifier array, normalized for comparison, or
 * `undefined` if what is recorded there is not usable as an identity.
 *
 * Phylonym DOIs are entered by hand and a fair number are malformed: some carry a `doi:` or
 * `doi.org/` prefix, several are missing the leading `1` of `10.`, one holds a paper title rather
 * than a DOI at all. We strip the prefixes we recognize and reject anything not shaped like a DOI,
 * so callers comparing two citations never match on a shared piece of junk. Use `rawCitationDOI`
 * to show a curator what is actually recorded.
 */
function citationDOI(citation) {
  const raw = rawCitationDOI(citation);
  if (!raw) return undefined;
  const normalized = raw
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi\.org\//, '')
    .replace(/^doi:\s*/, '');
  // A DOI is "10.<registrant>/<suffix>"; anything else is unusable as an identity.
  return /^10\.\d{4,9}\/\S+$/.test(normalized) ? normalized : undefined;
}

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
  CITATION_KEYS,
  citationDOI,
  rawCitationDOI,
  findJSONFiles,
  normalizeNewick,
  scanSourcePhylogenies,
  loadStore,
  buildReferenceIndex,
};
