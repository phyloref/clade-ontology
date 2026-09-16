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
same tree was physically re-pasted into every phyloref file that cited it (160 newick-bearing
phylogenies across `phyx/phylonym/` reduce to **112 unique trees**, with 25 duplicated across
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
      "label": "France et al. 1996, fig. 3",  // derived from the citation, for readability
      "primaryPhylogenyCitation": { /* BibJSON copied from the source Phyx file */ },
      "phylogenyCitation": { /* every citation key the source carried is copied */ },
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
      "citations": { "primaryPhylogenyCitation": { /* ... */ } }
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

### Filenames

Filenames are currently sequential (`PHYLO_0001.json` …), and **a tree keeps its id as long as
its Newick is unchanged**: inserting or removing a tree does not renumber the others, and the
id of a tree that disappears is retired rather than recycled onto a different tree. Editing a
tree's Newick, however, reads as a new tree and takes a new id.

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

The Mocha test `test/phylogenies/store.js` verifies the store is a faithful, deduplicated copy
of the source trees (every source `(cladoId, newick)` pair is reproduced exactly, every source
citation is still present, each unique tree lives in one file, and every store file is a valid
Phyx document). `test/phylogenies/extract.js` covers what a static store cannot show: id
stability across re-runs, retired ids never coming back on another tree, and the refusals
above.

## Roadmap

- **Round 1 (this PR):** build and populate the store by copying; keep the trees in the Phyx
  files so we can verify the copy is faithful first.
- **Round 2+ (future):** add an `assemble()` helper (`lib/phylogenies.js`) that injects store
  trees back into Phyx objects at test/build time; remove the newicks from `phyx/phylonym/`;
  record auto-snapshot `expectedResolution` baselines so drift becomes a test failure; add
  cross-resolution discovery and Regnum citation cross-checks; migrate `from_papers/` (carrying
  their `curatorComments`); and attribute each transcribed tree to a curator.
