/*
 * test/phylogenies/salvage.js
 *
 * Covers lib/salvage.js, the decisions salvage-trees.js makes about one tree. The script itself
 * reads unmerged git-crypt branches and cannot run in CI, so the rules it must not break are
 * tested here on plain objects: a tree only goes where its citation matches exactly one slot, a
 * curated tree is never overwritten, running twice changes nothing, and an expected-resolution
 * annotation is never silently pointed at the wrong phyloreference or at no node at all.
 */

const chai = require('chai');
const { cloneDeep } = require('lodash');

const {
  citationTitleKey,
  readSourceTree,
  matchSlot,
  translateNodeProperties,
  placeTree,
} = require('../../lib/salvage');

const assert = chai.assert;

const doi = (id) => [{ type: 'doi', id }];
const SOLTIS = { authors: [{ lastname: 'Soltis' }], year: 2011, title: 'Angiosperm phylogeny: 17-genes, 640 taxa.' };
const OLMSTEAD = { authors: [{ lastname: 'Olmstead' }], year: 2000, title: 'The phylogeny of the Asteridae.' };

/** A target Phyx file with one slot per citation; pass a Newick to have the slot hold a tree. */
const targetWith = (...slots) => ({
  phylorefs: [{ label: 'Asteridae' }],
  phylogenies: slots.map(([citation, newick], i) => ({
    [i === 0 ? 'primaryPhylogenyCitation' : 'phylogenyCitation']: citation,
    ...(newick ? { newick } : {}),
  })),
});

/** A source tree as the 2018 curation-tool files describe one: title, DOI and free text only. */
const tree2018 = (overrides = {}) => ({
  newick: '((A,B)Inner,C)root;',
  citation: { title: 'ANGIOSPERM PHYLOGENY: 17 GENES, 640 TAXA', identifier: doi('10.3732/ajb.1000404') },
  citationText: 'Soltis, D.E., Smith, S.A. American Journal of Botany 98.4 (2011): 704-730.',
  phylorefLabel: 'Asteridae',
  ...overrides,
});

describe('lib/salvage', () => {
  describe('citationTitleKey()', () => {
    it('ignores case and punctuation, which is all that separates the two formats', () => {
      assert.strictEqual(
        citationTitleKey({ title: 'ANGIOSPERM PHYLOGENY: 17 GENES, 640 TAXA' }),
        citationTitleKey({ title: 'Angiosperm phylogeny: 17-genes, 640 taxa.' }),
      );
      assert.isUndefined(citationTitleKey({ title: ' . ' }));
      assert.isUndefined(citationTitleKey(undefined));
    });
  });

  describe('readSourceTree()', () => {
    it('reads the 2018 format, whose citation sits at the top level of the file', () => {
      const tree = readSourceTree({
        doi: '10.1671/5.1',
        title: 'Cranial morphology of Microbrachis',
        citation: 'Vallin G, Laurin M. 2004.',
        phylorefs: [{ label: 'Amphibia', curatorComments: 'Phyx file by R. Stubbs' }],
        phylogenies: [{ newick: '(A,B);', description: 'Fig. 6', additionalNodeProperties: { X: {} } }],
      });
      assert.deepEqual(tree.citation.identifier, doi('10.1671/5.1'));
      assert.strictEqual(tree.citationText, 'Vallin G, Laurin M. 2004.');
      assert.strictEqual(tree.figure, 'Fig. 6');
      assert.strictEqual(tree.phylorefLabel, 'Amphibia');
      assert.strictEqual(tree.curatorComments, 'Phyx file by R. Stubbs');
      assert.deepEqual(tree.nodeProperties, { X: {} });
    });

    it('refuses a file with no tree, or with more than one', () => {
      assert.throws(() => readSourceTree({ phylogenies: [{}] }), /found 0/);
      assert.throws(
        () => readSourceTree({ phylogenies: [{ newick: '(A,B);' }, { newick: '(C,D);' }] }),
        /found 2/,
      );
    });
  });

  describe('matchSlot()', () => {
    it('matches on DOI when both sides have one', () => {
      const target = targetWith([{ ...SOLTIS, identifier: doi('doi:10.3732/AJB.1000404') }], [OLMSTEAD]);
      const slot = matchSlot(target, tree2018());
      assert.strictEqual(slot.index, 0);
      assert.strictEqual(slot.how, 'doi:10.3732/ajb.1000404');
      assert.deepEqual(slot.copies, []);
    });

    it('falls back to the title when the slot records no DOI', () => {
      const slot = matchSlot(targetWith([OLMSTEAD], [SOLTIS]), tree2018());
      assert.strictEqual(slot.index, 1);
      assert.match(slot.how, /^title:/);
    });

    it('never matches by title a slot whose DOI names a different publication', () => {
      const target = targetWith([{ ...SOLTIS, identifier: doi('10.9999/another.paper') }]);
      assert.throws(() => matchSlot(target, tree2018()), /none of 1 citation slots match/);
    });

    it('falls back to author and year when the titles disagree', () => {
      // The real case: the source says "the Campanulidae", the slot "Campanulideae".
      const target = targetWith(
        [{ authors: [{ lastname: 'Tank' }], year: 2010, title: 'Phylogeny of Campanulideae.' }],
        [{ authors: [{ lastname: 'Cosner' }], year: 1994, title: 'Relationships in the Campanulales.' }],
      );
      const slot = matchSlot(target, tree2018({
        citation: { title: 'Phylogeny of the Campanulidae', identifier: doi('10.1600/036364410791638306') },
        citationText: 'Tank DC, Donoghue MJ. Phylogeny of the Campanulidae. Systematic Botany. 2010.',
      }));
      assert.strictEqual(slot.index, 0);
      assert.strictEqual(slot.how, 'author+year:tank 2010');
    });

    it('matches an author only as a whole word', () => {
      const target = targetWith([{ authors: [{ lastname: 'Tank' }], year: 2010, title: 'Other.' }]);
      const tree = tree2018({ citation: { title: 'Unrelated' }, citationText: 'Tankard A. 2010.' });
      assert.throws(() => matchSlot(target, tree), /none of 1 citation slots match/);
    });

    it('refuses when two different slots match', () => {
      const target = targetWith([SOLTIS], [{ ...SOLTIS, year: 2012 }]);
      assert.throws(() => matchSlot(target, tree2018()), /2 of 2 citation slots match on title/);
    });

    it('refuses when nothing on the source can be compared', () => {
      assert.throws(
        () => matchSlot(targetWith([SOLTIS]), { newick: '(A,B);', citation: undefined }),
        /no usable DOI/,
      );
    });

    it('treats a tree appended beside a slot as a copy of it, not as a second slot', () => {
      const target = targetWith([SOLTIS, '(X,Y);']);
      target.phylogenies.push({ primaryPhylogenyCitation: cloneDeep(SOLTIS), newick: '(P,Q);' });
      const slot = matchSlot(target, tree2018());
      assert.strictEqual(slot.index, 0);
      assert.deepEqual(slot.copies, [1]);
    });
  });

  describe('placeTree()', () => {
    it('fills an empty slot, keeping the figure note', () => {
      const target = targetWith([SOLTIS]);
      const tree = tree2018({ figure: 'Fig. 1' });
      const placed = placeTree(target, tree, matchSlot(target, tree));
      assert.deepEqual(placed, { action: 'filled', index: 0, written: true });
      assert.strictEqual(target.phylogenies[0].newick, tree.newick);
      assert.strictEqual(target.phylogenies[0].description, 'Fig. 1');
      assert.lengthOf(target.phylogenies, 1);
    });

    it('appends beside a slot that already holds a tree, and never overwrites it', () => {
      const target = targetWith([SOLTIS, '(X,Y);'], [OLMSTEAD]);
      const tree = tree2018();
      const placed = placeTree(target, tree, matchSlot(target, tree), { Inner: { a: 1 } });
      assert.deepEqual(placed, { action: 'appended', index: 2, written: true });
      assert.strictEqual(target.phylogenies[0].newick, '(X,Y);', 'the curated tree must be untouched');
      assert.deepEqual(target.phylogenies[2], {
        primaryPhylogenyCitation: SOLTIS,
        newick: tree.newick,
        additionalNodeProperties: { Inner: { a: 1 } },
      });
      assert.notStrictEqual(
        target.phylogenies[2].primaryPhylogenyCitation,
        target.phylogenies[0].primaryPhylogenyCitation,
        'the citation is copied, not shared, so editing one entry cannot change the other',
      );
    });

    it('changes nothing when run again, whichever way the tree went in', () => {
      for (const target of [targetWith([SOLTIS]), targetWith([SOLTIS, '(X,Y);'])]) {
        const tree = tree2018();
        const first = placeTree(target, tree, matchSlot(target, tree));
        const before = cloneDeep(target);
        // Whitespace differences must not read as a new tree.
        const again = { ...tree, newick: ` ${tree.newick}\n` };
        const second = placeTree(target, again, matchSlot(target, again));
        assert.deepEqual(second, { ...first, written: false });
        assert.deepEqual(target, before);
      }
    });

    it('lets two trees share one citation: the first fills the slot, the second is appended', () => {
      const target = targetWith([SOLTIS]);
      const a = tree2018({ newick: '(A,B);' });
      const b = tree2018({ newick: '(A,(B,C));' });
      assert.strictEqual(placeTree(target, a, matchSlot(target, a)).action, 'filled');
      assert.deepEqual(
        placeTree(target, b, matchSlot(target, b)),
        { action: 'appended', index: 1, written: true },
      );
      // And both are still recognised as in place afterwards.
      assert.isFalse(placeTree(target, a, matchSlot(target, a)).written);
      assert.isFalse(placeTree(target, b, matchSlot(target, b)).written);
    });

    it('refuses a tree that is already filed under a different citation', () => {
      const target = targetWith([SOLTIS], [OLMSTEAD, '((A,B)Inner,C)root;']);
      const tree = tree2018();
      assert.throws(
        () => placeTree(target, tree, matchSlot(target, tree)),
        /already in phylogeny 1, under a different citation/,
      );
    });
  });

  describe('translateNodeProperties()', () => {
    const expecting = (node, name) => ({ [node]: { expectedPhyloreferenceNamed: [name] } });

    it("rewrites the source's own name for its phyloreference to the target's label", () => {
      // The 2018 file calls it "Dikarya " with a trailing space; PhyloRegnum calls it "Dikarya".
      const tree = tree2018({ phylorefLabel: 'Dikarya ', nodeProperties: expecting('Inner', 'Dikarya ') });
      const { properties, notes } = translateNodeProperties(tree, 'Dikarya');
      assert.deepEqual(properties, expecting('Inner', 'Dikarya'));
      assert.deepEqual(notes, [{ node: 'Inner', writtenNode: 'Inner', writtenPhyloref: 'Dikarya ' }]);
    });

    it('refuses an expectation that names some other phyloreference', () => {
      const tree = tree2018({ nodeProperties: expecting('Inner', 'Lamiidae') });
      assert.throws(() => translateNodeProperties(tree, 'Asteridae'), /expects phyloreference "Lamiidae"/);
    });

    it('refuses an annotation keyed on a label that is not an internal node', () => {
      // "A" is a tip, and "Innner" is nothing at all.
      for (const node of ['A', 'Innner']) {
        const tree = tree2018({ nodeProperties: expecting(node, 'Asteridae') });
        assert.throws(() => translateNodeProperties(tree, 'Asteridae'), /labels no internal node/);
      }
    });

    it('applies a declared fix for a mistyped node label, and records what was written', () => {
      const tree = tree2018({ nodeProperties: expecting('Innner', 'Asteridae') });
      const { properties, notes } = translateNodeProperties(tree, 'Asteridae', { Innner: 'Inner' });
      assert.deepEqual(properties, expecting('Inner', 'Asteridae'));
      assert.strictEqual(notes[0].writtenNode, 'Innner');
    });

    it('carries other node properties through unchanged', () => {
      const nodeProperties = { root: { comment: 'outgroup rooted' } };
      const { properties, notes } = translateNodeProperties(tree2018({ nodeProperties }), 'Asteridae');
      assert.deepEqual(properties, nodeProperties);
      assert.deepEqual(notes, []);
    });

    it('returns nothing for a tree with no annotations', () => {
      assert.deepEqual(translateNodeProperties(tree2018(), 'Asteridae'), { properties: {}, notes: [] });
    });
  });
});
