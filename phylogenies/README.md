# Reference-phylogeny store

This directory holds the **shared, deduplicated reference phylogenies** used to validate that
phyloreferences resolve to the clade their authors intended.

## Why this exists

Phyx files in `phyx/phylonym/` mix two kinds of data with different lifecycles:

- **Phyloreferences** — one per file, keyed by a stable `regnumId` (= the `CLADO_NNNNNNN`
  filename). These are *derived* from PhyloRegnum and are meant to be regenerated wholesale by
  `regnum2phyx.js` whenever the upstream database changes.
- **Reference phylogenies** — Newick trees, manually curated from the publications cited in
  Regnum.

Keeping the trees inside the Phyx files made regeneration overwrite curated newicks, and the
same tree was physically re-pasted into every phyloref file that cited it (175 newick-bearing
phylogenies across `phyx/phylonym/` reduce to **127 unique trees**, with 25 duplicated across
2–7 files). This store moves each unique tree into one file and records which phyloreferences
it is a reference for.

## File format

Each `PHYLO_NNNN.json` is a **valid Phyx file** (a `phylogenies` array with a single tree, and
an empty `phylorefs` array) **plus** a custom top-level `referenceFor` array:

```jsonc
{
  "@context": "http://www.phyloref.org/phyx.js/context/v1.1.0/phyx.json",
  "phylogenies": [
    {
      "label": "France et al. 1996, fig. 3",  // the source's own, else derived from the citation
      "primaryPhylogenyCitation": { /* BibJSON copied from the source Phyx file */ },
      "phylogenyCitation": { /* every citation key the source carried is copied */ },
      /* ...and every other field the source phylogeny carried */
      "newick": "(((...)));"
    }
  ],
  "phylorefs": [],
  "referenceFor": [
    { "clado": "CLADO_0000167", "regnumId": 167, "sourcePhylogenyIndex": 0 },
    {
      "clado": "CLADO_0000172",
      "regnumId": 172,
      "sourcePhylogenyIndex": 0,
      // Only when this source cited the tree differently from the canonical source above.
      "citations": { "primaryPhylogenyCitation": { /* ... */ } },
      // Only when this source's other fields (label, description, ...) differ from it.
      "otherFields": { "description": "..." }
    }
  ]
}
```

- `referenceFor` keys on the **stable** `CLADO_NNNNNNN` / `regnumId`, not the volatile
  build-time CLADO IRI that `phyx2ontology.js` mints by index.
- `sourcePhylogenyIndex` records which `phylogenies[]` slot the tree came from in the source
  Phyx file (provenance for the round-2 strip).
- The phylogeny carries the **canonical** source's citations — every citation key it had, not
  just the preferred one. When another source cited the same tree with a different citation
  (usually the same publication recorded with more or fewer authors and identifiers), that
  source's own citations are kept on its `referenceFor` entry: which version happens to sit in
  the earliest-numbered file is an accident, and round 2 will delete the source it came from.
- Every other field of the canonical source's phylogeny (a `label`, a `description`,
  `additionalNodeProperties`, …) is copied too, and a source whose other fields differ keeps
  its own on `referenceFor[].otherFields`. Today the only such fields are the `description`
  figure notes on three salvaged trees ("Vallin and Laurin 2004 Fig. 6"), and no two sources
  disagree on one; the copy is there so that fields added later are not lost.

### How the two sides relate

A store file and the phyloreferences it lists answer to different upstreams. A `CLADO_NNNNNNN`
file must match what PhyloRegnum says, and is regenerated wholesale from it; a `PHYLO_NNNN` file
must match the publication it was transcribed from. `referenceFor` is the link between them,
and it is authoritative: it is what lets a reasoner check that a phyloreference resolves to its
expected node on this tree, which is the only thing the link exists for. The citations on the
two sides usually agree, and a disagreement is worth a warning, but they are not the join:
about a quarter of the citation slots in `phyx/phylonym/` carry no DOI, so joining on citation
identity would silently drop them (the counts are in [#123](https://github.com/phyloref/clade-ontology/issues/123)). The link lives on the
store side rather than in the Phyx files because that is the side that is not regenerated:
anything written into a `CLADO_` file's citation slot is overwritten the next time
`regnum2phyx.js` runs.

### Filenames

Filenames are currently sequential (`PHYLO_0001.json` …), and **a tree keeps its id as long as
its Newick is unchanged**: inserting or removing a tree does not renumber the others, and the
id of a tree that disappears is retired rather than recycled onto a different tree. Editing a
tree's Newick, however, reads as a new tree and takes a new id.

Keying the id to the Newick is a consequence of round 1, not the intended identity model: while
the store is generated from `phyx/phylonym/`, the Newick is the only key the extractor can
re-derive an id from. Once round 2 makes the store the source of truth, the id is simply the
file, and correcting a transcription keeps its id, with git history as the provenance. The
long-term model is decided in [#123](https://github.com/phyloref/clade-ontology/issues/123).

That guarantee is held by `phylo-ids.json`, the **id ledger**: it records every id the store
has ever assigned — live or retired — against a SHA-256 of its normalized Newick. The store
files alone cannot hold it, because a retired id's file is precisely the thing that has been
deleted, so a run that looked only at the files on disk would hand the id straight back out to
an unrelated tree. Commit the ledger with the store, and do not edit it by hand; a tree that
comes back later reclaims its original id from it.

Filenames are expected to migrate to human-readable, publication-based names in a future round
(e.g. `leadAuthor2009.json`, `leadAuthor2009_journal.json`). Treat the filename as an opaque id
and use `referenceFor[].clado` for linking.

## Regenerating the store

```bash
node scripts/phylogenies/extract-phylogenies.js
# defaults: source=phyx/phylonym  store=phylogenies/  report=phylogenies/extraction-report.csv
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

## Salvaged trees

15 of the trees in the store were recovered from curation branches that were never merged
(PRs #79 and #45). Every phyloref in `phyx/phylonym/` declares its reference phylogenies as
citation slots — one `primaryPhylogenyCitation` plus any number of `phylogenyCitation` entries —
and only some of those slots carry a Newick. These trees were transcribed in 2018–2020 against
publications the target slots already cite, so recovering them meant filling in an empty `newick`
field rather than transcribing anything:

```bash
node scripts/phylogenies/salvage-trees.js [--dry-run]
# then regenerate the store, as above
```

The script refuses to write unless the source citation and the target slot agree on their DOI
(or, where no usable DOI exists, on author surname + year + title) and exactly one slot matches,
and it never overwrites a slot that already holds a tree. Re-running it is a no-op.

`salvage-provenance.csv` records, per salvaged tree, the source PR and branch, the commit that
introduced it (author, subject and date), the slot it filled and what it was matched on. It is
written once and committed, unlike the regenerated `extraction-report.csv`. Its `commit_author` is
the *committer*, not the curator who transcribed the tree; for that, see `attribution.csv` below.

Contested candidates from those branches — rival transcriptions of the same figure, and
challengers to trees already in the store — were deliberately left out.

## Curator attribution

`attribution.csv` records who transcribed each tree, keyed by `PHYLO_NNNN`. Current state:
**117 trees credited to Anna Becker, 3 to Rebecca Stubbs, 7 unattributed**
([#125](https://github.com/phyloref/clade-ontology/issues/125)).

Git authorship is no help: every commit in this repository is authored by the maintainer who
committed it, so the curators appear nowhere in the author field. The attribution comes from
commit *messages* instead — "Imported phylogenies curated by Anna", "Added new phyloreferences
from RS" — mapped onto the curators' full names by the `CURATORS` table in the script. The
messages never give more than "Anna" and "RS": "RS" is expanded only in the title of PR #45, and
Anna's surname was supplied by the maintainer.

```bash
node scripts/phylogenies/attribute-phylogenies.js
```

The script walks every commit touching `phyx/phylonym/` or `phyx/encrypted/phylonym/` on **any**
branch, oldest first, and the first commit to introduce a Newick owns it. It has to work forwards:
tracing backwards with `git log -S<newick>` bottoms out at whichever commit *moved* the file
("Renamed from `REGNUM_` to `CLADO_`", "Reorganized PHYX files into a single folder", the 2021 move
out of `encrypted/`), and `phyx/phylonym/` itself has only two commits in its history.

Seven trees remain unattributed because the commit that introduces them is a reformatting pass
("Updated Newicks", "Fixed specifier authorities in Phyx files") that credits nobody; their real
transcriber is only knowable from outside the repository. **A curator written into the CSV by hand
survives regeneration** — the script preserves an existing name wherever it would otherwise leave a
blank, the same way the extractor preserves PHYLO ids. A name the script *derives* still wins, so
correcting `CURATORS` propagates.

This is committed as data rather than derived on demand because what history can tell us keeps
degrading: every path move costs traceability, round 2 rewrites `phyx/` again, and the curators'
full names were never in the repository to begin with. ORCIDs are not recorded yet. Moving
attribution into the phylogeny records themselves waits on the store-model decision.

Note `salvage-provenance.csv` answers a different question — how each salvaged tree was written
into `phyx/`, keyed by `CLADO_NNNNNNN` — and traces only within its source branch, so where the two
disagree on a commit, **`attribution.csv` is the authoritative record of who transcribed a tree**.

## Roadmap

- **Round 1 (current):** build and populate the store by copying; keep the trees in the Phyx
  files so we can verify the copy is faithful first.
- **Round 2 (future):** make the store the source of truth for trees. Add an `assemble()`
  helper (`lib/phylogenies.js`) that injects store trees back into Phyx objects at test/build
  time, then remove the newicks from `phyx/phylonym/`. From that point the store is no longer
  derivable from `phyx/`, so three round-1 devices go with it: `test/phylogenies/store.js`,
  which compares against source Newicks that will no longer exist; the extractor as a
  regenerator (it becomes a one-shot migration); and Newick-keyed ids, including the refusal to
  run over a hand-edited store file.
- **Later:** record auto-snapshot `expectedResolution` baselines so drift becomes a test
  failure; add cross-resolution discovery and Regnum citation cross-checks; migrate
  `from_papers/` (carrying their `curatorComments`); and move curator attribution out of
  `attribution.csv` and into the phylogeny records themselves. The identity and linkage model
  is decided in [#123](https://github.com/phyloref/clade-ontology/issues/123).
