/*
 * merge-phylonym.js: Merge a new Regnum dump with existing curated Phylonym PHYX files.
 *
 * Generates fresh PHYX files from the dump via regnum2phyx.js, then merges in
 * manual additions (newick phylogenies) from the old curated files.
 *
 * Synopsis:
 *   merge-phylonym.js <regnum-dump.json> -o <output-dir> --old-dir <phyx/phylonym/>
 *                     [--report merge-report.csv] [--digits 7] [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const os = require('node:os');
const yargs = require('yargs');

// ── Helpers ──

function escapeCSV(field) {
  const str = String(field == null ? '' : field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function loadJSON(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function normalizeDOI(doi) {
  if (!doi) return null;
  return doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim();
}

function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Extract a fingerprint from a phylogeny object for matching purposes.
 * Looks at primaryPhylogenyCitation or phylogenyCitation for DOI, title, year.
 */
function getCitationFingerprint(phylogeny) {
  const cit = phylogeny.primaryPhylogenyCitation
    || phylogeny.phylogenyCitation
    || {};
  const doiEntry = (cit.identifier || []).find(i => i.type === 'doi');
  const doi = doiEntry ? normalizeDOI(doiEntry.id) : null;
  const title = normalizeTitle(cit.title || '');
  const year = cit.year || null;
  const isPrimary = !!phylogeny.primaryPhylogenyCitation;
  return { doi, title, year, isPrimary };
}

/**
 * Match phylogenies between old and new files using a three-tier cascade.
 * Returns { matched, unmatchedOld, unmatchedNew }.
 */
function matchPhylogenies(oldPhylogenies, newPhylogenies) {
  const matched = [];
  const usedOld = new Set();
  const usedNew = new Set();

  // Tier 1: Match by DOI.
  for (let oi = 0; oi < oldPhylogenies.length; oi++) {
    if (usedOld.has(oi)) continue;
    const oldFp = getCitationFingerprint(oldPhylogenies[oi]);
    if (!oldFp.doi) continue;
    for (let ni = 0; ni < newPhylogenies.length; ni++) {
      if (usedNew.has(ni)) continue;
      const newFp = getCitationFingerprint(newPhylogenies[ni]);
      if (newFp.doi && oldFp.doi === newFp.doi) {
        matched.push({ oldIdx: oi, newIdx: ni, method: 'doi' });
        usedOld.add(oi);
        usedNew.add(ni);
        break;
      }
    }
  }

  // Tier 2: Match by title + year.
  for (let oi = 0; oi < oldPhylogenies.length; oi++) {
    if (usedOld.has(oi)) continue;
    const oldFp = getCitationFingerprint(oldPhylogenies[oi]);
    if (!oldFp.title) continue;
    for (let ni = 0; ni < newPhylogenies.length; ni++) {
      if (usedNew.has(ni)) continue;
      const newFp = getCitationFingerprint(newPhylogenies[ni]);
      if (oldFp.title === newFp.title && oldFp.year === newFp.year) {
        matched.push({ oldIdx: oi, newIdx: ni, method: 'title+year' });
        usedOld.add(oi);
        usedNew.add(ni);
        break;
      }
    }
  }

  // Tier 3: If exactly one primary in both old and new remain unmatched, match them.
  const remainingOldPrimary = [];
  for (let oi = 0; oi < oldPhylogenies.length; oi++) {
    if (usedOld.has(oi)) continue;
    if (getCitationFingerprint(oldPhylogenies[oi]).isPrimary) {
      remainingOldPrimary.push(oi);
    }
  }
  const remainingNewPrimary = [];
  for (let ni = 0; ni < newPhylogenies.length; ni++) {
    if (usedNew.has(ni)) continue;
    if (getCitationFingerprint(newPhylogenies[ni]).isPrimary) {
      remainingNewPrimary.push(ni);
    }
  }
  if (remainingOldPrimary.length === 1 && remainingNewPrimary.length === 1) {
    matched.push({
      oldIdx: remainingOldPrimary[0],
      newIdx: remainingNewPrimary[0],
      method: 'position-fallback',
    });
    usedOld.add(remainingOldPrimary[0]);
    usedNew.add(remainingNewPrimary[0]);
  }

  const unmatchedOld = [];
  for (let i = 0; i < oldPhylogenies.length; i++) {
    if (!usedOld.has(i)) unmatchedOld.push(i);
  }
  const unmatchedNew = [];
  for (let i = 0; i < newPhylogenies.length; i++) {
    if (!usedNew.has(i)) unmatchedNew.push(i);
  }

  return { matched, unmatchedOld, unmatchedNew };
}

/**
 * Merge an old PHYX file with a freshly generated one.
 * Uses new file for @context and phylorefs; merges phylogenies to preserve newicks.
 */
function mergePhyxFile(oldPhyx, newPhyx) {
  const oldPhylogenies = oldPhyx.phylogenies || [];
  const newPhylogenies = newPhyx.phylogenies || [];

  const { matched, unmatchedOld, unmatchedNew } = matchPhylogenies(
    oldPhylogenies,
    newPhylogenies,
  );

  // Build merged phylogenies array.
  // Start with matched pairs: use new phylogeny data + copy newick from old.
  const mergedPhylogenies = [];
  const matchMethods = [];
  let newicksPreserved = 0;
  let manualPhylogeniesPreserved = 0;
  const issues = [];

  for (const m of matched) {
    const merged = { ...newPhylogenies[m.newIdx] };
    if (oldPhylogenies[m.oldIdx].newick) {
      merged.newick = oldPhylogenies[m.oldIdx].newick;
      newicksPreserved++;
    }
    mergedPhylogenies.push(merged);
    matchMethods.push(m.method);
    if (m.method === 'position-fallback') {
      issues.push('Used position-fallback matching for primary phylogeny');
    }
  }

  // Add unmatched new phylogenies (new citations from dump).
  for (const ni of unmatchedNew) {
    mergedPhylogenies.push(newPhylogenies[ni]);
  }

  // Append unmatched old phylogenies (manually added, preserve entirely).
  for (const oi of unmatchedOld) {
    const oldPhylogeny = oldPhylogenies[oi];
    if (oldPhylogeny.newick) {
      // This old phylogeny has a newick but no match in new — preserve it.
      manualPhylogeniesPreserved++;
      newicksPreserved++;
      issues.push(`Preserved unmatched old phylogeny with newick at index ${oi}`);
    }
    mergedPhylogenies.push(oldPhylogeny);
  }

  const mergedPhyx = {
    '@context': newPhyx['@context'],
    phylogenies: mergedPhylogenies,
    phylorefs: newPhyx.phylorefs,
  };

  // Determine label change.
  const oldLabel = (oldPhyx.phylorefs || [])[0]?.label || '';
  const newLabel = (newPhyx.phylorefs || [])[0]?.label || '';

  return {
    mergedPhyx,
    stats: {
      oldPhylogenies: oldPhylogenies.length,
      newPhylogenies: newPhylogenies.length,
      mergedPhylogenies: mergedPhylogenies.length,
      newicksPreserved,
      manualPhylogeniesPreserved,
      matchMethods: [...new Set(matchMethods)],
      labelOld: oldLabel,
      labelNew: newLabel,
      labelChanged: oldLabel !== newLabel,
      issues,
    },
  };
}

/**
 * Scan a directory for CLADO PHYX files and return a Map of
 * regnumId → Entry[]. Each Entry is { filename, relativePath, data }.
 *
 * Picks up CLADO_NNNNNNN.json at the top level and CLADO_NNNNNNN.json or
 * CLADO_NNNNNNN.json.txt one level deep in subdirectories. The .json.txt
 * extension is a curation convention used to mark phyloreferences whose
 * newicks the test suite skips (e.g. parser-crashing inputs in
 * newick-recursion-error/); its content is still valid PHYX JSON.
 *
 * The same regnum ID may appear at multiple paths (e.g. a working copy at
 * the root and an archival copy in a subdir with a different newick); each
 * such file is recorded as a separate entry so the merge can update both
 * files independently and keep diffs clean.
 */
function scanDirectory(dir) {
  const map = new Map();
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  function record(regnumId, filename, relativePath, fullPath) {
    const data = loadJSON(fullPath);
    const list = map.get(regnumId) || [];
    list.push({ filename, relativePath, data });
    map.set(regnumId, list);
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      const m = entry.name.match(/^CLADO_(\d+)\.json$/);
      if (!m) continue;
      const regnumId = Number.parseInt(m[1], 10);
      record(regnumId, entry.name, entry.name, path.join(dir, entry.name));
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdir = path.join(dir, entry.name);
    for (const sub of fs.readdirSync(subdir)) {
      const m = sub.match(/^CLADO_(\d+)\.json(?:\.txt)?$/);
      if (!m) continue;
      const regnumId = Number.parseInt(m[1], 10);
      record(regnumId, sub, path.join(entry.name, sub), path.join(subdir, sub));
    }
  }

  return map;
}

/**
 * Copy through any non-CLADO file in the old directory tree (e.g. helper
 * scripts in subdirs) to the output directory, preserving relative layout.
 * This keeps the merge "directory-replacement-safe": anything the merge
 * doesn't touch is carried over verbatim, so accepting the merge doesn't
 * silently drop unrelated curation artifacts.
 */
function copyThroughNonClado(oldDir, outputDir) {
  for (const entry of fs.readdirSync(oldDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      // Skip top-level CLADO files; merge handles them.
      if (/^CLADO_\d+\.json$/.test(entry.name)) continue;
      fs.copyFileSync(path.join(oldDir, entry.name), path.join(outputDir, entry.name));
    } else if (entry.isDirectory()) {
      const srcSub = path.join(oldDir, entry.name);
      const dstSub = path.join(outputDir, entry.name);
      if (!fs.existsSync(dstSub)) fs.mkdirSync(dstSub, { recursive: true });
      for (const sub of fs.readdirSync(srcSub)) {
        // Skip CLADO PHYX files in subdirs; merge handles them.
        if (/^CLADO_\d+\.json(?:\.txt)?$/.test(sub)) continue;
        fs.copyFileSync(path.join(srcSub, sub), path.join(dstSub, sub));
      }
    }
  }
}

// ── CLI + main ──

const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <regnum-dump.json> -o <output-dir> --old-dir <phyx/phylonym/>')
  .demandCommand(1, 1)
  .option('output-dir', {
    alias: 'o',
    describe: 'Directory to write merged files to (must not exist)',
    demandOption: true,
  })
  .option('old-dir', {
    describe: 'Directory containing existing curated PHYX files',
    demandOption: true,
  })
  .option('report', {
    describe: 'Path to write a CSV merge report',
    string: true,
  })
  .option('digits', {
    describe: 'Number of digits for CLADO filename padding',
    type: 'number',
    default: 7,
  })
  .option('dry-run', {
    describe: 'Only produce report, do not write output files',
    type: 'boolean',
    default: false,
  })
  .help('h')
  .alias('h', 'help')
  .argv;

const dumpPath = path.resolve(argv._[0]);
const outputDir = path.resolve(argv.outputDir);
const oldDir = path.resolve(argv.oldDir);
const { digits } = argv;

// Validate inputs.
if (!fs.existsSync(dumpPath)) {
  process.stderr.write(`Error: dump file not found: ${dumpPath}\n`);
  process.exit(1);
}
if (!fs.existsSync(oldDir)) {
  process.stderr.write(`Error: old directory not found: ${oldDir}\n`);
  process.exit(1);
}
if (!argv.dryRun && fs.existsSync(outputDir)) {
  process.stderr.write(`Error: output directory already exists: ${outputDir}\n`);
  process.exit(1);
}

// Phase 1: Generate fresh PHYX files in a temp directory.
// mkdtempSync creates the directory, but regnum2phyx.js expects the output dir
// to not exist, so we use a subdirectory inside the temp dir.
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-phylonym-'));
const tmpDir = path.join(tmpBase, 'phyx');
const regnum2phyxPath = path.join(__dirname, 'regnum2phyx.js');

process.stderr.write("Phase 1: Generating fresh PHYX files from dump...\n");
try {
  execSync(
    `node ${JSON.stringify(regnum2phyxPath)} ${JSON.stringify(dumpPath)} -o ${JSON.stringify(tmpDir)} --filenames regnum-id --digits ${digits}`,
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
} catch (err) {
  // regnum2phyx.js exits 1 on warnings (e.g. apomorphy specifiers), which is expected.
  // Only fail if the temp dir is empty (no files produced at all).
  const produced = fs.readdirSync(tmpDir).filter(f => /^CLADO_\d+\.json$/.test(f));
  if (produced.length === 0) {
    process.stderr.write("Error: regnum2phyx.js produced no files.\n");
    process.exit(1);
  }
}

// Phase 2: Load and classify.
process.stderr.write("Phase 2: Loading and classifying files...\n");
const oldFiles = scanDirectory(oldDir);
const newFiles = scanDirectory(tmpDir);

const allIds = new Set([...oldFiles.keys(), ...newFiles.keys()]);
const sortedIds = [...allIds].sort((a, b) => a - b);

function countEntries(filesMap) {
  let total = 0;
  for (const arr of filesMap.values()) total += arr.length;
  return total;
}
process.stderr.write(
  `  Old: ${countEntries(oldFiles)} files (${oldFiles.size} unique IDs), `
  + `New: ${countEntries(newFiles)} files (${newFiles.size} unique IDs), `
  + `Union of IDs: ${sortedIds.length}\n`,
);

// Phase 3: Merge.
process.stderr.write("Phase 3: Merging...\n");
if (!argv.dryRun) {
  fs.mkdirSync(outputDir);
}

const reportRows = [];
let countNew = 0;
let countMerged = 0;
let countOrphan = 0;
let totalNewicksPreserved = 0;

function writeOutputFile(relativePath, data) {
  const outPath = path.join(outputDir, relativePath);
  const outSubdir = path.dirname(outPath);
  if (!fs.existsSync(outSubdir)) fs.mkdirSync(outSubdir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 4));
}

for (const regnumId of sortedIds) {
  const oldEntries = oldFiles.get(regnumId) || [];
  const newEntries = newFiles.get(regnumId) || [];
  const newData = newEntries.length > 0 ? newEntries[0].data : null;
  const defaultFilename = `CLADO_${String(regnumId).padStart(digits, '0')}.json`;
  const duplicateNote = oldEntries.length > 1
    ? `Regnum ID present at ${oldEntries.length} paths in old dir: `
      + `${oldEntries.map(e => e.relativePath).join(', ')}`
    : null;

  if (newData && oldEntries.length === 0) {
    // NEW_ONLY: copy fresh file as-is to the root.
    countNew++;
    if (!argv.dryRun) {
      writeOutputFile(defaultFilename, newData);
    }
    const newLabel = (newData.phylorefs || [])[0]?.label || '';
    reportRows.push({
      regnumId,
      filename: defaultFilename,
      action: 'new',
      labelOld: '',
      labelNew: newLabel,
      labelChanged: false,
      oldPhylogenies: 0,
      newPhylogenies: (newData.phylogenies || []).length,
      mergedPhylogenies: (newData.phylogenies || []).length,
      newicksPreserved: 0,
      manualPhylogeniesPreserved: 0,
      matchMethods: '',
      issues: '',
    });
    continue;
  }

  // For each old entry (one or more — duplicates kept and merged independently),
  // emit either an orphan (no new data) or a merged file at the entry's path.
  for (const oldEntry of oldEntries) {
    if (!newData) {
      // OLD_ONLY: copy old file unchanged at its old location.
      countOrphan++;
      if (!argv.dryRun) {
        writeOutputFile(oldEntry.relativePath, oldEntry.data);
      }
      const oldLabel = (oldEntry.data.phylorefs || [])[0]?.label || '';
      const issues = ['Old file not found in new dump'];
      if (duplicateNote) issues.push(duplicateNote);
      reportRows.push({
        regnumId,
        filename: oldEntry.relativePath,
        action: 'orphan',
        labelOld: oldLabel,
        labelNew: '',
        labelChanged: false,
        oldPhylogenies: (oldEntry.data.phylogenies || []).length,
        newPhylogenies: 0,
        mergedPhylogenies: (oldEntry.data.phylogenies || []).length,
        newicksPreserved: 0,
        manualPhylogeniesPreserved: 0,
        matchMethods: '',
        issues: issues.join('; '),
      });
      continue;
    }

    // BOTH: merge. Output goes to the old entry's location, so subdir/.json.txt
    // archival copies stay in their subdir; root .json files stay at root.
    countMerged++;
    const { mergedPhyx, stats } = mergePhyxFile(oldEntry.data, newData);

    if (!argv.dryRun) {
      writeOutputFile(oldEntry.relativePath, mergedPhyx);
    }

    totalNewicksPreserved += stats.newicksPreserved;

    const issues = [...stats.issues];
    if (duplicateNote) issues.push(duplicateNote);

    reportRows.push({
      regnumId,
      filename: oldEntry.relativePath,
      action: 'merged',
      labelOld: stats.labelOld,
      labelNew: stats.labelNew,
      labelChanged: stats.labelChanged,
      oldPhylogenies: stats.oldPhylogenies,
      newPhylogenies: stats.newPhylogenies,
      mergedPhylogenies: stats.mergedPhylogenies,
      newicksPreserved: stats.newicksPreserved,
      manualPhylogeniesPreserved: stats.manualPhylogeniesPreserved,
      matchMethods: stats.matchMethods.join(';'),
      issues: issues.join('; '),
    });
  }
}

// Carry through helper scripts, READMEs, and other non-CLADO artifacts that
// live alongside the PHYX files in the old directory.
if (!argv.dryRun) {
  copyThroughNonClado(oldDir, outputDir);
}

// Clean up temp directory.
try {
  fs.rmSync(tmpBase, { recursive: true });
} catch (_) {
  // Ignore cleanup errors.
}

// Phase 4: Report.
if (argv.report) {
  const header = [
    'regnum_id', 'clado_filename', 'action',
    'label_old', 'label_new', 'label_changed',
    'old_phylogenies', 'new_phylogenies', 'merged_phylogenies',
    'newicks_preserved', 'manual_phylogenies_preserved', 'match_methods', 'issues',
  ];
  const csvRows = reportRows.map(r => [
    r.regnumId, r.filename, r.action,
    r.labelOld, r.labelNew, r.labelChanged,
    r.oldPhylogenies, r.newPhylogenies, r.mergedPhylogenies,
    r.newicksPreserved,
    r.manualPhylogeniesPreserved, r.matchMethods, r.issues,
  ].map(escapeCSV).join(','));
  fs.writeFileSync(argv.report, `${[header.join(','), ...csvRows].join('\n')}\n`);
  process.stderr.write(`Report written to: ${argv.report}\n`);
}

// Print summary.
process.stderr.write("\n=== Merge Summary ===\n");
process.stderr.write(`  Merged: ${countMerged}\n`);
process.stderr.write(`  New:    ${countNew}\n`);
process.stderr.write(`  Orphan: ${countOrphan}\n`);
process.stderr.write(`  Total:  ${sortedIds.length}\n`);
process.stderr.write(`  Newicks preserved: ${totalNewicksPreserved}\n`);
if (countOrphan > 0) {
  process.stderr.write(`  WARNING: ${countOrphan} old file(s) not found in new dump.\n`);
}
if (argv.dryRun) {
  process.stderr.write("  (dry-run mode \u2014 no files were written)\n");
}
