/*
 * test/phylogenies/attribute.js
 *
 * Exercises scripts/phylogenies/attribute-phylogenies.js against a throwaway git repository.
 *
 * The behaviour worth protecting is that a curator set by hand survives regeneration. Commit
 * messages cannot name everyone -- several trees are introduced by reformatting commits that credit
 * nobody -- so attribution.json is meant to be edited, and an edit the next run silently discarded
 * would be worse than no record at all. That failure mode is invisible: the file still looks
 * right, just with a name missing again. So are its cousins: a run whose git commands fail and
 * which writes a record of blanks; crediting a tree to a commit that only moved it; and crediting
 * it to a maintainer's later relabelling instead of the curator who transcribed it.
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const tmp = require('tmp');
const chai = require('chai');

const assert = chai.assert;

const SCRIPT = path.resolve(__dirname, '../../scripts/phylogenies/attribute-phylogenies.js');
const NEWICK = '(Aster_amellus,(Cornus_mas,Arbutus_unedo));';
const SOURCE_DIR = 'phyx/phylonym';
const FILE = `${SOURCE_DIR}/CLADO_0000018.json`;

/*
 * Made-up curators, passed to the script with --curators so the tests don't depend on the real
 * curators' names and ORCIDs. The ids are the examples ORCID publishes in its documentation (they
 * carry valid checksums); the commit subjects below name the curators only as "Alice" and "Bob",
 * the way the real history names only "Anna" and "RS".
 */
const ALICE = 'https://orcid.org/0000-0002-1825-0097';
const BOB = 'https://orcid.org/0000-0001-5109-3700';
const CURATORS = [
  { pattern: '\\bAlice\\b', flags: 'i', curator: ALICE },
  { pattern: '\\bfrom Bob\\b', flags: '', curator: BOB },
];

/** Run a git command in `cwd`, throwing with its stderr if it fails. */
function git(cwd, ...args) {
  const child = ChildProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(child.status, 0, `git ${args.join(' ')} failed: ${child.stderr}`);
  return child.stdout.trim();
}

/** Write a Phyx file holding `newicks` (one phylogeny each) at `file`, a path inside `repo`. */
function writePhyx(repo, file, ...newicks) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(
    path.join(repo, file),
    JSON.stringify({ phylorefs: [{ regnumId: 18 }], phylogenies: newicks.map((newick) => ({ newick })) }, null, 4),
  );
}

/** Stage everything in `repo` and commit it with `subject`. */
function commit(repo, subject) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', subject);
}

/**
 * An empty repository with a store holding `storeNewicks` (PHYLO_0001, PHYLO_0002, ...), and a
 * CURATORS table outside it; returns { repo, storeDir, output, curators }.
 */
function emptyFixture(...storeNewicks) {
  const curators = path.join(tmp.dirSync({ unsafeCleanup: true }).name, 'curators.json');
  fs.writeFileSync(curators, JSON.stringify(CURATORS));
  const repo = tmp.dirSync({ unsafeCleanup: true }).name;
  git(repo, 'init', '--quiet', '--initial-branch=main');
  // A fixture repo has no user config to inherit when git runs without a global identity.
  git(repo, 'config', 'user.email', 'fixture@example.com');
  git(repo, 'config', 'user.name', 'Fixture Maintainer');
  const storeDir = path.join(repo, 'phylogenies');
  fs.mkdirSync(storeDir);
  (storeNewicks.length ? storeNewicks : [NEWICK]).forEach((newick, i) => fs.writeFileSync(
    path.join(storeDir, `PHYLO_${String(i + 1).padStart(4, '0')}.json`),
    JSON.stringify({ phylogenies: [{ newick }], phylorefs: [] }),
  ));
  return { repo, storeDir, output: path.join(storeDir, 'attribution.json'), curators };
}

/** A repository whose one commit, with `subject`, adds NEWICK, which the store holds. */
function buildFixture(subject) {
  const fixture = emptyFixture();
  writePhyx(fixture.repo, FILE, NEWICK);
  commit(fixture.repo, subject);
  return fixture;
}

/** Run the attribution script (inside `repo`, unless `cwd` says otherwise). */
function runAttribution({ repo, storeDir, output, curators }, cwd = repo) {
  return ChildProcess.spawnSync(
    process.execPath,
    [SCRIPT, '--store', storeDir, '-o', output, '--paths', `${SOURCE_DIR}/`, '--curators', curators],
    { cwd, encoding: 'utf8' },
  );
}

/** Run the attribution script; returns the parsed attribution.json, with the run's stderr. */
function attribute(fixture, cwd = fixture.repo) {
  const child = runAttribution(fixture, cwd);
  assert.strictEqual(child.status, 0, `attribution failed: ${child.stderr}`);
  return { ...JSON.parse(fs.readFileSync(fixture.output, 'utf8')), stderr: child.stderr };
}

/** Rewrite the hand-maintained sections of attribution.json, as a maintainer would. */
function editByHand(fixture, edit) {
  const contents = JSON.parse(fs.readFileSync(fixture.output, 'utf8'));
  edit(contents);
  fs.writeFileSync(fixture.output, JSON.stringify(contents, null, 4));
}

describe('attribute-phylogenies.js', () => {
  it('credits the curator named in the commit that introduced a tree', () => {
    const { trees } = attribute(buildFixture('Imported phylogenies curated by Alice.'));
    // The subject gives a first name only; --curators maps it to the curator's ORCID.
    assert.strictEqual(trees.PHYLO_0001.transcribedBy, ALICE);
    assert.lengthOf(trees.PHYLO_0001.history, 1);
    const [event] = trees.PHYLO_0001.history;
    assert.strictEqual(event.event, 'transcribed');
    assert.strictEqual(event.curator, ALICE);
    assert.include(event.subject, 'curated by Alice');
  });

  it('leaves the curator blank when the commit credits nobody', () => {
    const { trees } = attribute(buildFixture('Fixed specifier authorities in Phyx files.'));
    assert.notProperty(trees.PHYLO_0001, 'transcribedBy', 'a commit naming no curator must not be attributed');
  });

  it('preserves the hand-maintained curators and overrides', () => {
    const fixture = buildFixture('Fixed specifier authorities in Phyx files.');
    attribute(fixture);

    // Stand in for a maintainer filling the blank the previous run left.
    editByHand(fixture, (contents) => {
      contents.curators[BOB] = { name: 'Bob' };
      contents.overrides.PHYLO_0001 = { transcribedBy: BOB };
    });

    const { trees, curators, overrides, stderr } = attribute(fixture);
    assert.strictEqual(trees.PHYLO_0001.transcribedBy, BOB, 'regenerating must not discard an override');
    assert.deepEqual(curators, { [BOB]: { name: 'Bob' } });
    assert.deepEqual(overrides, { PHYLO_0001: { transcribedBy: BOB } });
    assert.notInclude(stderr, 'Warning');
  });

  it('lets a derived curator win over a stale override, and says so', () => {
    // Correcting the CURATORS table should propagate rather than be shadowed by the old override.
    const fixture = buildFixture('Imported phylogenies curated by Alice.');
    attribute(fixture);
    editByHand(fixture, (contents) => {
      contents.overrides.PHYLO_0001 = { transcribedBy: 'curator:nobody' };
    });

    const { trees, stderr } = attribute(fixture);
    assert.strictEqual(trees.PHYLO_0001.transcribedBy, ALICE);
    assert.match(stderr, /override curator:nobody is shadowed/);
  });

  it('refuses to overwrite an attribution file it cannot parse', () => {
    const fixture = buildFixture('Imported phylogenies curated by Alice.');
    fs.writeFileSync(fixture.output, '{"curators": {},}');

    const child = runAttribution(fixture);
    assert.notStrictEqual(child.status, 0);
    assert.match(child.stderr, /could not read .*attribution\.json/);
    assert.strictEqual(fs.readFileSync(fixture.output, 'utf8'), '{"curators": {},}', 'hand edits must survive');
  });

  it('refuses to run on a --curators table it cannot parse', () => {
    // Read as an empty table, it would rewrite the record with every tree unattributed.
    const fixture = buildFixture('Imported phylogenies curated by Alice.');
    attribute(fixture);
    const before = fs.readFileSync(fixture.output, 'utf8');
    fs.writeFileSync(fixture.curators, '[{"pattern": "\\\\bAlice\\\\b",}]');

    const child = runAttribution(fixture);
    assert.notStrictEqual(child.status, 0);
    assert.match(child.stderr, /could not read --curators/);
    assert.strictEqual(fs.readFileSync(fixture.output, 'utf8'), before);
  });

  it('refuses to write when git fails, rather than blanking the record', () => {
    const fixture = buildFixture('Imported phylogenies curated by Alice.');
    attribute(fixture);
    const before = fs.readFileSync(fixture.output, 'utf8');

    // Outside any repository every git command fails; the record must survive untouched.
    const elsewhere = tmp.dirSync({ unsafeCleanup: true }).name;
    const child = runAttribution(fixture, elsewhere);
    assert.notStrictEqual(child.status, 0, 'a run whose git commands fail must not exit 0');
    assert.match(child.stderr, /git .* failed/);
    assert.strictEqual(fs.readFileSync(fixture.output, 'utf8'), before);
  });

  it('reads --paths from the top of the repository wherever it is run from', () => {
    const fixture = buildFixture('Imported phylogenies curated by Alice.');
    const { trees } = attribute(fixture, path.join(fixture.repo, SOURCE_DIR));
    assert.strictEqual(trees.PHYLO_0001.transcribedBy, ALICE);
  });

  it('does not credit a tree to a commit that only moved it', () => {
    // The tree was transcribed somewhere --paths does not cover, then moved into it. Read as an
    // addition, the move would claim the tree; it should be left untraced instead.
    const fixture = emptyFixture();
    writePhyx(fixture.repo, 'drafts/REGNUM_18.json', NEWICK);
    commit(fixture.repo, 'Draft from somewhere else.');
    fs.mkdirSync(path.join(fixture.repo, SOURCE_DIR), { recursive: true });
    git(fixture.repo, 'mv', 'drafts/REGNUM_18.json', FILE);
    git(fixture.repo, 'commit', '--quiet', '-m', 'Renamed from REGNUM_ to CLADO_ by Alice.');

    const { trees } = attribute(fixture);
    assert.deepEqual(trees.PHYLO_0001, { history: [] }, 'a move must not be recorded as introducing the tree');
  });

  it('credits a tree first written while resolving a merge to the merge', () => {
    const fixture = emptyFixture();
    writePhyx(fixture.repo, FILE, '(A,B);');
    commit(fixture.repo, 'Add a placeholder tree.');
    git(fixture.repo, 'checkout', '--quiet', '-b', 'side');
    writePhyx(fixture.repo, FILE, '(A,C);');
    commit(fixture.repo, 'Side edit.');
    git(fixture.repo, 'checkout', '--quiet', 'main');
    writePhyx(fixture.repo, FILE, '(A,D);');
    commit(fixture.repo, 'Main edit.');

    // The two edits conflict; the resolution is a tree neither side had.
    ChildProcess.spawnSync('git', ['merge', '--quiet', 'side'], { cwd: fixture.repo });
    writePhyx(fixture.repo, FILE, NEWICK);
    commit(fixture.repo, 'Merged phylogenies curated by Alice.');

    const { trees } = attribute(fixture);
    const last = trees.PHYLO_0001.history.at(-1);
    assert.strictEqual(last.commit, git(fixture.repo, 'rev-parse', '--short=12', 'HEAD'));
    assert.strictEqual(last.curator, ALICE);
  });

  it('credits the curator who transcribed a tree, not a later relabelling', () => {
    // A maintainer adds a node label to Alice's tree, in a commit that names nobody. The current
    // Newick is the maintainer's, but the tree is still Alice's transcription.
    const fixture = emptyFixture('(Aster_amellus,(Cornus_mas,Arbutus_unedo)Ericales);');
    writePhyx(fixture.repo, FILE, NEWICK);
    commit(fixture.repo, 'Imported phylogenies curated by Alice.');
    writePhyx(fixture.repo, FILE, '(Aster_amellus,(Cornus_mas,Arbutus_unedo)Ericales);');
    commit(fixture.repo, 'Manually labeled one expected resolution.');

    const { trees } = attribute(fixture);
    assert.strictEqual(trees.PHYLO_0001.transcribedBy, ALICE);
    assert.deepEqual(
      trees.PHYLO_0001.history.map(({ event, curator }) => [event, curator]),
      [['transcribed', ALICE], ['revised', undefined]],
    );
  });

  it('does not read a tree inserted ahead of another as a revision of it', () => {
    // Bob's new tree lands in slot 0 and pushes Alice's into slot 1. Pairing slots by index
    // alone would make Bob's tree a revision of Alice's, and credit Alice with transcribing it.
    const fixture = emptyFixture('(A,B);', '(X,Y);');
    writePhyx(fixture.repo, FILE, '(A,B);');
    commit(fixture.repo, 'Imported phylogenies curated by Alice.');
    writePhyx(fixture.repo, FILE, '(X,Y);', '(A,B);');
    commit(fixture.repo, 'Added new phyloreferences from Bob.');

    const { trees } = attribute(fixture);
    assert.strictEqual(trees.PHYLO_0001.transcribedBy, ALICE);
    assert.lengthOf(trees.PHYLO_0002.history, 1, 'a new tree is not a revision of the one it displaced');
    assert.strictEqual(trees.PHYLO_0002.transcribedBy, BOB);
  });

  it('credits the commit authored first, not the one committed first', () => {
    const fixture = emptyFixture();
    const { repo } = fixture;
    const commitAt = (authored, committed, subject) => {
      const child = ChildProcess.spawnSync('git', ['commit', '--quiet', '-am', subject], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: authored, GIT_COMMITTER_DATE: committed },
      });
      assert.strictEqual(child.status, 0, `git commit failed: ${child.stderr}`);
    };

    writePhyx(repo, FILE, '');
    git(repo, 'add', '-A');
    commitAt('2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 'Add an empty citation slot.');

    // A reformat that brings the same tree in on another branch in August 2020...
    git(repo, 'checkout', '--quiet', '-b', 'reformat');
    writePhyx(repo, FILE, NEWICK);
    commitAt('2020-08-01T00:00:00Z', '2020-08-01T00:00:00Z', 'Updated Newicks.');

    // ...and the transcription, written in June 2020 but rebased (re-committed) in 2021.
    git(repo, 'checkout', '--quiet', 'main');
    writePhyx(repo, FILE, NEWICK);
    commitAt('2020-06-01T00:00:00Z', '2021-03-01T00:00:00Z', 'Imported phylogenies curated by Alice.');

    const { trees } = attribute(fixture);
    assert.strictEqual(trees.PHYLO_0001.transcribedBy, ALICE);
    assert.strictEqual(trees.PHYLO_0001.history[0].date, '2020-06-01');
  });
});
