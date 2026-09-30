/*
 * test/phylogenies/citations.js
 *
 * Covers lib/phylogenies.js's DOI handling. citationDOI() is what decides whether two citations
 * describe the same publication -- it gates the salvage script's writes and the extractor's
 * divergence flag -- so the cases that matter are the malformed DOIs that phyx/phylonym/ actually
 * contains. Matching two citations on a shared piece of junk would be worse than not matching.
 */

const chai = require('chai');

const { citationDOI, rawCitationDOI } = require('../../lib/phylogenies');

const assert = chai.assert;

/** Wrap a DOI string the way a Phyx citation records it. */
const cite = (id) => ({ identifier: [{ type: 'doi', id }] });

describe('citationDOI()', () => {
  it('normalizes the prefixes curators actually type', () => {
    for (const input of [
      '10.3732/ajb.89.9.1510',
      'https://doi.org/10.3732/ajb.89.9.1510',
      'http://dx.doi.org/10.3732/ajb.89.9.1510',
      'doi.org/10.3732/ajb.89.9.1510',
      'doi:10.3732/ajb.89.9.1510',
      '  10.3732/AJB.89.9.1510  ',
    ]) {
      assert.strictEqual(citationDOI(cite(input)), '10.3732/ajb.89.9.1510', `input: ${input}`);
    }
  });

  it('rejects what is recorded in a DOI field but is not a DOI', () => {
    for (const input of [
      '0.1093/gbe/evy014', // missing the leading 1, seen in CLADO_0000008
      '0.3732/ajb.1700255', // ditto, CLADO_0000091
      '10.1093', // truncated, CLADO_0000028
      'Angiosperm phylogeny: 17 genes, 640 taxa. ', // a title, CLADO_0000011
      '',
    ]) {
      assert.isUndefined(citationDOI(cite(input)), `input: ${input}`);
    }
  });

  it('returns undefined rather than throwing on citations with no DOI', () => {
    assert.isUndefined(citationDOI(undefined));
    assert.isUndefined(citationDOI({}));
    assert.isUndefined(citationDOI({ identifier: [] }));
    assert.isUndefined(citationDOI({ identifier: [{ type: 'isbn', id: '978-3-16-148410-0' }] }));
  });

  it('keeps the raw value available so a broken DOI stays visible to curators', () => {
    assert.strictEqual(rawCitationDOI(cite(' 0.1093/gbe/evy014 ')), '0.1093/gbe/evy014');
    assert.isUndefined(rawCitationDOI(undefined));
  });
});
