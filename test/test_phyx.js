/*
 * test_phyx.js: Test all PHYX files in this repository.
 */

const BASE_DIR = 'phyx/';

/*
 * phyx.js uses some code (in particular through phylotree.js) that expects certain
 * Javascript libraries to be loaded via the browser using <script>. To replicate
 * this in Node, we load them and add them to the global object.
 */

// Load moment as a global variable so it can be accessed by phyx.js.
global.moment = require('moment');

// Load jQuery.extend as a global variable so it can be accessed by phyx.js.
global.jQuery = {};
global.jQuery.extend = require('extend');

// Load d3 as a global variable so it can be accessed by both phylotree.js (which
// needs to add additional objects to it) and phyx.js (which needs to call it).
global.d3 = require('d3');

// phylotree.js does not export functions itself, but adds them to global.d3.layout.
// So we set up a global.d3.layout object for them to be added to, and then we include
// phylotree.js ourselves.
if (!Object.prototype.hasOwnProperty.call(global.d3, 'layout')) {
  global.d3.layout = {};
}
require('../curation-tool/lib/phylotree.js/phylotree.js');

// Load phyx.js, our PHYX library.
const phyx = require('../curation-tool/js/phyx.js');

// Javascript libraries.
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const TapParser = require('tap-parser');
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

describe('Test PHYX files in repository', function() {
    // Test each input file.
    findPHYXFiles(BASE_DIR).forEach(function(filename) {
        describe('PHYX file: ' + filename, function() {

            // Make sure the file to test isn't empty.
            it('is not empty', function() {
              const stats = fs.lstatSync(filename);
              assert.notEqual(stats["size"], 0);
            });

            // Load the PHYX data. Skip testing if it is git-crypt encrypted.
            const data = fs.readFileSync(filename);
            const gitcrypt = data.slice(0, 9);
            if(gitcrypt.equals(Buffer.from("\x00GITCRYPT"))) {
                it.skip('cannot test git-encrypted file');
                return;
            }

            // Read the PHYX data as UTF-8 and convert it into JSON-LD.
            const phyxContent = data.toString('utf-8');
            let json;
            let jsonld;
            try {
              json = JSON.parse(phyxContent);
              const wrappedPhyx = new phyx.PHYXWrapper(json);
              jsonld = JSON.stringify(wrappedPhyx.asJSONLD());
            } catch(ex) {
              it('Exception thrown while converting PHYX to JSON-LD', function() {
                throw ex;
              });
              return;
            }

            // Make sure the produced JSON-LD is not empty.
            it('produced JSON-LD is not empty', function() {
              assert.isNotEmpty(jsonld);
            });

            // Write out information about the tested phyloreferences.
            it('contains one or more phyloreferences', function() {
              assert.property(json, 'phylorefs');
              assert.isAbove(json.phylorefs.length, 0);
            });

            // Test the produced JSON-LD using JPhyloRef.
            var args = [
              '-jar', 'jphyloref/jphyloref.jar',
              'test', '-', '--jsonld'
            ];

            // Some command line arguments should also be inserted into the command line.
            // JVM_ARGS should be given to the Java interpreter.
            if('JVM_ARGS' in process.env) {
              args = process.env.JVM_ARGS.split(/\s+/).concat(args);
            }

            // JPHYLOREF_ARGS should be given to JPhyloRef
            if('JPHYLOREF_ARGS' in process.env) {
              args = args.concat(process.env.JPHYLOREF_ARGS.split(/\s+/));
            }

            // Set up a TapParser.
            const tapParser = new TapParser(result => {
              it('should test all phyloreferences', function () {
                assert.equal(result.count, json.phylorefs.length, 'number of test results should equal the number of phylorefs in file');
              });

              it('should pass all non-skipped tests', function () {
                assert(result.ok);
              });
            });
            tapParser.on('assert', result => {
              const phyloref = new phyx.PhylorefWrapper(json.phylorefs[result.id - 1]);
              const countInternal = phyloref.phyloref.internalSpecifiers.length;
              const countExternal = phyloref.phyloref.externalSpecifiers.length;
              describe(`Phyloreference ${phyloref.label} (${countInternal} internal specifiers, ${countExternal} external specifiers)`, function () {
                phyloref.specifiers.forEach(specifier => {
                  it('Includes ' +  phyloref.getSpecifierType(specifier).toLowerCase() +
                    ' specifier ' + phyx.PhylorefWrapper.getSpecifierLabel(specifier), function () {
                      assert(true);
                    });
                });

                if (result.hasOwnProperty('todo')) {
                  it.skip('Skipping as TODO: ' + result.todo);
                } else if (result.hasOwnProperty('skip')) {
                  it.skip('Skipping: ' + result.skip);
                } else {
                  it('should pass testing', function () {
                    assert(assert.ok);
                  });
                }
              });
            });

            // Execute the command line, giving it the JSON-LD on STDIN.
            const child = child_process.spawnSync('java', args, { input: jsonld });

            tapParser.write(child.stdout);
            tapParser.end();

            // Test whether we can read the test result line from JPhyloRef.
            // Eventually, we will parse the TAP results directly.
            const matches = /Testing complete:(\d+) successes, (\d+) failures, (\d+) failures marked TODO, (\d+) skipped./.exec(child.stderr);
            it('produces a valid test result line from JPhyloRef', function() {
              assert.isNotNull(matches, 'Test result line not found in STDOUT');
            });

            // Test whether we have any failures.
            it('did not report any failures', function() {
              const failures = matches[2];
              assert.equal(failures, 0, failures + ' failures occurred during testing');
            });

            // Look for TODOs or skipped tests.
            const successes = matches[1];
            const todos = matches[3];
            const skipped = matches[4];

            if(todos > 0) {
              // TODOs are phyloreferences that we didn't expect to resolve.
              it.skip(todos + ' phyloreferences were marked as TODO during testing.');
              return;
            }

            if(skipped > 0) {
              // Skipped phyloreferences are here for historical reasons: JPhyloRef
              // won't actually recognize any phyloreferences as skipped. This has
              // been reported as https://github.com/phyloref/jphyloref/issues/40
              it.skip(skipped + ' phyloreferences were skipped during testing.');
              return;
            }

            // We could have zero failures but also zero successes. A Phyx file
            // without any failures, TODOs or any successes in the Clade Ontology
            // should be reported as a failure.
            it('had at least one success', function() {
              assert.isAbove(successes, 0, 'No successes occurred during testing');
            });

            // On the off chance that all of the above made sense but the exit code didn't,
            // we'll check that here.
            it('passed testing in JPhyloRef', function() {
              assert.equal(child.status, 0, 'Exit code from JPhyloRef was not zero');
            });
        });
    });
});
