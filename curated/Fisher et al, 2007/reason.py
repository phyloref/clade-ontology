#!/usr/bin/python

import owlready2

owlready2.onto_path.append("C:/Users/Gaurav/code/phyloref/curation-workflow/phylorefs/Fisher et al, 2007")

# onto = owlready2.get_ontology("file:///Users/Gaurav/code/phyloref/curation-workflow/phylorefs/Fisher et al, 2007/fisher_tweaked.owl")
onto = owlready2.get_ontology("file://./fisher_tweaked.owl")
onto.load(format="rdfxml")

# Speak CDAO
obo = owlready2.get_ontology("http://purl.obolibrary.org/obo/cdao.owl").load()
cdao = obo.get_namespace("http://purl.obolibrary.org/obo/")
class_Node = cdao.CDAO_0000140

# Find me all nodes and all classes they belong to.
nodes = onto.search(is_a = class_Node)

for node in nodes:
    print(" - " + str(node) + ": " + str(node.is_a))

with onto:
    owlready2.sync_reasoner()

nodes = onto.search(is_a = class_Node)
for node in nodes:
    print(" - " + str(node) + ": " + str(node.is_a))


onto.save("reasoned.nt", format="ntriples")
