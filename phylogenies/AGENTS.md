# phylogenies/

The shared reference-phylogeny store. `README.md` here describes the format, the ids and the curator record; `migration/README.md` is the entry point to the migration out of `phyx/phylonym/` and its roadmap. In round 1 the store is generated from `phyx/phylonym/`, so every tree is in both places.

- **To add or change a tree, edit `phyx/phylonym/` and re-run the extractor**, never a `PHYLO_*.json` file: each run rebuilds the store from `phyx/` alone, so a hand-added file disappears and a hand-edited one is refused. Fill in a `newick` on the phyloreference's citation slot, or, if the slot already holds a tree, append a phylogeny repeating its citation (`README.md`, "Building the store").
- **`phylo-ids.json` must be committed with the store and never edited by hand.** It is the only record of retired ids; without it the extractor can reissue an id onto a different tree (`README.md`, "Filenames"). Newick-keyed ids hold only while round 1 lasts; read the Roadmap in `migration/README.md` and #123 before extending the ledger logic.
- **Resolve a merge conflict in a generated file by regenerating it**: `migration/README.md`, "Merge conflicts in generated files". A hand-merged ledger can give one `PHYLO` id to two different Newicks. (One phyloreference having two trees, each with its own id, is fine.)
- **Curators are not in git authorship.** Every commit is authored by whoever committed it; the transcribers are named only in commit message prose. `attribution.json` is the record: its `curators` and `overrides` are maintained by hand, its `trees` regenerated (`README.md`, "Curator attribution"). It is separate from `phylo-ids.json`, which is never hand-edited; don't merge the two.
- **Store files carry `"phylorefs": []`** because `PhyxWrapper.asJSONLD()` throws on a document without the key.
- **`migration/` is deleted when the migration is done.** Don't put anything there that describes the trees themselves.
