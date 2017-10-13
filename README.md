# Phyloreferencing Curation Workflow
The Phyloreferencing curation workflow serves three main purposes:

1. It provides a set of exemplar curated phyloreferences in JSON and OWL.
2. It provides a test space for trying different approaches to generating phyloreferences from JSON to OWL, although these will be moved into their own repositories if they prove to be successes.
3. It provides a test suite of phyloreferences along with expected resolved nodes, allowing reasoning to be continually tested as ontologies and software tools are updated.

[![Build Status](https://travis-ci.org/phyloref/curation-workflow.svg?branch=master)](https://travis-ci.org/phyloref/curation-workflow)

## Currently curated phyloreferences

| Curated paper | DOI | Phyloreferences | Status |
|---------------|-----|-----------------|--------|
| [Fisher et al, 2007](curated/Fisher%20et%20al,%202007) | [doi](https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2#https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2) | 11 phyloreferences | All resolved correctly, but one resolved to a different node from paper | 
| [Hillis and Wilcox, 2005](curated/Hillis%20and%20Wilcox,%202005) | [doi](https://doi.org/10.1016/j.ympev.2004.10.007) | 16 phyloreferences | All resolved correctly, but in two cases the correct resolution was no nodes |
