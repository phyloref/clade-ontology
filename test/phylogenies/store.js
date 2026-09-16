/*
 * test/phylogenies/store.js
 *
 * Verifies that the standalone reference-phylogeny store in phylogenies/ is a faithful,
 * deduplicated copy of the Newick trees still embedded in phyx/phylonym/. This is the core
 * guarantee of round 1 (see scripts/phylogenies/extract-phylogenies.js): we keep both copies
 * and prove they agree before a future round removes the trees from the Phyx files.
 */

const fs = require('node:fs');
const path = require('node:path');

const chai = require('chai');
const { isEqual } = require('lodash');
const phyx = require('@phyloref/phyx');
const tmp = require('tmp');

const { findJSONFiles } = require('../../lib/files');
const {
  normalizeNewick,
  scanSourcePhylogenies,
  loadStore,
  storePhylogeny,
  buildReferenceIndex,
  PHYLOGENIES_DIR,
} = require('../../lib/phylogenies');

const assert = chai.assert;

const SOURCE_DIR = path.join('phyx', 'phylonym');
const CITATION_KEYS = ['primaryPhylogenyCitation', 'phylogenyCitation'];

/** Every Newick-bearing phylogeny in the source Phyx files. */
const sourceOccurrences = () => scanSourcePhylogenies(findJSONFiles(SOURCE_DIR));

/** The citation keys an object carries, as an object (so two can be compared directly). */
function citationsOf(obj) {
  const citations = {};
  for (const key of CITATION_KEYS) if (obj[key]) citations[key] = obj[key];
  return citations;
}

/** Multiset of "cladoId\tnormalizedNewick" pairs found in the source Phyx files. */
function sourcePairs() {
  return sourceOccurrences()
    .map(({ cladoId, phylogeny }) => `${cladoId}\t${normalizeNewick(phylogeny.newick)}`);
}

/** Multiset of "cladoId\tnormalizedNewick" pairs implied by the store's referenceFor maps. */
function storePairs(store) {
  const pairs = [];
  for (const { file, data } of store) {
    const norm = normalizeNewick(storePhylogeny({ file, data }).newick);
    for (const entry of data.referenceFor || []) pairs.push(`${entry.clado}\t${norm}`);
  }
  return pairs;
}

describe('Reference-phylogeny store (phylogenies/)', () => {
  const store = loadStore(PHYLOGENIES_DIR);

  it('exists and is non-empty', () => {
    assert.isAbove(store.length, 0, `No store files found in ${PHYLOGENIES_DIR}/`);
  });

  it('contains every source tree exactly once per source reference (faithful copy)', () => {
    const src = sourcePairs().sort();
    const dst = storePairs(store).sort();
    assert.deepEqual(dst, src, 'Store referenceFor pairs must exactly reproduce source (cladoId, newick) pairs');
  });

  it('preserves every source citation', () => {
    // Deduplication must not lose a citation: the store keeps the canonical source's citations
    // on the phylogeny, and any source that cited the same tree differently keeps its own copy
    // on its referenceFor entry. Once round 2 strips the trees from phyx/, this is the only copy.
    const index = buildReferenceIndex(store);
    for (const { file, cladoId, phyloIndex, phylogeny } of sourceOccurrences()) {
      const sourceCitations = citationsOf(phylogeny);
      if (Object.keys(sourceCitations).length === 0) continue;
      const ref = (index.get(cladoId) || [])
        .find(({ entry }) => entry.sourcePhylogenyIndex === phyloIndex);
      assert.isDefined(ref, `${file} phylogeny ${phyloIndex} is missing from the store`);
      const stored = ref.entry.citations || citationsOf(ref.phylogeny);
      assert.isTrue(
        isEqual(stored, sourceCitations),
        `${file} phylogeny ${phyloIndex}: citations in ${ref.file} do not match the source`,
      );
    }
  });

  it('deduplicates: each unique Newick lives in exactly one store file', () => {
    const seen = new Map(); // normNewick -> file
    for (const { file, data } of store) {
      const norm = normalizeNewick(storePhylogeny({ file, data }).newick);
      assert.isUndefined(seen.get(norm), `Duplicate Newick across ${seen.get(norm)} and ${file}`);
      seen.set(norm, file);
    }
  });

  it('holds one file per unique source tree', () => {
    // The 270 phylonym files hold 160 Newick-bearing phylogenies that reduce to 112 unique
    // trees. Only the relationship is asserted: pinning the count here would fail the suite for
    // a curator who legitimately adds a tree and correctly regenerates the store.
    const uniqueSourceTrees = new Set(
      sourceOccurrences().map(({ phylogeny }) => normalizeNewick(phylogeny.newick)),
    );
    assert.strictEqual(store.length, uniqueSourceTrees.size);
  });

  it('assigns each store file a distinct PHYLO id', () => {
    const ids = store.map(({ file }) => path.basename(file, '.json'));
    assert.deepEqual([...new Set(ids)].sort(), [...ids].sort(), 'PHYLO ids must be unique');
  });

  it('builds a reference index keyed by CLADO id', () => {
    const index = buildReferenceIndex(store);
    assert.isAbove(index.size, 0);
    // The Estes et al. 1988 tree is shared by seven phylorefs.
    const shared = index.get('CLADO_0000051');
    assert.isDefined(shared, 'CLADO_0000051 should be covered by the store');
  });

  for (const { file, data } of store) {
    describe(path.basename(file), () => {
      it('is a valid Phyx file with exactly one Newick phylogeny', () => {
        assert.isArray(data.phylogenies);
        assert.strictEqual(data.phylogenies.length, 1);
        assert.isString(data.phylogenies[0].newick);
        assert.doesNotThrow(() => new phyx.PhyxWrapper(data).asJSONLD('#test'));
      });

      it('has a non-empty referenceFor mapping with stable CLADO keys', () => {
        assert.isArray(data.referenceFor);
        assert.isAbove(data.referenceFor.length, 0);
        for (const entry of data.referenceFor) {
          assert.match(entry.clado, /^CLADO_\d+$/, 'referenceFor entries must key on CLADO ids');
        }
      });
    });
  }
});

describe('lib/phylogenies store helpers', () => {
  it('ignores files in the store directory that are not PHYLO_NNNN.json', () => {
    // The store directory also holds a README, the CSV report and the id ledger, and a curator
    // may leave a working file there. None of them is a tree (compare the phyx/ glob hazard in
    // AGENTS.md), so loadStore must not try to read a Newick out of them.
    const dir = tmp.dirSync({ unsafeCleanup: true }).name;
    const tree = { phylogenies: [{ newick: '(A,B);' }], phylorefs: [], referenceFor: [] };
    fs.writeFileSync(path.join(dir, 'PHYLO_0001.json'), JSON.stringify(tree));
    fs.writeFileSync(path.join(dir, 'phylo-ids.json'), JSON.stringify({ nextId: 2, ids: {} }));
    fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ hello: 'world' }));
    fs.mkdirSync(path.join(dir, 'scratch'));
    fs.writeFileSync(path.join(dir, 'scratch', 'PHYLO_0002.json'), JSON.stringify(tree));

    const store = loadStore(dir);
    assert.deepEqual(store.map(({ file }) => path.basename(file)), ['PHYLO_0001.json']);
  });

  it('names the offending file when a store file has no phylogeny', () => {
    assert.throws(
      () => storePhylogeny({ file: 'phylogenies/PHYLO_9999.json', data: { phylorefs: [] } }),
      /PHYLO_9999\.json is not a store file/,
    );
  });
});
