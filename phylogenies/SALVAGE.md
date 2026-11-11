# Salvaged reference phylogenies

29 of the trees in the store were recovered from curation branches that were never merged: 15
from PR #79 and 14 from PR #45, which is every Newick at the tip of either branch. This file
explains how they were recovered and what records it. For the store itself, see
[`README.md`](README.md).

Every phyloref in `phyx/phylonym/` declares its reference phylogenies as citation slots — one
`primaryPhylogenyCitation` plus any number of `phylogenyCitation` entries — and only some of those
slots carry a Newick. Each of these trees was transcribed in 2018–2020 against a publication one
of its phyloref's slots already cites, so recovering it was mechanical rather than a new
transcription:

```bash
node scripts/phylogenies/salvage-trees.js [--dry-run]
# then regenerate the store: node scripts/phylogenies/extract-phylogenies.js
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

## Figure notes and expected resolutions

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

## `salvage-provenance.csv`

One row per salvaged tree: the source PR and branch, the commit that introduced it (author, subject
and date), where the tree now sits and whether it was `filled` or `appended`, what it was matched
on, any expectation exactly as the source wrote it, and the source file's `curatorComments` (which
say, for instance, that a Newick came from TreeBASE or from an author). It is written once and
committed, unlike the regenerated `extraction-report.csv`.

The introducing commit is the oldest in the source file's history, followed across renames, whose
copy holds the tree; a move such as "Renamed from `REGNUM_` to `CLADO_`" never counts, but a commit
that corrected the tree ("Fixed a typo in the phylogeny.") does: the tree in the store is the
corrected one.

This answers a different question from [`attribution.json`](README.md#curator-attribution): how
each salvaged tree was written into `phyx/`, keyed by `CLADO_NNNNNNN`, tracing only within its
source branch. Its `commit_author` is the *committer*, not the curator who transcribed the tree.
Where the two disagree, **`attribution.json` is the authoritative record of who transcribed a
tree**.

## Still outside the store

Two kinds of tree are not on those branches' tips and were not salvaged
([#129](https://github.com/phyloref/clade-ontology/issues/129) has the full list):

- 17 archived `.json.txt` files in `phyx/phylonym/newick-problems/` and `newick-recursion-error/`,
  set aside because of their Newicks. 14 of those phyloreferences have no live `CLADO_` file at
  all.
- Picidae (`CLADO_0000285`) and Pan-Testudines (`CLADO_0000272`), deleted in 2020 along with
  their trees for the same reason ("removed two files with failing Newick strings") and
  recoverable only from history.
