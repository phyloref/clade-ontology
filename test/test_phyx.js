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
const ChildProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const retus = require('retus');
const lodash = require('lodash');

const Ajv = require('ajv');
const chai = require('chai');

const assert = chai.assert;

/*
 * Configuration options.
 */
/* Flag used to determine whether or not we run the slow tests. */
const FLAG_SLOW_TESTS = process.env.SLOW_TESTS || false;
/* Flag used to determine whether or not we run the online tests. */
const FLAG_ONLINE_TESTS = process.env.ONLINE_TESTS || false;
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
  return fs.readdirSync(dirPath).map(function (filename) {
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

describe('Test Phyx files in repository', function () {
  // Test each input file.
  findPhyxFiles(BASE_DIR).forEach(function (filename) {
    describe(`Phyx file: ${filename}`, function () {
      // Make sure the file to test isn't empty.
      it('is not empty', function () {
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
      it.skip('should validate against the Phyx JSON Schema', function () {
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
        it('Exception thrown while loading Phyx to JSON-LD', function () {
          throw ex;
        });
        return;
      }

      console.log(`Loaded Phyx file ${filename}`);

        it('should have a Newick phylogeny', () => {
          const newick = json.phylogenies.map(p => p.newick || "").find(elem => !lodash.isEmpty(elem));
          assert.isNotEmpty(newick);
        });

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

          return false;
        })
        .reduce((a, b) => a || b, false);

      if (!skipFile) {
        console.log(`Converting Phyx file ${filename} into JSON-LD`);
        const jsonld = JSON.stringify(wrappedPhyx.asJSONLD());

        // Make sure the produced JSON-LD is not empty.
        it('produced a non-empty JSON-LD ontology without throwing an exception', function () {
          assert.isNotEmpty(jsonld);
        });

        // Test the Phyx file using the Open Tree of Life API.
        if (FLAG_ONLINE_TESTS) {
          /**
           * Display debugging output to STDERR if the '--verbose' flag has been set.
           */
          function debug(...args) {
            process.stderr.write(args.join(' ') + "\n")
          }

          function specifierToOTLId(specifier) {
            const wrappedSpecifier = new phyx.TaxonomicUnitWrapper(specifier);

            if (!wrappedSpecifier.taxonConcept) {
              debug(`     - ${wrappedSpecifier.label}: not a taxon concept`);
              return undefined;
            } else {
              const nameComplete = new phyx.TaxonConceptWrapper(specifier).nameComplete;

              if (!nameComplete) {
                debug(`     - ${wrappedSpecifier.label} is missing a taxonomic name: ${JSON.stringify(specifier)}`);
                return undefined;
              } else {
                const nameToUse = nameComplete.replace(/\s+\(originally \w+\)/g, "");
                const { statusCode, body } = retus("https://api.opentreeoflife.org/v3/tnrs/match_names", {
                  method: 'post',
                  json: { names : [ nameToUse ] },
                });

                const matches = body['results'].map(result => result['matches']).reduce((acc, curr) => acc.concat(curr), []);

                const ottNames = matches.filter(match => match).map(match => match['taxon']['name']).filter(name => name);
                const ottIds = matches.filter(match => match).map(match => match['taxon']['ott_id']).filter(ott_id => ott_id);

                if (ottIds.length > 1) debug(`     - Taxon name ${nameComplete} resolved to multiple OTT Ids: ${ottIds.join(', ')}.`)

                const result = {};
                result[nameComplete] = ottIds;
                return result;
              }
            }
          }

          (json.phylorefs || [])
            .map(phyloref => new phyx.PhylorefWrapper(phyloref))
            .forEach((wrappedPhyloref) => {
              const internalOTTs = wrappedPhyloref.internalSpecifiers.map(specifierToOTLId);
              const internalOTTids = lodash.flattenDeep(internalOTTs.map(ott => lodash.head(lodash.values(ott))));
              debug(`   - Internal specifiers: ${internalOTTids.join(", ")}`);
              // console.log(internalOTTids);

              const externalOTTs = wrappedPhyloref.externalSpecifiers.map(specifierToOTLId);
              const externalOTTids = lodash.flattenDeep(externalOTTs.map(ott => lodash.head(lodash.values(ott))));
              debug(`   - External specifiers: ${externalOTTids.join(", ")}`);
              // console.log(externalOTTids);

              describe(`Phyloreference ${wrappedPhyloref.label}`, () => {
                it(`should be resolvable on the Open Tree of Life`, () => {
                  assert(internalOTTids.filter(x => x === undefined).length === 0, "All internal specifiers must be matched to OTT Ids");
                  assert(externalOTTids.filter(x => x === undefined).length === 0, "All external specifiers must be matched to OTT Ids");
                  assert(internalOTTids.length > 0, "No internal specifiers present in phyloref.");

                  // debug('Request: ', { node_ids: internalOTTids, excluded_node_ids: externalOTTids });
                  const result = retus("https://api.opentreeoflife.org/v3/tree_of_life/mrca ", {
                    throwHttpErrors: false,
                    method: 'post',
                    json: { node_ids: internalOTTids.map(id => "ott" + id), excluded_node_ids: externalOTTids.map(id => "ott" + id) },
                    responseType: 'text',
                  });

                  // There are two types of responses we might get:
                  //  - If we have external specifiers, we'll get a 'node_ids', where the first one
                  //    is the node-based name and the last one is the branch-based name, and a 'synth_id'.
                  //  - If we have only internal specifiers, we'll get a 'mrca' with a 'node_id' (as well as
                  //    'supported_by' and 'unique_name') and a 'synth_id'.

                  assert(result.statusCode != 404 && result.statusCode != 400, `Could not find MRCA: ${result}`);

                  const body = JSON.parse(result.body);
                  const synth_id = body['synth_id'];
                  if (body['node_ids']) {
                    const node_id = body.node_ids[body.node_ids.length - 1];
                    debug(`          -> ${body.node_ids.length} node IDs returned, with branch-based node at: https://tree.opentreeoflife.org/opentree/argus/${synth_id}@${node_id}`);

                    const nodeInfo = retus("https://api.opentreeoflife.org/v3/tree_of_life/node_info ", {
                      method: 'post',
                      json: { node_id }
                    });

                    let name = "";
                    if (nodeInfo['body'] && nodeInfo['body']['taxon'] && nodeInfo['body']['taxon']['unique_name']) {
                      name = nodeInfo['body']['taxon']['unique_name'];
                      debug(`            - Identified as ${name}.`);
                    } else {
                      debug(`            - Could not identify node.`);
                    }
                  } else if(body['mrca']) {
                    const name = body.mrca.unique_name || ((body.mrca.taxon || {}).name) || "";
                    debug(`          -> Found MRCA node (${name}): https://tree.opentreeoflife.org/opentree/argus/${synth_id}@${body.mrca.node_id}`);
                  } else {
                    assert.fail('Unable to interpret Open Tree MRCA response: ', body);
                  }
                });
              });
            });
        }

        // Test the produced JSON-LD using JPhyloRef.
        if (FLAG_SLOW_TESTS) {
          let args = [
            '-jar', `${__dirname}/jphyloref.jar`,
            'test', '-', '--jsonld',
          ];

          // Some command line arguments should also be inserted into the command line.
          // JVM_ARGS should be given to the Java interpreter.
          if ('JVM_ARGS' in process.env) {
            args = process.env.JVM_ARGS.split(/\s+/).concat(args);
          }

          // JPHYLOREF_ARGS should be given to JPhyloRef
          if ('JPHYLOREF_ARGS' in process.env) {
            args = args.concat(process.env.JPHYLOREF_ARGS.split(/\s+/));
          }

          // Execute the command line, giving it the JSON-LD on STDIN.
          const child = ChildProcess.spawnSync('java', args, { input: jsonld });

          // Test whether we can read the test result line from JPhyloRef.
          // Eventually, we will parse the TAP results directly.
          const matches = /Testing complete:(\d+) successes, (\d+) failures, (\d+) failures marked TODO, (\d+) skipped./.exec(child.stderr);
          assert(matches !== null, `Test result line not found in STDERR <${child.stderr}>`);
          console.log(`For ${filename}: ${matches}`);

          // Test whether we have any failures.
          it('did not report any failures', function () {
            const failures = matches[2];
            assert.equal(failures, 0, `${failures} failures occurred during testing`);
          });

          describe('test the results of resolution', function () {
            // Look for TODOs or skipped tests.
            const successes = matches[1];
            const todos = matches[3];
            const skipped = matches[4];

            if (todos > 0) {
            // TODOs are phyloreferences that we didn't expect to resolve.
              it.skip(`${todos} phyloreferences were marked as TODO during testing.`);
              return;
            }

            if (skipped > 0) {
            // Skipped phyloreferences are here for historical reasons: JPhyloRef
            // won't actually recognize any phyloreferences as skipped. This has
            // been reported as https://github.com/phyloref/jphyloref/issues/40
              it.skip(`${skipped} phyloreferences were skipped during testing.`);
              return;
            }

            // We could have zero failures but also zero successes. A Phyx file
            // without any failures, TODOs or any successes in the Clade Ontology
            // should be reported as a failure.
            it('had at least one success', function () {
              assert.isAbove(successes, 0, 'No successes occurred during testing');
            });

            // On the off chance that all of the above made sense but the exit code didn't,
            // we'll check that here.
            it('passed testing in JPhyloRef', function () {
              assert.equal(child.status, 0, 'Exit code from JPhyloRef was not zero');
            });
          });
        }
      }
    });
  });
});
