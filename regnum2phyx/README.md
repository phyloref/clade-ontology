# regnum2phyx

Tools for converting [PhyloRegnum](http://app.phyloregnum.org) database dumps
into PHYX files for the Clade Ontology.

## Background

The Clade Ontology stores phyloreferences as **PHYX files** (JSON files with
phyloreference definitions, specifiers, and phylogeny citations). The
`phyx/phylonym/` directory contains curated PHYX files that were originally
generated from a PhyloRegnum database dump, then manually enhanced in the
[Klados](https://github.com/phyloref/klados) editor. The main manual additions
are **newick phylogeny strings** attached to phylogeny citation entries (160 of
270 files have them, all on `primaryPhylogenyCitation` entries).

PhyloRegnum periodically produces updated database dumps (JSON arrays of
phyloreference entries with specifiers, citations, and definitions). When a new
dump arrives, PHYX files must be regenerated to pick up changes, but manual
curation work -- especially newick strings -- must be preserved. This will happen
3-5 more times before publication.

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

**Phase 2 -- Load and classify.** Scans both the old directory and the temp
directory for `CLADO_*.json` files. Extracts the Regnum ID from each filename
and classifies every ID as:
- **NEW_ONLY** -- present in the dump but not in the old directory.
- **OLD_ONLY** (orphan) -- present in the old directory but not in the dump
  (should not normally occur).
- **BOTH** -- present in both; needs merging.

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
data) and the merged `phylogenies` array.

**Phase 4 -- Report.** Writes a CSV report and prints a summary to stderr.

### CSV report columns

| Column | Description |
|--------|-------------|
| `regnum_id` | Regnum database ID |
| `clado_filename` | e.g. `CLADO_0000002.json` |
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

## Workflow for merging a new Regnum dump

This is the recommended workflow for incorporating a new Regnum dump into the
curated Phylonym PHYX files. It is designed to be repeatable for future dumps.

### Step 1: Run the merge

```bash
node regnum2phyx/merge-phylonym.js \
  data/regnum_submissions_2026mar4.json \
  --old-dir phyx/phylonym/ \
  -o phyx/phylonym-merged/ \
  --report data/merge_report.csv
```

### Step 2: Review the output

Check the merge summary printed to stderr. Key things to verify:
- `Newicks lost` should be **0**.
- `Orphan` count should be **0** (unless entries were removed from the dump).
- Look at the CSV report for any `issues` column entries or `label_changed=true`.

```bash
# Quick structural comparison
diff -rq phyx/phylonym/ phyx/phylonym-merged/ | head -20

# Spot-check a specific merged file
diff phyx/phylonym/CLADO_0000045.json phyx/phylonym-merged/CLADO_0000045.json
```

### Step 3: Verify newick preservation

```bash
node -e "
const fs = require('fs');
const old = 'phyx/phylonym', merged = 'phyx/phylonym-merged';
let preserved = 0, lost = 0;
for (const f of fs.readdirSync(old).filter(f => f.match(/CLADO_\d+\.json$/))) {
  const o = JSON.parse(fs.readFileSync(old + '/' + f, 'utf8'));
  if (!fs.existsSync(merged + '/' + f)) continue;
  const m = JSON.parse(fs.readFileSync(merged + '/' + f, 'utf8'));
  for (const p of o.phylogenies || []) {
    if (!p.newick) continue;
    if ((m.phylogenies || []).some(mp => mp.newick === p.newick)) preserved++;
    else { lost++; console.log('LOST newick in', f); }
  }
}
console.log('Preserved:', preserved, 'Lost:', lost);
"
```

### Step 4: Replace and validate

```bash
mv phyx/phylonym phyx/phylonym-backup
mv phyx/phylonym-merged phyx/phylonym
npm test
```

### Step 5: Commit

```bash
git add phyx/phylonym/
git commit -m "Update phylonym PHYX files from YYYY-MM-DD Regnum dump"
```

### For future dumps

Repeat from Step 1, using the current `phyx/phylonym/` as `--old-dir`. The
merged files become the new "old" for the next iteration. The merge script is
idempotent with respect to newick preservation -- running it repeatedly with the
same dump and old directory produces the same output.

## Current status (2026-03-04 dump)

Running `merge-phylonym.js` against `data/regnum_submissions_2026mar4.json`
with the 270 existing curated files produces:

| Metric | Value |
|--------|-------|
| Merged files (old + new) | 270 |
| New files (dump only) | 839 |
| Orphaned files | 0 |
| Total output files | 1,109 |
| Newicks preserved | 160 / 160 |
| Newicks lost | 0 |
| Entries skipped (duplicate labels) | 18 |

The 18 skipped entries are duplicates in the dump (e.g. multiple Regnum entries
with the label "Lognkosauria") that `regnum2phyx.js` skips. This means 1,127
dump entries produce 1,109 unique files.

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
