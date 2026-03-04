# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Clade Ontology is an ontology of exemplar phyloreferences curated from peer-reviewed publications. It stores phyloreferences (computable clade definitions) as PHYX files that are converted to OWL/JSON-LD for reasoning with an OWL reasoner (JPhyloRef + JFact++).

## Commands

```bash
npm test           # Lint + run all Mocha tests (requires Node.js)
npm run lint       # ESLint on test/, phyx2ontology/, and regnum2phyx/
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
  - `phylonym/` — Files from the PhyloNym database
  - `encrypted/` — Git-crypt encrypted files (skipped during processing)
- **`phyx2ontology/phyx2ontology.js`** — Converts PHYX files to a single Clade Ontology JSON-LD. Reads PHYX files, wraps them via `@phyloref/phyx`, and emits JSON-LD to STDOUT.
- **`regnum2phyx/regnum2phyx.js`** — Converts PhyloRegnum database dumps (JSON arrays) into individual PHYX files. Handles specifiers, citations (BibJSON format), and author formatting.
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

ESLint uses `airbnb-base` + `mocha` plugin. Trailing commas required on multiline arrays/objects (not functions). ES6 syntax.

### Git-Crypt

Some PHYX files in `phyx/encrypted/` are git-crypt encrypted. Both `phyx2ontology.js` and `test_phyx.js` detect these by checking for the `\x00GITCRYPT` magic bytes and skip them gracefully.
