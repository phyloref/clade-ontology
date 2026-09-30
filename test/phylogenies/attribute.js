/*
 * test/phylogenies/attribute.js
 *
 * Exercises scripts/phylogenies/attribute-phylogenies.js against a throwaway git repository.
 *
 * The behaviour worth protecting is that a curator corrected by hand survives regeneration. Commit
 * messages cannot name everyone -- several trees are introduced by reformatting commits that credit
 * nobody -- so the ledger is meant to be edited, and an edit the next run silently discarded would
 * be worse than no ledger at all. That failure mode is invisible: the CSV still looks right, just
 * with a name missing again.
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

/** Run a git command in `cwd`, throwing with its stderr if it fails. */
function git(cwd, ...args) {
  const child = ChildProcess.spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(child.status, 0, `git ${args.join(' ')} failed: ${child.stderr}`);
  return child.stdout.trim();
}

/**
 * Build a repository holding one Phyx file with one tree, committed with `subject`, plus a store
 * containing that same tree. `curatorComments`, if given, goes on the file's phyloreference.
 * Returns { repo, storeDir, ledger }.
 */
function buildFixture(subject, curatorComments) {
  const repo = tmp.dirSync({ unsafeCleanup: true }).name;
  git(repo, 'init', '--quiet');
  // A fixture repo has no user config to inherit when git runs without a global identity.
  git(repo, 'config', 'user.email', 'fixture@example.com');
  git(repo, 'config', 'user.name', 'Fixture Maintainer');

  fs.mkdirSync(path.join(repo, SOURCE_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(repo, SOURCE_DIR, 'CLADO_0000018.json'),
    JSON.stringify({
      phylorefs: [{ regnumId: 18, ...(curatorComments ? { curatorComments } : {}) }],
      phylogenies: [{ newick: NEWICK }],
    }, null, 4),
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

/** Run the attribution script inside `repo`; returns the parsed ledger rows. */
function attribute({ repo, storeDir, ledger }) {
  const child = ChildProcess.spawnSync(
    process.execPath,
    [SCRIPT, '--store', storeDir, '-o', ledger, '--paths', `${SOURCE_DIR}/`],
    { cwd: repo, encoding: 'utf8' },
  );
  assert.strictEqual(child.status, 0, `attribution failed: ${child.stderr}`);
  return fs.readFileSync(ledger, 'utf8').trim().split('\n').slice(1)
    .map((line) => line.split(','));
}

describe('attribute-phylogenies.js', () => {
  it('credits the curator named in the commit that introduced a tree', () => {
    const fixture = buildFixture('Imported phylogenies curated by Anna.');
    const [[phyloId, curator, evidence, , , ...subject]] = attribute(fixture);
    assert.strictEqual(phyloId, 'PHYLO_0001');
    // The subject gives a first name only; the script expands it to the curator's full name.
    assert.strictEqual(curator, 'Anna Becker');
    assert.strictEqual(evidence, 'commit subject');
    assert.include(subject.join(','), 'curated by Anna');
  });

  it('leaves the curator blank when neither the commit nor the file credits anybody', () => {
    const [[, curator, evidence]] = attribute(
      buildFixture('Fixed specifier authorities in Phyx files.', 'Reference phylogeny: Fig. 1'),
    );
    assert.strictEqual(curator, '', 'a commit naming no curator must not be attributed');
    assert.strictEqual(evidence, '');
  });

  it('falls back to the curator comments in the file that introduced the tree', () => {
    // The 2018 curation-tool files name their curator in the file, and the commits that last
    // touched their trees ("Fixed a typo in the phylogeny.") name nobody.
    const [[, curator, evidence]] = attribute(
      buildFixture('Fixed a typo in the phylogeny.', 'PHYX file by R. Stubbs\n\nReference phylogeny: Fig. 1'),
    );
    assert.strictEqual(curator, 'Rebecca Stubbs');
    assert.strictEqual(evidence, 'curator comments');
  });

  it('prefers the commit subject to the curator comments', () => {
    const [[, curator, evidence]] = attribute(
      buildFixture('Imported phylogenies curated by Anna.', 'PHYX file by R. Stubbs'),
    );
    assert.strictEqual(curator, 'Anna Becker');
    assert.strictEqual(evidence, 'commit subject');
  });

  it('preserves a curator set by hand when it cannot derive one', () => {
    const fixture = buildFixture('Fixed specifier authorities in Phyx files.');
    attribute(fixture);

    // Stand in for a maintainer correcting the blank the previous run left.
    const corrected = fs.readFileSync(fixture.ledger, 'utf8')
      .replace('PHYLO_0001,,', 'PHYLO_0001,Rebecca Stubbs,');
    fs.writeFileSync(fixture.ledger, corrected);

    const [[, curator, evidence]] = attribute(fixture);
    assert.strictEqual(
      curator,
      'Rebecca Stubbs',
      'regenerating must not discard a hand-set curator',
    );
    assert.strictEqual(evidence, 'set by hand', 'and must say that only the ledger vouches for it');
  });

  it('lets a derived curator win over a stale hand-set one', () => {
    // Correcting the CURATORS table should propagate rather than be shadowed by the old ledger.
    const fixture = buildFixture('Imported phylogenies curated by Anna.');
    attribute(fixture);
    fs.writeFileSync(
      fixture.ledger,
      fs.readFileSync(fixture.ledger, 'utf8').replace('PHYLO_0001,Anna Becker,commit subject,', 'PHYLO_0001,Nobody,set by hand,'),
    );

    const [[, curator, evidence]] = attribute(fixture);
    assert.strictEqual(curator, 'Anna Becker');
    assert.strictEqual(evidence, 'commit subject');
  });
});
