/*
 * test_phyx.js: Test all PHYX files in this repository.
 */

const BASE_DIR = 'phyx/';

// Javascript libraries.
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
            const stats = fs.lstatSync(filename);

            it('is not empty', function() {
                assert.notEqual(stats["size"], 0);
            });

            const data = fs.readFileSync(filename).slice(0, 9);
            if(data.equals(Buffer.from("\x00GITCRYPT"))) {
                it.skip('is git-crypt encrypted');
                return;
            }

            it('is not git-crypt encrypted');
        });
    });
});


//  2. Skip files that start with "\x00GITCRYPT", which means they are Git encrypted.
