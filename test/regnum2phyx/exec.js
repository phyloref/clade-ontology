/*
 * exec.js: Tests execution of regnum2phyx.js.
 */

// Javascript libraries.
const ChildProcess = require('node:child_process');
const fs = require('node:fs');

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
  for (const filename of fs.readdirSync(`${__dirname}/examples`)) {
    describe(`Processing example Regnum dump: ${filename}`, () => {
      const filepath = `${__dirname}/examples/${filename}`;

      // We only test '.json' files.
      if (!filepath.endsWith('.json')) {
        it.skip('not a JSON file');
        return;
      }

      // Create a temporary directory to make files into.
      const tmpdirname = tmp.dirSync().name;

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

      // There should be an ./expected/${basename} directory
      // containing at least one file.
      const basename = filename.replace(/.json$/i, '');
      const producedFiles = fs.readdirSync(`${tmpdirname}`);
      const expectedFiles = fs.readdirSync(`${__dirname}/expected/${basename}`);

      it('should produce the expected files', () => {
        expect(producedFiles).to.deep.equal(expectedFiles);
        expect(producedFiles).to.not.be.empty;
      });

      for (const producedFile of producedFiles) {
        describe(`Testing produced file ${producedFile}`, () => {
          const producedPhyx = loadJSON(`${tmpdirname}/${producedFile}`);
          const expectedPhyx = loadJSON(`${__dirname}/expected/${basename}/${producedFile}`);

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
