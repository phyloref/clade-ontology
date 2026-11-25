# scripts/phylogenies/

Tooling for the reference-phylogeny store. `migration/` holds the scripts that exist only for the round 1 → 2 migration (the extractor and the salvage); how to run them, and what they refuse to do, is in `phylogenies/migration/README.md`. The salvage's per-tree decisions live in `lib/salvage.js`, so they can be tested without git.

- **Reading git-crypt files from history:** `git cat-file --textconv <rev>:<path>` decrypts in an unlocked repository with no checkout, which is how the salvage and attribution scripts read the unmerged curation branches (through their `archive/*` tags); `git log -S` also sees through the driver. The driver is chosen from today's `.gitattributes` by the path *as named*, so a blob read from a path no longer covered (2018's `private/`, before the move into `phyx/encrypted/`) comes back still encrypted: pass `--path=<a path under phyx/encrypted/>`, as both scripts do. A linked worktree cannot decrypt at all.
- **A script that edits a `phyx/phylonym/` file in place writes it back with `JSON.stringify(obj, null, 4)` and no trailing newline**, as every file there round-trips that way.
- **`salvage-trees.js` reads its own ledger**, `phylogenies/migration/salvage-provenance.csv`, to tell trees it placed from trees already there; keep the ledger committed.
