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
    describe: 'Report what would be written without modifying any file (the ledger included)',
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
 * yet. Asteridae and Campanulaceae each have a second candidate on `summer_curation`, transcribed
 * from the same publication as the tree listed below. It matches no slot only because the slot
 * carries no DOI and the 2018 file no author or year, so it is a rival transcription to decide
 * on, not salvage.
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

/**
 * Read a file from a git revision, decrypting git-crypt blobs via the configured diff filter.
 *
 * The filter is chosen by path, from the .gitattributes in the working tree, so a blob from
 * before a move (under 2018's private/, say) comes back still encrypted. `attributesPath` names
 * a path whose attributes to apply instead: pass the file's current path.
 */
function readFromRev(rev, file, attributesPath = file) {
  return ChildProcess.execFileSync(
    'git',
    ['cat-file', '--textconv', `--path=${attributesPath}`, `${rev}:${file}`],
    { maxBuffer: 256 * 1024 * 1024 },
  ).toString();
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
 * { index, key, phylogeny, how } or throws explaining why the match was not unique.
 *
 * A slot is one phylogeny, and it matches if *any* of its citation keys does: a phylogeny may
 * carry both a primaryPhylogenyCitation and a phylogenyCitation (CLADO_0000030 does), and a tree
 * transcribed against the second must still find its slot. `key` names the citation that matched.
 */
function matchSlot(target, sourceCitation) {
  const slots = (target.phylogenies || []).map((phylogeny, index) => ({
    index,
    phylogeny,
    citations: CITATION_KEYS.filter((k) => phylogeny[k]).map((key) => ({ key, citation: phylogeny[key] })),
  }));

  const sourceDOI = citationDOI(sourceCitation);
  let identify; // citation -> the identity compared
  let wanted;
  if (sourceDOI) {
    identify = citationDOI;
    wanted = sourceDOI;
  } else {
    // Cuculidae's citation is a book with no DOI at all, so fall back to the bibliographic
    // fingerprint rather than refusing to salvage it.
    const fingerprint = citationFingerprint(sourceCitation);
    if (!fingerprint) {
      const raw = rawCitationDOI(sourceCitation) || 'none';
      throw new Error(`no usable DOI (raw: ${raw}) and no author+year+title to fall back on`);
    }
    identify = citationFingerprint;
    wanted = fingerprint;
  }
  const how = `${sourceDOI ? 'doi' : 'fingerprint'}:${wanted}`;
  const matches = slots
    .map((slot) => ({ ...slot, key: slot.citations.find((c) => identify(c.citation) === wanted)?.key }))
    .filter((slot) => slot.key);

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
  'commit_subject', 'commit_date', 'source_path', 'target_slot', 'matched_on', 'citation_doi',
  'figure', 'tip_count', 'newick_chars',
].join(',');
const ledgerRows = [];
const notes = []; // Candidates already in place: expected on every re-run.
const failures = []; // Candidates that failed a check: the list and the data have diverged.
const pendingWrites = new Map(); // targetPath -> serialized Phyx, written only if nothing failed
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
          notes.push(`${clado}: already salvaged`);
        } else {
          failures.push(`${clado}: slot ${slot.index} already holds a different tree -- contested`);
          continue;
        }
      } else {
        slot.phylogeny.newick = tree.newick;
        // Figure-level notes ("Vallin and Laurin 2004 Fig. 6") say which figure was transcribed,
        // which the target slots do not record. Keep it where the source had one and we do not.
        if (tree.figure && !slot.phylogeny.description) {
          slot.phylogeny.description = tree.figure;
        }
        // Every file in phyx/phylonym/ round-trips exactly through 4-space JSON.stringify with no
        // trailing newline, so re-serializing keeps the diff to the lines we actually changed.
        pendingWrites.set(targetPath, JSON.stringify(target, null, 4));
        written += 1;
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
        `${slot.index}:${slot.key}`,
        escapeCSV(slot.how),
        escapeCSV(citationDOI(tree.citation) || rawCitationDOI(tree.citation) || ''),
        escapeCSV(tree.figure || ''),
        countTips(tree.newick),
        normalizeNewick(tree.newick).length,
      ].join(','));
    } catch (e) {
      failures.push(`${clado}: ${e.message}`);
    }
  }
}

/** Rough tip count: labels that follow an opening paren or comma in the Newick string. */
function countTips(newick) {
  return (normalizeNewick(newick).match(/[(,]\s*[^(),:;]+/g) || []).length;
}

/**
 * The commit that introduced this tree: the oldest commit in the source file's history whose copy
 * of the file holds it. Returns [hash, author, date, subject], or [] if no revision does.
 *
 * This walks forwards and compares parsed, normalized Newicks, as attribute-phylogenies.js does,
 * rather than asking `git log -S<slice of the Newick>` limited to the file's current path. That
 * stopped at whichever commit moved the file ("Renamed from REGNUM_ to CLADO_", "Reorganized PHYX
 * files into a single folder"), since to a path-limited log a move is the file appearing, tree
 * and all; and a slice cut from the normalized Newick never matched a file that stored the tree
 * across several lines. --follow carries the history across those moves, and each old copy is
 * decrypted with the current path's attributes, since 2018's private/ has no git-crypt rule now.
 */
function provenance(rev, file, newick) {
  // The subject carries the attribution the author field does not: every commit here is authored
  // by the maintainer, while the transcriber is named in prose ("...from Anna", "...from RS").
  // %x00 starts each record, so a record is its header line, then the file's path at that commit.
  const format = '%x00%H%x09%an%x09%aI%x09%s';
  const log = ChildProcess.execFileSync(
    'git',
    ['log', '--follow', '--name-only', `--format=${format}`, rev, '--', file],
    { maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  const wanted = normalizeNewick(newick);
  // git log is newest-first; the introducing commit is the oldest that holds the tree.
  for (const record of log.split('\0').filter(Boolean).reverse()) {
    const [header, ...paths] = record.split('\n').filter(Boolean);
    const [hash] = header.split('\t');
    let json;
    try {
      json = JSON.parse(readFromRev(hash, paths[0], file));
    } catch {
      continue; // Deleted at this commit, or unparseable mid-edit: some other commit holds it.
    }
    const holds = (json.phylogenies || [])
      .some((p) => (p.newick || '').trim() && normalizeNewick(p.newick) === wanted);
    if (holds) return header.split('\t');
  }
  return [];
}

/*
 * A candidate that fails its checks means the candidate list and the data have diverged. Then
 * nothing is written: the ledger has one row per tree in place, so rewriting it from this run
 * would silently drop the failed tree's provenance, and a dry run writes nothing at all.
 */
const writing = !argv.dryRun && !failures.length;
if (writing) {
  for (const [targetPath, contents] of pendingWrites) fs.writeFileSync(targetPath, contents);
  fs.mkdirSync(path.dirname(argv.ledger), { recursive: true });
  ledgerRows.sort();
  fs.writeFileSync(argv.ledger, `${[ledgerHeader, ...ledgerRows].join('\n')}\n`);
}

const summary = [
  `${writing ? 'Salvaged' : 'Would salvage'} ${written} tree(s) into ${argv.sourceDir}/.`,
  `${writing ? 'Wrote' : 'Would write'} provenance for ${ledgerRows.length} tree(s) to ${argv.ledger}.`,
  ...(notes.length ? [`Unchanged ${notes.length}:`, ...notes.map((n) => `  - ${n}`)] : []),
  ...(failures.length ? [`Failed ${failures.length}:`, ...failures.map((n) => `  - ${n}`)] : []),
];
process.stderr.write(`${summary.join('\n')}\n`);

if (failures.length) {
  process.stderr.write(`Nothing written: ${failures.length} candidate(s) failed their checks.\n`);
  process.exit(1);
}
