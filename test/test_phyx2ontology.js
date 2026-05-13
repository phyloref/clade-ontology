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
  this.timeout(60000);

  // Redirect the child's stdout straight to a file via stdio. spawnSync's default
  // maxBuffer is 1 MB and the ontology output for the current phyx/ corpus is
  // hundreds of MB; using an in-memory buffer would cause Node to kill the child
  // with SIGTERM as soon as that limit is exceeded.
  const outFd = fs.openSync(tmpfilename, 'w');
  const child = ChildProcess.spawnSync(process.execPath, [
    'phyx2ontology/phyx2ontology.js', BASE_DIR,
  ], {
    stdio: ['ignore', outFd, 'inherit'],
  });
  fs.closeSync(outFd);

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
