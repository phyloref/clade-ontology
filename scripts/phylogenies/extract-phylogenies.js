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
 * copy is faithful.
 *
 * Usage:
 *   node scripts/phylogenies/extract-phylogenies.js [sourceDir] -o [storeDir] --report [csv]
 *   (defaults: sourceDir=phyx/phylonym, storeDir=phylogenies, report=phylogenies/extraction-report.csv)
 */

const fs = require('node:fs');
const path = require('node:path');
const yargs = require('yargs');

const {
  findJSONFiles,
  normalizeNewick,
  scanSourcePhylogenies,
  escapeCSV,
  PHYLOGENIES_DIR,
} = require('../../lib/phylogenies');

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
  .help('h').alias('h', 'help').argv;

const sourceDir = argv._[0] || path.join('phyx', 'phylonym');
const storeDir = argv.o;

// Recognized citation keys on a phylogeny entry, in order of preference.
const CITATION_KEYS = ['primaryPhylogenyCitation', 'phylogenyCitation'];
// Keys whose presence on a phylogeny entry we treat as curator notes worth carrying over.
const NOTE_KEY_RE = /curat|note|comment/i;

const CONTEXT = 'http://www.phyloref.org/phyx.js/context/v1.1.0/phyx.json';

/** Numeric value of a CLADO id, for deterministic ordering by source. */
const cladoNum = (id) => {
  const m = /(\d+)/.exec(id || '');
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
};

/** Order two occurrences by their source: earliest CLADO id, then phylogeny index. */
const byClado = (a, b) => a.cladoNumValue - b.cladoNumValue || a.phyloIndex - b.phyloIndex;

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
  if (citation.figure) label = `${label}, fig. ${citation.figure}`;
  return label || undefined;
}

/** Return the first DOI string found in a citation's identifier array, normalized. */
function citationDOI(citation) {
  if (!citation) return undefined;
  const ids = citation.identifier || [];
  const doi = ids.find((i) => i.type === 'doi');
  return doi ? String(doi.id).toLowerCase().replace(/^https?:\/\/doi\.org\//, '') : undefined;
}

/** Extract any curator-note-like fields from a phylogeny entry. */
function extractNotes(phylogeny) {
  const notes = {};
  for (const [key, value] of Object.entries(phylogeny)) {
    if (key === 'newick' || CITATION_KEYS.includes(key)) continue;
    if (NOTE_KEY_RE.test(key)) notes[key] = value;
  }
  return notes;
}

// ---------------------------------------------------------------------------
// 1. Scan source files and collect every Newick-bearing phylogeny occurrence.
// ---------------------------------------------------------------------------

const sourceFiles = findJSONFiles(sourceDir).sort();
// { cladoId, cladoNumValue, regnumId, phyloIndex, newick, normNewick, citationKey, citation, notes }
const occurrences = scanSourcePhylogenies(sourceFiles).map(({ cladoId, regnumId, phyloIndex, phylogeny }) => {
  const citationKey = CITATION_KEYS.find((k) => phylogeny[k]);
  return {
    cladoId,
    cladoNumValue: cladoNum(cladoId),
    regnumId,
    phyloIndex,
    newick: phylogeny.newick,
    normNewick: normalizeNewick(phylogeny.newick),
    citationKey,
    citation: citationKey ? phylogeny[citationKey] : undefined,
    notes: extractNotes(phylogeny),
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

// ---------------------------------------------------------------------------
// 3. Emit one store file per group, plus a CSV report.
// ---------------------------------------------------------------------------

fs.mkdirSync(storeDir, { recursive: true });
// Clean previously generated store files so re-runs are reproducible (leave README etc.).
for (const f of fs.readdirSync(storeDir)) {
  if (/^PHYLO_\d+\.json$/.test(f)) fs.rmSync(path.join(storeDir, f));
}

const reportRows = [[
  'phylo_id', 'num_references', 'clado_ids', 'label', 'citation_doi',
  'newick_whitespace_variants', 'citation_divergence', 'notes_carried',
].join(',')];

orderedGroups.forEach((group, i) => {
  const phyloId = `PHYLO_${String(i + 1).padStart(argv.digits, '0')}`;

  // Canonical occurrence = earliest source (group is already byClado-sorted); its original
  // newick and citation win.
  const canonical = group[0];

  // Merge any curator notes found across occurrences (rare in phylonym; defensive).
  const mergedNotes = Object.assign({}, ...group.map((o) => o.notes));

  const phylogeny = {};
  const label = deriveLabel(canonical.citation);
  if (label) phylogeny.label = label;
  if (canonical.citationKey) phylogeny[canonical.citationKey] = canonical.citation;
  phylogeny.newick = canonical.newick;
  Object.assign(phylogeny, mergedNotes);

  // group is already byClado-sorted, so the references come out in (cladoId, phyloIndex) order.
  const referenceFor = group
    .map((o) => ({ clado: o.cladoId, regnumId: o.regnumId, sourcePhylogenyIndex: o.phyloIndex }));

  const storeFile = {
    '@context': CONTEXT,
    phylogenies: [phylogeny],
    // An empty phyloref list keeps each store file a complete, valid Phyx document
    // (PhyxWrapper.asJSONLD iterates `phylorefs`); the trees are linked to phylorefs via
    // the custom `referenceFor` mapping below instead.
    phylorefs: [],
    referenceFor,
  };

  fs.writeFileSync(
    path.join(storeDir, `${phyloId}.json`),
    `${JSON.stringify(storeFile, null, 4)}\n`,
  );

  // Report diagnostics.
  const whitespaceVariants = new Set(group.map((o) => o.newick)).size;
  const dois = new Set(group.map((o) => citationDOI(o.citation)).filter(Boolean));
  reportRows.push([
    phyloId,
    referenceFor.length,
    escapeCSV(referenceFor.map((r) => r.clado).join(' ')),
    escapeCSV(label || ''),
    escapeCSV([...dois].join(' ')),
    whitespaceVariants,
    dois.size > 1 ? 'YES' : '',
    escapeCSV(Object.keys(mergedNotes).join(' ')),
  ].join(','));
});

fs.mkdirSync(path.dirname(argv.report), { recursive: true });
fs.writeFileSync(argv.report, `${reportRows.join('\n')}\n`);

// ---------------------------------------------------------------------------
// 4. Summary to STDERR.
// ---------------------------------------------------------------------------

const divergent = reportRows.filter((r) => r.includes(',YES,')).length;
process.stderr.write(
  `Scanned ${sourceFiles.length} Phyx files in ${sourceDir}.\n`
  + `Found ${occurrences.length} Newick-bearing phylogenies → ${orderedGroups.length} unique trees.\n`
  + `Wrote ${orderedGroups.length} store files to ${storeDir}/ and a report to ${argv.report}.\n`
  + `${divergent} tree(s) had divergent citations across sources (see report).\n`,
);
