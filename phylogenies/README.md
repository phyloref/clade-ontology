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
      "newick": "(((...)));"
    }
  ],
  "phylorefs": [],
  "referenceFor": [
    { "clado": "CLADO_0000167", "regnumId": 167, "sourcePhylogenyIndex": 0 },
    { "clado": "CLADO_0000172", "regnumId": 172, "sourcePhylogenyIndex": 0 }
  ]
}
```

- `referenceFor` keys on the **stable** `CLADO_NNNNNNN` / `regnumId`, not the volatile
  build-time CLADO IRI that `phyx2ontology.js` mints by index.
- `sourcePhylogenyIndex` records which `phylogenies[]` slot the tree came from in the source
  Phyx file (provenance for the round-2 strip).

### Filenames

Filenames are currently sequential (`PHYLO_0001.json` …) for stable referencing. They are
expected to migrate to human-readable, publication-based names in a future round (e.g.
`leadAuthor2009.json`, `leadAuthor2009_journal.json`). Treat the filename as an opaque id and
use `referenceFor[].clado` for linking.

## Regenerating the store

```bash
node scripts/phylogenies/extract-phylogenies.js
# defaults: source=phyx/phylonym  store=phylogenies/  report=phylogenies/extraction-report.csv
```

The extractor **copies** trees out of `phyx/phylonym/` and never modifies anything under
`phyx/`. `extraction-report.csv` lists, per store file, the source CLADO ids, derived label,
DOI(s), and any anomalies (e.g. the same tree cited with divergent DOIs in different files).

The Mocha test `test/phylogenies/store.js` verifies the store is a faithful, deduplicated copy
of the source trees (every source `(cladoId, newick)` pair is reproduced exactly, each unique
tree lives in one file, and every store file is a valid Phyx document).

## Roadmap

- **Round 1 (this PR):** build and populate the store by copying; keep the trees in the Phyx
  files so we can verify the copy is faithful first.
- **Round 2+ (future):** add an `assemble()` helper (`lib/phylogenies.js`) that injects store
  trees back into Phyx objects at test/build time; remove the newicks from `phyx/phylonym/`;
  record auto-snapshot `expectedResolution` baselines so drift becomes a test failure; add
  cross-resolution discovery and Regnum citation cross-checks; migrate `from_papers/` (carrying
  their `curatorComments`); and attribute each transcribed tree to a curator.
