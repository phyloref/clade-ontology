# Moving the reference phylogenies out of the Phyx files

The phyloreferences in `phyx/phylonym/` come from PhyloRegnum and are meant to be regenerated
from it wholesale by `regnum2phyx.js`. The reference phylogenies in the same files are Newick
trees transcribed by hand from publications. Because both live in one file, regenerating the
phyloreferences overwrites the trees, so we cannot pull updates from PhyloRegnum without losing
curated work ([#113](https://github.com/phyloref/clade-ontology/issues/113)). The same tree is also
pasted into every file that cites it: 175 Newick-bearing phylogenies hold only 127 distinct trees.

This migration moves the trees into a store of their own, [`phylogenies/`](../README.md), in three
rounds. When it is done, a `CLADO_NNNNNNN` file answers only to PhyloRegnum, a `PHYLO_NNNN` file
only to the publication it was transcribed from, and each store file's `referenceFor` list joins
the two. This directory and `scripts/phylogenies/migration/` hold everything that exists only to
get there, and both can be deleted once the last round is done.

## Where the trees live, round by round

| | `phyx/phylonym/CLADO_*.json` | `phylogenies/PHYLO_*.json` | Source of truth for trees |
|---|---|---|---|
| Before | phyloreferences and Newicks | — | the Phyx files |
| Round 1 | unchanged, plus 15 salvaged Newicks | a copy of every distinct tree | the Phyx files; the store is regenerated from them |
| Round 2 | phyloreferences only | the trees | the store; `assemble()` joins the two at build time |
| Round 3 | phyloreferences only | the trees, and more of them | the store |

## Where we are

*As of November 2026. The live checklist is [#113](https://github.com/phyloref/clade-ontology/issues/113);
update this section when a round lands.*

- **Round 1 is in review** in [#115](https://github.com/phyloref/clade-ontology/pull/115). Stacked
  on it: [#128](https://github.com/phyloref/clade-ontology/pull/128), which rescues the 14 trees
  still held only on unmerged curation branches and lets a phyloreference have several trees, and
  [#141](https://github.com/phyloref/clade-ontology/pull/141), a proposal to run the attribution
  tests on made-up curators.
- **Round 2 has not started.** Its shape depends on
  [#123](https://github.com/phyloref/clade-ontology/issues/123), the long-term identity and
  linkage model for the store.
- **Resolution is not being checked at all**:
  [#132](https://github.com/phyloref/clade-ontology/issues/132). Nothing yet confirms that a
  phyloreference resolves to the intended node on its trees, before or after the migration.
- **Fixes to the trees themselves** wait in issues:
  [#138](https://github.com/phyloref/clade-ontology/issues/138) (placeholder branch lengths),
  [#139](https://github.com/phyloref/clade-ontology/issues/139) (`root` labels),
  [#140](https://github.com/phyloref/clade-ontology/issues/140) (numbered tips) and
  [#125](https://github.com/phyloref/clade-ontology/issues/125) (two trees with no recoverable
  curator). They are easier after round 2: until then, editing a tree's Newick gives it a new
  `PHYLO_` id.

## Roadmap

- **Round 1: copy the trees into a standalone store.** Build and populate the store by copying,
  and keep the trees in the Phyx files too, so a test can prove the copy is faithful. Round 1
  produces 127 store files, an id ledger (`phylo-ids.json`) that keeps every `PHYLO_` id tied to
  its tree, 15 trees salvaged from never-merged curation branches, and `attribution.json`, which
  records who transcribed each tree.
- **Round 2: make the store the source of truth.** Add an `assemble()` helper
  (`lib/phylogenies.js`) that injects store trees back into Phyx objects at test and build time,
  then remove the Newicks from `phyx/phylonym/`. From that point the store is no longer derivable
  from `phyx/`, so three round-1 devices go with it: `test/phylogenies/store.js`, which compares
  against source Newicks that will no longer exist; the extractor as a regenerator (it becomes a
  one-shot migration); and Newick-keyed ids, including the refusal to run over a hand-edited store
  file. This round closes #113.
- **Round 3: build on the store.** Record `expectedResolution` baselines so resolution drift
  becomes a test failure; migrate `phyx/from_papers/` (carrying their `curatorComments`); add
  Regnum citation cross-checks and cross-resolution discovery; split the ontology into core
  (phyloreferences) and extended (phylogenies) files; transcribe trees for the ~520 citation slots
  that have none; reconcile the four trees cited with conflicting DOIs (`PHYLO_0025`, `0047`,
  `0053`, `0068`); move to publication-based filenames once #123 is settled; and move curator
  attribution out of `attribution.json` into the phylogeny records themselves.

## A map of the pieces

| Path | What it is | Fate |
|---|---|---|
| `phylogenies/PHYLO_*.json` | the store: one file per distinct tree | stays; the source of truth from round 2 |
| `phylogenies/phylo-ids.json` | the id ledger, live and retired ids | stays; loses its Newick keying in round 2 |
| `phylogenies/attribution.json` | who transcribed and revised each tree | stays until round 3 moves it into the records |
| `phylogenies/README.md` | the store's format, ids and attribution | stays |
| `phylogenies/migration/` | this README and the two reports below | deleted when the migration is done |
| `scripts/phylogenies/migration/extract-phylogenies.js` | copies trees from `phyx/` into the store | a one-shot migration in round 2, then deleted |
| `scripts/phylogenies/migration/salvage-trees.js` | fills empty `newick` fields from old branches | deleted when the migration is done |
| `scripts/phylogenies/attribute-phylogenies.js` | mines commit messages for curators | stays while `attribution.json` does |
| `lib/phylogenies.js`, `lib/files.js`, `lib/csv.js` | shared helpers | stay; `assemble()` is added in round 2 |
| `test/phylogenies/store.js` | proves the store is a faithful copy of `phyx/` | retired in round 2 |
| `test/phylogenies/extract.js` | id stability and the extractor's refusals | deleted with the extractor |
| `test/phylogenies/citations.js`, `attribute.js` | DOI normalization, attribution | stay with the code they test |

## Where to start reading

1. This page, for what is happening and why.
2. [`../README.md`](../README.md): the store file format, "How the two sides relate" (why
   `referenceFor` is the link, not citations), and how ids and the ledger work.
3. One store file with several references, such as `phylogenies/PHYLO_0024.json`, which seven
   phyloreferences cite.
4. `lib/phylogenies.js` and `scripts/phylogenies/migration/extract-phylogenies.js`, then the tests
   in `test/phylogenies/`.

To check round 1 yourself: `npm test` passes; re-running
`node scripts/phylogenies/migration/extract-phylogenies.js` and
`node scripts/phylogenies/migration/salvage-trees.js` leaves `git status` clean; and
`node scripts/phylogenies/attribute-phylogenies.js` (about a minute) leaves `attribution.json`
unchanged.

## How round 1 was carried out

The rest of this page is reference material for running the round-1 scripts.

- `extraction-report.csv` is regenerated by every run of the extractor.
- `salvage-provenance.csv` was written once by the salvage, and is committed.

### Regenerating the store

```bash
node scripts/phylogenies/migration/extract-phylogenies.js
# defaults: source=phyx/phylonym  store=phylogenies/  report=phylogenies/migration/extraction-report.csv
```

The extractor **copies** trees out of `phyx/phylonym/` and never modifies anything under
`phyx/`. `extraction-report.csv` lists, per store file, the source CLADO ids, derived label,
DOI(s), and any anomalies (e.g. the same tree cited with divergent DOIs in different files, and
how many sources kept their own `citations` on a `referenceFor` entry).

The new store is written into a temporary directory and moved into place, so an interrupted run
leaves the old store intact. Because the source directory is a bare positional argument while
`-o` defaults to `phylogenies/`, the extractor also **refuses** to run when it finds no trees at
all, or when the run would retire more than half of the existing store files — the signature of
a run aimed at the wrong corner of `phyx/`. Pass `--force` if a wholesale replacement really is
what you want.

It also refuses to run when a store file's tree no longer matches the tree the ledger records
for its id. Store files are generated, so a hand edit there would otherwise tie one id to two
trees; make the change in `phyx/phylonym/`, restore the store file, and re-run. That refusal
protects a generated artifact and goes away with round 2, when store files become curated and
editing one is the normal way to correct a tree.

The Mocha test `test/phylogenies/store.js` verifies the store is a faithful, deduplicated copy
of the source trees (every source `(cladoId, newick)` pair is reproduced exactly, every source
citation is still present, each unique tree lives in one file, and every store file is a valid
Phyx document). `test/phylogenies/extract.js` covers what a static store cannot show: id
stability across re-runs, retired ids never coming back on another tree, and the refusals
above.

### Salvaged trees

15 of the trees in the store were recovered from curation branches that were never merged
(PRs [#79](https://github.com/phyloref/clade-ontology/pull/79) and
[#45](https://github.com/phyloref/clade-ontology/pull/45)). Every phyloref in `phyx/phylonym/`
declares its reference phylogenies as citation slots — one `primaryPhylogenyCitation` plus any
number of `phylogenyCitation` entries — and only some of those slots carry a Newick. These trees
were transcribed in 2018–2020 against publications the target slots already cite, so recovering
them meant filling in an empty `newick` field rather than transcribing anything. The trees are
written into `phyx/phylonym/`, not into the store, because in round 1 the store is regenerated
from `phyx/phylonym/`: a tree written straight into `phylogenies/` would vanish on the next
extraction. Until round 2 they are as exposed to a `regnum2phyx.js` regeneration as every other
tree there.

```bash
node scripts/phylogenies/migration/salvage-trees.js [--dry-run]
# then regenerate the store, as above
```

The script refuses to write unless the source citation and the target slot agree on their DOI
(or, where no usable DOI exists, on author surname + year + title) and exactly one slot matches,
and it never overwrites a slot that already holds a tree. Re-running it is a no-op. If any
candidate fails those checks it writes nothing, the ledger included, and exits non-zero, so a
regeneration cannot quietly drop a tree's provenance; `--dry-run` writes nothing either.

`salvage-provenance.csv` records, per salvaged tree, the source PR and branch, the commit that
introduced it (author, subject and date), the slot it filled and what it was matched on. The
introducing commit is the oldest in the source file's history, followed across renames, whose
copy holds the tree; a move such as "Renamed from `REGNUM_` to `CLADO_`" never counts. It is
written once and committed, unlike the regenerated `extraction-report.csv`. Its `commit_author` is
the *committer*, not the curator who transcribed the tree; for that, see
[`attribution.json`](../README.md#curator-attribution).

Contested candidates from those branches — rival transcriptions of the same figure, and
challengers to trees already in the store — were deliberately left out.
