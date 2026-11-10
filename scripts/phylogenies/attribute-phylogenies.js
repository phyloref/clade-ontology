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
 * Each curator's ORCID comes from ORCID_BY_CURATOR below and fills the ledger's curator_orcid
 * column. Per-tree attribution inside the data itself waits on the store-model decision.
 *
 * Usage:
 *   node scripts/phylogenies/attribute-phylogenies.js [-o <csv>] [--store <dir>] [--paths <p>...]
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yargs = require('yargs');

const { normalizeNewick, loadStore, PHYLOGENIES_DIR } = require('../../lib/phylogenies');
const { escapeCSV, parseCSVRow } = require('../../lib/csv');

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
    default: ['phyx/phylonym/', 'phyx/encrypted/phylonym/', 'private/phylonym/'],
  })
  .help('h').alias('h', 'help').argv;

/*
 * Paths the Phylonym trees have lived under, defaulted in --paths above: phyx/phylonym/ is where
 * they are now, the encrypted directory is where they were until the 2021 move and where the
 * unmerged curation branches still write, and private/phylonym/ is where the first 2018 files
 * were added, before "Reorganized PHYX files into a single folder" moved them. Without it that
 * move is the earliest commit to hold their trees, and it claims them.
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
 * Curator -> ORCID, as the full https URI ORCID asks to be cited by. Supplied by the maintainer
 * and checked against each ORCID record's public name. The ledger's curator_orcid column is
 * regenerated from this on every run, hand-set curators included, so a new curator's ORCID goes
 * here rather than into the CSV. A curator missing from this table gets a blank.
 */
const ORCID_BY_CURATOR = new Map([
  ['Anna Becker', 'https://orcid.org/0009-0005-6085-1100'],
  ['Rebecca Stubbs', 'https://orcid.org/0000-0001-7386-2830'],
]);

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

/*
 * git-crypt decrypts by path, using the .gitattributes in the working tree, and private/ has no
 * git-crypt rule any more: its blobs would come back encrypted. Read them with the attributes of
 * the directory they moved to.
 */
const attributesPath = (file) => file.replace(/^private\//, 'phyx/encrypted/');

/** Normalized Newick strings present in a Phyx file at a given revision. */
function newicksAt(rev, file) {
  const text = git('cat-file', '--textconv', `--path=${attributesPath(file)}`, `${rev}:${file}`);
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
const log = git('log', '--all', '--format=%H|%aI|%cI|%s', '--', ...HISTORICAL_PATHS).trim();

/*
 * The 2018-2020 history was rebased across branches, so the same transcription appears under
 * several hashes. Collapsing on (author date, subject) keeps one commit per real event --
 * otherwise whichever duplicate is walked first wins arbitrarily and the hash recorded is a coin
 * toss. Of the copies, keep the one committed first: the original, not a later rebase of it.
 */
const byEvent = new Map();
for (const line of log.split('\n').filter(Boolean)) {
  const [hash, date, committed, ...rest] = line.split('|');
  const subject = rest.join('|');
  const key = `${date}|${subject}`;
  const copy = { hash, date, committed: Date.parse(committed), subject };
  if (!byEvent.has(key) || copy.committed < byEvent.get(key).committed) byEvent.set(key, copy);
}
/*
 * Walk oldest first, so the earliest commit to introduce a tree is the one that owns it, and
 * later reorganizations and reformats cannot claim it. "Oldest" is by author date: git log orders
 * by committer date, which a rebase resets, so a transcription authored in 2020-06 and rebased in
 * 2021 would otherwise sort after a 2020-08 reformat of the same tree and lose it to that.
 */
const commits = [...byEvent.values()]
  .sort((a, b) => (Date.parse(a.date) - Date.parse(b.date)) || (a.committed - b.committed));

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

const header = ['phylo_id', 'curator', 'curator_orcid', 'introduced_in', 'commit_date', 'commit_subject'].join(',');
const rows = [];
const tally = new Map();

/*
 * Curators corrected by hand must survive regeneration, the same way the extractor preserves
 * PHYLO ids across runs. Commit messages cannot name everyone -- some trees are introduced by
 * maintenance commits ("Fixed specifier authorities in Phyx files") that credit nobody,
 * and their real transcriber is only knowable from outside the repository. So a curator already
 * written into the ledger wins over a blank we would derive; re-running never silently discards
 * an edit. A derived name still takes precedence, so fixing CURATORS above propagates.
 */
const existing = new Map();
if (fs.existsSync(argv.o)) {
  // Parsed, not split on commas: a hand-set curator may be quoted ("Becker, Anna", or two names),
  // and a naive split would truncate it and add another layer of quotes on every run.
  const [columns, ...lines] = fs.readFileSync(argv.o, 'utf8').trim().split('\n').map(parseCSVRow);
  const curatorColumn = columns.indexOf('curator');
  for (const fields of lines) {
    const [phyloId] = fields;
    const curator = fields[curatorColumn];
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
    ORCID_BY_CURATOR.get(curator) || '',
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
