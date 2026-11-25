# test/

Each test file's header comment says what it covers.

## Slow tests (`RUN_SLOW_TESTS=1`)

They run JPhyloRef on each Phyx file to check that every phyloreference resolves to its expected node. Optional environment variables: `JVM_ARGS`, `JPHYLOREF_ARGS`. `MAX_INTERNAL_SPECIFIERS` and `MAX_EXTERNAL_SPECIFIERS` are not slow-test-only: they also skip files in the default run and drop phyloreferences from `CLADO.json` (see the root `AGENTS.md`).

**As of 2026-09-30 they cannot confirm anything** (#132). No phyloreference tried resolves to any node:

- under JPhyloRef 0.3.1, what `download.sh` fetches, which on Java 17+ starts only with `JVM_ARGS='--add-opens java.base/java.lang=ALL-UNNAMED'`;
- or under 1.1.1, from Maven Central, which starts unaided;
- on Java 17 or 23.

JPhyloRef 1.1.1 does find the expected nodes, and its log shows OWLAPI leaving every phylogeny node's `rdf:type` restriction as an "Unparsed triple": that is the first thing to look at. Until some file passes, a failure here says nothing about the file under test. Once one does, delete this section, and the matching gotcha in the root `AGENTS.md`.
