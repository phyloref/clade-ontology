/*
 * exec.js: Tests execution of regnum2phyx.js.
 */

// Javascript libraries.
const ChildProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const tmp = require('tmp');
const chai = require('chai');
const Ajv = require('ajv');

const assert = chai.assert;
const expect = chai.expect;

// Load a JSON file from the file system.
function loadJSON(filename) {
  const content = fs.readFileSync(filename, { encoding: 'utf8' });
  return JSON.parse(content);
}

describe('Test regnum2phyx.js', () => {
  // Each correct test case is a self-contained directory under fixtures/correct/,
  // named for the case: it holds the input dump (<case>/<case>.json) and the
  // expected output Phyx files (<case>/expected/).
  for (const basename of fs.readdirSync(`${__dirname}/../fixtures/correct`)) {
    describe(`Processing example Regnum dump: ${basename}`, () => {
      const caseDir = `${__dirname}/../fixtures/correct/${basename}`;
      const filepath = `${caseDir}/${basename}.json`;

      // We only test fixture directories that contain an input dump.
      if (!fs.statSync(caseDir).isDirectory() || !fs.existsSync(filepath)) {
        it.skip('not a fixture directory');
        return;
      }

      // Create a temporary directory and use a non-existing subdirectory as the
      // output path, so regnum2phyx.js can create it (it errors if it already exists).
      const tmpdirname = path.join(tmp.dirSync().name, 'output');

      // Run phyx2regnum.js on it.
      const child = ChildProcess.spawnSync(
        process.execPath,
        [
          'regnum2phyx/regnum2phyx.js',
          filepath,
          '-o',
          tmpdirname,
        ],
        {
          encoding: 'utf8',
        }
      );

      it('could be executed by regnum2phyx.js', () => {
        expect(child.stderr).to.be.empty;
        expect(child.stdout).to.match(/^(\d+) Phyx files produced successfully.\n$/);
        expect(child.status).to.equal(0);
      });

      // The case's expected/ directory should contain at least one file.
      const producedFiles = fs.readdirSync(`${tmpdirname}`);
      const expectedFiles = fs.readdirSync(`${caseDir}/expected`);

      it('should produce the expected files', () => {
        expect(producedFiles).to.deep.equal(expectedFiles);
        expect(producedFiles).to.not.be.empty;
      });

      for (const producedFile of producedFiles) {
        describe(`Testing produced file ${producedFile}`, () => {
          const producedPhyx = loadJSON(`${tmpdirname}/${producedFile}`);
          const expectedPhyx = loadJSON(`${caseDir}/expected/${producedFile}`);

          it('should be identical to expected', () => {
            expect(producedPhyx).to.deep.equal(expectedPhyx);
          });

          const phyxSchemaJSON = loadJSON(`${__dirname}/../phyx_schema.json`);
          const ajvInstance = new Ajv({
            allErrors: true, // Display all error messages, not just the first.
          });
          const phyxSchema = ajvInstance.compile(phyxSchemaJSON);
          const result = phyxSchema(producedPhyx);

          it('should validate against the Phyx JSON Schema', () => {
            for (const error of (phyxSchema.errors || [])) {
              assert.fail(ajvInstance.errorsText([error]));
            }
            expect(result).is.true;
          });
        });
      }
    });
  }
});
