/*
 * test_phyx.js: Test all PHYX files in this repository.
 */

const BASE_DIR = 'phyx/';

// Our libraries.
const phyx2jsonld = require('../curation-tool/js/phyx2jsonld.js');

// Javascript libraries.
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const chai = require('chai');
const assert = chai.assert;

/*
 * Returns a list of PHYX files that we can test in the provided directory.
 *
 * We use a simple flatMap to search for these files. Since flatMap isn't in
 * Node.js yet, I use a map to recursively find the files and then flatten it
 * using reduce() and concat().
 *
 * This could be implemented asynchronously, but we need a list of files to
 * test each one individually in Mocha, so we need a synchronous implementation
 * to get that list before we start testing.
 */
function findPHYXFiles(dirPath) {
    return fs.readdirSync(dirPath).map(function(filename) {
        const filePath = path.join(dirPath, filename);

        if(fs.lstatSync(filePath).isDirectory()) {
            // Recurse into this directory.
            return findPHYXFiles(filePath);
        } else {
            // Look for .json files (but not for '_as_owl.json' files, for historical reasons).
            if(filePath.endsWith('.json') && !filePath.endsWith('_as_owl.json')) {
                return [filePath];
            } else {
                return [];
            }
        }
   }).reduce((x, y) => x.concat(y), []); // This flattens the list of results.
}

// Test each input file.
describe('Test PHYX files in repository', function() {
    findPHYXFiles(BASE_DIR).forEach(function(filename) {
        describe('PHYX file: ' + filename, function() {
            it('is not empty', function() {
              const stats = fs.lstatSync(filename);
              assert.notEqual(stats["size"], 0);
            });

            it('can be converted into JSON-LD and reasoned over (skipped if git-crypt encrypted)', function() {
              // Load the PHYX data. Check to see if it is git-crypt encrypted.
              const data = fs.readFileSync(filename);
              const gitcrypt = data.slice(0, 9);
              if(gitcrypt.equals(Buffer.from("\x00GITCRYPT"))) {
                  this.skip(); // Hopefully they will eventually let us write out a message here.
                  return;
              }

              // Read the PHYX data as 'UTF-8' and convert it into JSON-LD.
              const phyx = data.toString('utf-8');
              const jsonld = phyx2jsonld.convertPHYXToJSONLD(phyx);
              assert.isNotEmpty(jsonld);

              // Test using JPhyloRef.
              var args = [
                '-jar', 'jphyloref/jphyloref.jar',
                'test', '-'
              ];
              if('JVM_ARGS' in process.env) {
                args.unshift(process.env.JVM_ARGS);
              }
              if('JPHYLOREF_ARGS' in process.env) {
                args.push(process.env.JPHYLOREF_ARGS);
              }
              const stdout = child_process.execFileSync('java', args);
              const matches = /Testing complete:(\d+) successes, (\d+) failures, (\d+) failures marked TODO, (\d+) skipped./.exec(stdout);
              assert.isNotNull(matches, 'Testing complete line not found in STDOUT');

              const successes = matches[1];
              const failures = matches[2];
              const todos = matches[3];
              const skipped = matched[4];

              if(skipped > 0 || todos > 0 || successes == 0) {
                this.skip();
                return;
              }

              assert.notStrictEqual(failures, 0, failures + ' failures occurred in this file');
              assert.isAbove(successes, 0, 'Only successes occured when testing this PHYX file');
            });
        });
    });
});


//  2. Skip files that start with "\x00GITCRYPT", which means they are Git encrypted.
