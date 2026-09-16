/*
 * scripts/phylogenies/salvage-trees.js
 *
 * Recovers curated reference phylogenies from branches that were never merged, by writing their
 * Newick strings into the phylogeny citation slots in phyx/phylonym/ that have been waiting for
 * them.
 *
 * Every phyloref in phyx/phylonym/ already declares its reference phylogenies as citation slots
 * (one `primaryPhylogenyCitation` plus any number of `phylogenyCitation` entries) and only 160 of
 * the 682 slots carry a Newick. The trees on these branches fill some of the empty ones: each was
 * transcribed against a publication the target slot already cites, so salvage is filling in a
 * field, not transcribing a tree.
 *
 * That makes the operation mechanical, and we hold it to that:
 *
 *   - The tree is only written if the source citation and the target slot agree on their DOI
 *     (see citationDOI, which rejects the malformed DOIs Phylonym contains), or, for sources with
 *     no usable DOI, on author surname + year + title. Exactly one slot must match.
 *   - The target slot must be empty. We never overwrite a curated tree; a tree that would is a
 *     contested candidate, not a salvage.
 *   - Re-running is a no-op once a tree is in place, so this can be run again to regenerate the
 *     provenance ledger.
 *
 * Source files live on git-crypt encrypted branches. `git cat-file --textconv` applies git-crypt's
 * diff filter, so an unlocked repository can read them without checking the branches out (a linked
 * worktree looks for keys under .git/worktrees/<name>/git-crypt and fails).
 *
 * Contested candidates -- rival transcriptions of the same figure, challengers to trees we already
 * have -- are deliberately out of scope. See the issue on the long-term store model.
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
  CITATION_KEYS,
  PHYLOGENIES_DIR,
} = require('../../lib/phylogenies');
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
 * The trees to salvage, and where each comes from.
 *
 * Only the uncontested ones: a single candidate tree, for a phyloref that has no tree of its own
 * yet. Asteridae and Campanulaceae belong here because the tree listed below matches the
 * publication their primary slot already cites; the rival trees on `summer_curation` cite
 * different publications that match no slot, which makes them additions to decide on, not
 * salvage.
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
      'CLADO_0000024', // Caryophyllales
      'CLADO_0000031', // Coniferae
      'CLADO_0000032', // Convolvulaceae
      'CLADO_0000044', // Feliformia
      'CLADO_0000165', // Cnidaria
      'CLADO_0000247', // Apiidae
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
    }[clado]}`,
    clados: [
      'CLADO_0000008', // Amorphea
      'CLADO_0000009', // Amphibia
      'CLADO_0000011', // Angiospermae -- filename says 2018, the citation is Doyle 2008
    ],
  },
};

/** Read a file from a git revision, decrypting git-crypt blobs via the configured diff filter. */
function readFromRev(rev, file) {
  return ChildProcess.execFileSync('git', ['cat-file', '--textconv', `${rev}:${file}`], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();
}

/** First author surname + year + lowercased title, for sources with no usable DOI. */
function citationFingerprint(citation) {
  if (!citation) return undefined;
  const first = (citation.authors || [])[0];
  const who = (first?.lastname || first?.name || '').trim().toLowerCase();
  const title = String(citation.title || '').trim().toLowerCase().replace(/[.\s]+$/, '');
  if (!who || !citation.year || !title) return undefined;
  return `${who}|${citation.year}|${title}`;
}

/**
 * Describe the tree to salvage out of a source file: its Newick, the citation it was transcribed
 * against, and any figure note. Handles both source formats -- the 2020 files carry the citation
 * on the phylogeny, the 2018 files at the top level of the document.
 */
function readSourceTree(json) {
  const bearing = (json.phylogenies || []).filter((p) => (p.newick || '').trim());
  if (bearing.length !== 1) {
    throw new Error(`expected exactly one Newick-bearing phylogeny, found ${bearing.length}`);
  }
  const [phylogeny] = bearing;
  const onPhylogeny = CITATION_KEYS.map((k) => phylogeny[k]).find(Boolean);
  // The 2018 format records doi/title/citation as top-level strings; synthesize the little we
  // need from them so both formats compare the same way.
  const topLevel = json.doi || json.title
    ? {
      title: json.title,
      identifier: json.doi ? [{ type: 'doi', id: json.doi }] : [],
    }
    : undefined;
  return {
    newick: phylogeny.newick,
    citation: onPhylogeny || topLevel,
    figure: phylogeny.description,
  };
}

/**
 * Find the single citation slot in `target` that the source citation belongs to. Returns
 * { index, key, citation } or throws explaining why the match was not unique.
 */
function matchSlot(target, sourceCitation) {
  const slots = (target.phylogenies || []).map((phylogeny, index) => {
    const key = CITATION_KEYS.find((k) => phylogeny[k]);
    return { index, key, phylogeny, citation: key ? phylogeny[key] : undefined };
  });

  const sourceDOI = citationDOI(sourceCitation);
  let matches;
  let how;
  if (sourceDOI) {
    matches = slots.filter((s) => citationDOI(s.citation) === sourceDOI);
    how = `doi:${sourceDOI}`;
  } else {
    // Cuculidae's citation is a book with no DOI at all, so fall back to the bibliographic
    // fingerprint rather than refusing to salvage it.
    const fingerprint = citationFingerprint(sourceCitation);
    if (!fingerprint) {
      const raw = rawCitationDOI(sourceCitation) || 'none';
      throw new Error(`no usable DOI (raw: ${raw}) and no author+year+title to fall back on`);
    }
    matches = slots.filter((s) => citationFingerprint(s.citation) === fingerprint);
    how = `fingerprint:${fingerprint}`;
  }

  if (matches.length !== 1) {
    throw new Error(
      `${matches.length} of ${slots.length} citation slots match ${how}, expected exactly 1`,
    );
  }
  return { ...matches[0], how };
}

// ---------------------------------------------------------------------------
// Salvage each tree, or explain why it was skipped.
// ---------------------------------------------------------------------------

const ledgerHeader = [
  'clado_id', 'label', 'source_pr', 'source_branch', 'source_commit', 'commit_author',
  'commit_date', 'source_path', 'target_slot', 'matched_on', 'citation_doi', 'figure',
  'tip_count', 'newick_chars',
].join(',');
const ledgerRows = [];
const skipped = [];
let written = 0;

for (const [branch, source] of Object.entries(SOURCES)) {
  for (const clado of source.clados) {
    const sourcePath = source.file(clado);
    const targetPath = path.join(argv.sourceDir, `${clado}.json`);
    try {
      const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      const tree = readSourceTree(JSON.parse(readFromRev(source.rev, sourcePath)));
      const slot = matchSlot(target, tree.citation);

      const existing = (slot.phylogeny.newick || '').trim();
      if (existing) {
        if (normalizeNewick(existing) === normalizeNewick(tree.newick)) {
          skipped.push(`${clado}: already salvaged`);
        } else {
          skipped.push(`${clado}: slot ${slot.index} already holds a different tree -- contested`);
          continue;
        }
      } else if (!argv.dryRun) {
        slot.phylogeny.newick = tree.newick;
        // Figure-level notes ("Vallin and Laurin 2004 Fig. 6") say which figure was transcribed,
        // which the target slots do not record. Keep it where the source had one and we do not.
        if (tree.figure && !slot.phylogeny.description) {
          slot.phylogeny.description = tree.figure;
        }
        // Every file in phyx/phylonym/ round-trips exactly through 4-space JSON.stringify with no
        // trailing newline, so re-serializing keeps the diff to the lines we actually changed.
        fs.writeFileSync(targetPath, JSON.stringify(target, null, 4));
        written += 1;
      } else {
        written += 1;
      }

      const [commit = '', author = '', date = ''] = provenance(source.rev, sourcePath, tree.newick);
      ledgerRows.push([
        clado,
        escapeCSV(target.phylorefs?.[0]?.label || ''),
        source.pr,
        branch,
        commit,
        escapeCSV(author),
        date,
        escapeCSV(sourcePath),
        `${slot.index}:${slot.key}`,
        escapeCSV(slot.how),
        escapeCSV(citationDOI(tree.citation) || rawCitationDOI(tree.citation) || ''),
        escapeCSV(tree.figure || ''),
        countTips(tree.newick),
        normalizeNewick(tree.newick).length,
      ].join(','));
    } catch (e) {
      skipped.push(`${clado}: ${e.message}`);
    }
  }
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
  const format = '%H%x09%an%x09%aI';
  // A distinctive slice of the tree finds the commit that introduced it even if the file already
  // existed. Newick punctuation is safe inside a -S pickaxe string.
  const needle = normalizeNewick(newick).slice(10, 50);
  for (const args of [
    ['log', '-1', `-S${needle}`, `--format=${format}`, rev, '--', file],
    ['log', '-1', '--diff-filter=A', `--format=${format}`, rev, '--', file],
  ]) {
    const out = ChildProcess.execFileSync('git', args, { maxBuffer: 1024 * 1024 }).toString().trim();
    if (out) return out.split('\t');
  }
  return [];
}

fs.mkdirSync(path.dirname(argv.ledger), { recursive: true });
ledgerRows.sort();
fs.writeFileSync(argv.ledger, `${[ledgerHeader, ...ledgerRows].join('\n')}\n`);

const summary = [
  `${argv.dryRun ? 'Would salvage' : 'Salvaged'} ${written} tree(s) into ${argv.sourceDir}/.`,
  `Wrote provenance for ${ledgerRows.length} tree(s) to ${argv.ledger}.`,
  ...(skipped.length ? [`Skipped ${skipped.length}:`, ...skipped.map((s) => `  - ${s}`)] : []),
];
process.stderr.write(`${summary.join('\n')}\n`);

// A salvage that silently did nothing is a failure, not a no-op: the guards are there to catch a
// mismatch, and a mismatch means the candidate list and the data have diverged.
if (!ledgerRows.length) {
  process.stderr.write('No trees salvaged -- every candidate failed its checks.\n');
  process.exit(1);
}
