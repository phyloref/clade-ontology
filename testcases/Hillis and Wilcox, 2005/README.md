# Hillis and Wilcox, 2005

* Based on [Hillis and Wilcox, 2005](http://www.sciencedirect.com/science/article/pii/S1055790304003240)
  * Tree [available on TreeBase](https://treebase.org/treebase-web/search/study/trees.html?id=1269)

* Input file: [`paper.json`](paper.json)
* To create ontology:
  * `python ../../testcase2owl/testcase2owl.py paper.json -o paper_as_owl.json`
  * `rdfpipe -i json-ld paper_as_owl.json -o xml > paper.owl`
    * (On Windows, you need to end with `... | Set-Content -Encoding UTF8 hillis_and_wilcox_2005.owl`

* Output file: `paper.owl`
  * This file can be opened in Protege; phyloreferences are instances of the 
    Phyloreference class, and should contain a single node from which that
    clade descends.

## Current test status

1. Amerana: **no nodes resolved**.
2. Aquarana: **no nodes resolved**.
3. Lacusirana: **no nodes resolved**.
4. Laurasiarana: **no nodes resolved**.
5. Levirana: resolved correctly.
6. Lithobates: **no nodes resolved**.
7. Nenirana: resolved correctly.
8. Novirana: resolved correctly.
9. Pantherana: **no nodes resolved**.
10. Ranula: resolved correctly.
11. Scurrilirana: **no nodes resolved**.
12. Sierrana: **no nodes resolved**.
13. Stertirana: resolved correctly.
14. Torrentirana: resolved correctly.
15. Trypheropsis: resolved correctly.
16. Zweifelia: resolved correctly.
