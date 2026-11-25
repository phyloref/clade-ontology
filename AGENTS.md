# AGENTS.md

Guidance for AI coding agents working in this repository. This file holds what applies everywhere; rules for one part of the repository live in an `AGENTS.md` in that directory (`phyx/`, `test/`), which Claude Code loads once it reads a file there. Keep it that way: add a rule here only if it bites before an agent has opened any file in the directory it concerns. There is deliberately no `CLAUDE.md`: Claude Code reads `AGENTS.md` itself, but by default only when no `CLAUDE.md` exists at or above the working directory, so adding one (even a symlink) hides every nested `AGENTS.md`.

## Overview

The Clade Ontology is an ontology of exemplar phyloreferences curated from PhyloRegnum (https://www.phyloregnum.org/) and peer-reviewed publications. It stores phyloreferences (computable clade definitions) as Phyx files (JSON-LD; see https://www.phyloref.org/phyx.js/ and https://doi.org/10.7717/peerj.12618), which `@phyloref/phyx` converts to OWL for reasoning. We use JPhyloRef (https://github.com/phyloref/jphyloref) to wrap [Elk](https://liveontologies.github.io/elk-reasoner/).

## Commands

```bash
npm test                 # Lint + run all Mocha tests
npm run lint             # Biome lint
npm run mocha            # Tests without linting (recursive, so it includes test/regnum2phyx/)
npm run build-ontology   # Convert all phyx/ files into CLADO.json; see the specifier-limit gotcha
npx mocha test/test_phyx.js           # A single test file
npx mocha test/regnum2phyx/exec.js    # The regnum2phyx end-to-end test
RUN_SLOW_TESTS=1 npm test             # Also check resolution with JPhyloRef (Java); see test/AGENTS.md
cd test && bash download.sh           # Fetch the JPhyloRef JAR and Phyx JSON schema
node phyx2ontology/phyx2ontology.js phyx/ [--no-phylogenies] > CLADO.json
node regnum2phyx/regnum2phyx.js dump.json -o output_dir/ [--filenames regnum-id]
```

## Data pipeline

```
PhyloRegnum DB dump (JSON, in the git-ignored data/)
    → regnum2phyx/regnum2phyx.js → Phyx files (phyx/)
    → phyx2ontology/phyx2ontology.js → CLADO.json (OWL/JSON-LD)
    → JPhyloRef (Java) → reasoning/test results
```

`phyx/` holds the curated Phyx files: `from_papers/` (from peer-reviewed papers), `phylonym/` (from PhyloRegnum) and `encrypted/` (git-crypt).

## Gotchas

- **Every `*.json` under `phyx/` is treated as a Phyx file.** `test_phyx.js` and `phyx2ontology.js` walk the tree and feed each one to phyx.js, so don't put other JSON there. Archived or broken copies use a `.json.txt` extension to stay out of the walk.
- **Run `npm ci` before trusting the lint.** `npm run lint` uses `biome` from `node_modules/.bin`. `npx biome` instead downloads an unrelated npm package (a template engine), lints nothing and exits 0: a silent, instant pass means the wrong binary, not clean code.
- **In standalone scripts, import phyx.js wrappers directly**, e.g. `require('@phyloref/phyx/src/wrappers/TaxonConceptWrapper')`, as `regnum2phyx.js` does. The package index pulls in `PhyxWrapper → jsonld`, which breaks under newer Node. Mocha tests can use the index.
- **Specifier limits quietly drop phyloreferences, even when unset.** `MAX_INTERNAL_SPECIFIERS` and `MAX_EXTERNAL_SPECIFIERS` (defaults 7 and 10) apply to the build as well as the tests: `phyx2ontology.js` leaves any phyloreference over either limit out of `CLADO.json` with only a warning on stderr, and `test_phyx.js` skips the conversion tests (fast and slow) for every file containing one. Raise them to include larger phyloreferences, and check that a value left in the shell from a test run hasn't lowered them before `npm run build-ontology`.
- **Nothing checks resolution by default, and the slow tests currently can't.** Only `RUN_SLOW_TESTS` asks JPhyloRef whether a phyloreference resolves to its expected node, and at present no phyloreference resolves to any node (#132). A slow-test failure says nothing about the file under test; see `test/AGENTS.md`.
- **Git-crypt:** files in `phyx/encrypted/` are encrypted; `phyx2ontology.js` and `test_phyx.js` skip them by their `\x00GITCRYPT` magic bytes. In an unlocked repository, `git cat-file --textconv <rev>:<path>` decrypts a blob from any revision without a checkout. A linked worktree cannot decrypt (git-crypt looks for its keys under `.git/worktrees/<name>/`), so work in the main checkout.
