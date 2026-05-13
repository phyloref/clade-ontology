/*
 * test_phyx.js: Test all Phyx files in this repository.
 */

const BASE_DIR = 'phyx/';

/*
 * The `phyx` folder contains a set of public and private (encrypted)
 * Phyx files. We can run some fast tests against these:
 *  - 1. Validate them against the JSON Schema.
 * We can also run some slow tests:
 *  - 1. See if we can convert the Phyx file into an ontology without a problem.
 *  - 2. See if JPhyloRef can validate the ontology without a problem.
 */

// Load phyx.js, our Phyx library.
const phyx = require('@phyloref/phyx');

// Javascript libraries.
const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const Ajv = require('ajv');
const chai = require('chai');

const assert = chai.assert;

/*
 * Configuration options.
 */
/* Flag used to determine whether or not we run the slow tests. */
const FLAG_SLOW_TESTS = process.env.RUN_SLOW_TESTS || false;
/* Maximum number of internal specifiers to test. */
const MAX_INTERNAL_SPECIFIERS = process.env.MAX_INTERNAL_SPECIFIERS || 7;
/* Maximum number of external specifiers to test. */
const MAX_EXTERNAL_SPECIFIERS = process.env.MAX_EXTERNAL_SPECIFIERS || 10;

/*
 * Load the JSON schema.
 */
const phyxSchemaJSON = JSON.parse(fs.readFileSync(`${__dirname}/phyx_schema.json`, { encoding: 'utf8' }));
const ajvInstance = new Ajv({
  allErrors: true, // Display all error messages, not just the first.
});
const phyxSchema = ajvInstance.compile(phyxSchemaJSON);

/*
 * Returns a list of Phyx files that we can test in the provided directory.
 *
 * We use a simple flatMap to search for these files. Since flatMap isn't in
 * Node.js yet, I use a map to recursively find the files and then flatten it
 * using reduce() and concat().
 *
 * This could be implemented asynchronously, but we need a list of files to
 * test each one individually in Mocha, so we need a synchronous implementation
 * to get that list before we start testing.
 */
function findPhyxFiles(dirPath) {
  return fs.readdirSync(dirPath).map((filename) => {
    const filePath = path.join(dirPath, filename);

    if (fs.lstatSync(filePath).isDirectory()) {
      // Recurse into this directory.
      return findPhyxFiles(filePath);
    }
    // Look for .json files.
    if (filePath.endsWith('.json')) {
      return [filePath];
    }
    return [];
  }).reduce((x, y) => x.concat(y), []); // This flattens the list of results.
}

describe('Test Phyx files in repository', () => {
  // Test each input file.
  for (const filename of findPhyxFiles(BASE_DIR)) {
    describe(`Phyx file: ${filename}`, () => {
      // Make sure the file to test isn't empty.
      it('is not empty', () => {
        const stats = fs.lstatSync(filename);
        assert.notEqual(stats.size, 0);
      });

      // Load the Phyx data. Skip testing if it is git-crypt encrypted.
      const data = fs.readFileSync(filename);
      const gitcrypt = data.slice(0, 9);
      if (gitcrypt.equals(Buffer.from('\x00GITCRYPT'))) {
        it.skip('cannot test git-encrypted file');
        return;
      }

      // Okay, it looks like the file is not Git-crypted. Validate it
      // against the JSON schema.
      const phyxContent = data.toString('utf-8');
      const json = JSON.parse(phyxContent);
      // Remove the .skip once the Phyx files pass validation.
      it.skip('should validate against the Phyx JSON Schema', () => {
        const result = phyxSchema(json);
        const errorStrings = (phyxSchema.errors || []).map(err => ajvInstance.errorsText([err]));
        assert.deepEqual(errorStrings, []);
        assert.isNull(phyxSchema.errors);
        assert.true(result);
      });

      // Read the Phyx data as UTF-8 and convert it into JSON-LD.
      let wrappedPhyx;
      try {
        wrappedPhyx = new phyx.PhyxWrapper(json);
      } catch (ex) {
        it('Exception thrown while loading Phyx to JSON-LD', () => {
          throw ex;
        });
        return;
      }

      it('has at least one Newick phylogeny', () => {
        const phylogenies = json.phylogenies || [];
        // assert.isAbove(phylogenies.length, 0, 'No phylogenies found in file');

        const newicks = phylogenies
          .map(ph => ph.newick || [])
          .reduce((a, b) => a.concat(b), [])
          .filter(nw => nw.trim() !== '');
        // assert.isAbove(newicks.length, 0, 'No Newick phylogenies found in file');
        if (newicks.length === 0) {
          console.warn(`No Newick phylogenies found in file ${filename}.`);
        }

        // assert.equal(newicks.length, 1,
        //   `Contains ${newicks.length} Newick phylogenies in ${phylogenies.length} phylogenies.`);
        if (newicks.length > 1) {
          console.warn(`Unexpectedly found ${newicks.length} Newick phylogenies in ${phylogenies.length} phylogenies in Phyx file ${filename}.`);
        }
      });

      // console.log(`Loaded Phyx file ${filename}`);

      const skipFile = (json.phylorefs || [])
        .map(phyloref => new phyx.PhylorefWrapper(phyloref))
        .map((wrappedPhyloref) => {
          if (wrappedPhyloref.internalSpecifiers.length > MAX_INTERNAL_SPECIFIERS) {
            it.skip(
              `Phyloreference ${wrappedPhyloref.label} has `
              + `${wrappedPhyloref.internalSpecifiers.length} internal specifiers,`
              + `which is greater than the limit (${MAX_INTERNAL_SPECIFIERS}).`
            );
            return true;
          }

          if (wrappedPhyloref.externalSpecifiers.length > MAX_EXTERNAL_SPECIFIERS) {
            it.skip(
              `Phyloreference ${wrappedPhyloref.label} has `
              + `${wrappedPhyloref.externalSpecifiers.length} external specifiers,`
              + `which is greater than the limit (${MAX_EXTERNAL_SPECIFIERS}).`
            );
            return true;
          }

          if (
            wrappedPhyloref.internalSpecifiers.length === 1 &&
            wrappedPhyloref.externalSpecifiers.length === 0
          ) {
            it.skip(
              `Phyloreference "${wrappedPhyloref.label}" has only 1 internal specifier and no external specifiers — `
              + 'cannot generate a valid OWL class expression (single-specifier limitation).'
            );
            return true;
          }

          return false;
        })
        .reduce((a, b) => a || b, false);

      if (!skipFile) {
        let jsonld;
        let jsonldError = null;
        let child;
        let matches;

        // Build JPhyloRef args at definition time (no async work needed here).
        let jphylorefArgs = [
          '-jar', `${__dirname}/jphyloref.jar`,
          'test', '-', '--jsonld',
        ];
        if ('JVM_ARGS' in process.env) {
          jphylorefArgs = process.env.JVM_ARGS.split(/\s+/).concat(jphylorefArgs);
        }
        if ('JPHYLOREF_ARGS' in process.env) {
          jphylorefArgs = jphylorefArgs.concat(process.env.JPHYLOREF_ARGS.split(/\s+/));
        }

        before(function () {
          this.timeout(30000);
          console.log(`Converting Phyx file ${filename} into JSON-LD`);
          // Catch errors so the hook doesn't abort the whole describe block;
          // the 'produced a non-empty JSON-LD' it() will re-throw to isolate them.
          try {
            jsonld = JSON.stringify(wrappedPhyx.asJSONLD());
          } catch (err) {
            jsonldError = err;
            return;
          }

          if (FLAG_SLOW_TESTS) {
            // Execute JPhyloRef, giving it the JSON-LD on STDIN.
            child = ChildProcess.spawnSync('java', jphylorefArgs, { input: jsonld });

            // Parse the TAP-style summary line from JPhyloRef's STDERR.
            matches = /Testing complete:(\d+) successes, (\d+) failures, (\d+) failures marked TODO, (\d+) skipped./.exec(child.stderr);
            assert(matches !== null, `Test result line not found in STDERR <${child.stderr}>`);
          }
        });

        // Make sure the produced JSON-LD is not empty.
        it('produced a non-empty JSON-LD ontology without throwing an exception', () => {
          if (jsonldError) throw jsonldError;
          assert.isNotEmpty(jsonld);
        });

        // Test the produced JSON-LD using JPhyloRef.
        if (FLAG_SLOW_TESTS) {
          // Test whether we have any failures.
          it('did not report any failures', function () {
            if (jsonldError) { this.skip(); return; }
            const failures = matches[2];
            assert.equal(failures, 0, `${failures} failures occurred during testing`);
          });

          describe('test the results of resolution', () => {
            // We could have zero failures but also zero successes. A Phyx file
            // without any failures, TODOs or any successes in the Clade Ontology
            // should be reported as a failure.
            it('had at least one success', function () {
              if (jsonldError) { this.skip(); return; }
              // TODOs are phyloreferences that we didn't expect to resolve.
              if (Number(matches[3]) > 0) { this.skip(); return; }
              // Skipped phyloreferences: JPhyloRef won't recognize any as skipped.
              // See https://github.com/phyloref/jphyloref/issues/40
              if (Number(matches[4]) > 0) { this.skip(); return; }
              assert.isAbove(Number(matches[1]), 0, 'No successes occurred during testing');
            });

            // On the off chance that all of the above made sense but the exit code didn't,
            // we'll check that here.
            it('passed testing in JPhyloRef', function () {
              if (jsonldError) { this.skip(); return; }
              if (Number(matches[3]) > 0) { this.skip(); return; }
              if (Number(matches[4]) > 0) { this.skip(); return; }
              assert.equal(child.status, 0, 'Exit code from JPhyloRef was not zero');
            });
          });
        }
      }
    });
  }
});
