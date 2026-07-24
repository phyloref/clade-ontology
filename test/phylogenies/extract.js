/*
 * test/phylogenies/extract.js
 *
 * Exercises scripts/phylogenies/extract-phylogenies.js against a temporary fixture, focusing
 * on the two behaviors the static store test (store.js) can't see: PHYLO ids must stay tied to
 * their tree across regenerations (insert/delete must not renumber or recycle), and divergent
 * citation DOIs must be flagged in the report.
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const tmp = require('tmp');
const chai = require('chai');

const assert = chai.assert;

/** Write a minimal source Phyx file (one phyloref, one phylogeny) into `dir`. */
function writeSource(dir, regnumId, phylogeny) {
  const clado = `CLADO_${String(regnumId).padStart(7, '0')}`;
  fs.writeFileSync(
    path.join(dir, `${clado}.json`),
    JSON.stringify({ phylorefs: [{ regnumId }], phylogenies: [phylogeny] }),
  );
}

/** Run the extractor over `srcDir` → `storeDir`; returns the parsed process result. */
function runExtractor(srcDir, storeDir, reportPath) {
  const child = ChildProcess.spawnSync(
    process.execPath,
    ['scripts/phylogenies/extract-phylogenies.js', srcDir, '-o', storeDir, '--report', reportPath],
    { encoding: 'utf8' },
  );
  assert.strictEqual(child.status, 0, `extractor failed: ${child.stderr}`);
  return child;
}

/** Map of normalized-ish newick → PHYLO id for the current store. */
function idsByNewick(storeDir) {
  const map = new Map();
  for (const f of fs.readdirSync(storeDir)) {
    if (!/^PHYLO_\d+\.json$/.test(f)) continue;
    const data = JSON.parse(fs.readFileSync(path.join(storeDir, f), 'utf8'));
    map.set(data.phylogenies[0].newick, path.basename(f, '.json'));
  }
  return map;
}

describe('extract-phylogenies.js', () => {
  it('keeps PHYLO ids stable across insertion and deletion', () => {
    const base = tmp.dirSync({ unsafeCleanup: true }).name;
    const srcDir = path.join(base, 'src');
    const storeDir = path.join(base, 'store');
    const report = path.join(base, 'report.csv');
    fs.mkdirSync(srcDir);

    writeSource(srcDir, 1, { newick: '(A,B);' });
    writeSource(srcDir, 2, { newick: '(C,D);' });
    writeSource(srcDir, 3, { newick: '(E,F);' });
    runExtractor(srcDir, storeDir, report);

    const first = idsByNewick(storeDir);
    assert.strictEqual(first.size, 3);
    const idAB = first.get('(A,B);');
    const idEF = first.get('(E,F);');
    const idCD = first.get('(C,D);');

    // Insert a tree that sorts ahead of all existing sources, and delete (C,D).
    writeSource(srcDir, 0, { newick: '(NEW,TREE);' });
    fs.rmSync(path.join(srcDir, 'CLADO_0000002.json'));
    runExtractor(srcDir, storeDir, report);

    const second = idsByNewick(storeDir);
    assert.strictEqual(second.get('(A,B);'), idAB, '(A,B) must keep its id despite an earlier-sorting insert');
    assert.strictEqual(second.get('(E,F);'), idEF, '(E,F) must keep its id');
    assert.notInclude([...second.values()], idCD, "deleted tree's id must be retired, not recycled");
    assert.isString(second.get('(NEW,TREE);'));
    assert.notStrictEqual(second.get('(NEW,TREE);'), idCD, 'new tree must not reuse the retired id');
  });

  it('flags divergent citation DOIs in the report', () => {
    const base = tmp.dirSync({ unsafeCleanup: true }).name;
    const srcDir = path.join(base, 'src');
    const storeDir = path.join(base, 'store');
    const report = path.join(base, 'report.csv');
    fs.mkdirSync(srcDir);

    // Same tree, two sources, conflicting DOIs → divergence.
    const cite = (doi) => ({
      primaryPhylogenyCitation: { year: 2020, authors: [{ lastname: 'Smith' }], identifier: [{ type: 'doi', id: doi }] },
    });
    writeSource(srcDir, 1, { newick: '(A,B);', ...cite('10.1/aaa') });
    writeSource(srcDir, 2, { newick: '(A,B);', ...cite('10.1/bbb') });
    const child = runExtractor(srcDir, storeDir, report);

    assert.match(child.stderr, /1 tree\(s\) had divergent citations/);
    const rows = fs.readFileSync(report, 'utf8').trim().split('\n');
    const divergenceCol = rows[0].split(',').indexOf('citation_divergence');
    const flagged = rows.slice(1).filter((r) => r.split(',')[divergenceCol] === 'YES');
    assert.lengthOf(flagged, 1, 'exactly one store row should be flagged divergent');
  });
});
