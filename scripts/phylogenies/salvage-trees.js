/*
 * scripts/phylogenies/salvage-trees.js
 *
 * Recovers curated reference phylogenies from branches that were never merged, by writing them
 * into the phyx/phylonym/ file of the phyloreference they were transcribed for.
 *
 * Every phyloref in phyx/phylonym/ already declares its reference phylogenies as citation slots
 * (one `primaryPhylogenyCitation` plus any number of `phylogenyCitation` entries), and most slots
 * carry no Newick. Each tree on these branches was transcribed against a publication one of those
 * slots already cites, so salvage is mechanical, and we hold it to that:
 *
 *   - The tree is only written if its source citation matches exactly one slot: on DOI, else on
 *     author surname + year + title, else on title, else on author + year (see lib/salvage.js;
 *     citationDOI rejects the malformed DOIs Phylonym contains). What matched is recorded.
 *   - An empty slot is filled. A slot that already holds a different tree is left alone, and the
 *     tree is appended as a further phylogeny repeating the slot's citation: two transcriptions
 *     of one publication, side by side. We never overwrite a curated tree, and never judge which
 *     transcription is the better one.
 *   - Re-running is a no-op once a tree is in place, so this can be run again to regenerate the
 *     provenance ledger.
 *
 * Source files live on git-crypt encrypted branches. `git cat-file --textconv` applies git-crypt's
 * diff filter, so an unlocked repository can read them without checking the branches out (a linked
 * worktree looks for keys under .git/worktrees/<name>/git-crypt and fails).
 *
 * Usage:
 *   node scripts/phylogenies/salvage-trees.js [--dry-run] [--ledger <csv>]
 *   (then re-run scripts/phylogenies/extract-phylogenies.js to regenerate the store)
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yargs = require('yargs');

const {
  citationDOI,
  rawCitationDOI,
  normalizeNewick,
  PHYLOGENIES_DIR,
} = require('../../lib/phylogenies');
const {
  readSourceTree,
  matchSlot,
  translateNodeProperties,
  placeTree,
} = require('../../lib/salvage');
const { escapeCSV } = require('../../lib/csv');

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [--dry-run] [--ledger <csv>]')
  .option('dry-run', {
    describe: 'Report what would be written without modifying any file',
    type: 'boolean',
    default: false,
  })
  .option('ledger', {
    describe: 'Path to write the provenance CSV to',
    default: path.join(PHYLOGENIES_DIR, 'salvage-provenance.csv'),
  })
  .option('source-dir', {
    describe: 'Directory of target Phyx files',
    default: path.join('phyx', 'phylonym'),
  })
  .help('h').alias('h', 'help').argv;

/*
 * The trees to salvage, and where each comes from: every Newick at the tip of either branch.
 *
 * Order matters where two trees want the same slot. The 2020 branch goes first because the trees
 * already on master descend from that curation pass, so its tree takes an empty slot and the 2018
 * tree for the same publication is appended after it -- the same arrangement the 2018 trees get
 * wherever master already holds a tree.
 */
const SOURCES = {
  'add-support-for-testing-against-open-tree': {
    pr: 79,
    rev: 'origin/add-support-for-testing-against-open-tree',
    // Same CLADO_NNNNNNN.json names as the target, under the since-emptied encrypted directory.
    file: (clado) => `phyx/encrypted/phylonym/${clado}.json`,
    clados: [
      'CLADO_0000002', // Lobelioideae
      'CLADO_0000018', // Asteridae
      'CLADO_0000020', // Campanulaceae
      'CLADO_0000021', // Campanuloideae
      'CLADO_0000023', // Caniformia
      'CLADO_0000024', // Caryophyllales
      'CLADO_0000027', // Chlorophyta
      'CLADO_0000031', // Coniferae
      'CLADO_0000032', // Convolvulaceae
      'CLADO_0000044', // Feliformia
      'CLADO_0000165', // Cnidaria
      'CLADO_0000247', // Apiidae
      'CLADO_0000279', // Galloanserae -- master already holds a different tree for this citation
      'CLADO_0000280', // Cuculidae
      'CLADO_0000297', // Foraminifera
    ],
  },
  summer_curation: {
    pr: 45,
    rev: 'origin/summer_curation',
    // 2018 curation-tool format: per-clade filenames, and the citation sits at the top level of
    // the file rather than on the phylogeny.
    file: (clado) => `phyx/encrypted/phylonym/${{
      CLADO_0000008: 'phyloref.amorphea.Minge2009.2.json',
      CLADO_0000009: 'phyloref.amphibia.Vallin2004.json',
      CLADO_0000011: 'phyloref.angiospermae.Doyle2018.json',
      CLADO_0000014: 'phloref.Apo-Spermatophyta.Hilton_Bateman_2006.json',
      CLADO_0000015: 'phyloref.Apo-Tracheophyte.Crane.2004.json',
      CLADO_0000016: 'phyloref.Archaeplastida.Burki.2008.json',
      CLADO_0000018: 'phyloref.Asteridae.Soltis2011.json',
      CLADO_0000019: 'phloref.Basidomycota.James_2006.json',
      CLADO_0000020: 'phyloref.Campanulaceae.Tank2010.json',
      CLADO_0000022: 'phyloref.Bignoniaceae.Olmstead.2009.json',
      CLADO_0000023: 'phyloref.caniformia.Flynn2005.json',
      CLADO_0000027: 'phyloref.Chlorophyta.Cocquyt.2009.json',
      CLADO_0000035: 'phyloref.Dikarya.Bauer.2015.json',
      CLADO_0000036: 'phyloref.Discicristata.Hampl.2009.json',
    }[clado]}`,
    clados: [
      'CLADO_0000008', // Amorphea
      'CLADO_0000009', // Amphibia
      'CLADO_0000011', // Angiospermae -- filename says 2018, the citation is Doyle 2008
      'CLADO_0000014', // Apo-Spermatophyta
      'CLADO_0000015', // Apo-Tracheophyta
      'CLADO_0000016', // Archaeplastida
      'CLADO_0000018', // Asteridae
      'CLADO_0000019', // Basidiomycota
      'CLADO_0000020', // Campanulaceae
      'CLADO_0000022', // Bignoniaceae
      'CLADO_0000023', // Caniformia
      'CLADO_0000027', // Chlorophyta
      'CLADO_0000035', // Dikarya
      'CLADO_0000036', // Discicristata
    ],
    // The Chlorophyta file marks its expected node as "Chlorphyta"; the node in its Newick is
    // labelled "Chlorophyta", so as written the annotation points at nothing.
    nodeLabelFixes: { CLADO_0000027: { Chlorphyta: 'Chlorophyta' } },
  },
};

/** Read a file from a git revision, decrypting git-crypt blobs via the configured diff filter. */
function readFromRev(rev, file) {
  return ChildProcess.execFileSync('git', ['cat-file', '--textconv', `${rev}:${file}`], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();
}

/** Rough tip count: labels that follow an opening paren or comma in the Newick string. */
function countTips(newick) {
  return (normalizeNewick(newick).match(/[(,]\s*[^(),:;]+/g) || []).length;
}

/**
 * The commit that introduced this tree: the one that added the Newick to the source file, or the
 * commit that added the file if the tree arrived with it.
 */
function provenance(rev, file, newick) {
  // The subject carries the attribution the author field does not: every commit here is authored
  // by the maintainer, while the transcriber is named in prose ("...from Anna", "...from RS").
  const format = '%H%x09%an%x09%aI%x09%s';
  // A distinctive slice of the tree finds the commit that introduced it even if the file already
  // existed. Newick punctuation is safe inside a -S pickaxe string.
  const needle = normalizeNewick(newick).slice(10, 50);
  for (const args of [
    ['log', `-S${needle}`, `--format=${format}`, rev, '--', file],
    ['log', '--diff-filter=A', `--format=${format}`, rev, '--', file],
  ]) {
    const out = ChildProcess.execFileSync('git', args, { maxBuffer: 1024 * 1024 }).toString().trim();
    // git log is newest-first, and a tree removed and re-added matches more than once. The
    // introducing commit is the oldest match, so take the last line rather than passing -1.
    if (out) return out.split('\n').pop().split('\t');
  }
  return [];
}

/** Fold a multi-line note onto one line: the ledger is read back a line at a time. */
const oneLine = (text) => String(text || '').split(/\s*\n\s*/).filter(Boolean).join(' / ');

// ---------------------------------------------------------------------------
// Salvage each tree, or explain why it was skipped.
// ---------------------------------------------------------------------------

const ledgerHeader = [
  'clado_id', 'label', 'source_pr', 'source_branch', 'source_commit', 'commit_author',
  'commit_subject', 'commit_date', 'source_path', 'target_slot', 'action', 'matched_on',
  'citation_doi', 'figure', 'tip_count', 'newick_chars', 'expected_at_node',
  'expectation_as_written', 'curator_comments',
].join(',');
const ledgerRows = [];
const skipped = [];
const tally = { filled: 0, appended: 0 };
let written = 0;

// Two candidates can target one file, and the second must see what the first did to it, in a dry
// run too. So each target is parsed once and written back at the end.
const targets = new Map(); // path -> { json, changed }
function loadTarget(targetPath) {
  if (!targets.has(targetPath)) {
    targets.set(targetPath, { json: JSON.parse(fs.readFileSync(targetPath, 'utf8')), changed: false });
  }
  return targets.get(targetPath);
}

for (const [branch, source] of Object.entries(SOURCES)) {
  for (const clado of source.clados) {
    const sourcePath = source.file(clado);
    const targetPath = path.join(argv.sourceDir, `${clado}.json`);
    try {
      const loaded = loadTarget(targetPath);
      const target = loaded.json;
      const tree = readSourceTree(JSON.parse(readFromRev(source.rev, sourcePath)));
      const slot = matchSlot(target, tree);
      const { properties, notes } = translateNodeProperties(
        tree,
        target.phylorefs?.[0]?.label,
        source.nodeLabelFixes?.[clado],
      );

      const placed = placeTree(target, tree, slot, properties);
      tally[placed.action] += 1;
      if (placed.written) {
        written += 1;
        loaded.changed = true;
      }

      const [commit = '', author = '', date = '', subject = ''] = provenance(source.rev, sourcePath, tree.newick);
      ledgerRows.push([
        clado,
        escapeCSV(target.phylorefs?.[0]?.label || ''),
        source.pr,
        branch,
        commit,
        escapeCSV(author),
        escapeCSV(subject),
        date,
        escapeCSV(sourcePath),
        `${placed.index}:${slot.key}`,
        placed.action,
        escapeCSV(slot.how),
        escapeCSV(citationDOI(tree.citation) || rawCitationDOI(tree.citation) || ''),
        escapeCSV(tree.figure || ''),
        countTips(tree.newick),
        normalizeNewick(tree.newick).length,
        escapeCSV(notes.map((n) => n.node).join(' ')),
        // What the source file said, where we changed it: the node label it keyed the expectation
        // on, and its own name for the phyloreference.
        escapeCSV(notes.map((n) => `${n.writtenNode} => ${JSON.stringify(n.writtenPhyloref)}`).join('; ')),
        escapeCSV(oneLine(tree.curatorComments)),
      ].join(','));
    } catch (e) {
      skipped.push(`${clado} (#${source.pr}): ${e.message}`);
    }
  }
}

if (!argv.dryRun) {
  for (const [targetPath, { json, changed }] of targets) {
    // Every file in phyx/phylonym/ round-trips exactly through 4-space JSON.stringify with no
    // trailing newline, so re-serializing keeps the diff to the lines we actually changed.
    if (changed) fs.writeFileSync(targetPath, JSON.stringify(json, null, 4));
  }
}

fs.mkdirSync(path.dirname(argv.ledger), { recursive: true });
ledgerRows.sort();
fs.writeFileSync(argv.ledger, `${[ledgerHeader, ...ledgerRows].join('\n')}\n`);

const summary = [
  `${argv.dryRun ? 'Would write' : 'Wrote'} ${written} tree(s) into ${argv.sourceDir}/.`,
  `${ledgerRows.length} tree(s) in place: ${tally.filled} filling a citation slot, `
    + `${tally.appended} appended beside one.`,
  `Wrote provenance to ${argv.ledger}.`,
  ...(skipped.length ? [`Skipped ${skipped.length}:`, ...skipped.map((s) => `  - ${s}`)] : []),
];
process.stderr.write(`${summary.join('\n')}\n`);

// A candidate that fails its checks means the candidate list and the data have diverged. Say so
// with the exit code: a salvage that quietly dropped a tree is how one gets lost.
if (skipped.length) process.exit(1);
