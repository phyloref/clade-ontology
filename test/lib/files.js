/*
 * test/lib/files.js
 *
 * Tests the shared recursive walker in lib/files.js, which decides which files the Phyx tests,
 * the ontology build and the phylogeny tooling see.
 */

const fs = require('node:fs');
const path = require('node:path');

const chai = require('chai');
const tmp = require('tmp');

const { findJSONFiles } = require('../../lib/files');

const assert = chai.assert;

describe('lib/files.js findJSONFiles', () => {
  it('follows symlinked directories without looping on a cycle', () => {
    const base = tmp.dirSync({ unsafeCleanup: true }).name;
    const root = path.join(base, 'root');
    const elsewhere = path.join(base, 'elsewhere');
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(root, 'a.json'), '{}');
    fs.writeFileSync(path.join(root, 'sub', 'b.json'), '{}');
    fs.writeFileSync(path.join(root, 'notes.txt'), '');
    fs.writeFileSync(path.join(elsewhere, 'c.json'), '{}');
    // phyx2ontology.js has always built what a symlinked directory holds...
    fs.symlinkSync(elsewhere, path.join(root, 'linked'), 'dir');
    // ...and a link back up the tree must not send the walk round forever.
    fs.symlinkSync(root, path.join(root, 'sub', 'loop'), 'dir');

    const found = findJSONFiles(root).map((f) => path.relative(root, f)).sort();
    assert.deepEqual(found, ['a.json', path.join('linked', 'c.json'), path.join('sub', 'b.json')]);
  });
});
