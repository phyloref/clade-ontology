# Phyx JSON Schema (`phyx_schema.json`)

`phyx_schema.json` is the [JSON Schema](https://json-schema.org/) (draft-07) used by the
test suite to validate Phyx files, both the curated `.json` files in this repository and
the files produced by `regnum2phyx`.

## Provenance

This schema is **not** a pristine copy of any officially published Phyx schema. It started
as a verbatim copy of the official **v1.1.0** schema and was then hand-edited.

The official schemas are published at <https://www.phyloref.org/phyx.js/context/>:

| Version       | URL                                                          |
| ------------- | ------------------------------------------------------------ |
| v1.0.0        | <https://www.phyloref.org/phyx.js/context/v1.0.0/schema.json> |
| v1.1.0        | <https://www.phyloref.org/phyx.js/context/v1.1.0/schema.json> |
| development   | <https://www.phyloref.org/phyx.js/context/development/schema.json> |

At the time of writing, the official `v1.1.0` and `development` schemas are byte-for-byte
identical to each other, and our local copy is closest to them (the older `v1.0.0` is a
much poorer match).

## How this copy differs from official v1.1.0 / development

The local copy diverges in two distinct ways.

### 1. Deliberate relaxations / extensions (so the repo's own files validate)

These make the schema more permissive than the official one so that the Phyx files in this
repository (and the output of `regnum2phyx`) pass validation:

- **`definitions.nomenclaturalCodes.enum`** — adds two codes the official schema does not
  allow: `http://purl.obolibrary.org/obo/NOMEN_0000107` and
  `http://purl.obolibrary.org/obo/NOMEN_0000109`.
- **`phylogenies[].required`** — relaxed from `["newick"]` to `[]`, so a phylogeny with no
  Newick string passes.
- **`phylorefs[].namePublishedIn`** and **`phylorefs[].definitionSource`** — widened from a
  single `citation` to `anyOf: [citation, array-of-citation]`.
- **`definitions.citation.edition`** — an `edition` property that does not exist in the
  official schema.

### 2. Apparent bug-fixes vs. the official schema (should be upstreamed)

These correct what look like genuine mistakes in the official schema and should ideally be
fixed in the official version rather than carried as a local fork:

- **`definitions.taxon_name.specificEpithet.description`** — our copy correctly says
  "The specific epithet portion of the taxon name." The official schema has a copy-paste
  error describing it as "The genus portion of the taxon name."
- **`phylorefs[].scientificNameAuthorship`** — our copy types it as a plain `string`. The
  official schema points it at `$ref: #/definitions/citation`, which is wrong for an
  authorship string.
- Minor: our copy adds `"type": "string"` to `@context`, and places
  `additionalProperties` / `type: object` slightly differently in
  `citation.journal.identifier.items`.

## Maintenance

The goal is to track the official Phyx schema as closely as possible. The relaxations in
group (1) exist only because the official schema is stricter than the data we have; the
fixes in group (2) should be contributed back to
[phyx.js](https://github.com/phyloref/phyx.js) so this local copy can eventually be a
straight copy of an official version again. This is tracked in
[clade-ontology#112](https://github.com/phyloref/clade-ontology/issues/112).
