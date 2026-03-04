/*
 * test_phyx2ontology.js: Test whether phyx2ontology.js can be executed successfully.
 */

const BASE_DIR = 'phyx/';

// Node libraries.
const ChildProcess = require('node:child_process');
const fs = require('node:fs');

// Javascript libraries.
const tmp = require('tmp');
const chai = require('chai');

const assert = chai.assert;

const tmpfilename = tmp.fileSync().name;

describe('Executing phyx2ontology.js on all current Phyx files', function () {
  this.timeout(10000);

  const child = ChildProcess.spawnSync(process.execPath, [
    'phyx2ontology/phyx2ontology.js', BASE_DIR, '>', tmpfilename,
  ], {
    encoding: 'utf8',
    shell: true,
  });

  it('should execute successfully', () => {
    assert.isNull(child.signal, `Terminated because of signal ${child.signal}`);
    assert.equal(child.status, 0, 'Exit value should be zero');
  });

  it('should produce valid JSON output', () => {
    const jsonContent = fs.readFileSync(tmpfilename, { encoding: 'utf8' });
    let json = [];
    assert.doesNotThrow(() => {
      json = JSON.parse(jsonContent);
    }, SyntaxError);
    assert.isNotEmpty(json, 'Produced JSON should not be empty');
  });
});
