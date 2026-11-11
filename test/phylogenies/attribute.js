/*
 * test/phylogenies/attribute.js
 *
 * Exercises scripts/phylogenies/attribute-phylogenies.js against a throwaway git repository.
 *
 * The behaviour worth protecting is that a curator corrected by hand survives regeneration. Commit
 * messages cannot name everyone -- several trees are introduced by reformatting commits that credit
 * nobody -- so the ledger is meant to be edited, and an edit the next run silently discarded would
 * be worse than no ledger at all. That failure mode is invisible: the CSV still looks right, just
 * with a name missing again. So is its cousin, a run whose git commands fail and which writes a
 * ledger of blanks; and so is crediting a tree to a commit that only moved it.
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const tmp = require('tmp');
const chai = require('chai');

const { parseCSVRow } = require('../../lib/csv');

const assert = chai.assert;

const SCRIPT = path.resolve(__dirname, '../../scripts/phylogenies/attribute-phylogenies.js');
const NEWICK = '(Aster_amellus,(Cornus_mas,Arbutus_unedo));';
const SOURCE_DIR = 'phyx/phylonym';

/** Run a git command in `cwd`, throwing with its stderr if it fails. */
function git(cwd, ...args) {
  const child = ChildProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(child.status, 0, `git ${args.join(' ')} failed: ${child.stderr}`);
  return child.stdout.trim();
}

/**
 * Build a repository holding one Phyx file with one tree, committed with `subject`, plus a store
 * containing that same tree. Returns { repo, storeDir, ledger }.
 */
function buildFixture(subject) {
  const repo = tmp.dirSync({ unsafeCleanup: true }).name;
  git(repo, 'init', '--quiet');
  // A fixture repo has no user config to inherit when git runs without a global identity.
  git(repo, 'config', 'user.email', 'fixture@example.com');
  git(repo, 'config', 'user.name', 'Fixture Maintainer');

  fs.mkdirSync(path.join(repo, SOURCE_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(repo, SOURCE_DIR, 'CLADO_0000018.json'),
    JSON.stringify({ phylorefs: [{ regnumId: 18 }], phylogenies: [{ newick: NEWICK }] }, null, 4),
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', subject);

  const storeDir = path.join(repo, 'phylogenies');
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(
    path.join(storeDir, 'PHYLO_0001.json'),
    JSON.stringify({
      phylogenies: [{ newick: NEWICK }],
      phylorefs: [],
      referenceFor: [{ clado: 'CLADO_0000018' }],
    }, null, 4),
  );

  return { repo, storeDir, ledger: path.join(storeDir, 'attribution.csv') };
}

/** Run the attribution script (inside `repo`, unless `cwd` says otherwise). */
function runAttribution({ repo, storeDir, ledger }, cwd = repo) {
  return ChildProcess.spawnSync(
    process.execPath,
    [SCRIPT, '--store', storeDir, '-o', ledger, '--paths', `${SOURCE_DIR}/`],
    { cwd, encoding: 'utf8' },
  );
}

/** Run the attribution script inside `repo`; returns the parsed ledger rows. */
function attribute(fixture, cwd = fixture.repo) {
  const child = runAttribution(fixture, cwd);
  assert.strictEqual(child.status, 0, `attribution failed: ${child.stderr}`);
  return fs.readFileSync(fixture.ledger, 'utf8').trim().split('\n').slice(1).map(parseCSVRow);
}

/** Write a one-tree Phyx file at `file` (a path inside `repo`), creating its directory. */
function writePhyx(repo, file, newick) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(
    path.join(repo, file),
    JSON.stringify({ phylorefs: [{ regnumId: 18 }], phylogenies: [{ newick }] }, null, 4),
  );
}

/** An empty repository with a store holding NEWICK; returns { repo, storeDir, ledger }. */
function emptyFixture() {
  const repo = tmp.dirSync({ unsafeCleanup: true }).name;
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'fixture@example.com');
  git(repo, 'config', 'user.name', 'Fixture Maintainer');
  const storeDir = path.join(repo, 'phylogenies');
  fs.mkdirSync(storeDir);
  fs.writeFileSync(
    path.join(storeDir, 'PHYLO_0001.json'),
    JSON.stringify({ phylogenies: [{ newick: NEWICK }], phylorefs: [] }),
  );
  return { repo, storeDir, ledger: path.join(storeDir, 'attribution.csv') };
}

describe('attribute-phylogenies.js', () => {
  it('credits the curator named in the commit that introduced a tree', () => {
    const fixture = buildFixture('Imported phylogenies curated by Anna.');
    const [[phyloId, curator, orcid, , , ...subject]] = attribute(fixture);
    assert.strictEqual(phyloId, 'PHYLO_0001');
    // The subject gives a first name only; the script expands it to the curator's full name.
    assert.strictEqual(curator, 'Anna Becker');
    assert.strictEqual(orcid, 'https://orcid.org/0009-0005-6085-1100');
    assert.include(subject.join(','), 'curated by Anna');
  });

  it('leaves the curator blank when the commit credits nobody', () => {
    const [[, curator]] = attribute(buildFixture('Fixed specifier authorities in Phyx files.'));
    assert.strictEqual(curator, '', 'a commit naming no curator must not be attributed');
  });

  it('preserves a curator set by hand when it cannot derive one', () => {
    const fixture = buildFixture('Fixed specifier authorities in Phyx files.');
    attribute(fixture);

    // Stand in for a maintainer correcting the blank the previous run left.
    const corrected = fs.readFileSync(fixture.ledger, 'utf8')
      .replace('PHYLO_0001,,', 'PHYLO_0001,Rebecca Stubbs,');
    fs.writeFileSync(fixture.ledger, corrected);

    const [[, curator, orcid]] = attribute(fixture);
    assert.strictEqual(
      curator,
      'Rebecca Stubbs',
      'regenerating must not discard a hand-set curator',
    );
    assert.strictEqual(orcid, 'https://orcid.org/0000-0001-7386-2830', 'and looks up its ORCID');
  });

  it('lets a derived curator win over a stale hand-set one', () => {
    // Correcting the CURATORS table should propagate rather than be shadowed by the old ledger.
    const fixture = buildFixture('Imported phylogenies curated by Anna.');
    attribute(fixture);
    fs.writeFileSync(
      fixture.ledger,
      fs.readFileSync(fixture.ledger, 'utf8').replace('PHYLO_0001,Anna Becker,', 'PHYLO_0001,Nobody,'),
    );

    const [[, curator]] = attribute(fixture);
    assert.strictEqual(curator, 'Anna Becker');
  });

  it('preserves a hand-set curator that needs CSV quoting', () => {
    const fixture = buildFixture('Fixed specifier authorities in Phyx files.');
    attribute(fixture);
    fs.writeFileSync(
      fixture.ledger,
      fs.readFileSync(fixture.ledger, 'utf8')
        .replace('PHYLO_0001,,', 'PHYLO_0001,"Anna Becker, Rebecca Stubbs",'),
    );

    // Twice: a curator read back wrong is truncated on the first run and re-quoted on the next.
    attribute(fixture);
    const [[, curator]] = attribute(fixture);
    assert.strictEqual(curator, 'Anna Becker, Rebecca Stubbs');
  });

  it('refuses to write a ledger when git fails, rather than blanking it', () => {
    const fixture = buildFixture('Imported phylogenies curated by Anna.');
    attribute(fixture);
    const before = fs.readFileSync(fixture.ledger, 'utf8');

    // Outside any repository every git command fails; the ledger must survive untouched.
    const elsewhere = tmp.dirSync({ unsafeCleanup: true }).name;
    const child = runAttribution(fixture, elsewhere);
    assert.notStrictEqual(child.status, 0, 'a run whose git commands fail must not exit 0');
    assert.match(child.stderr, /git .* failed/);
    assert.strictEqual(fs.readFileSync(fixture.ledger, 'utf8'), before);
  });

  it('reads --paths from the top of the repository wherever it is run from', () => {
    const fixture = buildFixture('Imported phylogenies curated by Anna.');
    const [[, curator]] = attribute(fixture, path.join(fixture.repo, SOURCE_DIR));
    assert.strictEqual(curator, 'Anna Becker');
  });

  it('does not credit a tree to a commit that only moved it', () => {
    // The tree was transcribed somewhere --paths does not cover, then moved into it. Read as an
    // addition, the move would claim the tree; it should be left unattributed instead.
    const fixture = emptyFixture();
    writePhyx(fixture.repo, 'drafts/REGNUM_18.json', NEWICK);
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'commit', '--quiet', '-m', 'Draft from somewhere else.');
    fs.mkdirSync(path.join(fixture.repo, SOURCE_DIR), { recursive: true });
    git(fixture.repo, 'mv', 'drafts/REGNUM_18.json', `${SOURCE_DIR}/CLADO_0000018.json`);
    git(fixture.repo, 'commit', '--quiet', '-m', 'Renamed from REGNUM_ to CLADO_ by Anna.');

    const [[, curator, , introducedIn]] = attribute(fixture);
    assert.strictEqual(introducedIn, '', 'a move must not be recorded as introducing the tree');
    assert.strictEqual(curator, '');
  });

  it('credits a tree first written while resolving a merge to the merge', () => {
    const fixture = emptyFixture();
    const file = `${SOURCE_DIR}/CLADO_0000018.json`;
    writePhyx(fixture.repo, file, '(A,B);');
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'commit', '--quiet', '-m', 'Add a placeholder tree.');
    git(fixture.repo, 'checkout', '--quiet', '-b', 'side');
    writePhyx(fixture.repo, file, '(A,C);');
    git(fixture.repo, 'commit', '--quiet', '-am', 'Side edit.');
    git(fixture.repo, 'checkout', '--quiet', 'main');
    writePhyx(fixture.repo, file, '(A,D);');
    git(fixture.repo, 'commit', '--quiet', '-am', 'Main edit.');

    // The two edits conflict; the resolution is a tree neither side had.
    ChildProcess.spawnSync('git', ['merge', '--quiet', 'side'], { cwd: fixture.repo });
    writePhyx(fixture.repo, file, NEWICK);
    git(fixture.repo, 'add', '-A');
    git(fixture.repo, 'commit', '--quiet', '--no-edit', '-m', 'Merged phylogenies curated by Anna.');

    const [[, curator, , introducedIn]] = attribute(fixture);
    assert.strictEqual(introducedIn, git(fixture.repo, 'rev-parse', '--short=12', 'HEAD'));
    assert.strictEqual(curator, 'Anna Becker');
  });

  it('credits the commit authored first, not the one committed first', () => {
    const repo = tmp.dirSync({ unsafeCleanup: true }).name;
    const commitAt = (authored, committed, subject) => {
      const child = ChildProcess.spawnSync('git', ['commit', '--quiet', '-am', subject], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: authored, GIT_COMMITTER_DATE: committed },
      });
      assert.strictEqual(child.status, 0, `git commit failed: ${child.stderr}`);
    };
    git(repo, 'init', '--quiet', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'fixture@example.com');
    git(repo, 'config', 'user.name', 'Fixture Maintainer');
    const source = path.join(repo, SOURCE_DIR, 'CLADO_0000018.json');
    const writeTree = (newick) => fs.writeFileSync(
      source,
      JSON.stringify({ phylorefs: [{ regnumId: 18 }], phylogenies: [{ newick }] }, null, 4),
    );

    fs.mkdirSync(path.dirname(source), { recursive: true });
    writeTree('');
    git(repo, 'add', '-A');
    commitAt('2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 'Add an empty citation slot.');

    // A reformat that brings the same tree in on another branch in August 2020...
    git(repo, 'checkout', '--quiet', '-b', 'reformat');
    writeTree(NEWICK);
    commitAt('2020-08-01T00:00:00Z', '2020-08-01T00:00:00Z', 'Updated Newicks.');

    // ...and the transcription, written in June 2020 but rebased (re-committed) in 2021.
    git(repo, 'checkout', '--quiet', 'main');
    writeTree(NEWICK);
    commitAt('2020-06-01T00:00:00Z', '2021-03-01T00:00:00Z', 'Imported phylogenies curated by Anna.');

    const storeDir = path.join(repo, 'phylogenies');
    fs.mkdirSync(storeDir);
    fs.writeFileSync(
      path.join(storeDir, 'PHYLO_0001.json'),
      JSON.stringify({ phylogenies: [{ newick: NEWICK }], phylorefs: [] }),
    );

    const [[, curator, , , date]] = attribute({
      repo, storeDir, ledger: path.join(storeDir, 'attribution.csv'),
    });
    assert.strictEqual(curator, 'Anna Becker');
    assert.strictEqual(date, '2020-06-01');
  });
});
