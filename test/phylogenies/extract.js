/*
 * test/phylogenies/extract.js
 *
 * Exercises scripts/phylogenies/extract-phylogenies.js against temporary fixtures, focusing on
 * the behaviors the static store test (store.js) can't see: PHYLO ids must stay tied to their
 * tree across regenerations (insert/delete must not renumber, and a retired id must never come
 * back on a different tree), every source citation must survive deduplication, divergent
 * citation DOIs must be flagged in the report, and a mis-aimed run must not eat the store.
 */

const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const tmp = require('tmp');
const chai = require('chai');

const { parseCSVRow } = require('../../lib/csv');

const assert = chai.assert;

/** A fresh { srcDir, storeDir, report } fixture in a self-cleaning temp directory. */
function fixture() {
  const base = tmp.dirSync({ unsafeCleanup: true }).name;
  const srcDir = path.join(base, 'src');
  fs.mkdirSync(srcDir);
  return { base, srcDir, storeDir: path.join(base, 'store'), report: path.join(base, 'report.csv') };
}

/** Write a minimal source Phyx file (one phyloref, one phylogeny) into `dir`. */
function writeSource(dir, regnumId, phylogeny) {
  const clado = `CLADO_${String(regnumId).padStart(7, '0')}`;
  fs.writeFileSync(
    path.join(dir, `${clado}.json`),
    JSON.stringify({ phylorefs: [{ regnumId }], phylogenies: [phylogeny] }),
  );
}

/** Run the extractor over `srcDir` → `storeDir`; returns the parsed process result. */
function runExtractor({ srcDir, storeDir, report }, { args = [], expectFailure = false } = {}) {
  const child = ChildProcess.spawnSync(
    process.execPath,
    ['scripts/phylogenies/extract-phylogenies.js', srcDir, '-o', storeDir, '--report', report, ...args],
    { encoding: 'utf8' },
  );
  if (expectFailure) assert.notStrictEqual(child.status, 0, 'extractor should have failed');
  else assert.strictEqual(child.status, 0, `extractor failed: ${child.stderr}`);
  return child;
}

/** The PHYLO ids currently in a store directory. */
const storeIds = (storeDir) => fs.readdirSync(storeDir)
  .filter((f) => /^PHYLO_\d+\.json$/.test(f))
  .map((f) => path.basename(f, '.json'))
  .sort();

/** Map of newick → PHYLO id for the current store. */
function idsByNewick(storeDir) {
  const map = new Map();
  for (const id of storeIds(storeDir)) {
    const data = JSON.parse(fs.readFileSync(path.join(storeDir, `${id}.json`), 'utf8'));
    map.set(data.phylogenies[0].newick, id);
  }
  return map;
}

/** Parse the CSV report into { header, rows } of parsed fields. */
function readReport(report) {
  const [header, ...rows] = fs.readFileSync(report, 'utf8').trim().split('\n').map(parseCSVRow);
  return { header, rows, column: (name) => header.indexOf(name) };
}

/** A BibJSON-ish citation with a comma in its figure, so labels need CSV quoting. */
const cite = (doi, authors = [{ lastname: 'Smith' }]) => ({
  primaryPhylogenyCitation: {
    year: 2020,
    authors,
    figure: '3, top panel',
    identifier: doi ? [{ type: 'doi', id: doi }] : [],
  },
});

describe('extract-phylogenies.js', () => {
  it('keeps PHYLO ids stable across insertion and deletion', () => {
    const fx = fixture();
    writeSource(fx.srcDir, 1, { newick: '(A,B);' });
    writeSource(fx.srcDir, 2, { newick: '(C,D);' });
    writeSource(fx.srcDir, 3, { newick: '(E,F);' });
    runExtractor(fx);

    const first = idsByNewick(fx.storeDir);
    assert.strictEqual(first.size, 3);
    const idAB = first.get('(A,B);');
    const idEF = first.get('(E,F);');
    const idCD = first.get('(C,D);');

    // Insert a tree that sorts ahead of all existing sources, and delete (C,D).
    writeSource(fx.srcDir, 0, { newick: '(NEW,TREE);' });
    fs.rmSync(path.join(fx.srcDir, 'CLADO_0000002.json'));
    runExtractor(fx);

    const second = idsByNewick(fx.storeDir);
    assert.strictEqual(second.get('(A,B);'), idAB, '(A,B) must keep its id despite an earlier-sorting insert');
    assert.strictEqual(second.get('(E,F);'), idEF, '(E,F) must keep its id');
    assert.notInclude([...second.values()], idCD, "deleted tree's id must be retired, not recycled");
    assert.isString(second.get('(NEW,TREE);'));
    assert.notStrictEqual(second.get('(NEW,TREE);'), idCD, 'new tree must not reuse the retired id');
  });

  it('never reissues a retired id on a later run', () => {
    // The regression the id ledger exists for: once the retired tree's store file is gone, the
    // files on disk no longer remember its id, so a later run would hand it to a different tree.
    const fx = fixture();
    writeSource(fx.srcDir, 1, { newick: '(A,B);' });
    writeSource(fx.srcDir, 2, { newick: '(C,D);' });
    writeSource(fx.srcDir, 3, { newick: '(E,F);' });
    runExtractor(fx);
    const idCD = idsByNewick(fx.storeDir).get('(C,D);');

    // Run 2: (C,D) disappears, and with it the only file that recorded its id.
    fs.rmSync(path.join(fx.srcDir, 'CLADO_0000002.json'));
    runExtractor(fx);
    assert.notInclude(storeIds(fx.storeDir), idCD);

    // Run 3, a separate invocation: a brand-new tree must not be given the retired id.
    writeSource(fx.srcDir, 4, { newick: '(NEW,TREE);' });
    runExtractor(fx);
    const third = idsByNewick(fx.storeDir);
    assert.notStrictEqual(third.get('(NEW,TREE);'), idCD, 'retired id was recycled onto a different tree');

    // And if the retired tree comes back, it gets its original id back.
    writeSource(fx.srcDir, 2, { newick: '(C,D);' });
    runExtractor(fx);
    assert.strictEqual(idsByNewick(fx.storeDir).get('(C,D);'), idCD, 'a returning tree should reclaim its id');
  });

  it('copies every citation key a source phylogeny carries', () => {
    const fx = fixture();
    writeSource(fx.srcDir, 1, {
      newick: '(A,B);',
      primaryPhylogenyCitation: { year: 2020, authors: [{ lastname: 'Smith' }] },
      phylogenyCitation: { year: 1999, authors: [{ lastname: 'Jones' }] },
    });
    runExtractor(fx);

    const stored = JSON.parse(fs.readFileSync(path.join(fx.storeDir, 'PHYLO_0001.json'), 'utf8'));
    assert.deepEqual(stored.phylogenies[0].primaryPhylogenyCitation.authors, [{ lastname: 'Smith' }]);
    assert.deepEqual(stored.phylogenies[0].phylogenyCitation.authors, [{ lastname: 'Jones' }]);
  });

  it('keeps the citations of sources that disagree about the same tree', () => {
    const fx = fixture();
    writeSource(fx.srcDir, 1, { newick: '(A,B);', ...cite(undefined) });
    // Same tree, but this source records the DOI and a fuller author list.
    writeSource(fx.srcDir, 2, { newick: '(A,B);', ...cite('10.1/bbb', [{ lastname: 'Smith' }, { lastname: 'Patel' }]) });
    runExtractor(fx);

    const stored = JSON.parse(fs.readFileSync(path.join(fx.storeDir, 'PHYLO_0001.json'), 'utf8'));
    assert.lengthOf(stored.referenceFor, 2);
    const [canonical, alternate] = stored.referenceFor;
    assert.isUndefined(canonical.citations, "the canonical source's citations live on the phylogeny");
    assert.deepEqual(
      alternate.citations.primaryPhylogenyCitation.identifier,
      [{ type: 'doi', id: '10.1/bbb' }],
      'the divergent citation must be kept, not just reported',
    );
  });

  it('flags divergent citation DOIs in the report', () => {
    const fx = fixture();
    writeSource(fx.srcDir, 1, { newick: '(A,B);', ...cite('10.1/aaa') });
    writeSource(fx.srcDir, 2, { newick: '(A,B);', ...cite('10.1/bbb') });
    const child = runExtractor(fx);

    assert.match(child.stderr, /1 tree\(s\) had divergent citation DOIs/);
    const { rows, column } = readReport(fx.report);
    // The derived label contains a comma ("Smith 2020, fig. 3, top panel"), so the report is
    // quoted and has to be parsed rather than split on commas.
    assert.include(rows[0][column('label')], ',');
    assert.lengthOf(rows.filter((r) => r[column('citation_divergence')] === 'YES'), 1);
    assert.strictEqual(rows[0][column('alternate_citations')], '1');
  });

  it('refuses to replace the store when pointed at an unrelated source', () => {
    // sourceDir is a bare positional and -o defaults to phylogenies/, so a mis-aimed run would
    // otherwise silently swap the whole committed store for an unrelated set of trees.
    const fx = fixture();
    writeSource(fx.srcDir, 1, { newick: '(A,B);' });
    writeSource(fx.srcDir, 2, { newick: '(C,D);' });
    writeSource(fx.srcDir, 3, { newick: '(E,F);' });
    runExtractor(fx);
    const before = storeIds(fx.storeDir);

    const other = path.join(fx.base, 'other');
    fs.mkdirSync(other);
    writeSource(other, 9, { newick: '(X,Y);' });

    const failed = runExtractor({ ...fx, srcDir: other }, { expectFailure: true });
    assert.match(failed.stderr, /would retire 3 of the 3 store files/);
    assert.deepEqual(storeIds(fx.storeDir), before, 'the store must be left untouched');

    runExtractor({ ...fx, srcDir: other }, { args: ['--force'] });
    assert.lengthOf(storeIds(fx.storeDir), 1, '--force should allow the replacement');
  });

  it('refuses to empty the store from a source with no phylogenies', () => {
    const fx = fixture();
    writeSource(fx.srcDir, 1, { newick: '(A,B);' });
    runExtractor(fx);

    const empty = path.join(fx.base, 'empty');
    fs.mkdirSync(empty);
    const failed = runExtractor({ ...fx, srcDir: empty }, { expectFailure: true });
    assert.match(failed.stderr, /no Newick-bearing phylogenies found/);
    assert.deepEqual(storeIds(fx.storeDir), ['PHYLO_0001']);
  });
});
