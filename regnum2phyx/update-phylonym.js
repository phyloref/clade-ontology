/*
 * update-phylonym.js: Orchestrate the full update of phyx/phylonym/ from a new
 * Regnum dump. Combines merge, newick verification, and optional directory swap.
 *
 * Synopsis:
 *   update-phylonym.js <regnum-dump.json> [options]
 *   npm run update-phylonym -- <regnum-dump.json> [options]
 *
 * Without --accept (default): stages merged files to --work-dir for review.
 * With --accept: replaces --old-dir with --work-dir after verification passes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const yargs = require('yargs');

// ── Helpers ──

/**
 * Verify that every newick string in oldDir is present in the corresponding
 * file in workDir. Returns counts and a list of files where newicks were lost.
 */
function verifyNewicks(oldDir, workDir) {
  const files = fs.readdirSync(oldDir).filter(f => /^CLADO_\d+\.json$/.test(f));
  let preserved = 0;
  let lost = 0;
  const lostFiles = [];

  for (const f of files) {
    const oldData = JSON.parse(fs.readFileSync(path.join(oldDir, f), 'utf8'));
    const workPath = path.join(workDir, f);
    if (!fs.existsSync(workPath)) continue;
    const workData = JSON.parse(fs.readFileSync(workPath, 'utf8'));
    const workPhylogenies = workData.phylogenies || [];

    for (const p of (oldData.phylogenies || [])) {
      if (!p.newick) continue;
      if (workPhylogenies.some(wp => wp.newick === p.newick)) {
        preserved++;
      } else {
        lost++;
        lostFiles.push(f);
      }
    }
  }

  return { preserved, lost, lostFiles };
}

// ── CLI ──

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <regnum-dump.json> [options]')
  .demandCommand(1, 1)
  .option('old-dir', {
    describe: 'Directory with existing curated PHYX files',
    default: 'phyx/phylonym/',
    string: true,
  })
  .option('work-dir', {
    describe: 'Staging directory for merged output',
    default: 'phyx/phylonym-merged/',
    string: true,
  })
  .option('report', {
    describe: 'Path to write CSV report (passed to merge-phylonym.js)',
    string: true,
  })
  .option('digits', {
    describe: 'CLADO filename padding digits (passed to merge-phylonym.js)',
    type: 'number',
    default: 7,
  })
  .option('accept', {
    describe: 'Replace --old-dir with --work-dir after successful verification',
    type: 'boolean',
    default: false,
  })
  .option('backup', {
    describe: 'Create a backup of --old-dir when --accept is used (--no-backup to skip)',
    type: 'boolean',
    default: true,
  })
  .option('dry-run', {
    describe: 'Pass --dry-run to merge-phylonym.js; report only, no files written',
    type: 'boolean',
    default: false,
  })
  .help('h')
  .alias('h', 'help')
  .argv;

const dumpPath = path.resolve(argv._[0]);
const oldDir = path.resolve(argv.oldDir);
const workDir = path.resolve(argv.workDir);
const mergePath = path.join(__dirname, 'merge-phylonym.js');

// Validate inputs.
if (!fs.existsSync(dumpPath)) {
  process.stderr.write(`Error: dump file not found: ${dumpPath}\n`);
  process.exit(1);
}
if (!fs.existsSync(oldDir)) {
  process.stderr.write(`Error: --old-dir not found: ${oldDir}\n`);
  process.exit(1);
}

// ── Dry-run mode ──

if (argv.dryRun) {
  const reportArg = argv.report ? ` --report ${JSON.stringify(argv.report)}` : '';
  process.stderr.write('Running in dry-run mode (no files written).\n');
  execSync(
    `node ${JSON.stringify(mergePath)} ${JSON.stringify(dumpPath)} -o ${JSON.stringify(workDir)} --old-dir ${JSON.stringify(oldDir)} --digits ${argv.digits}${reportArg} --dry-run`,
    { stdio: 'inherit' },
  );
  process.exit(0);
}

// ── Phase 1: Merge (or reuse existing work-dir) ──

if (fs.existsSync(workDir)) {
  process.stderr.write(`Reusing existing staged output: ${workDir}\n`);
  process.stderr.write('(Delete it and re-run to regenerate from the dump.)\n\n');
} else {
  process.stderr.write('Phase 1: Merging dump with existing curated files...\n');
  const reportArg = argv.report ? ` --report ${JSON.stringify(argv.report)}` : '';
  try {
    execSync(
      `node ${JSON.stringify(mergePath)} ${JSON.stringify(dumpPath)} -o ${JSON.stringify(workDir)} --old-dir ${JSON.stringify(oldDir)} --digits ${argv.digits}${reportArg}`,
      { stdio: 'inherit' },
    );
  } catch (_) {
    // merge-phylonym.js exits 1 on apomorphy/crown warnings — that's expected.
    // Only fail if work-dir was not created.
    if (!fs.existsSync(workDir)) {
      process.stderr.write('Error: merge-phylonym.js produced no output.\n');
      process.exit(1);
    }
  }
}

// ── Phase 2: Verify newicks ──

process.stderr.write('Phase 2: Verifying newick preservation...\n');
const { preserved, lost, lostFiles } = verifyNewicks(oldDir, workDir);

if (lost > 0) {
  process.stderr.write(`ERROR: ${lost} newick(s) lost in: ${lostFiles.join(', ')}\n`);
  process.stderr.write('Staged output retained for inspection. Aborting.\n');
  process.exit(1);
}

process.stderr.write(`  Newicks preserved: ${preserved}  Lost: ${lost}\n\n`);

// ── Phase 3: Summary and next steps ──

const workFiles = fs.readdirSync(workDir).filter(f => /^CLADO_\d+\.json$/.test(f)).length;
const oldFiles = fs.readdirSync(oldDir).filter(f => /^CLADO_\d+\.json$/.test(f)).length;

process.stderr.write("=== Summary ===\n");
process.stderr.write(`  Old directory: ${oldFiles} files in ${oldDir}\n`);
process.stderr.write(`  Staged output: ${workFiles} files in ${workDir}\n`);
if (argv.report) process.stderr.write(`  Report:        ${argv.report}\n`);
process.stderr.write('\n');

if (!argv.accept) {
  const dumpArg = JSON.stringify(argv._[0]);
  const oldDirArg = argv.oldDir !== 'phyx/phylonym/' ? ` --old-dir ${JSON.stringify(argv.oldDir)}` : '';
  const workDirArg = argv.workDir !== 'phyx/phylonym-merged/' ? ` --work-dir ${JSON.stringify(argv.workDir)}` : '';
  const reportArg = argv.report ? ` --report ${JSON.stringify(argv.report)}` : '';

  process.stderr.write('Merge staged successfully. Review the output:\n');
  process.stderr.write(`  diff -rq ${JSON.stringify(oldDir)} ${JSON.stringify(workDir)} | head -20\n`);
  process.stderr.write('\n');
  process.stderr.write('When satisfied, accept the merge:\n');
  process.stderr.write(`  node regnum2phyx/update-phylonym.js ${dumpArg}${oldDirArg}${workDirArg}${reportArg} --accept\n`);
  process.exit(0);
}

// ── Phase 4: Accept — rename dirs ──

process.stderr.write('Phase 3: Accepting merge...\n');

if (argv.backup) {
  const backupDir = `${oldDir}-backup`;
  if (fs.existsSync(backupDir)) {
    process.stderr.write(`Error: backup directory already exists: ${backupDir}\n`);
    process.stderr.write('Remove it or use --no-backup to skip creating a backup.\n');
    process.exit(1);
  }
  fs.renameSync(oldDir, backupDir);
  process.stderr.write(`  Backed up: ${oldDir} → ${backupDir}\n`);
} else {
  fs.rmSync(oldDir, { recursive: true });
  process.stderr.write(`  Removed: ${oldDir}\n`);
}

fs.renameSync(workDir, oldDir);
process.stderr.write(`  Installed: ${workDir} → ${oldDir}\n`);

const dumpBasename = path.basename(dumpPath);
process.stderr.write('\nDone. Next steps:\n');
process.stderr.write('  npm test\n');
process.stderr.write(`  git add ${JSON.stringify(argv.oldDir)}\n`);
process.stderr.write(`  git commit -m "Update phylonym PHYX files from ${dumpBasename}"\n`);
