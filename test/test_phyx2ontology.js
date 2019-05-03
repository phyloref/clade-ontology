/*
 * test_phyx2ontology.js: Test whether phyx2ontology.js can be executed successfully.
 */

const BASE_DIR = 'phyx/';

// Javascript libraries.
const ChildProcess = require('child_process');
const chai = require('chai');

const assert = chai.assert;

describe('Executing phyx2ontology.js on all current Phyx files', function () {
  const child = ChildProcess.spawnSync(process.execPath, [
    'phyx2ontology/phyx2ontology.js', BASE_DIR,
  ]);

  it('should execute successfully', function () {
    assert.isEmpty(child.stderr, 'Should not produce any output to STDERR');
    assert.isNotEmpty(child.stdout, 'Should produce output in STDOUT');
    assert.isNull(child.signal, `Should not have terminated because of signal ${child.signal}`);
    assert.equal(child.status, 0, 'Exit value should be zero');
  });

  it('should produce valid JSON output', function () {
    let json = [];
    assert.doesNotThrow(function () {
      json = JSON.parse(child.stdout);
    }, SyntaxError);
    assert.isNotEmpty(json, 'Produced JSON should not be empty');
  });
});
