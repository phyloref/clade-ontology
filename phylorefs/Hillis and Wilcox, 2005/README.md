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

1. Amerana: no nodes matched; *Rana pretiosa* is an internal specifier but not present in this phylogeny.
2. Aquarana: matched node `file2_tree1_node17`, correct node.
3. Lacusirana: no nodes matched; *Rana megapoda* is an internal specifier but not present in this phylogeny.
4. Laurasiarana: matched node `file1_tree1_node1`, correct node for file, but not for figure in paper.
5. Levirana: matched node `file2_tree1_node111`, correct node.
6. Lithobates: matched node `file2_tree1_node112`, correct node.
7. Nenirana: matched node `file2_tree1_node49`, correct node.
8. Novirana: matched node `file2_tree1_node4`, correct node.
9. Pantherana: matched node `file2_tree1_node38`, correct node.
10. Ranula: matched node `file2_tree1_node36`, correct node.
11. Scurrilirana: matched node `file2_tree1_node50`, correct node.
12. Sierrana: matched node `file2_tree1_node16`, correct node.
13. Stertirana: matched node `file_2_tree1_node48`, correct node.
14. Torrentirana: matched node `file2_tree1_node37`, correct node.
15. Trypheropsis: matched node `file2_tree1_node114`, correct node.
16. Zweifelia: matched node `file2_tree1_node39`, correct node.
