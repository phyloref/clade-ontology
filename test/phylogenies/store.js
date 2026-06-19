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
const phyx = require('@phyloref/phyx');

const {
  findJSONFiles,
  normalizeNewick,
  loadStore,
  buildReferenceIndex,
  PHYLOGENIES_DIR,
} = require('../../lib/phylogenies');

const assert = chai.assert;

const SOURCE_DIR = path.join('phyx', 'phylonym');

/** Multiset of "cladoId\tnormalizedNewick" pairs found in the source Phyx files. */
function sourcePairs() {
  const pairs = [];
  for (const file of findJSONFiles(SOURCE_DIR)) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      continue;
    }
    const cladoId = path.basename(file, '.json');
    for (const phylogeny of json.phylogenies || []) {
      if (phylogeny.newick) pairs.push(`${cladoId}\t${normalizeNewick(phylogeny.newick)}`);
    }
  }
  return pairs;
}

/** Multiset of "cladoId\tnormalizedNewick" pairs implied by the store's referenceFor maps. */
function storePairs(store) {
  const pairs = [];
  for (const { data } of store) {
    const phylogeny = (data.phylogenies || [])[0];
    const norm = normalizeNewick(phylogeny.newick);
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

  it('deduplicates: each unique Newick lives in exactly one store file', () => {
    const seen = new Map(); // normNewick -> file
    for (const { file, data } of store) {
      const norm = normalizeNewick((data.phylogenies || [])[0].newick);
      assert.isUndefined(seen.get(norm), `Duplicate Newick across ${seen.get(norm)} and ${file}`);
      seen.set(norm, file);
    }
    // The 270 phylonym files hold 160 Newick-bearing phylogenies that reduce to 112 unique trees.
    assert.strictEqual(store.length, 112, 'Expected 112 unique reference phylogenies');
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
