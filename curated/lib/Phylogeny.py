import os.path
import re

import dendropy

from lib import owlterms
from lib.Phyloreference import TestPhyloreference
import PhyloreferenceTestSuite


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
                phylogeny.phylorefs.append(TestPhyloreference.load_from_json(phyloref_id, phyloref))

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
            raise PhyloreferenceTestSuite.TestException("ERROR in phylogeny {0}: tree file '{1}' could not be loaded!".format(self.id, filename))

        # Load the tree file.
        try:
            return dendropy.TreeList.get(path=filename, schema='nexml')
        except dendropy.utility.error.DataParseError as err:
            raise PhyloreferenceTestSuite.TestException("Could not parse NeXML in phylogeny {0}: {1}".format(self.id, err))

    def load_phylogeny_from_newick(self, newick):
        try:
            return dendropy.TreeList.get(data=newick, schema='newick')
        except dendropy.utility.error.DataParseError as err:
            raise PhyloreferenceTestSuite.TestException("Could not parse Newick while reading phylogeny {0}: {1}".format(self.id, err))

    def process_labeled_node_data(self, nodeData):
        labeled_node_data = dict()

        for nodeEntry in nodeData:
            if 'label' not in nodeEntry:
                continue

            labels = nodeEntry['label']
            if isinstance(labels, (type(""), type(u""))):
                labels = [labels]

            for label in labels:
                if label in labeled_node_data:
                    raise PhyloreferenceTestSuite.TestException("Label '{0}' duplicated in labeled node data in phylogeny {1}.".format(label, self.id))

                labeled_node_data[label] = nodeEntry

        return labeled_node_data
