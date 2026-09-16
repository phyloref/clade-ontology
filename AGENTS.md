# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, etc.) when working with code in this repository.

## Overview

The Clade Ontology is an ontology of exemplar phyloreferences curated from PhyloRegnum (https://www.phyloregnum.org/) and peer-reviewed publications. It stores phyloreferences (computable clade definitions) in the Phyx format (https://github.com/phyloref/phyx.js/, https://www.phyloref.org/phyx.js/, https://doi.org/10.7717/peerj.12618 -- JSON Schema and JSON-LD contexts available at https://www.phyloref.org/phyx.js/context/) that are converted to n-triples and OWL/JSON-LD for reasoning with an OWL reasoner. We use JPhyloRef (https://github.com/phyloref/jphyloref) to wrap [Elk](https://liveontologies.github.io/elk-reasoner/).

## Commands

```bash
npm test           # Lint + run all Mocha tests (requires Node.js)
npm run lint       # Biome lint on test/, phyx2ontology/, regnum2phyx/, lib/, scripts/
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
    → regnum2phyx.js → Phyx files (.json in phyx/)
    → phyx2ontology.js → CLADO.json (OWL/JSON-LD)
    → JPhyloRef (Java) → reasoning/test results
```

### Key Directories

- **`data/`** — Git-ignored directory for raw PhyloRegnum database dumps (JSON files) used as input to `regnum2phyx.js`. Not committed.
- **`phyx/`** — Curated Phyx files organized by source:
  - `from_papers/` — Phyloreferences from peer-reviewed papers (e.g., `Brochu 2003/`)
  - `phylonym/` — Files from the Phylonym database, PhyloRegnum (https://www.phyloregnum.org/)
  - `encrypted/` — Git-crypt encrypted files (skipped during processing)
- **`phylogenies/`** — Shared, deduplicated reference-phylogeny store. One `PHYLO_NNNN.json` per unique Newick tree; each is a valid Phyx file plus a custom top-level `referenceFor` array mapping the tree to the `CLADO_NNNNNNN`/`regnumId` phyloreferences it validates. See `phylogenies/README.md`. (Round 1: the trees are *copied* here but still also live in `phyx/phylonym/`.)
- **`lib/`** — Shared Node modules. `phylogenies.js` holds the store helpers (`loadStore`, `buildReferenceIndex`, `normalizeNewick`, `findJSONFiles`, `scanSourcePhylogenies`); `csv.js` holds `escapeCSV`, shared by the scripts that emit CSV reports.
- **`scripts/`** — Top-level home for ad-hoc/maintenance scripts. `scripts/phylogenies/extract-phylogenies.js` copies Newick trees out of `phyx/phylonym/` into the store (never modifies `phyx/`).
- **`phyx2ontology/phyx2ontology.js`** — Converts Phyx files to a single Clade Ontology JSON-LD. Reads Phyx files, wraps them via `@phyloref/phyx`, and emits JSON-LD to STDOUT.
- **`regnum2phyx/regnum2phyx.js`** — Converts PhyloRegnum database dumps (JSON arrays) into individual Phyx files. Handles specifiers, citations (BibJSON format), and author formatting.
- **`test/`** — Mocha test suite:
  - `test_phyx.js` — Validates all Phyx files in `phyx/` (JSON schema + JSON-LD conversion). Skips git-crypt encrypted files.
  - `test_phyx2ontology.js` — Smoke-tests `phyx2ontology.js` execution on all Phyx files.
  - `phylogenies/store.js` — Verifies the `phylogenies/` store is a faithful, deduplicated copy of the trees in `phyx/phylonym/`.
  - `regnum2phyx/exec.js` — Tests `regnum2phyx.js` against example dumps in `test/regnum2phyx/examples/` and compares output against `test/regnum2phyx/expected/`.

### Phyx Format

Phyx files are JSON with:
- `@context`: points to `http://www.phyloref.org/phyx.js/context/v1.1.0/phyx.json`
- `phylorefs`: array of phyloreference objects with `internalSpecifiers`, `externalSpecifiers`, `definition`, etc.
- `phylogenies`: array of phylogeny objects with Newick strings

### Key Library

`@phyloref/phyx` (npm) provides `PhylorefWrapper`, `PhylogenyWrapper`, and `PhyxWrapper` classes that convert Phyx objects to JSON-LD/OWL class restrictions.

### Linting

Linting uses [Biome](https://biomejs.dev/). ES6 syntax.

### Git-Crypt

Some Phyx files in `phyx/encrypted/` are git-crypt encrypted. Both `phyx2ontology.js` and `test_phyx.js` detect these by checking for the `\x00GITCRYPT` magic bytes and skip them gracefully.

### Gotchas for agents

- **Anything matching `*.json` under `phyx/` is treated as a Phyx file.** The recursive walkers in `test_phyx.js` and `phyx2ontology.js` glob every `.json` and feed it to phyx.js, so do not put non-Phyx JSON (or new stores) inside `phyx/`. Archival/broken copies under `phyx/phylonym/` use a `.json.txt` extension specifically to dodge this glob; the shared `phylogenies/` store lives *outside* `phyx/` for the same reason.
- **`PhyxWrapper.asJSONLD()` requires a `phylorefs` key**, even an empty `[]`. Its expected-resolution cross-linking iterates `jsonld.phylorefs`, so a Phyx document with only `phylogenies` throws `TypeError: Cannot read properties of undefined (reading 'forEach')`. Store files therefore include `"phylorefs": []`.
- **Import phyx.js wrappers directly in standalone scripts**, e.g. `require('@phyloref/phyx/src/wrappers/PhylorefWrapper')`, not the package index. The index pulls in `PhyxWrapper → jsonld`, which breaks under newer Node. (Mocha tests use the package index fine; the constraint bites CLI scripts — see `regnum2phyx/regnum2phyx.js` and `lib/phylogenies.js`.)
- **Resolution validation (does a phyloref resolve to its expected node?) only runs under `RUN_SLOW_TESTS`** via JPhyloRef; the default `npm test` and the `phyx2ontology.js` build path do not check resolution. `phyx2ontology.js` also wraps phylorefs and phylogenies *independently* (not through `PhyxWrapper`), so it never emits the node↔phyloref expected-resolution restrictions.
- **Read git-crypt files from history with `git cat-file --textconv <rev>:<path>`.** git-crypt installs a textconv diff driver, so this decrypts a blob in an unlocked repo with no checkout at all — which is how the salvage and attribution scripts read the unmerged curation branches. A linked worktree does *not* work: keys live in `.git/git-crypt/keys` but git-crypt looks under `.git/worktrees/<name>/git-crypt` and the smudge filter fails. (`git log -S` also sees through the driver, so the pickaxe works on encrypted paths.)
- **Every file under `phyx/phylonym/` round-trips exactly through `JSON.stringify(obj, null, 4)` with no trailing newline.** Verified across all 270. Re-serializing with anything else — 2-space, or a trailing `\n` — reformats the whole file and buries a one-field change in a whole-file diff. Any script that edits a Phyx file in place should match this.
- **`extract-phylogenies.js` deletes every `phylogenies/PHYLO_*.json` at the start of each run** and rewrites only what it finds in `phyx/`. A store file added by hand therefore disappears on the next run: the store is a pure function of `phyx/phylonym/`, and the way to add a tree is to fill in a `newick` on the phyloref's citation slot in `phyx/` and re-extract. See `phylogenies/README.md`.
- **Curator attribution is not in git authorship.** Every commit here is authored by whoever committed it, so the curators who transcribed the reference phylogenies are named only in commit message prose. `phylogenies/attribution.csv` is the record; see `phylogenies/README.md` before trying to derive it from history.
- **`phylonym/` phylogenies have no explicit phyloref link** (no `expectedResolution` / `expectedPhyloreferenceNamed`); the relationship is structural (same file). Only `from_papers/` files carry explicit links via `additionalNodeProperties.expectedPhyloreferenceNamed` keyed by Newick node label. `curatorComments` likewise appear only in `from_papers/`.
