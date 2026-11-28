# phyx/

Curated Phyx files. Every `*.json` here is validated and converted as one, so this file is Markdown on purpose.

- **Every file in `phylonym/` round-trips exactly through `JSON.stringify(obj, null, 4)` with no trailing newline.** Any script that edits one in place should write it back that way; anything else (2-space indent, a trailing `\n`) reformats the whole file and buries a one-field change in a whole-file diff.
- **`additionalNodeProperties.expectedPhyloreferenceNamed` does not by itself create a tested expectation.** `PhylorefWrapper.getExpectedNodeLabels()` reads it, but `PhyxWrapper.asJSONLD()`, which builds what JPhyloRef tests, marks a node as expected only when its label equals the phyloreference's label or the phyloreference has its own `expectedResolution`. So the annotations in `from_papers/` count only where the node is also labelled with the clade's name. Migrating them to `expectedResolution` is #133. Conversely, many `phylonym/` trees record an expectation only through a node that carries the phyloreference's label (#134).
- **`phyx2ontology.js` never emits expected resolutions.** It wraps phylorefs and phylogenies separately, not through `PhyxWrapper`, so the node↔phyloref restrictions exist only in what the slow tests build.
- **`curatorComments` appear only in `from_papers/`.**
