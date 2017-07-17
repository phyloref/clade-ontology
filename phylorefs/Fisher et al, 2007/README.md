= Fisher *et al.*, 2007 =

* Based on [Fisher *et al.*, 2007](https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2#https://doi.org/10.1639/0007-2745%282007%29110%5B46%3APOTCWA%5D2.0.CO%3B2)
  * Tree [available on TreeBase](https://treebase.org/treebase-web/search/study/taxa.html?id=1624).

* Input file: [`input.json`](input.json)
* To create ontology:
  * `python ../add-labels.py paper.json -o labeled.json`
  * `rdfpipe -i json-ld labeled.json -o xml > fisher_et_al_2007.owl`
    * (On Windows, you need to end with `... | Set-Content -Encoding UTF8 fisher_et_al_2007.owl`

* Output file: [`fisher_et_al_2007.owl`](fisher_et_al_2007.owl)
  * This file can be opened in Protege; phyloreferences are instances of the 
    Phyloreference class 
