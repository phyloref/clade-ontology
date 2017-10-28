#!/usr/bin/env python

"""
TestCase.py: A test case represents a single JSON file, containing multiple phylogenies and phyloreferences.
"""

import argparse
import dendropy
import json
import os.path
import re
import sys
import owlterms

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"

class PhyloreferenceTestSuite:
    """
    A test case can loaded from JSON and exported to JSON-LD. It is designed to model
    one publication, but will likely be extended to other sources of phylogenies and
    phyloreferences.
    """

    class TestException(Exception):
        pass

    @staticmethod
    def append_extend_or_ignore(property, dict, key):
        """
        Many values may be stored in JSON as either a list or a single element.
        This method differentiates between those, and either extends the current
        value with all elements from that list, or appends the single element.
        """
        if key not in dict:
            return

        if isinstance(dict[key], list):
            property.extend(dict[key])
        else:
            property.append(dict[key])

    def __init__(self, id):
        """ Create a test case for a given identifier. """
        self.id = id

        # Make sure the identifier ends with '#' or '/'
        if self.id[-1] != '#' and self.id[-1] != '/':
            self.id.append('#')

        # Set up other properties
        self.type = [owlterms.PHYLOREFERENCE_TEST_CASE, owlterms.OWL_ONTOLOGY]
        self.owl_imports = [
            "https://www.w3.org/2004/02/skos/core",
            "https://raw.githubusercontent.com/phyloref/curation-workflow/refactor_add_labels/curated/phyloref_testcase.owl",
                # Will become "http://vocab.phyloref.org/phyloref/testcase.owl",
            "http://raw.githubusercontent.com/hlapp/phyloref/master/phyloref.owl"
                # Will become "http://phyloinformatics.net/phyloref.owl"
        ]

        # Metadata
        self.citation = []
        self.url = []
        self.year = []
        self.curator = []
        self.comments = []

        # Made up of
        self.phylogenies = []
        self.phylorefs = []

    @staticmethod
    def load_from_document(doc):
        if '@id' not in doc:
            raise PhyloreferenceTestSuite.TestException("Document does not contain required key '@id'")

        testSuite = PhyloreferenceTestSuite(doc['@id'])

        # Load document-level properties
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.type, doc, '@type')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.owl_imports, doc, 'owl:imports')

        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.citation, doc, 'citation')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.url, doc, 'url')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.year, doc, 'year')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.curator, doc, 'curator')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.comments, doc, 'comments')

        # Load all test phylogenies
        if 'phylogenies' in doc:
            phylogeny_count = 0
            for phylogeny in doc['phylogenies']:
                phylogeny_count += 1
                phylogeny_id = testSuite.id + 'phylogeny' + str(phylogeny_count)
                testSuite.phylogenies.append(TestPhylogeny.load_from_json(phylogeny_id, phylogeny))

        return testSuite

    def export_to_jsonld_document(self):
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = self.type
        doc['owl:imports'] = self.owl_imports

        def export_unless_blank(prop, var):
            if len(var) == 1:
                doc[prop] = var[0]
            elif len(var) > 1:
                doc[prop] = var

        export_unless_blank('citation', self.citation)
        export_unless_blank('url', self.url)
        export_unless_blank('year', self.year)
        export_unless_blank('curator', self.curator)
        export_unless_blank('comments', self.comments)

        if len(self.phylogenies) > 0:
            doc['phylogenies'] = []

            for phylogeny in self.phylogenies:
                doc['phylogenies'].append(phylogeny.export_to_jsonld_document())

        return doc

class TestPhyloref:
    def __init__(self, id):
        self.id = id

        self.label = ""
        self.description = ""

        # Additional classes
        self.count_additional_classes = 0
        self.additional_classes = []

        # Store specifiers
        self.count_specifiers = 0
        self.internal_specifiers = []
        self.external_specifiers = []

    def get_class_expression_for_internal_specifier(self, specifier):
        if specifier is None:
            return None

        return {
            "@type": owlterms.OWL_RESTRICTION,
                "unionOf": [
                    specifier,
                    {
                        "@type": owlterms.OWL_RESTRICTION,
                        "onProperty": owlterms.CDAO_HAS_DESCENDANT,
                        "someValuesFrom": specifier
                    }
                ]
        }

    def get_class_expression_for_external_specifier(self, specifier):
        if specifier is None:
            return None

        return {
            "@type": owlterms.OWL_RESTRICTION,
            "onProperty": owlterms.PHYLOREF_HAS_SIBLING,
            "someValuesFrom": {
                "@type": owlterms.OWL_CLASS,
                "unionOf": [
                    self.get_class_expression_for_internal_specifier(specifier)
                ]
            }
        }

    def get_class_expression_for_mrca(self, class1, class2):
        mrca_as_owl = {
            "@type": "owl:Class",
                "unionOf": [
                    # What if the correct answer *is* specifier1 or
                    # specifier2, such as if specifier2 is a direct
                    # descendant of specifier1? We encode that here.
                    {
                        "@type": "owl:Class",
                        "intersectionOf": [
                            class1,
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000174",
                                # has_Descendant
                                "someValuesFrom": [class2]
                            }
                        ]
                    },
                    {
                        "@type": "owl:Class",
                        "intersectionOf": [
                            class2,
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000174",
                                # has_Descendant
                                "someValuesFrom": [class1]
                            }
                        ]
                    },

                    # Standard mrca formula
                    {
                        "@type": "owl:Class",
                        "intersectionOf": [
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000149",
                                "someValuesFrom": {
                                    "@type": "owl:Class",
                                    "intersectionOf": [
                                        self.get_class_expression_for_internal_specifier(class1),
                                        self.get_class_expression_for_external_specifier(class2)
                                    ]
                                }
                            },
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000149",
                                "someValuesFrom": {
                                    "@type": "owl:Class",
                                    "intersectionOf": [
                                        self.get_class_expression_for_internal_specifier(class2),
                                        self.get_class_expression_for_external_specifier(class1)
                                    ]
                                }
                            }
                        ]}
                ]
        }

        # This is fine, in terms of complexity, but if you start
        # using mrca on itself, the expression grows exponentially.
        # So, instead of returning this class expression, let's
        # safe it as its own class and return just that name.

        additional_class_id = '{0}_additional{1}'.format(self.id, self.count_additional_classes)
        self.count_additional_classes += 1

        self.additional_classes.append({
            '@id': additional_class_id,
            '@type': 'owl:Class',
            'equivalentClass': mrca_as_owl
        })

        return {
            '@id': additional_class_id
        }

    def export_to_jsonld_document(self):
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = [owlterms.PHYLOREFERENCE, owlterms.OWL_CLASS]
        doc['label'] = self.label
        doc['description'] = self.description

        # Write out all specifiers.
        doc['hasInternalSpecifier'] = [specifier.export_to_jsonld_document() for specifier in self.internal_specifiers]
        doc['hasExternalSpecifier'] = [specifier.export_to_jsonld_document() for specifier in self.external_specifiers]

        # Write out all additional classes.
        doc['hasAdditionalClass'] = self.additional_classes

        # What type of phyloreference is this?
        # Check for malformed specifiers.
        if len(self.external_specifiers) == 0 and len(self.internal_specifiers) == 0:
            doc['malformedPhyloreference'] = "No specifiers providers"
            doc['equivalentClass'] = {
                "@type": owlterms.CDAO_NODE
            }
            doc['manchesterSyntax'] = "Node"

        elif len(self.internal_specifiers) == 0:
            doc['malformedPhyloreference'] = "No internal specifiers provided"

        elif len(self.external_specifiers) > 1:
            doc['malformedPhyloreference'] = "More than one external specifier provided"

        elif len(self.external_specifiers) == 0 and len(self.internal_specifiers) == 1:
            doc['malformedPhyloreference'] = "Single internal specifier provided"

        elif len(self.external_specifiers) == 0:
            # This phyloreference is made up entirely of internal specifiers.
            # Calculate in a pairwise fashion.
            #
            # (has_Child some (internal(<node 1>) and external(<node 2>)) and
            #       has_Child some (internal(<node 2>) and external (<node 1>))
            #

            accum_equivalentClass = self.get_class_expression_for_mrca(
                self.internal_specifiers[0].get_reference(),
                self.internal_specifiers[1].get_reference()
            )

            last_internal_specifier = self.internal_specifiers[1]
            for i in range(2, len(self.internal_specifiers)):
                accum_equivalentClass = self.get_class_expression_for_mrca(
                    accum_equivalentClass,
                    self.internal_specifiers[i].get_reference()
                )
                last_internal_specifier = self.internal_specifiers[i]

            doc['equivalentClass'] = accum_equivalentClass

        else:
            # This phyloreference is made up of one external specifier and
            # some number of internal specifiers.

            specifiers_repr = []
            for internal_specifier in self.internal_specifiers:
                specifiers_repr.append(self.get_class_expression_for_internal_specifier(internal_specifier.get_reference()))

            for external_specifier in self.external_specifiers:
                specifiers_repr.append(self.get_class_expression_for_external_specifier(external_specifier.get_reference()))

            # Filter out Nones
            specifiers_repr = [x for x in specifiers_repr if x is not None]

            if len(specifiers_repr) > 0:
                # We have specifiers! Make this into a phyloreference.
                doc['equivalentClass'] = {
                    '@type': 'owl:Class',
                    'intersectionOf': specifiers_repr
                }

        return doc

    @staticmethod
    def load_from_json(phyloref_id, json):
        phyloref = TestPhyloref(phyloref_id)

        if 'label' in json:
            phyloref.label = json['label']

        if 'description' in json:
            phyloref.description = json['description']

        if 'internalSpecifiers' in json:
            for specifier in json['internalSpecifiers']:
                phyloref.count_specifiers += 1
                specifier_id = '{0}_specifier{1}'.format(phyloref_id, phyloref.count_specifiers)
                phyloref.internal_specifiers.append(TestSpecifier(specifier_id, owlterms.INTERNAL_SPECIFIER, specifier))

        if 'externalSpecifiers' in json:
            for specifier in json['externalSpecifiers']:
                phyloref.count_specifiers += 1
                specifier_id = '{0}_specifier{1}'.format(phyloref_id, phyloref.count_specifiers)
                phyloref.external_specifiers.append(TestSpecifier(specifier_id, owlterms.EXTERNAL_SPECIFIER, specifier))

        return phyloref


class TestSpecifier:
    def __init__(self, id, type, matchOn):
        self.id = id
        self.type = [owlterms.OWL_CLASS, type]

        self.matchOn = matchOn

    def get_reference(self):
        return {
            '@id': self.id
        }

    def export_to_jsonld_document(self):
        specifier_exprs = list()

        for key in self.matchOn:
            if key == 'dc:description':
                continue

            # TODO: add support for fields containing other fields

            specifier_exprs.append({
                "@type": "owl:Class",
                "intersectionOf": [
                    {"@id": owlterms.CDAO_NODE},  # Node and
                    {"@type": owlterms.OWL_RESTRICTION,  # <key> <value>
                     "onProperty": key,
                     "hasValue": self.matchOn[key]
                     }
                ]
            })

        return {
            "@id": self.id,
            "@type": self.type,
            "unionOf": specifier_exprs
        }

class TestPhylogeny:
    def __init__(self, id):
        self.id = id

        # Storage for trees
        self.trees = []
        self.nodes = []
        self.annotations = []
        self.phylorefs = []

        # Temporary storage
        self.node_count = 0
        self.nodes_by_id = dict()

    # Store identifiers for each node object
    def get_id_for_node(self, tree_id, node):
        if node in self.nodes_by_id:
            return self.nodes_by_id[node]
        else:
            self.nodes_by_id[node] = '{0}_node{1}'.format(tree_id, self.node_count)
            self.node_count += 1
            return self.nodes_by_id[node]

    def export_to_jsonld_document(self):
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = owlterms.PHYLOREFERENCE_TEST_PHYLOGENY

        # Export each tree in Newick.
        if len(self.trees) == 1:
            doc['newick'] = self.trees[0].as_string(schema='newick')
        elif len(self.trees) > 1:
            doc['newick'] = [tree.as_string(schema='newick') for tree in self.trees]

        # Export each node.
        doc['nodes'] = [node for node in self.nodes]

        # Export all phylorefs
        if len(self.phylorefs) > 0:
            doc['phylorefs'] = []

            for phyloref in self.phylorefs:
                doc['phylorefs'].append(phyloref.export_to_jsonld_document())

        return doc

    @staticmethod
    def load_from_json(phylogeny_id, json):
        phylogeny = TestPhylogeny(phylogeny_id)

        # A phylogeny is made of three components:
        #   - labeledNodeData: information provided for nodes in the phylogeny
        #   - phylogeny: either as a Newick or NeXML file
        #   - phylorefs: a list of phyloreferences

        # Step 1. Extract all labeled node data.
        labeled_node_data = dict()
        if 'labeledNodeData' in json:
            labeled_node_data = phylogeny.process_labeled_node_data(json['labeledNodeData'])

        # Step 2. Read phylogenies using DendroPy.
        if 'filename' in json:
            phylogeny.trees = phylogeny.load_phylogeny_from_nexml(json['filename'])
        elif 'newick' in json:
            phylogeny.trees = phylogeny.load_phylogeny_from_newick(json['newick'])
        else:
            # Maybe we should warn someone?
            pass

        # Step 3. Convert phylogenies into nodes.
        tree_count = 0
        for tree in phylogeny.trees:
            tree_count += 1
            tree_id = phylogeny.id + "_tree" + str(tree_count)

            phylogeny.nodes.extend(phylogeny.convert_tree_to_nodes(tree_id, tree, labeled_node_data))

        # Step 4. Convert phylorefs into class expressions.
        if 'phylorefs' in json:
            phyloref_count = 0
            for phyloref in json['phylorefs']:
                phyloref_count += 1
                phyloref_id = phylogeny.id + '_phyloref' + str(phyloref_count)
                phylogeny.phylorefs.append(TestPhyloref.load_from_json(phyloref_id, phyloref))

        return phylogeny

    def convert_tree_to_nodes(self, tree_id, tree, labeled_data):
        nodes = []

        # Copy over any annotations from NeXML
        for annotation in tree.annotations:
            self.annotations.append({
                '@type': "Annotation",
                'annotationName': annotation.name,
                'annotationTarget': tree_id,
                'annotationBody': str(annotation.value)
            })

        def add_all_child_nodes(node):
            # print("add_all_child_nodes(" + str(node) + ")")

            # Create the node.
            node_dict = dict()
            node_dict['@id'] = self.get_id_for_node(tree_id, node)
            node_dict['inPhylogeny'] = tree_id

            node_dict['@type'] = owlterms.CDAO_NODE,

            annotations = list()
            for annotation in node.annotations:
                self.annotations.append({
                    '@type': "Annotation",
                    'annotationName': annotation.name,
                    'annotationTarget': self.get_id_for_node(tree_id, node),
                    'annotationBody': str(annotation.value)
                })

            # Do we have any taxonomic names?
            node_labels = list()
            if node.taxon is not None:
                node_labels.append(node.taxon)
            elif node.label is not None:
                node_labels.append(node)

            for node_label in node_labels:
                node_dict['submittedName'] = node_label.label

                matched_names = list()

                # Is this a uninomial name?
                match = re.search('^(\w+)$', node_label.label)
                if match:
                    node_dict['matchedName'] = match.group(1)

                # Is this a binomial name?
                match = re.search('^(\w+) ([\w\-]+)\\b', node_label.label)
                if match:
                    node_dict['matchedName'] = match.group(1) + " " + match.group(2)

                if node_label.annotations:
                    closeMatches = node_label.annotations.findall(name='closeMatch')
                    node_dict['skos:closeMatch'] = [closeMatch.value for closeMatch in closeMatches]

                # Do we have any labeled data for this label?
                if node_label.label in labeled_data:
                    nodeData = labeled_data[node_label.label]

                    for key in nodeData:
                        if key in node_dict:
                            if type(node_dict[key]) is not list:
                                node_dict[key] = [node_dict[key], nodeData[key]]

                            node_dict[key].append(nodeData[key])

                            # hackity hack hack
                            # TODO: cleanup
                            # remove duplicates
                            node_dict[key] = list(set(node_dict[key]))

                        else:
                            node_dict[key] = nodeData[key]

            node_dict['children'] = list()
            for child in node.child_nodes():
                node_dict['children'].append(self.get_id_for_node(tree_id, child))

            node_dict['siblings'] = list()
            for sibling in node.sibling_nodes():
                node_dict['siblings'].append(self.get_id_for_node(tree_id, sibling))

            # Add to the list of nodes
            nodes.append(node_dict)

            # print("Appended node " + str(node_dict) + " to nodes " + str(nodes))

            # Add all its children.
            for child in node.child_nodes():
                add_all_child_nodes(child)

        add_all_child_nodes(tree.seed_node)

        # print("Nodes: " + str(nodes))

        return nodes

    def load_phylogeny_from_nexml(self, filename):
        if not os.path.exists(filename):
            raise PhyloreferenceTestSuite.TestException("ERROR in phylogeny {0}: tree file '{1}' could not be loaded!\n".format(self.id, filename))

        # Load the tree file.
        try:
            return dendropy.TreeList.get(path=filename, schema='nexml')
        except dendropy.utility.error.DataParseError as err:
            raise PhyloreferenceTestSuite.TestException("Error in phylogeny {0}: could not parse input!\n{1}\n".format(self.id, err))

    def load_phylogeny_from_newick(self, newick):
        try:
            return dendropy.TreeList.get(data=newick, schema='newick')
        except dendropy.utility.error.DataParseError as err:
            raise PhyloreferenceTestSuite.TestException("Error in reading phylogeny {0}: could not parse input!\n{1}\n".format(self.id, err))

    def process_labeled_node_data(self, nodeData):
        labeled_node_data = dict()

        for nodeEntry in nodeData:
            if 'label' not in nodeEntry:
                continue

            labels = nodeEntry['label']
            if isinstance(labels, str) or isinstance(labels, type("")):
                labels = [labels]

            for label in labels:
                if label in labeled_node_data:
                    raise PhyloreferenceTestSuite.TestException("Duplicate label in labeled node data in phylogeny " + self.id + ": " + label + ".\n")

                labeled_node_data[label] = nodeEntry

        return labeled_node_data
