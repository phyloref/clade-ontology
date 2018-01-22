# Fisher *et al.*, 2007

* Based on [Fisher *et al.*, 2007](https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2#https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2)
  * Tree [available on TreeBase](https://treebase.org/treebase-web/search/study/taxa.html?id=1624).

* Input file: [`paper.json`](paper.json)
* To create ontology:
  * `python ../../testcase2owl/testcase2owl.py paper.json -o paper_as_owl.json`
  * `rdfpipe -i json-ld paper_as_owl.json -o xml > paper.owl`
    * (On Windows, you need to end with `... | Set-Content -Encoding UTF8 fisher_et_al_2007.owl`)

* Output file: `paper.owl`
  * This file can be opened in Protege; phyloreferences are instances of the 
    Phyloreference class and should contain a single node from which this clade
    descends.

## Current test status

* Albifolium: resolved correctly.
* Arthrocormus: resolved correctly.
* Calymperaceae: resolved correctly.
* Calymperes: resolved correctly.
* Exodictyon: resolved correctly.
* Exostratum: resolved correctly.
* Leucophanella: **no nodes resolved**, as it specifies *Syrrhopodon revolutus* as an internal specifier, but this specifier does not exist in this phylogeny.
* Leucophanes: resolved correctly.
* Mitthyridium: resolved correctly.
* Syrrhopodon: resolved correctly.
* Trachymitrium: resolved correctly.
