/*
 * scripts/phylogenies/attribute-phylogenies.js
 *
 * Records who transcribed each reference phylogeny in the store, by mining the commit that
 * introduced its Newick.
 *
 * Git authorship is no help here: every commit in this repository is authored by the maintainer
 * who committed it, so the curators who actually transcribed these trees -- Anna, and RS
 * (Rebecca Stubbs, per the title of PR #45) -- appear nowhere in the author field. What we have
 * instead is commit *messages*: "Imported phylogenies curated by Anna", "Added new phyloreferences
 * from RS". CURATORS below maps those subjects onto curators.
 *
 * Tracing backwards from a tree does not work. `git log -S<newick>` bottoms out at whichever
 * commit moved the file -- "Renamed from REGNUM_ to CLADO_", "Reorganized PHYX files into a single
 * folder", the 2021 move out of phyx/encrypted/ -- rather than the commit that transcribed the
 * tree, and phyx/phylonym/ itself has only two commits in its history. So we walk forwards
 * instead: oldest commit first, and the first commit to introduce a given Newick owns it.
 *
 * This is why the attribution is committed as data rather than derived on demand. Every path move
 * degrades what history can tell us, round 2 will rewrite phyx/ again, and the expansion of "RS"
 * to a full name exists only in a GitHub pull request title. Capture it while it is still legible.
 *
 * Full names and identifiers (ORCIDs) are not recoverable from the repository; the `curator`
 * column holds the name as the commit messages give it, and is meant to be corrected by hand.
 * Per-tree attribution inside the data itself waits on the store-model decision.
 *
 * Usage:
 *   node scripts/phylogenies/attribute-phylogenies.js [-o <csv>] [--store <dir>] [--paths <p>...]
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yargs = require('yargs');

const { normalizeNewick, loadStore, PHYLOGENIES_DIR } = require('../../lib/phylogenies');
const { escapeCSV } = require('../../lib/csv');

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [-o <csv>] [--store <dir>]')
  .option('o', {
    alias: 'output',
    describe: 'Path to write the attribution CSV to',
    default: path.join(PHYLOGENIES_DIR, 'attribution.csv'),
  })
  .option('store', { describe: 'Store directory to attribute', default: PHYLOGENIES_DIR })
  .option('paths', {
    describe: 'Repository paths whose history to walk',
    type: 'array',
    default: ['phyx/phylonym/', 'phyx/encrypted/phylonym/'],
  })
  .help('h').alias('h', 'help').argv;

/*
 * Paths the Phylonym trees have lived under, defaulted in --paths above: phyx/phylonym/ is where
 * they are now, and the encrypted directory is where they were until the 2021 move and where the
 * unmerged curation branches still write.
 */
const HISTORICAL_PATHS = argv.paths;

/*
 * Commit subject -> curator. Ordered; the first match wins.
 *
 * "Updated phylogenies with latest" (2020-08-09, 30 trees) names nobody, but it sits between two
 * commits that credit Anna explicitly and uses the same phrasing as "Updated phylogenies with
 * latest from Anna". Attributing it to her is a judgement call, confirmed with the maintainer
 * rather than inferred by this script -- hence the explicit pattern rather than a loose fallback.
 */
const CURATORS = [
  [/\bAnna\b/i, 'Anna'],
  [/^Updated phylogenies with latest\.?$/i, 'Anna'],
  [/\bfrom RS\b|\bby RS\b|\bRS\.?$/, 'RS'],
];

/** Run git, returning stdout, or '' if the command failed (e.g. a path absent at that commit). */
function git(...args) {
  try {
    return ChildProcess.execFileSync('git', args, {
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return '';
  }
}

/** Normalized Newick strings present in a Phyx file at a given revision. */
function newicksAt(rev, file) {
  const text = git('cat-file', '--textconv', `${rev}:${file}`);
  if (!text) return new Set();
  try {
    const phylogenies = JSON.parse(text).phylogenies || [];
    return new Set(
      phylogenies.map((p) => p.newick || '').filter((n) => n.trim()).map(normalizeNewick),
    );
  } catch {
    // Unparseable at this revision (mid-edit, or a format we no longer read). Not fatal: some
    // other commit will own the tree.
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// 1. Index the store by normalized Newick.
// ---------------------------------------------------------------------------

const phyloIdByNewick = new Map();
for (const { file, data } of loadStore(argv.store)) {
  const newick = (data.phylogenies || [])[0]?.newick;
  if (newick) phyloIdByNewick.set(normalizeNewick(newick), path.basename(file, '.json'));
}

// ---------------------------------------------------------------------------
// 2. Walk every commit that touched a Phylonym path, oldest first.
// ---------------------------------------------------------------------------

// --all so the unmerged curation branches are included: that is where several of these trees were
// transcribed, and PR #45 in particular is destined to be closed.
const log = git('log', '--all', '--format=%H|%aI|%s', '--', ...HISTORICAL_PATHS).trim();

/*
 * The 2018-2020 history was rebased across branches, so the same transcription appears under
 * several hashes. Collapsing on (date, subject) keeps one commit per real event -- otherwise
 * whichever duplicate is walked first wins arbitrarily and the hash recorded is a coin toss.
 */
const byEvent = new Map();
for (const line of log.split('\n').filter(Boolean)) {
  const [hash, date, ...rest] = line.split('|');
  const subject = rest.join('|');
  const key = `${date}|${subject}`;
  if (!byEvent.has(key)) byEvent.set(key, { hash, date, subject });
}
// git log is newest-first; reverse so the earliest commit to introduce a tree is the one that owns
// it, and later reorganizations and reformats cannot claim it.
const commits = [...byEvent.values()].reverse();

const introducedBy = new Map(); // phyloId -> commit
for (const commit of commits) {
  if (introducedBy.size === phyloIdByNewick.size) break;
  // --root so a root commit diffs against the empty tree; without it diff-tree prints nothing
  // for one, and a tree introduced by a repository's first commit would never be attributed.
  const changed = git(
    'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', commit.hash,
    '--', ...HISTORICAL_PATHS,
  ).trim();
  for (const file of changed.split('\n').filter((f) => f.endsWith('.json'))) {
    const after = newicksAt(commit.hash, file);
    if (!after.size) continue;
    const before = newicksAt(`${commit.hash}^`, file);
    for (const newick of after) {
      if (before.has(newick)) continue;
      const phyloId = phyloIdByNewick.get(newick);
      if (phyloId && !introducedBy.has(phyloId)) introducedBy.set(phyloId, commit);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Emit the ledger.
// ---------------------------------------------------------------------------

const header = ['phylo_id', 'curator', 'introduced_in', 'commit_date', 'commit_subject'].join(',');
const rows = [];
const tally = new Map();

/*
 * Curators corrected by hand must survive regeneration, the same way the extractor preserves
 * PHYLO ids across runs. Commit messages cannot name everyone -- eight trees are introduced by
 * reformatting commits ("Updated Newicks", "Fixed specifier authorities") that credit nobody,
 * and their real transcriber is only knowable from outside the repository. So a curator already
 * written into the ledger wins over a blank we would derive; re-running never silently discards
 * an edit. A derived name still takes precedence, so fixing CURATORS above propagates.
 */
const existing = new Map();
if (fs.existsSync(argv.o)) {
  for (const line of fs.readFileSync(argv.o, 'utf8').trim().split('\n').slice(1)) {
    const [phyloId, curator] = line.split(',');
    if (phyloId && curator) existing.set(phyloId, curator);
  }
}

for (const phyloId of [...phyloIdByNewick.values()].sort()) {
  const commit = introducedBy.get(phyloId);
  const derived = commit
    ? (CURATORS.find(([pattern]) => pattern.test(commit.subject)) || [])[1] || ''
    : '';
  const curator = derived || existing.get(phyloId) || '';
  tally.set(curator || '(unattributed)', (tally.get(curator || '(unattributed)') || 0) + 1);
  rows.push([
    phyloId,
    escapeCSV(curator),
    commit ? commit.hash.slice(0, 12) : '',
    commit ? commit.date.slice(0, 10) : '',
    escapeCSV(commit ? commit.subject : ''),
  ].join(','));
}

fs.mkdirSync(path.dirname(argv.o), { recursive: true });
fs.writeFileSync(argv.o, `${[header, ...rows].join('\n')}\n`);

const summary = [...tally.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([who, n]) => `  ${String(n).padStart(4)}  ${who}`);
process.stderr.write(
  `Attributed ${introducedBy.size} of ${phyloIdByNewick.size} store trees `
  + `across ${commits.length} commits.\n${summary.join('\n')}\nWrote ${argv.o}.\n`,
);
