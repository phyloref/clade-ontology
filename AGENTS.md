# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Clade Ontology is an ontology of exemplar phyloreferences curated from peer-reviewed publications. It stores phyloreferences (computable clade definitions) as PHYX files that are converted to OWL/JSON-LD for reasoning with an OWL reasoner (JPhyloRef + JFact++).

## Commands

```bash
npm test           # Lint + run all Mocha tests (requires Node.js)
npm run lint       # Biome lint on test/, phyx2ontology/, and regnum2phyx/
npm run mocha      # Run tests without linting
npm run build-ontology  # Convert all phyx/ files into CLADO.json
```

**Run a single test file:**
```bash
npx mocha test/test_phyx.js
npx mocha test/regnum2phyx/exec.js
```

**Enable slow tests (requires Java + JPhyloRef):**
```bash
RUN_SLOW_TESTS=1 npm test
# Optional env vars: JVM_ARGS, JPHYLOREF_ARGS, MAX_INTERNAL_SPECIFIERS, MAX_EXTERNAL_SPECIFIERS
```

**Download test dependencies (JPhyloRef JAR and Phyx JSON schema):**
```bash
cd test && bash download.sh
```

**Build the Clade Ontology:**
```bash
node phyx2ontology/phyx2ontology.js phyx/ > CLADO.json
node phyx2ontology/phyx2ontology.js phyx/ --no-phylogenies > CLADO.json
```

**Convert a PhyloRegnum database dump to Phyx files:**
```bash
node regnum2phyx/regnum2phyx.js dump.json -o output_dir/
node regnum2phyx/regnum2phyx.js dump.json -o output_dir/ --filenames regnum-id
```

**Update phyx/phylonym/ from a new Regnum dump:**
```bash
# Stage merged output for review (default — safe):
npm run update-phylonym -- data/dump.json --report data/merge_report.csv

# Accept the staged merge (replaces phyx/phylonym/):
npm run update-phylonym -- data/dump.json --accept
```

## Architecture

### Data Pipeline

```
PhyloRegnum DB dump (JSON)
    → regnum2phyx.js → PHYX files (.json in phyx/)
    → phyx2ontology.js → CLADO.json (OWL/JSON-LD)
    → JPhyloRef (Java) → reasoning/test results
```

### Key Directories

- **`phyx/`** — Curated PHYX files organized by source:
  - `from_papers/` — Phyloreferences from peer-reviewed papers (e.g., `Brochu 2003/`)
  - `phylonym/` — Files from the Phylonym database. Has subdirs `newick-problems/` and `newick-recursion-error/` containing archival copies as `CLADO_*.json.txt` (renamed extension keeps them out of the standard `*.json` glob so the test suite skips their newicks); a regnum ID may appear at both root and subdir paths. `scripts/` holds ad-hoc helpers.
  - `encrypted/` — Git-crypt encrypted files (skipped during processing)
- **`phyx2ontology/phyx2ontology.js`** — Converts PHYX files to a single Clade Ontology JSON-LD. Reads PHYX files, wraps them via `@phyloref/phyx`, and emits JSON-LD to STDOUT.
- **`regnum2phyx/regnum2phyx.js`** — Converts PhyloRegnum database dumps (JSON arrays) into individual PHYX files. Handles specifiers, citations (BibJSON format), and author formatting.
- **`regnum2phyx/merge-phylonym.js`** + **`update-phylonym.js`** — Merge a new Regnum dump with the existing curated `phyx/phylonym/` tree, preserving newicks. Walks subdirs of the old directory; emits each old file (root or subdir) to its same relative path. See `regnum2phyx/README.md` for the full workflow.
- **`test/`** — Mocha test suite:
  - `test_phyx.js` — Validates all PHYX files in `phyx/` (JSON schema + JSON-LD conversion). Skips git-crypt encrypted files.
  - `test_phyx2ontology.js` — Smoke-tests `phyx2ontology.js` execution on all Phyx files.
  - `regnum2phyx/exec.js` — Tests `regnum2phyx.js` against example dumps in `test/regnum2phyx/examples/` and compares output against `test/regnum2phyx/expected/`.

### PHYX Format

PHYX files are JSON with:
- `@context`: points to `http://www.phyloref.org/phyx.js/context/v0.2.0/phyx.json`
- `phylorefs`: array of phyloreference objects with `internalSpecifiers`, `externalSpecifiers`, `cladeDefinition`, etc.
- `phylogenies`: array of phylogeny objects with Newick strings

### Key Library

`@phyloref/phyx` (npm) provides `PhylorefWrapper`, `PhylogenyWrapper`, and `PhyxWrapper` classes that convert PHYX objects to JSON-LD/OWL class restrictions.

### Linting

Biome (`@biomejs/biome`) is the linter; configuration is in `biome.json`. ES6 syntax.

### Git-Crypt

Some PHYX files in `phyx/encrypted/` are git-crypt encrypted. Both `phyx2ontology.js` and `test_phyx.js` detect these by checking for the `\x00GITCRYPT` magic bytes and skip them gracefully.
