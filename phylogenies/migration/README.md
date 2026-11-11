# Moving the reference phylogenies out of the Phyx files

The phyloreferences in `phyx/phylonym/` come from PhyloRegnum and are meant to be regenerated
from it wholesale by `regnum2phyx.js`. The reference phylogenies in the same files are Newick
trees transcribed by hand from publications. Because both live in one file, regenerating the
phyloreferences overwrites the trees, so we cannot pull updates from PhyloRegnum without losing
curated work ([#113](https://github.com/phyloref/clade-ontology/issues/113)). The same tree is also
pasted into every file that cites it: 189 Newick-bearing phylogenies hold only 141 distinct trees.

This migration moves the trees into a store of their own, [`phylogenies/`](../README.md), in three
rounds. When it is done, a `CLADO_NNNNNNN` file answers only to PhyloRegnum, a `PHYLO_NNNN` file
only to the publication it was transcribed from, and each store file's `referenceFor` list joins
the two. This directory and `scripts/phylogenies/migration/` hold everything that exists only to
get there, and both can be deleted once the last round is done.

## Where the trees live, round by round

| | `phyx/phylonym/CLADO_*.json` | `phylogenies/PHYLO_*.json` | Source of truth for trees |
|---|---|---|---|
| Before | phyloreferences and Newicks | — | the Phyx files |
| Round 1 | unchanged, plus 29 salvaged trees | a copy of every distinct tree | the Phyx files; the store is regenerated from them |
| Round 2 | phyloreferences only | the trees | the store; `assemble()` joins the two at build time |
| Round 3 | phyloreferences only | the trees, and more of them | the store |

## Where we are

*As of November 2026. The live checklist is [#113](https://github.com/phyloref/clade-ontology/issues/113);
update this section when a round lands.*

- **Round 1 is in review** in [#115](https://github.com/phyloref/clade-ontology/pull/115) (the
  store, and the first 15 salvaged trees) and
  [#128](https://github.com/phyloref/clade-ontology/pull/128), stacked on it (the other 14, which
  let a phyloreference have several trees). Also stacked on #115:
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
  produces 141 store files, an id ledger (`phylo-ids.json`) that keeps every `PHYLO_` id tied to
  its tree, 29 trees salvaged from never-merged curation branches (so a phyloreference can now have
  several trees), and `attribution.json`, which records who transcribed each tree.
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
| `lib/salvage.js` | the salvage's per-tree decisions | deleted with the salvage script |
| `test/phylogenies/store.js` | proves the store is a faithful copy of `phyx/` | retired in round 2 |
| `test/phylogenies/extract.js` | id stability and the extractor's refusals | deleted with the extractor |
| `test/phylogenies/salvage.js` | the salvage's per-tree decisions | deleted with `lib/salvage.js` |
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

29 of the trees in the store were recovered from curation branches that were never merged: 15
from PR [#79](https://github.com/phyloref/clade-ontology/pull/79) and 14 from PR
[#45](https://github.com/phyloref/clade-ontology/pull/45), which is every Newick at the tip of
either branch.

Every phyloref in `phyx/phylonym/` declares its reference phylogenies as citation slots — one
`primaryPhylogenyCitation` plus any number of `phylogenyCitation` entries — and only some of those
slots carry a Newick. Each of these trees was transcribed in 2018–2020 against a publication one
of its phyloref's slots already cites, so recovering it was mechanical rather than a new
transcription. The trees are written into `phyx/phylonym/`, not into the store, because in round 1
the store is regenerated from `phyx/phylonym/`: a tree written straight into `phylogenies/` would
vanish on the next extraction. Until round 2 they are as exposed to a `regnum2phyx.js`
regeneration as every other tree there.

```bash
node scripts/phylogenies/migration/salvage-trees.js [--dry-run]
# then regenerate the store, as above
```

- **The source citation must match exactly one slot**, or nothing is written. A slot matches if
  any of its citations does. The matchers are tried strongest first: DOI, then author surname +
  year + title, then title alone, then author + year. The weaker ones exist because many slots
  record no DOI and the 2018 files record no author or year; a citation whose DOI names a
  different publication is never offered to them.
- **An empty slot is filled** (17 trees).
- **A slot that already holds a different tree is left alone, and the tree is appended** as a
  further phylogeny repeating that slot's citation (12 trees). A curated tree is never
  overwritten, and the script does not judge which transcription is better. The 2020 branch (#79)
  is processed first, because the trees already on `master` descend from that curation pass; so
  where both branches have a tree for an empty slot, the 2020 one fills it and the 2018 one is
  appended.
- **Re-running is a no-op.** A candidate that fails its checks fails the run, and then nothing
  is written, the ledger included, so a regeneration cannot quietly drop a tree's provenance;
  `--dry-run` writes nothing either.

The decisions are made in `lib/salvage.js` and tested in `test/phylogenies/salvage.js`; the script
itself reads git-crypt branches and cannot run in CI.

#### Figure notes and expected resolutions

The 14 trees from #45 carry the figure they were transcribed from as a `description` ("Vallin and
Laurin 2004 Fig. 6"), which the store copies like any other field of a phylogeny.

Five of them also say which node their phyloreference should resolve to, as
`additionalNodeProperties.<node label>.expectedPhyloreferenceNamed`: Apo-Tracheophyta,
Archaeplastida, Chlorophyta, Dikarya and Discicristata. The 2018 files name the phyloreference by
their own label for it ("Apo-Tracheophyte", "Dikarya " with a trailing space), which is rewritten
to the label the `CLADO_` file uses, since an expectation that names no phyloreference in its
file matches nothing.

**The annotation alone does not reach the reasoner.** phyx.js reads it in
`PhylorefWrapper.getExpectedNodeLabels()`, but `PhyxWrapper.asJSONLD()`, which builds what
JPhyloRef tests, marks a node as expected only when its label equals the phyloreference's label
or the phyloreference carries its own `expectedResolution`. Three of the five are therefore
tested, because their node happens to be labelled with the clade's name (as it is on 24 trees in
`phyx/phylonym/`). The other two are not: Apo-Tracheophyta (node "Tracheophytes") and
Archaeplastida (node "plants"). Making those count needs an `expectedResolution` on the
phyloreference, which is round-3 work in
[#113](https://github.com/phyloref/clade-ontology/issues/113). Resolution itself is only tested
under `RUN_SLOW_TESTS`.

#### `salvage-provenance.csv`

One row per salvaged tree: the source PR and branch, the commit that introduced it (author, subject
and date), where the tree now sits and whether it was `filled` or `appended`, what it was matched
on, any expectation exactly as the source wrote it, and the source file's `curatorComments` (which
say, for instance, that a Newick came from TreeBASE or from an author). It is written once and
committed, unlike the regenerated `extraction-report.csv`.

The introducing commit is the oldest in the source file's history, followed across renames, whose
copy holds the tree; a move such as "Renamed from `REGNUM_` to `CLADO_`" never counts, but a commit
that corrected the tree ("Fixed a typo in the phylogeny.") does: the tree in the store is the
corrected one.

This answers a different question from [`attribution.json`](../README.md#curator-attribution): how
each salvaged tree was written into `phyx/`, keyed by `CLADO_NNNNNNN`, tracing only within its
source branch. Its `commit_author` is the *committer*, not the curator who transcribed the tree.
Where the two disagree, **`attribution.json` is the authoritative record of who transcribed a
tree**.

#### Still outside the store

Two kinds of tree are not on those branches' tips and were not salvaged
([#129](https://github.com/phyloref/clade-ontology/issues/129) has the full list):

- 17 archived `.json.txt` files in `phyx/phylonym/newick-problems/` and `newick-recursion-error/`,
  set aside because of their Newicks. 14 of those phyloreferences have no live `CLADO_` file at
  all.
- Picidae (`CLADO_0000285`) and Pan-Testudines (`CLADO_0000272`), deleted in 2020 along with
  their trees for the same reason ("removed two files with failing Newick strings") and
  recoverable only from history.
