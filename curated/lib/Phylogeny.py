"""
A Phylogeny wraps a DendroPy tree, converting it into a Newick representation as well as a series of CDAO_NODE objects
in JSON-LD.
"""

from lib import owlterms
from lib.TaxonomicUnit import TaxonomicUnit

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"


class Phylogeny:
    """
    A Phylogeny consists of a series of nodes representing a phylogeny. We also export it in Newick format.
    """

    def __init__(self, phylogeny_id, dendropy_tree, labeled_data):
        """ Create a Phylogeny using a DendroPy tree object and the labeled data to be associated with it.
        """

        self.id = phylogeny_id

        # Labeled node data.
        self.labeled_data = labeled_data

        # Other variables.
        self.annotations = []

        # Tree
        self.dendropy_tree = dendropy_tree

        # Node count management
        self.node_count = 0
        self.nodes_by_id = dict()
        self.nodes = self.read_tree_to_nodes(dendropy_tree)

    def get_id_for_node(self, node):
        """ Node identifiers need to be consistent, but we don't want to create
        individual node objects to track them. Instead, we assign unique identifiers
        to each DendroPy node and keep them here, so that we always return the same
        identifier for the same node.
        """

        if node in self.nodes_by_id:
            return self.nodes_by_id[node]
        else:
            self.nodes_by_id[node] = '{0}_node{1}'.format(self.id, self.node_count)
            self.node_count += 1
            return self.nodes_by_id[node]

    def read_tree_to_nodes(self, tree):
        """ Reads nodes from a DendroPy tree and stores them in this Phylogeny. """

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
            """ Recursively adds a node and all of its children to the current Phylogeny. """

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

            # Identify all distinct taxon associated with this Node
            # and store it in the 'taxa' JSON property.
            tunits = []

            for node_label in node_labels:
                tunits.append(TaxonomicUnit.from_scientific_name(node_label.label))

                if node_label.annotations:
                    close_matches = node_label.annotations.findall(name='closeMatch')
                    tunits.extend(map(
                        lambda n: TaxonomicUnit.from_scientific_name(n),
                        [closeMatch.value for closeMatch in close_matches])
                    )

            node_dict['taxa'] = [tunit.as_jsonld() for tunit in tunits]

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

    def export_to_jsonld_document(self):
        """ Export this phylogeny as a JSON-LD document. """

        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = owlterms.PHYLOREFERENCE_PHYLOGENY

        # Export dendropy_tree in Newick.
        doc['newick'] = self.dendropy_tree.as_string(schema='newick')

        # Export each node as part of each phylogeny.
        doc['nodes'] = self.nodes

        doc['annotations'] = self.annotations

        return doc
