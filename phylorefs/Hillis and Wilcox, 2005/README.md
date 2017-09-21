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

## Current test status

1. Amerana: **no nodes matched**.
2. Aquarana: **no nodes matched**.
3. Lacusirana: **no nodes matched**.
4. Laurasiarana: matched node `file1_tree1_node1`, **incorrect node**.
5. Levirana: matched node `file2_tree1_node111`, correct node.
6. Lithobates: **no nodes matched**.
7. Nenirana: matched node `file2_tree1_node49`, correct node.
8. Novirana: **no nodes matched**.
9. Pantherana: **no nodes matched**.
10. Ranula: **no nodes matched**.
11. Scurrilirana: **no nodes matched**.
12. Sierrana: matched node `file2_tree1_node16`, correct node.
13. Stertirana: **no nodes matched**.
14. Torrentirana: matched node `file2_tree1_node37`, correct node.
15. Trypheropsis: **no nodes matched**.
16. Zweifelia: **no nodes matched**.
