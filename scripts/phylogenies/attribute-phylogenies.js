/*
 * scripts/phylogenies/attribute-phylogenies.js
 *
 * Records who transcribed each reference phylogeny in the store, by mining the commit that
 * introduced its Newick.
 *
 * Git authorship is no help here: every commit in this repository is authored by the maintainer
 * who committed it, so the curators who actually transcribed these trees -- Anna Becker and
 * Rebecca Stubbs -- appear nowhere in the author field. What we have instead is commit *messages*,
 * which name them only as "Anna" and "RS": "Imported phylogenies curated by Anna", "Added new
 * phyloreferences from RS". CURATORS below maps those subjects onto the curators' full names.
 *
 * Where the subject names nobody, the file itself sometimes does: the 2018 curation-tool files
 * open their `curatorComments` with "Phyx file by R. Stubbs". That is the second source of
 * evidence, and the `evidence` column says which one each row rests on.
 *
 * Tracing backwards from a tree does not work. `git log -S<newick>` bottoms out at whichever
 * commit moved the file -- "Renamed from REGNUM_ to CLADO_", "Reorganized PHYX files into a single
 * folder", the 2021 move out of phyx/encrypted/ -- rather than the commit that transcribed the
 * tree, and phyx/phylonym/ itself has only two commits in its history. So we walk forwards
 * instead: oldest commit first, and the first commit to introduce a given Newick owns it.
 *
 * This is why the attribution is committed as data rather than derived on demand. Every path move
 * degrades what history can tell us, round 2 will rewrite phyx/ again, and the full names were
 * never in the repository: "RS" is expanded only in the title of PR #45, and Anna's surname was
 * supplied by the maintainer. Capture it while it is still legible.
 *
 * Identifiers (ORCIDs) are not recorded yet. Per-tree attribution inside the data itself waits on
 * the store-model decision.
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
 * Commit subject -> curator. Ordered; the first match wins. The subjects say only "Anna" and "RS";
 * the full names come from the maintainer.
 *
 * "Updated phylogenies with latest" (2020-08-09, 30 trees) names nobody, but it sits between two
 * commits that credit Anna explicitly and uses the same phrasing as "Updated phylogenies with
 * latest from Anna". Attributing it to Anna is a judgement call, confirmed with the maintainer
 * rather than inferred by this script -- hence the explicit pattern rather than a loose fallback.
 */
const CURATORS = [
  [/\bAnna\b/i, 'Anna Becker'],
  [/^Updated phylogenies with latest\.?$/i, 'Anna Becker'],
  [/\bfrom RS\b|\bby RS\b|\bRS\.?$/, 'Rebecca Stubbs'],
];

/*
 * `curatorComments` text -> curator, consulted only when the commit subject names nobody. The
 * comments are read from the file as it stood in the commit that introduced the tree.
 */
const COMMENT_CURATORS = [
  [/\bR\.\s*Stubbs\b/, 'Rebecca Stubbs'],
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

/** A Phyx file as it stood at a given revision, or undefined if it is absent or unparseable. */
function phyxAt(rev, file) {
  const text = git('cat-file', '--textconv', `${rev}:${file}`);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Unparseable at this revision (mid-edit, or a format we no longer read). Not fatal: some
    // other commit will own the tree.
    return undefined;
  }
}

/** Normalized Newick strings present in a Phyx file at a given revision. */
function newicksAt(rev, file) {
  const phylogenies = phyxAt(rev, file)?.phylogenies || [];
  return new Set(
    phylogenies.map((p) => p.newick || '').filter((n) => n.trim()).map(normalizeNewick),
  );
}

/** The curator comments on the phyloreferences of a Phyx file at a given revision. */
function curatorCommentsAt(rev, file) {
  return (phyxAt(rev, file)?.phylorefs || []).map((p) => p.curatorComments || '').join('\n');
}

/** The curator named by the first matching pattern, or ''. */
const curatorIn = (patterns, text) => (patterns.find(([pattern]) => pattern.test(text)) || [])[1] || '';

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

const introducedBy = new Map(); // phyloId -> { hash, date, subject, file }
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
      if (phyloId && !introducedBy.has(phyloId)) introducedBy.set(phyloId, { ...commit, file });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Emit the ledger.
// ---------------------------------------------------------------------------

const header = [
  'phylo_id', 'curator', 'evidence', 'introduced_in', 'commit_date', 'commit_subject',
].join(',');
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
  const fromSubject = commit ? curatorIn(CURATORS, commit.subject) : '';
  const fromComments = commit && !fromSubject
    ? curatorIn(COMMENT_CURATORS, curatorCommentsAt(commit.hash, commit.file))
    : '';
  const curator = fromSubject || fromComments || existing.get(phyloId) || '';
  // What the name rests on. A name only the ledger vouches for was put there by a person.
  const evidence = (fromSubject && 'commit subject')
    || (fromComments && 'curator comments')
    || (curator && 'set by hand')
    || '';
  tally.set(curator || '(unattributed)', (tally.get(curator || '(unattributed)') || 0) + 1);
  rows.push([
    phyloId,
    escapeCSV(curator),
    evidence,
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
