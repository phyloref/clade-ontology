/*
 * scripts/phylogenies/extract-phylogenies.js
 *
 * Round 1 of moving reference phylogenies into a standalone, deduplicated store (see
 * lib/phylogenies.js). This script COPIES every Newick-bearing phylogeny out of the
 * phyx/phylonym/ Phyx files into phylogenies/PHYLO_NNNN.json, collapsing trees that appear in
 * multiple files into a single store file with one `referenceFor` entry per source.
 *
 * IMPORTANT: this is a copy, not a move. It does NOT modify any file under phyx/. A future
 * round will regenerate the Phyx files without their phylogenies once we have verified the
 * copy is faithful. Until that round lands, everything the source phylogeny carries has to
 * survive the copy — a citation dropped here becomes a permanent loss the moment phyx/ is
 * stripped — so every citation key is copied, and the citations of sources that disagree are
 * preserved on their `referenceFor` entries rather than being reported and discarded.
 *
 * Scoped to phyx/phylonym/, which holds only plain Phyx JSON. Unparseable files are warned
 * about and skipped; pointing this at phyx/ as a whole would silently reduce the git-crypt
 * files in phyx/encrypted/ to warnings rather than the explicit magic-byte skip that
 * test_phyx.js and phyx2ontology.js perform.
 *
 * Usage:
 *   node scripts/phylogenies/extract-phylogenies.js [sourceDir] -o [storeDir] --report [csv]
 *   (defaults: sourceDir=phyx/phylonym, storeDir=phylogenies, report=phylogenies/extraction-report.csv)
 */

const fs = require('node:fs');
const path = require('node:path');
const { isEqual } = require('lodash');
const yargs = require('yargs');

const {
  findStoreFiles,
  loadIdLedger,
  newickFingerprint,
  normalizeNewick,
  saveIdLedger,
  scanSourcePhylogenies,
  PHYLOGENIES_DIR,
} = require('../../lib/phylogenies');
const { findJSONFiles } = require('../../lib/files');
const { escapeCSV } = require('../../lib/csv');

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [sourceDir] -o [storeDir] --report [csv]')
  .option('o', {
    alias: 'output',
    describe: 'Directory to write the phylogeny store into',
    default: PHYLOGENIES_DIR,
  })
  .option('report', {
    describe: 'Path to write the CSV extraction report to',
    default: path.join(PHYLOGENIES_DIR, 'extraction-report.csv'),
  })
  .option('digits', {
    describe: 'Number of digits to zero-pad PHYLO identifiers to',
    default: 4,
  })
  .option('force', {
    describe: 'Allow a run that would retire more than half of the existing store files',
    type: 'boolean',
    default: false,
  })
  .help('h').alias('h', 'help').argv;

const sourceDir = argv._[0] || path.join('phyx', 'phylonym');
const storeDir = argv.o;

// Recognized citation keys on a phylogeny entry, in order of preference. All of the keys a
// phylogeny carries are copied into the store; the first one present is the "primary" citation
// used for the derived label.
const CITATION_KEYS = ['primaryPhylogenyCitation', 'phylogenyCitation'];

const CONTEXT = 'http://www.phyloref.org/phyx.js/context/v1.1.0/phyx.json';

/** Numeric value of a CLADO id, for deterministic ordering by source. */
const cladoNum = (id) => {
  const m = /(\d+)/.exec(id || '');
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
};

/** Numeric value of a PHYLO id, for computing the ledger's high-water mark. */
const phyloNum = (id) => {
  const m = /^PHYLO_(\d+)$/.exec(id || '');
  return m ? Number.parseInt(m[1], 10) : 0;
};

/** Order two occurrences by their source: earliest CLADO id, then phylogeny index. */
const byClado = (a, b) => a.cladoNumValue - b.cladoNumValue || a.phyloIndex - b.phyloIndex;

/** The citation used for the label and the store file's primary citation, if any. */
const primaryCitation = (citations) => citations[CITATION_KEYS.find((k) => citations[k])];

/** Build a short human-readable label from a citation object (best-effort, derived). */
function deriveLabel(citation) {
  if (!citation) return undefined;
  const authors = citation.authors || [];
  let who;
  if (authors.length === 1) who = authors[0].lastname || authors[0].name;
  else if (authors.length === 2) {
    who = `${authors[0].lastname || authors[0].name} & ${authors[1].lastname || authors[1].name}`;
  } else if (authors.length > 2) who = `${authors[0].lastname || authors[0].name} et al.`;
  const parts = [];
  if (who) parts.push(who);
  if (citation.year) parts.push(String(citation.year));
  let label = parts.join(' ');
  // Only qualify a label we actually have; a bare ", fig. 3" is worse than no label.
  if (label && citation.figure) label = `${label}, fig. ${citation.figure}`;
  return label || undefined;
}

/** Return the first DOI string found in a citation's identifier array, normalized. */
function citationDOI(citation) {
  if (!citation) return undefined;
  const ids = citation.identifier || [];
  const doi = ids.find((i) => i.type === 'doi');
  return doi ? String(doi.id).toLowerCase().replace(/^https?:\/\/doi\.org\//, '') : undefined;
}

/** Every DOI an occurrence's citations carry (a phylogeny may hold more than one citation). */
const occurrenceDOIs = (occ) => Object.values(occ.citations).map(citationDOI).filter(Boolean);

/** Fail with a message rather than a stack trace, leaving the store untouched. */
function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Scan source files and collect every Newick-bearing phylogeny occurrence.
// ---------------------------------------------------------------------------

const sourceFiles = findJSONFiles(sourceDir).sort();
// { cladoId, cladoNumValue, regnumId, phyloIndex, newick, normNewick, citations }
const occurrences = scanSourcePhylogenies(sourceFiles).map(({ cladoId, regnumId, phyloIndex, phylogeny }) => {
  // Copy *every* citation key the phylogeny carries, not just the preferred one: at least one
  // phylonym phylogeny (CLADO_0000030) has both, and the store is about to become the only copy.
  const citations = {};
  for (const key of CITATION_KEYS) if (phylogeny[key]) citations[key] = phylogeny[key];
  return {
    cladoId,
    cladoNumValue: cladoNum(cladoId),
    regnumId,
    phyloIndex,
    newick: phylogeny.newick,
    normNewick: normalizeNewick(phylogeny.newick),
    citations,
  };
});

// ---------------------------------------------------------------------------
// 2. Group occurrences by normalized Newick (deduplication).
// ---------------------------------------------------------------------------

const groups = new Map(); // normNewick -> occurrence[]
for (const occ of occurrences) {
  const list = groups.get(occ.normNewick) || [];
  list.push(occ);
  groups.set(occ.normNewick, list);
}

// Sort each group's occurrences once so its earliest (canonical) source is element [0],
// then order the groups by that canonical source for deterministic PHYLO numbering.
const orderedGroups = [...groups.values()]
  .map((group) => [...group].sort(byClado))
  .sort((a, b) => byClado(a[0], b[0]));

if (orderedGroups.length === 0) {
  die(`no Newick-bearing phylogenies found in ${sourceDir}; refusing to empty ${storeDir}/`);
}

// ---------------------------------------------------------------------------
// 3. Assign PHYLO ids.
//
// PHYLO ids must survive re-runs: the store is regenerated whenever phyx/phylonym/ changes,
// and positional numbering would renumber every tree after an insertion. Each tree keeps the
// id already assigned to its Newick, and an id that has ever been assigned is never handed to
// a different tree — which is why the ledger, not the files on disk, is the source of truth:
// the file of a retired id is gone, so the files alone would let its id be recycled.
// ---------------------------------------------------------------------------

const ledger = loadIdLedger(storeDir);
const usedIds = new Set(Object.keys(ledger.ids));
const idByFingerprint = new Map();

// Ledger entries first, lowest id winning if two ids somehow share a fingerprint...
for (const id of Object.keys(ledger.ids).sort()) {
  const fingerprint = ledger.ids[id]?.newickSHA256;
  if (fingerprint && !idByFingerprint.has(fingerprint)) idByFingerprint.set(fingerprint, id);
}

// ...then the store files on disk, which are authoritative for the trees currently stored (and
// are the only source of ids on the first run after the ledger was introduced).
const existingById = new Map(); // phyloId -> { fingerprint, label }
for (const file of findStoreFiles(storeDir)) {
  const phyloId = path.basename(file, '.json');
  const previous = (JSON.parse(fs.readFileSync(file, 'utf8')).phylogenies || [])[0];
  if (!previous?.newick) continue;
  const fingerprint = newickFingerprint(previous.newick);
  existingById.set(phyloId, { fingerprint, label: previous.label });
  idByFingerprint.set(fingerprint, phyloId);
  usedIds.add(phyloId);
}

let nextNum = Math.max(ledger.nextId, ...[...usedIds].map((id) => phyloNum(id) + 1), 1) - 1;
function allocateId() {
  let candidate;
  do {
    nextNum += 1;
    candidate = `PHYLO_${String(nextNum).padStart(argv.digits, '0')}`;
  } while (usedIds.has(candidate));
  usedIds.add(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// 4. Build the new store in memory.
// ---------------------------------------------------------------------------

const reportHeader = [
  'phylo_id', 'num_references', 'clado_ids', 'label', 'citation_doi',
  'newick_whitespace_variants', 'citation_divergence', 'alternate_citations',
].join(',');
const reportRows = [];

const newFiles = new Map(); // phyloId -> { contents, fingerprint, label }
let divergent = 0;
let alternates = 0;

for (const group of orderedGroups) {
  // Canonical occurrence = earliest source (group is already byClado-sorted); its original
  // newick and citations win.
  const canonical = group[0];
  const fingerprint = newickFingerprint(canonical.normNewick);
  const phyloId = idByFingerprint.get(fingerprint) || allocateId();

  const phylogeny = {};
  const label = deriveLabel(primaryCitation(canonical.citations));
  if (label) phylogeny.label = label;
  Object.assign(phylogeny, canonical.citations);
  phylogeny.newick = canonical.newick;

  // group is already byClado-sorted, so the references come out in (cladoId, phyloIndex) order.
  // A source whose citations differ from the canonical one keeps its own copy here: these are
  // usually the same publication recorded with more or fewer authors and identifiers, and
  // which version happens to sit in the earliest-numbered file is an accident.
  const referenceFor = group.map((o) => {
    const entry = { clado: o.cladoId, regnumId: o.regnumId, sourcePhylogenyIndex: o.phyloIndex };
    if (o !== canonical && !isEqual(o.citations, canonical.citations)) {
      entry.citations = o.citations;
      alternates += 1;
    }
    return entry;
  });

  const storeFile = {
    '@context': CONTEXT,
    phylogenies: [phylogeny],
    // An empty phyloref list keeps each store file a complete, valid Phyx document
    // (PhyxWrapper.asJSONLD iterates `phylorefs`); the trees are linked to phylorefs via
    // the custom `referenceFor` mapping below instead.
    phylorefs: [],
    referenceFor,
  };

  newFiles.set(phyloId, {
    contents: `${JSON.stringify(storeFile, null, 4)}\n`,
    fingerprint,
    label,
  });

  // Report diagnostics.
  const whitespaceVariants = new Set(group.map((o) => o.newick)).size;
  const dois = new Set(group.flatMap(occurrenceDOIs));
  if (dois.size > 1) divergent += 1;
  reportRows.push([
    phyloId,
    referenceFor.length,
    escapeCSV(referenceFor.map((r) => r.clado).join(' ')),
    escapeCSV(label || ''),
    escapeCSV([...dois].join(' ')),
    whitespaceVariants,
    dois.size > 1 ? 'YES' : '',
    referenceFor.filter((r) => r.citations).length,
  ].join(','));
}

// ---------------------------------------------------------------------------
// 5. Swap the new store in.
// ---------------------------------------------------------------------------

const retiring = [...existingById.keys()].filter((id) => !newFiles.has(id));
if (retiring.length > existingById.size / 2 && !argv.force) {
  // Almost always a mis-aimed run: `sourceDir` is a bare positional and `-o` defaults to
  // phylogenies/, so pointing the extractor at a different corner of phyx/ would otherwise
  // quietly replace the whole committed store.
  die(
    `this run would retire ${retiring.length} of the ${existingById.size} store files in `
    + `${storeDir}/, keeping only ${newFiles.size - (existingById.size - retiring.length)} new `
    + `tree(s) from ${sourceDir}. Re-run with --force if that is really what you want.`,
  );
}

fs.mkdirSync(storeDir, { recursive: true });
// Write the complete new store into a sibling temp directory before touching the real one, so
// a failure part-way through (an unwritable file, a full disk) leaves the store as it was
// rather than half-deleted. The renames below are into the same directory, so they are cheap
// and cannot fail for being cross-device.
const tmpDir = fs.mkdtempSync(path.join(storeDir, '.extract-'));
try {
  for (const [phyloId, { contents }] of newFiles) {
    fs.writeFileSync(path.join(tmpDir, `${phyloId}.json`), contents);
  }
  for (const phyloId of newFiles.keys()) {
    fs.renameSync(path.join(tmpDir, `${phyloId}.json`), path.join(storeDir, `${phyloId}.json`));
  }
  // Only now remove the store files whose tree is gone from the source (leave README etc.).
  for (const phyloId of retiring) fs.rmSync(path.join(storeDir, `${phyloId}.json`));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// Record every id this store has ever used, so a retired id is never reissued. A tree that
// comes back later matches its retired entry's fingerprint and takes its original id again.
const ids = { ...ledger.ids };
for (const [phyloId, { fingerprint, label }] of existingById) {
  ids[phyloId] = { newickSHA256: fingerprint, ...(label ? { label } : {}) };
}
for (const [phyloId, { fingerprint, label }] of newFiles) {
  ids[phyloId] = { newickSHA256: fingerprint, ...(label ? { label } : {}) };
}
for (const phyloId of Object.keys(ids)) {
  if (!newFiles.has(phyloId)) ids[phyloId].retired = true;
}
saveIdLedger(storeDir, {
  nextId: Math.max(ledger.nextId, nextNum + 1, ...Object.keys(ids).map((id) => phyloNum(id) + 1)),
  ids,
});

// Reused ids mean the rows are no longer emitted in id order; sort so the committed report
// diffs minimally between runs (ids are zero-padded, so lexicographic order is numeric).
reportRows.sort();

fs.mkdirSync(path.dirname(argv.report), { recursive: true });
fs.writeFileSync(argv.report, `${[reportHeader, ...reportRows].join('\n')}\n`);

// ---------------------------------------------------------------------------
// 6. Summary to STDERR.
// ---------------------------------------------------------------------------

process.stderr.write(
  `Scanned ${sourceFiles.length} Phyx files in ${sourceDir}.\n`
  + `Found ${occurrences.length} Newick-bearing phylogenies → ${orderedGroups.length} unique trees.\n`
  + `Wrote ${orderedGroups.length} store files to ${storeDir}/ and a report to ${argv.report}.\n`
  + `${retiring.length} store file(s) retired; their ids stay reserved in the id ledger.\n`
  + `${divergent} tree(s) had divergent citation DOIs across sources (see report); `
  + `${alternates} differing source citation(s) kept on their referenceFor entries.\n`,
);
