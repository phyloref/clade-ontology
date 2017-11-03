import os.path
import re

import dendropy

from lib import owlterms
from lib.Phyloreference import TestPhyloreference
import PhyloreferenceTestSuite


class TestPhylogenyGroup:
    """
    DendroPy loads NeXML files as TreeLists that might contain multiple trees. We model them as a
    PhylogenyGroup that contains multiple Phylogenies.
    """

    def __init__(self, id):
        self.id = id

        # Storage for trees
        self.phylogenies = []
        self.phylorefs = []

    def export_to_jsonld_document(self):
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = owlterms.PHYLOREFERENCE_TEST_PHYLOGENY_GROUP

        doc['phylogenies'] = [phylogeny.export_to_jsonld_document() for phylogeny in self.phylogenies]

        # Export all phylorefs
        if len(self.phylorefs) > 0:
            doc['phylorefs'] = []

            for phyloref in self.phylorefs:
                doc['phylorefs'].append(phyloref.export_to_jsonld_document())

        return doc

    @staticmethod
    def load_from_json(phylogenies_id, json):
        phylogeny_group = TestPhylogenyGroup(phylogenies_id)

        # A phylogeny is made of three components:
        #   - labeledNodeData: information provided for nodes in the phylogeny
        #   - phylogeny: either as a Newick or NeXML file
        #   - phylorefs: a list of phyloreferences

        # Step 1. Extract all labeled node data.
        labeled_node_data = dict()
        if 'labeledNodeData' in json:
            labeled_node_data = phylogeny_group.process_labeled_node_data(json['labeledNodeData'])

        # Step 2. Read phylogenies using DendroPy.
        treeList = []
        if 'filename' in json:
            treeList = phylogeny_group.load_phylogeny_from_nexml(json['filename'])
        elif 'newick' in json:
            treeList = phylogeny_group.load_phylogeny_from_newick(json['newick'])

        # Step 3. Convert phylogenies into nodes.
        phylogeny_count = 0
        for tree in treeList:
            phylogeny_count += 1
            phylogeny_id = phylogeny_group.id + "_phylogeny" + str(phylogeny_count)

            phylogeny_group.phylogenies.append(TestPhylogeny(phylogeny_id, tree, labeled_node_data))

        # Step 4. Convert phylorefs into class expressions.
        if 'phylorefs' in json:
            phyloref_count = 0
            for phyloref in json['phylorefs']:
                phyloref_count += 1
                phyloref_id = phylogeny_group.id + '_phyloref' + str(phyloref_count)
                phylogeny_group.phylorefs.append(TestPhyloreference.load_from_json(phyloref_id, phyloref))

        return phylogeny_group

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

class TestPhylogeny:
    def __init__(self, id, tree, labeled_node_data):
        self.id = id

        # Other variables.
        self.annotations = []

        # Tree
        self.tree = tree

        # Node count management
        self.node_count = 0
        self.nodes_by_id = dict()
        self.nodes = self.convert_tree_to_nodes(tree, labeled_node_data)


    # Store identifiers for each node object
    def get_id_for_node(self, node):
        if node in self.nodes_by_id:
            return self.nodes_by_id[node]
        else:
            self.nodes_by_id[node] = '{0}_node{1}'.format(self.id, self.node_count)
            self.node_count += 1
            return self.nodes_by_id[node]

    def export_to_jsonld_document(self):
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = owlterms.PHYLOREFERENCE_TEST_PHYLOGENY

        # Export tree in Newick.
        doc['newick'] = self.tree.as_string(schema='newick')

        # Export each node as part of each phylogeny.
        doc['nodes'] = self.nodes

        doc['annotations'] = self.annotations

        return doc

    def convert_tree_to_nodes(self, tree, labeled_data):
        nodes = []

        # Copy over any annotations from NeXML
        for annotation in tree.annotations:
            self.annotations.append({
                '@type': "Annotation",
                'annotationName': annotation.name,
                'annotationTarget': self.id,
                'annotationBody': str(annotation.value)
            })

        def add_all_child_nodes(node):
            # print("add_all_child_nodes(" + str(node) + ")")

            # Create the node.
            node_dict = dict()
            node_dict['@id'] = self.get_id_for_node(node)
            node_dict['inPhylogeny'] = self.id

            node_dict['@type'] = owlterms.CDAO_NODE

            annotations = list()
            for annotation in node.annotations:
                self.annotations.append({
                    '@type': "Annotation",
                    'annotationName': annotation.name,
                    'annotationTarget': self.get_id_for_node(self.id, node),
                    'annotationBody': str(annotation.value)
                })

            # Do we have any taxonomic names?
            node_labels = list()
            if node.taxon is not None:
                node_labels.append(node.taxon)
            elif node.label is not None:
                node_labels.append(node)

            for node_label in node_labels:
                node_dict['submittedName'] = [node_label.label]

                # Is this a uninomial name?
                match = re.search('^(\w+)$', node_label.label)
                if match:
                    node_dict['matchedName'] = [match.group(1)]

                # Is this a binomial name?
                match = re.search('^(\w+) ([\w\-]+)\\b', node_label.label)
                if match:
                    node_dict['matchedName'] = [match.group(1) + " " + match.group(2)]

                if node_label.annotations:
                    closeMatches = node_label.annotations.findall(name='closeMatch')
                    node_dict['skos:closeMatch'] = [closeMatch.value for closeMatch in closeMatches]

                # Do we have any labeled data for this label?
                if node_label.label in labeled_data:
                    nodeData = labeled_data[node_label.label]

                    for key in nodeData:
                        if key in node_dict:
                            if isinstance(nodeData[key], list):
                                node_dict[key].extend(nodeData[key])
                            else:
                                node_dict[key].append(nodeData[key])

                            # hackity hack hack
                            # TODO: cleanup
                            # remove duplicates
                            try:
                                node_dict[key] = list(set(node_dict[key]))
                            except TypeError as e:
                                raise TypeError("Deduplication of nodeData failed on key '" + str(key) + "', value: " + str(node_dict[key]))

                        else:
                            node_dict[key] = [nodeData[key]]

            node_dict['children'] = list()
            for child in node.child_nodes():
                node_dict['children'].append(self.get_id_for_node(child))

            node_dict['siblings'] = list()
            for sibling in node.sibling_nodes():
                node_dict['siblings'].append(self.get_id_for_node(sibling))

            # Add to the list of nodes
            nodes.append(node_dict)

            # print("Appended node " + str(node_dict) + " to nodes " + str(nodes))

            # Add all its children.
            for child in node.child_nodes():
                add_all_child_nodes(child)

        add_all_child_nodes(tree.seed_node)

        # print("Nodes: " + str(nodes))

        return nodes


