# phyx/regnum/

This directory contains Phyx files exported from the [PhyloRegnum](https://www.phyloregnum.org/) database of phylogenetic clade definitions.

## How these files were generated

The Phyx files here are produced by running `regnum2phyx/regnum2phyx.js` against a PhyloRegnum database dump:

```bash
node regnum2phyx/regnum2phyx.js dump.json -o phyx/regnum/ --filenames regnum-id
```

Files are named after their PhyloRegnum entry ID (e.g., `CLADO_0000001.json`). The raw database dumps are stored in `data/` (git-ignored) and are not committed to this repository.

## Contents

Each JSON file is a Phyx file containing one phyloreference (`phylorefs` array) with:
- `label` — the phyloreference name as it appears in PhyloRegnum
- `definition` — the text definition of the clade
- `internalSpecifiers` / `externalSpecifiers` — the specifiers that define the clade
- `definitionSource` / `namePublishedIn` — citation(s) in BibJSON format
- `curatorNotes` — includes the original PhyloRegnum entry ID

See the [Phyx format documentation](https://www.phyloref.org/phyx.js/) and the
[phyx.js JSON Schema](https://www.phyloref.org/phyx.js/context/) for details on the file format.
