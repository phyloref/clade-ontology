# Hillis and Wilcox, 2005

* Based on [Hillis and Wilcox, 2005](http://www.sciencedirect.com/science/article/pii/S1055790304003240)
  * Tree [available on TreeBase](https://treebase.org/treebase-web/search/study/trees.html?id=1269)

* Input file: [`paper.json`](paper.json)
* To create ontology:
  * `python ../add-labels.py paper.json -o labeled.json`
  * `rdfpipe -i json-ld labeled.json -o xml > hillis_and_wilcox_2005.owl`
    * (On Windows, you need to end with `... | Set-Content -Encoding UTF8 hillis_and_wilcox_2005.owl`

* Output file: [`hillis_and_wilcox_2005.owl`](hillis_and_wilcox_2005.owl)
  * This file can be opened in Protege; phyloreferences are instances of the 
    Phyloreference class, and should contain a single node from which that
    clade descends.
