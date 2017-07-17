# Fisher *et al.*, 2007

* Based on [Fisher *et al.*, 2007](https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2#https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2)
  * Tree [available on TreeBase](https://treebase.org/treebase-web/search/study/taxa.html?id=1624).

* Input file: [`paper.json`](paper.json)
* To create ontology:
  * `python ../add-labels.py paper.json -o labeled.json`
  * `rdfpipe -i json-ld labeled.json -o xml > fisher_et_al_2007.owl`
    * (On Windows, you need to end with `... | Set-Content -Encoding UTF8 fisher_et_al_2007.owl`)

* Output file: [`fisher_et_al_2007.owl`](fisher_et_al_2007.owl)
  * This file can be opened in Protege; phyloreferences are instances of the 
    Phyloreference class and should contain a single node from which this clade
    descends.

## Current test status

* Albifolium: matched node `file1_tree1_node18`, correct node.
* Arthrocormus: **no nodes matched**, caused by [phylo2owl issue #26](https://github.com/phyloref/phylo2owl/issues/26).
* Calymperaceae: matched node `file1_tree1_node2`, correct node.
* Calymperes: matched node `file1_tree1_node9`, correct node.
* Exodictyon: **no nodes matched**, caused by [phylo2owl issue #26](https://github.com/phyloref/phylo2owl/issues/26).
* Exostratum: matched node `file1_tree1_node23`, correct node.
* Leucophanella: matched node `file1_tree1_node49`, correct node.
* Leucophanes: matched node `file1_tree1_node27`, correct node.
* Mitthyridium: matched node `file1_tree1_node54`, **incorrect node** caused by [phylo2owl issue #29](https://github.com/phyloref/phylo2owl/issues/29).
* Syrrhopodon: matched node `file1_tree1_node8`, correct node.
* Trachymitrium: matched node `file1_tree1_node15`, correct node.
