/*
 * scripts/phylogenies/attribute-phylogenies.js
 *
 * Records who transcribed each reference phylogeny in the store, and who revised it since, by
 * mining the commits that wrote each version of its Newick. Writes phylogenies/attribution.json.
 *
 * Git authorship is no help here: every commit in this repository is authored by the maintainer
 * who committed it, so the curators who actually transcribed these trees -- Anna Becker and
 * Rebecca Stubbs -- appear nowhere in the author field. What we have instead is commit *messages*,
 * which name them only as "Anna" and "RS": "Imported phylogenies curated by Anna", "Added new
 * phyloreferences from RS". CURATORS below maps those subjects onto the curators' ORCIDs.
 * Where the subject names nobody, the file itself sometimes does: the 2018 curation-tool files open
 * their `curatorComments` with "Phyx file by R. Stubbs", which COMMENT_CURATORS reads for a tree's
 * first version. Each event's `curatorFrom` says which of the two its curator came from.
 *
 * Tracing backwards from a tree does not work. `git log -S<newick>` bottoms out at whichever
 * commit moved the file -- "Renamed from REGNUM_ to CLADO_", "Reorganized PHYX files into a single
 * folder", the 2021 move out of phyx/encrypted/ -- rather than the commit that transcribed the
 * tree, and phyx/phylonym/ itself has only two commits in its history. So we walk forwards
 * instead, oldest commit first.
 *
 * A tree's current Newick is often not the one first transcribed: a maintainer later added a node
 * label ("Added expectation for Ascomycota", "Manually labeled one expected resolution") or a
 * curator sent a corrected version. Crediting whoever wrote the *current* Newick would credit the
 * label fix and lose the transcriber. So the walk also records, whenever a commit replaces the
 * Newick in a phylogeny slot, which version it replaced, and each store tree is traced back
 * through those versions: the first is its `transcribed` event, every later one `revised`.
 *
 * What counts as a commit writing a version -- renames followed, merges compared with each parent,
 * rebased copies collapsed and ordered by author date, a tree pushed into the next slot not read
 * as replaced -- is explained at the code that decides it, below.
 *
 * This is why the attribution is committed as data rather than derived on demand. Every path move
 * degrades what history can tell us, round 2 will rewrite phyx/ again, and the full names were
 * never in the repository: "RS" is expanded only in the title of PR #45, and Anna's surname was
 * supplied by the maintainer. Capture it while it is still legible.
 *
 * attribution.json has three sections. `curators` (curator id -> { name }) and `overrides`
 * (phylo id -> { transcribedBy, note }) are maintained by hand and carried over untouched, so an
 * override can say in its `note` who vouched for it and when; `trees` is
 * regenerated on every run. A curator id is the curator's ORCID URI, or `curator:<slug>` for
 * someone without one. This is deliberately not the PHYLO id ledger (phylo-ids.json): that file
 * must never be edited by hand and is written by the extractor, this one is edited by hand and
 * written by this script.
 *
 * Usage:
 *   node scripts/phylogenies/attribute-phylogenies.js [-o <json>] [--store <dir>] [--paths <p>...]
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yargs = require('yargs');

const {
  normalizeNewick, loadStore, storePhylogeny, PHYLOGENIES_DIR,
} = require('../../lib/phylogenies');

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 [-o <json>] [--store <dir>] [--paths <p>...]')
  .option('o', {
    alias: 'output',
    describe: 'Path to the attribution JSON (read for its hand-maintained sections, then rewritten)',
    default: path.join(PHYLOGENIES_DIR, 'attribution.json'),
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

const ANNA_BECKER = 'https://orcid.org/0009-0005-6085-1100';
const REBECCA_STUBBS = 'https://orcid.org/0000-0001-7386-2830';

/*
 * Commit subject -> curator id. Ordered; the first match wins. The subjects say only "Anna" and
 * "RS"; who they are, and their ORCIDs, come from the maintainer. Their names live in the
 * `curators` section of attribution.json, not here.
 *
 * "Updated phylogenies with latest" (2020-08-09; transcribed 31 trees, revised a 32nd) names
 * nobody, but it sits between two commits that credit Anna explicitly and uses the same phrasing
 * as "Updated phylogenies with latest from Anna". Attributing it to Anna is a judgement call,
 * confirmed with the maintainer rather than inferred by this script -- hence the explicit pattern
 * rather than a loose fallback.
 */
const CURATORS = [
  [/\bAnna\b/i, ANNA_BECKER],
  [/^Updated phylogenies with latest\.?$/i, ANNA_BECKER],
  [/\bfrom RS\b|\bby RS\b|\bRS\.?$/, REBECCA_STUBBS],
];

/*
 * `curatorComments` text -> curator id, consulted only for a tree's first version and only when
 * the commit subject names nobody. The 2018 curation-tool files open theirs with "Phyx file by
 * R. Stubbs", and the commits that added several of them ("Added two PHYX files curated from the
 * Phylonym volume", "Fixed a typo in the phylogeny.") name no one. Not used for revisions: a file
 * keeps its original curator's comment through a maintainer's later edit.
 */
const COMMENT_CURATORS = [
  [/\bR\.\s*Stubbs\b/, REBECCA_STUBBS],
];

/** The curator id named by the first matching pattern in `text`, or undefined. */
const curatorIn = (patterns, text) => (patterns.find(([pattern]) => pattern.test(text)) || [])[1];

/** Stop with a message, leaving the existing ledger untouched. */
function die(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

/*
 * Run git from the top of the repository, so --paths are always repository paths (as diff-tree
 * reports them) whichever directory the script was started from. A failing git command stops the
 * run. It once returned '' instead, so a broken run (started outside the repository, or with
 * git-crypt locked) found no commits, blanked every derived column, rewrote the ledger and
 * exited 0.
 */
function gitIn(cwd, args) {
  try {
    return ChildProcess.execFileSync('git', args, {
      cwd,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
  } catch (e) {
    return die(`git ${args.join(' ')} failed: ${String(e.stderr || e.message).trim()}`);
  }
}
const toplevel = gitIn(undefined, ['rev-parse', '--show-toplevel']).trim();
const git = (...args) => gitIn(toplevel, args);

/*
 * git-crypt decrypts by path, using the .gitattributes in the working tree, and private/ has no
 * git-crypt rule any more: its blobs would come back encrypted. Read them with the attributes of
 * the directory they moved to.
 */
const attributesPath = (file) => file.replace(/^private\//, 'phyx/encrypted/');

/*
 * The normalized Newick of each phylogeny in one blob, read with the git-crypt attributes of
 * `file`, in slot order ('' for a slot with no tree), so a slot's old and new Newicks can be
 * paired up.
 *
 * Cached by blob, since the same file contents recur across many commits and every read costs a
 * git process plus a git-crypt decryption. Reading every blob through one `git cat-file --batch
 * --textconv` would be cheaper still, but does not work here: git (2.54) prints the *encrypted*
 * size in each record's header and then the decrypted contents, so the output cannot be split.
 */
const blobCache = new Map();
function readBlob(blob, file) {
  const key = `${blob}\t${attributesPath(file)}`;
  if (!blobCache.has(key)) {
    const text = git('cat-file', '--textconv', `--path=${attributesPath(file)}`, blob);
    let read;
    try {
      const json = JSON.parse(text);
      read = {
        newicks: (json.phylogenies || [])
          .map((p) => (String(p.newick || '').trim() ? normalizeNewick(p.newick) : '')),
        // The comments on the file's phyloreferences, for COMMENT_CURATORS.
        comments: (json.phylorefs || []).map((p) => p.curatorComments || '').join('\n'),
      };
    } catch {
      // Unparseable at this revision (mid-edit, or a format we no longer read). Not fatal: some
      // other commit will own the tree.
      read = { newicks: [], comments: '' };
    }
    blobCache.set(key, read);
  }
  return blobCache.get(key);
}
const newicksOfBlob = (blob, file) => readBlob(blob, file).newicks;

/** Whether a repository path falls under one of the --paths pathspecs. */
const underHistoricalPath = (file) => HISTORICAL_PATHS.some((spec) => file === spec
  || file.startsWith(spec.endsWith('/') ? spec : `${spec}/`));

/*
 * The JSON files under --paths that `hash` changed relative to `parent` (or, for a root commit,
 * added), as Map<path, { oldBlob, oldPath, newBlob }>. oldBlob is undefined for an added file.
 *
 * Renames are detected (-M) and the diff is not limited to --paths, so a file moved in from
 * anywhere -- "Renamed from REGNUM_ to CLADO_", or out of a directory not in --paths -- is compared
 * with its old self rather than read as new, and the move cannot claim the trees it carried.
 */
function changedFiles(hash, parent) {
  const fields = (parent
    ? git('diff-tree', '-r', '-M', '-z', '--raw', parent, hash)
    : git('diff-tree', '-r', '--root', '-z', '--raw', '--no-commit-id', hash)
  ).split('\0');
  const changed = new Map();
  for (let i = 0; i < fields.length - 1;) {
    // :<old mode> <new mode> <old blob> <new blob> <status>, then one path, or two for a rename.
    const [, , oldBlob, newBlob, status] = fields[i++].split(' ');
    const oldPath = fields[i++];
    const newPath = /^[RC]/.test(status) ? fields[i++] : oldPath;
    if (status === 'D' || !newPath.endsWith('.json') || !underHistoricalPath(newPath)) continue;
    changed.set(newPath, { oldBlob: /^0+$/.test(oldBlob) ? undefined : oldBlob, oldPath, newBlob });
  }
  return changed;
}

// ---------------------------------------------------------------------------
// 1. Index the store by normalized Newick.
// ---------------------------------------------------------------------------

const phyloIdByNewick = new Map();
// storePhylogeny throws on a malformed store file rather than skipping it: a tree skipped here
// would silently drop out of the ledger, taking any hand-set curator with it.
for (const entry of loadStore(argv.store)) {
  const { newick } = storePhylogeny(entry);
  phyloIdByNewick.set(normalizeNewick(newick), path.basename(entry.file, '.json'));
}
if (!phyloIdByNewick.size) die(`no store files found in ${argv.store}; nothing to attribute.`);

// ---------------------------------------------------------------------------
// 2. Walk every commit that touched a Phylonym path, oldest first.
// ---------------------------------------------------------------------------

// --all so the unmerged curation branches are included: that is where several of these trees were
// transcribed, and PR #45 in particular is destined to be closed.
const log = git('log', '--all', '--format=%H|%P|%aI|%cI|%s', '--', ...HISTORICAL_PATHS).trim();
if (!log) die(`no commits touch ${HISTORICAL_PATHS.join(' ')}; is --paths right?`);

/*
 * The 2018-2020 history was rebased across branches, so the same transcription appears under
 * several hashes. Collapsing on (author date, subject) keeps one commit per real event --
 * otherwise whichever duplicate is walked first wins arbitrarily and the hash recorded is a coin
 * toss. Of the copies, keep the one committed first: the original, not a later rebase of it.
 */
const byEvent = new Map();
for (const line of log.split('\n').filter(Boolean)) {
  const [hash, parents, date, committed, ...rest] = line.split('|');
  const subject = rest.join('|');
  const key = `${date}|${subject}`;
  const copy = {
    hash, parents: parents.split(' ').filter(Boolean), date, committed: Date.parse(committed), subject,
  };
  if (!byEvent.has(key) || copy.committed < byEvent.get(key).committed) byEvent.set(key, copy);
}
/*
 * Walk oldest first, so the earliest commit to introduce a Newick is the one that owns it, and
 * later reorganizations and reformats cannot claim it. "Oldest" is by author date: git log orders
 * by committer date, which a rebase resets, so a transcription authored in 2020-06 and rebased in
 * 2021 would otherwise sort after a 2020-08 reformat of the same tree and lose it to that.
 */
const commits = [...byEvent.values()]
  .sort((a, b) => (Date.parse(a.date) - Date.parse(b.date)) || (a.committed - b.committed));

// normalized Newick -> the commit that first wrote it anywhere, with the blob and path it wrote
const introducedBy = new Map();
const replaced = new Map(); // normalized Newick -> the Newick it replaced in its slot, if any
for (const commit of commits) {
  // Diff against each parent in turn. A plain `diff-tree <commit>` prints nothing for a merge, so
  // a tree first written while resolving one would never be attributed; and a root commit diffs
  // against the empty tree, so a tree in a repository's first commit is not missed either.
  const byParent = commit.parents.length
    ? commit.parents.map((parent) => changedFiles(commit.hash, parent))
    : [changedFiles(commit.hash)];
  for (const [file, { newBlob }] of byParent[0]) {
    // A file carried over unchanged from any parent introduces nothing: that parent had it first.
    const sides = byParent.map((changed) => changed.get(file));
    if (sides.some((side) => !side)) continue;
    const after = newicksOfBlob(newBlob, file);
    const afterSet = new Set(after.filter(Boolean));
    if (!afterSet.size) continue;
    const beforeBySide = sides.map(({ oldBlob, oldPath }) => (
      oldBlob ? newicksOfBlob(oldBlob, oldPath) : []
    ));
    const before = new Set(beforeBySide.flat());
    after.forEach((newick, slot) => {
      if (!newick || before.has(newick) || introducedBy.has(newick)) return;
      introducedBy.set(newick, { ...commit, blob: newBlob, file });
      // A new version of the tree in this slot, if the slot held another tree that this commit
      // removed from the file. One still elsewhere in the file was moved, not replaced: a new
      // tree inserted ahead of another pushes it into the next slot, and must not be read as a
      // revision of it (which would credit the displaced tree's transcriber with the new one).
      const previous = beforeBySide.map((old) => old[slot]).find((old) => old && !afterSet.has(old));
      if (previous) replaced.set(newick, previous);
    });
  }
}

/**
 * The versions of a tree, oldest first, as [{ newick, commit }]: the tree as first transcribed,
 * then each revision up to `newick`. Stops at a version whose commit is unknown, or on a cycle
 * (A replaced by B, later replaced by A again).
 */
function versionsOf(newick) {
  const versions = [];
  const seen = new Set();
  for (let current = newick; current && !seen.has(current); current = replaced.get(current)) {
    seen.add(current);
    const commit = introducedBy.get(current);
    if (!commit) break;
    versions.unshift({ newick: current, commit });
  }
  return versions;
}

// ---------------------------------------------------------------------------
// 3. Emit attribution.json.
// ---------------------------------------------------------------------------

/*
 * The hand-maintained sections, carried over as they are. A file that will not parse stops the
 * run: rewriting it would throw away every hand edit in it.
 */
let existingFile = {};
if (fs.existsSync(argv.o)) {
  try {
    existingFile = JSON.parse(fs.readFileSync(argv.o, 'utf8'));
  } catch (e) {
    die(`could not read ${argv.o}: ${e.message}. Fix it by hand; it holds hand-maintained curators.`);
  }
}
const curators = existingFile.curators || {};
const overrides = existingFile.overrides || {};

const sortedObject = (object, compare) => Object.fromEntries(
  Object.keys(object).sort(compare).map((key) => [key, object[key]]),
);
const commitRecord = (commit) => ({
  commit: commit.hash.slice(0, 12),
  date: commit.date.slice(0, 10),
  subject: commit.subject,
});

const trees = {};
const tally = new Map();
const warnings = [];
let traced = 0;
for (const [newick, phyloId] of [...phyloIdByNewick.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
  const versions = versionsOf(newick);
  if (versions.length) traced += 1;
  const history = versions.map(({ commit }, i) => {
    let curator = curatorIn(CURATORS, commit.subject);
    let curatorFrom = curator && 'commit subject';
    if (!curator && i === 0) {
      curator = curatorIn(COMMENT_CURATORS, readBlob(commit.blob, commit.file).comments);
      curatorFrom = curator && 'curator comments';
    }
    return {
      event: i === 0 ? 'transcribed' : 'revised',
      ...(curator ? { curator, curatorFrom } : {}),
      ...commitRecord(commit),
    };
  });

  /*
   * Curators set by hand must survive regeneration, the same way the extractor preserves PHYLO ids
   * across runs: some trees were transcribed in commits that credit nobody, and their transcriber
   * is only knowable from outside the repository. An override fills only a blank, so correcting
   * CURATORS above still propagates; one that a derived curator now contradicts is reported.
   */
  const derived = history[0]?.curator;
  const override = overrides[phyloId]?.transcribedBy;
  if (override && derived && override !== derived) {
    warnings.push(`${phyloId}: override ${override} is shadowed by ${derived}, derived from history`);
  }
  const transcribedBy = derived || override;
  trees[phyloId] = { ...(transcribedBy ? { transcribedBy } : {}), history };

  const who = transcribedBy ? (curators[transcribedBy]?.name || transcribedBy) : '(unattributed)';
  const date = history[0]?.date;
  const entry = tally.get(who) || { count: 0, first: date, last: date };
  entry.count += 1;
  if (date && !(entry.first <= date)) entry.first = date;
  if (date && !(entry.last >= date)) entry.last = date;
  tally.set(who, entry);
}

// Every curator a tree names should have a name; every override should name a live tree.
const named = new Set(Object.values(trees).flatMap((tree) => [
  tree.transcribedBy, ...tree.history.map((event) => event.curator),
]).filter(Boolean));
for (const id of named) {
  if (!curators[id]?.name) warnings.push(`curator ${id} has no entry in \`curators\`; add their name`);
}
for (const phyloId of Object.keys(overrides)) {
  if (!trees[phyloId]) warnings.push(`override for ${phyloId}, which is not in the store`);
}

const contents = {
  comment: 'Who transcribed and revised each reference phylogeny, mined from commit messages by '
    + 'scripts/phylogenies/attribute-phylogenies.js. Edit only `curators` and `overrides`; '
    + '`trees` is regenerated on every run. See phylogenies/README.md.',
  curators: sortedObject(curators),
  overrides: sortedObject(overrides),
  trees,
};
fs.mkdirSync(path.dirname(argv.o), { recursive: true });
fs.writeFileSync(argv.o, `${JSON.stringify(contents, null, 4)}\n`);

const revised = Object.values(trees).filter((tree) => tree.history.length > 1).length;
/*
 * Each curator's transcriptions with the span of their dates. The curators worked in different
 * periods (Rebecca Stubbs in 2018, Anna Becker in 2020), so a tree credited to one but dated in
 * the other's period shows up here as a span that overlaps, and is the first thing to check.
 */
const summary = [...tally.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .map(([who, { count, first, last }]) => `  ${String(count).padStart(4)}  ${who}`
    + `${first ? `  (${first} to ${last})` : ''}`);
process.stderr.write(
  `Traced ${traced} of ${phyloIdByNewick.size} store trees across ${commits.length} commits; `
  + `${revised} were revised after transcription.\nTranscribed by:\n${summary.join('\n')}\n`
  + `${warnings.map((w) => `Warning: ${w}\n`).join('')}Wrote ${argv.o}.\n`,
);
