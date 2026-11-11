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
same tree was physically re-pasted into every phyloref file that cited it (189 newick-bearing
phylogenies across `phyx/phylonym/` reduce to **141 unique trees**, with 25 duplicated across
2–7 files). This store moves each unique tree into one file and records which phyloreferences
it is a reference for.

The store is being introduced in three rounds, which this file refers to throughout. The plan,
where it stands, and how round 1 was carried out are in [`migration/`](migration/README.md).

## File format

Each `PHYLO_NNNN.json` is a **valid Phyx file** (a `phylogenies` array with a single tree, and
an empty `phylorefs` array) **plus** a custom top-level `referenceFor` array:

```jsonc
{
  "@context": "http://www.phyloref.org/phyx.js/context/v1.1.0/phyx.json",
  "phylogenies": [
    {
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
- **A phyloreference can have several trees.** Twelve do: two transcriptions of the same
  publication, each in its own store file, both naming the same `clado`. They are told apart by
  `sourcePhylogenyIndex`, so look a tree up by `(clado, sourcePhylogenyIndex)` and never assume
  a `clado` appears in one store file only (`buildReferenceIndex` returns a list for that
  reason). Nothing here says which transcription is the better one.
- The phylogeny carries the **canonical** source's citations — every citation key it had, not
  just the preferred one. When another source cited the same tree with a different citation
  (usually the same publication recorded with more or fewer authors and identifiers), that
  source's own citations are kept on its `referenceFor` entry: which version happens to sit in
  the earliest-numbered file is an accident, and round 2 will delete the source it came from.
- Every other field of the canonical source's phylogeny (a `label`, a `description`,
  `additionalNodeProperties`, …) is copied too, and a source whose other fields differ keeps
  its own on `referenceFor[].otherFields`. Today those fields are the figure notes and
  expected-resolution annotations on the trees salvaged from #45 (see
  [`migration/`](migration/README.md#salvaged-trees)); no two sources disagree on one.
- **An `additionalNodeProperties.<node>.expectedPhyloreferenceNamed` annotation is copied, but is
  not by itself a tested expectation**: JPhyloRef only sees an expectation when the node is also
  labelled with the phyloreference's name, or the phyloreference has an `expectedResolution`.
  The AGENTS.md gotcha and the [migration README](migration/README.md#salvaged-trees) have the
  details.
- A `label` appears only if the source phylogeny had one, and none do today. The short label
  the extractor derives from the citation ("France et al. 1996, fig. 3") goes into
  `migration/extraction-report.csv` and `phylo-ids.json` instead: written into `label`, it would be
  indistinguishable from a curator's once round 2 removes the source copy.

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

## Building the store

The store is built by copying trees out of `phyx/phylonym/` with
`scripts/phylogenies/migration/extract-phylogenies.js`. Most trees were transcribed into
`phyx/phylonym/` directly; 29 were recovered from curation branches that were never merged (15
from #79, 14 from #45), by filling or appending beside citation slots that already cited their
publication. Trees that are still missing from the store are listed in
[#129](https://github.com/phyloref/clade-ontology/issues/129). How to run the extractor and the
salvage, what they refuse to do, and the reports they leave behind are documented in
[`migration/`](migration/README.md), which holds everything that exists only for the migration and
goes away with it.

## Curator attribution

`attribution.json` records who transcribed each tree and who revised it since, keyed by
`PHYLO_NNNN`. Trees that nobody can yet be credited with are tracked in
[#125](https://github.com/phyloref/clade-ontology/issues/125).

```jsonc
{
  "comment": "...",
  "curators": {        // hand-maintained: curator id -> { name }
    "https://orcid.org/0009-0005-6085-1100": { "name": "Anna Becker" }
  },
  "overrides": {       // hand-maintained: a transcriber history cannot supply, and why
    "PHYLO_NNNN": { "transcribedBy": "https://orcid.org/...", "note": "who vouched for it, and when" }
  },
  "trees": {           // regenerated on every run
    "PHYLO_0006": {
      "transcribedBy": "https://orcid.org/0009-0005-6085-1100",  // absent if unattributed
      "history": [     // oldest first; only commits that changed the Newick
        { "event": "transcribed", "curator": "https://orcid.org/0009-0005-6085-1100",
          "curatorFrom": "commit subject", "commit": "216f7b85a0ab", "date": "2020-07-13",
          "subject": "Imported phylogenies curated by Anna." },
        { "event": "revised", "commit": "1cfdd8d23a82", "date": "2020-07-14",
          "subject": "Added expectation for Ascomycota." }   // no curator: the message names none
      ]
    }
  }
}
```

```bash
node scripts/phylogenies/attribute-phylogenies.js
```

- **Edit only `curators` and `overrides`.** The script carries both over untouched, and refuses
  to run over a file it cannot parse rather than lose them. To add a curator, give them an entry
  in `curators` and a pattern in the script's `CURATORS` table.
- **A curator id is the curator's ORCID URI**, or a local `curator:<slug>` for someone without
  one: it is already a global, resolvable identifier, and carries over to JSON-LD unchanged when
  attribution moves into the store files.
- **An override fills only a blank.** A curator the script derives still wins, so correcting
  `CURATORS` propagates, and the script warns about an override that a derived curator now
  contradicts.
- **Curators come from commit messages**, because every commit here is authored by the maintainer
  who committed it; where a message names nobody, from the `curatorComments` of the file that
  first held the tree. `curatorFrom` says which.
- **A tree is credited to whoever transcribed its first version**, not whoever wrote its current
  Newick: a later commit that changes the Newick, such as a maintainer adding a node label, is a
  `revised` event. How the history is read, and why, is in the header of
  `attribute-phylogenies.js`.
- **After a change, check the date spans the script prints.** Rebecca Stubbs worked on these
  trees in 2018 and Anna Becker in 2020, so a misattributed tree shows up as overlapping spans.

This is a separate file from the id ledger, `phylo-ids.json`, on purpose: the ledger must never be
edited by hand and is swapped in by the extractor with the store, while this file is edited by
hand and written by a slow walk of the history. It is committed as data rather than derived on
demand because what history can tell us keeps degrading with every path move, and round 2 rewrites
`phyx/` again.
