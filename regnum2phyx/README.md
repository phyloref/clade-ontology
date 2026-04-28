# regnum2phyx

Tools for converting [PhyloRegnum](http://app.phyloregnum.org) database dumps
into PHYX files for the Clade Ontology.

## Background

The Clade Ontology stores phyloreferences as **PHYX files** (JSON files with
phyloreference definitions, specifiers, and phylogeny citations). The
`phyx/phylonym/` directory contains curated PHYX files that were originally
generated from a PhyloRegnum database dump, then manually enhanced in the
[Klados](https://github.com/phyloref/klados) editor. The main manual additions
are **newick phylogeny strings** attached to phylogeny citation entries.

PhyloRegnum periodically produces updated database dumps (JSON arrays of
phyloreference entries with specifiers, citations, and definitions). When a new
dump arrives, PHYX files must be regenerated to pick up changes, but manual
curation work -- especially newick strings -- must be preserved. This will happen
3-5 more times before publication.

### Directory layout in `phyx/phylonym/`

The merge treats this whole tree as the curated input:

- `phyx/phylonym/CLADO_NNNNNNN.json` -- the working PHYX file for each
  phyloreference. Test-runnable.
- `phyx/phylonym/newick-problems/CLADO_NNNNNNN.json.txt` -- archival copies
  whose newicks the test suite skips (the `.json.txt` extension keeps them
  out of the standard `*.json` glob).
- `phyx/phylonym/newick-recursion-error/CLADO_NNNNNNN.json.txt` -- copies
  whose newicks crash the parser; also test-skipped.
- `phyx/phylonym/scripts/` -- ad-hoc helper scripts (`phyx2owl.js`,
  `phyxfix.js`).

A regnum ID may appear in **both** the root and a subdir (the root copy is
the working version with a cleaned newick; the subdir copy is the archival
version with the original problematic newick). The merge updates each file
independently in place: phyloref metadata is refreshed from the new dump,
each file's own newick is preserved, and the duplicate is flagged in the
CSV report.

Two scripts address this workflow:

1. **`regnum2phyx.js`** -- Converts a raw Regnum dump into fresh PHYX files (no
   awareness of existing files).
2. **`merge-phylonym.js`** -- Orchestrates a full merge: generates fresh files
   via `regnum2phyx.js`, then merges manual additions from existing curated
   files into the fresh output.

## regnum2phyx.js

Converts a PhyloRegnum database dump (a JSON array) into individual PHYX files,
one per phyloreference entry.

### Usage

```bash
node regnum2phyx/regnum2phyx.js <dump.json> -o <output-dir> [options]
```

The output directory **must not already exist** (the script creates it).

### Options

| Option | Description |
|--------|-------------|
| `-o`, `--output-dir` | Directory to write PHYX files to (required) |
| `--filenames` | Filename strategy: `label` (default), `number`, or `regnum-id` |
| `--digits` | Zero-padding width for CLADO filenames (default: 7) |
| `--filename-prefix` | Prefix for generated filenames (used with `number` mode) |
| `--report` | Path to write a CSV report of all processed entries |

### Examples

```bash
# Generate files named by phyloref label (default)
node regnum2phyx/regnum2phyx.js data/dump.json -o output/

# Generate files named by Regnum ID (e.g. CLADO_0000042.json)
node regnum2phyx/regnum2phyx.js data/dump.json -o output/ --filenames regnum-id

# Generate with a CSV report
node regnum2phyx/regnum2phyx.js data/dump.json -o output/ --filenames regnum-id --report report.csv
```

### What it does

For each entry in the dump, the script:

1. Builds a phyloreference object using `@phyloref/phyx` wrapper classes
   (`PhylorefWrapper`, `TaxonConceptWrapper`, `TaxonNameWrapper`).
2. Converts citations from the Regnum format to BibJSON using `CitationWrapper`.
3. Converts specifiers (internal/external) into taxon concept objects with
   nomenclatural codes (ICZN, ICN via NOMEN ontology IRIs).
4. Writes a PHYX file with `@context`, `phylorefs`, and `phylogenies` arrays.

### Known limitations

- **Apomorphy and crown specifiers** are logged as warnings and not included in
  the output (the PHYX format does not yet support them).
- **Duplicate phyloreference labels** cause the second entry to be skipped
  (logged as a warning). When using `--filenames regnum-id`, the files are named
  by Regnum ID so duplicates don't collide on disk, but regnum2phyx.js still
  skips them to avoid ambiguity.
- The script exits with code 1 if any warnings or skips occurred, even if most
  files were written successfully. This is expected behavior.

### CSV report columns

| Column | Description |
|--------|-------------|
| `regnum_id` | Regnum database ID |
| `label` | Phyloreference label |
| `status` | `success`, `warning`, or `skipped` |
| `output_file` | Path to the generated PHYX file |
| `num_internal_specifiers` | Count of internal specifiers |
| `num_external_specifiers` | Count of external specifiers |
| `internal_specifier_N` | Label of each internal specifier |
| `external_specifier_N` | Label of each external specifier |
| `issues` | Semicolon-separated warning messages |

## merge-phylonym.js

Merges a new Regnum dump with existing curated PHYX files, preserving manual
additions (newick phylogeny strings) while updating everything else from the
dump.

### Usage

```bash
node regnum2phyx/merge-phylonym.js <dump.json> -o <output-dir> --old-dir <curated-dir> [options]
```

The output directory **must not already exist** (unless `--dry-run` is used).

### Options

| Option | Description |
|--------|-------------|
| `-o`, `--output-dir` | Directory to write merged files to (required) |
| `--old-dir` | Directory containing existing curated PHYX files (required) |
| `--report` | Path to write a CSV merge report |
| `--digits` | Zero-padding width for CLADO filenames (default: 7) |
| `--dry-run` | Produce report only, do not write output files |

### Examples

```bash
# Full merge with report
node regnum2phyx/merge-phylonym.js \
  data/regnum_submissions_2026mar4.json \
  --old-dir phyx/phylonym/ \
  -o phyx/phylonym-merged/ \
  --report data/merge_report.csv

# Dry run (report only, no files written)
node regnum2phyx/merge-phylonym.js \
  data/regnum_submissions_2026mar4.json \
  --old-dir phyx/phylonym/ \
  -o phyx/phylonym-merged/ \
  --report data/merge_report.csv \
  --dry-run
```

### How it works

The script runs in four phases:

**Phase 1 -- Generate fresh PHYX files.** Shells out to `regnum2phyx.js` with
`--filenames regnum-id` to produce a complete set of fresh PHYX files in a temp
directory. The exit code 1 from regnum2phyx.js (due to apomorphy/crown specifier
warnings) is expected and handled gracefully.

**Phase 2 -- Load and classify.** Walks the old directory: top-level
`CLADO_*.json` and one-level-deep `CLADO_*.json` / `CLADO_*.json.txt` in
subdirs are all collected. Each old file becomes its own merge target
(carried by its full path relative to the old dir), so duplicate regnum IDs
across root + subdir each produce their own merged output. The temp
directory (the fresh dump output) is scanned at the top level only. Every
regnum ID is classified as:
- **NEW_ONLY** -- present in the dump but not in the old directory. Output
  is written at the root as `CLADO_NNNNNNN.json`.
- **OLD_ONLY** (orphan) -- present in the old directory but not in the dump
  (should not normally occur). Output is written at the same relative path
  as in the old directory.
- **BOTH** -- present in both; needs merging. Each old entry (one or more
  per ID, allowing duplicates) gets its own merged output at its old path.

**Phase 3 -- Merge.** For each BOTH entry, phylogenies are matched between old
and new files using a three-tier cascade:

1. **DOI match** (handles ~80% of newick cases): DOIs are normalized
   (lowercased, `https://doi.org/` prefix stripped) and compared.
2. **Title + year match** (handles remaining ~20%): citation titles are
   normalized (lowercased, whitespace collapsed) and compared as
   `(title, year)` tuples.
3. **Position fallback**: if exactly one `primaryPhylogenyCitation` remains
   unmatched in both old and new, they are matched. A warning is logged.

For each matched pair, the new phylogeny data is used but the newick string from
the old file is copied over. Unmatched new phylogenies are included as-is.
Unmatched old phylogenies (which may contain manually added newicks) are appended
at the end to ensure zero newick loss.

The merged file uses `@context` and `phylorefs` from the new file (latest dump
data) and the merged `phylogenies` array. After merging the PHYX files, any
non-CLADO files in the old directory tree (e.g. `scripts/phyx2owl.js`) are
copied through verbatim to the output, so accepting the merge does not silently
drop unrelated curation artifacts.

**Phase 4 -- Report.** Writes a CSV report (one row per output file, so a
duplicate ID across root + subdir produces two rows with the same `regnum_id`
and an `issues` note recording the other path) and prints a summary to stderr.

### CSV report columns

| Column | Description |
|--------|-------------|
| `regnum_id` | Regnum database ID (may appear on multiple rows when an ID exists at multiple paths in the old dir) |
| `clado_filename` | Path of the output file, relative to the output directory (e.g. `CLADO_0000002.json` or `newick-problems/CLADO_0000041.json.txt`) |
| `action` | `new`, `merged`, or `orphan` |
| `label_old` | Phyloref label from old file |
| `label_new` | Phyloref label from new dump |
| `label_changed` | `true` if label differs between old and new |
| `old_phylogenies` | Count of phylogenies in old file |
| `new_phylogenies` | Count of phylogenies from dump |
| `merged_phylogenies` | Count of phylogenies in output |
| `newicks_preserved` | Newick strings carried over from old |
| `newicks_lost` | Should always be 0 |
| `manual_phylogenies_preserved` | Old phylogenies not in dump, kept as-is |
| `match_methods` | Methods used: `doi`, `title+year`, `position-fallback` |
| `issues` | Warnings (semicolon-separated) |

## update-phylonym.js

Orchestrates the full update of `phyx/phylonym/` in one command: runs the merge,
verifies newick preservation, and optionally does the directory swap.

### Usage

```bash
node regnum2phyx/update-phylonym.js <dump.json> [options]
npm run update-phylonym -- <dump.json> [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--old-dir` | `phyx/phylonym/` | Directory with existing curated PHYX files |
| `--work-dir` | `phyx/phylonym-merged/` | Staging directory for merged output |
| `--report` | — | CSV report path (passed to merge-phylonym.js) |
| `--digits` | `7` | CLADO filename padding (passed to merge-phylonym.js) |
| `--accept` | false | Replace `--old-dir` with `--work-dir` after verification |
| `--no-backup` | — | Skip backup of `--old-dir` when `--accept` is used |
| `--dry-run` | false | Pass `--dry-run` to merge-phylonym.js; no files written |

### Workflow for merging a new Regnum dump

```bash
# Step 1: Stage merged output for review (safe — no changes to phyx/phylonym/).
# Runs merge-phylonym.js, verifies all newicks preserved, then prints review
# instructions. Aborts with exit code 1 if any newicks are lost.
npm run update-phylonym -- data/regnum_submissions_2026mar4.json \
  --report data/merge_report.csv

# Step 2: Review the staged output.
# Key checks: Newicks lost = 0, Orphan count = 0,
# no issues or label_changed=true in the CSV report.
diff -rq phyx/phylonym/ phyx/phylonym-merged/ | head -20
diff phyx/phylonym/CLADO_0000045.json phyx/phylonym-merged/CLADO_0000045.json

# Step 3: Accept the merge (replaces phyx/phylonym/, keeps a backup).
# If work-dir already exists from Step 1, it is reused (no re-merge).
npm run update-phylonym -- data/regnum_submissions_2026mar4.json --accept

# Step 4: Validate and commit.
npm test
git add phyx/phylonym/
git commit -m "Update phylonym PHYX files from YYYY-MM-DD Regnum dump"
```

For future dumps: repeat from Step 1, using the current `phyx/phylonym/` as
`--old-dir` (the default). The merged output becomes the new "old" for the next
iteration.

### Manual workflow (fallback)

If you prefer to run each step individually — or need to understand what the
orchestrator does — here are the equivalent manual commands:

```bash
# Run the merge
node regnum2phyx/merge-phylonym.js \
  data/regnum_submissions_2026mar4.json \
  --old-dir phyx/phylonym/ \
  -o phyx/phylonym-merged/ \
  --report data/merge_report.csv

# Verify newick preservation (walks root + one-level subdirs so
# newick-problems/ and newick-recursion-error/ are also checked).
node -e "
const fs = require('fs'), path = require('path');
const old = 'phyx/phylonym', merged = 'phyx/phylonym-merged';
function findFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && /^CLADO_\d+\.json\$/.test(e.name)) out.push(e.name);
    else if (e.isDirectory()) {
      for (const s of fs.readdirSync(path.join(dir, e.name)))
        if (/^CLADO_\d+\.json(\.txt)?\$/.test(s)) out.push(path.join(e.name, s));
    }
  }
  return out;
}
let preserved = 0, lost = 0;
for (const f of findFiles(old)) {
  const o = JSON.parse(fs.readFileSync(path.join(old, f), 'utf8'));
  const mPath = path.join(merged, f);
  if (!fs.existsSync(mPath)) continue;
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  for (const p of o.phylogenies || []) {
    if (!p.newick) continue;
    if ((m.phylogenies || []).some(mp => mp.newick === p.newick)) preserved++;
    else { lost++; console.log('LOST newick in', f); }
  }
}
console.log('Preserved:', preserved, 'Lost:', lost);
"

# Replace and validate
mv phyx/phylonym phyx/phylonym-backup
mv phyx/phylonym-merged phyx/phylonym
npm test

# Commit
git add phyx/phylonym/
git commit -m "Update phylonym PHYX files from YYYY-MM-DD Regnum dump"
```

## Current status (2026-04-28 dump)

Running `merge-phylonym.js` against `data/regnum_submissions_2026apr28.json`
with the 287 existing curated files (270 root `.json` + 17 subdir `.json.txt`
in `newick-problems/` and `newick-recursion-error/`) produces:

| Metric | Value |
|--------|-------|
| Merged files (old + new) | 287 (3 IDs duplicated across root + subdir) |
| New files (dump only) | 826 |
| Orphaned files | 0 |
| Total output files | 1,113 |
| Newicks preserved | 177 / 177 |
| Newicks lost | 0 |
| Entries skipped (duplicate labels) | 19 |

## Limitations and future improvements

### Unsupported specifier types

`regnum2phyx.js` does not support **apomorphy specifiers** or **crown
specifiers**. These are logged as warnings and the affected phyloreferences are
written without those specifiers. In the 2026-03-04 dump, this affects ~120
entries. Supporting these will require changes to both the PHYX format and the
`@phyloref/phyx` library.

### Duplicate label handling

When the dump contains multiple entries with the same phyloreference label,
`regnum2phyx.js` keeps the first and skips subsequent duplicates. This is
logged but may need manual review -- the skipped entries might have different
Regnum IDs, specifiers, or definitions that should be reconciled.

### Phylogeny matching edge cases

The three-tier matching cascade (DOI, title+year, position fallback) handles all
160 newick-bearing phylogenies in the current dataset. However, future dumps
could introduce edge cases:

- **Citation metadata changes**: if a DOI or title is corrected in the dump, the
  old and new citations won't match by the first two tiers. The position
  fallback handles the single-primary case, but files with multiple primaries
  would need manual intervention.
- **Multiple primaries without DOIs**: the position fallback only fires when
  exactly one primary phylogeny is unmatched in both old and new. If both sides
  have multiple unmatched primaries, those old phylogenies (and their newicks)
  are preserved as appended entries rather than merged in-place.

### Field-level merge granularity

`merge-phylonym.js` currently merges at the **file level**: `@context` and
`phylorefs` come entirely from the new file, and only `phylogenies` are merged.
If future manual curation adds non-newick data to phylorefs (e.g. additional
annotations), this would need to be extended to merge at the field level within
phylorefs as well. Currently no such manual additions exist.

### No automated test coverage for merge-phylonym.js

The merge script does not yet have Mocha tests. Adding test cases in
`test/regnum2phyx/` with small synthetic old/new file pairs would improve
confidence for future changes. The existing `test/regnum2phyx/exec.js` pattern
(comparing against expected output files) could be extended for this.
