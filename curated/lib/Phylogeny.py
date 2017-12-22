"""
A Phylogeny wraps a DendroPy tree, converting it into a Newick representation as well as a series of CDAO_NODE objects
in JSON-LD.
"""

from lib import owlterms
from lib.TaxonomicUnit import TaxonomicUnit
from lib.Identified import Identified


class Phylogeny(object):
    """
    A Phylogeny consists of a series of nodes representing a phylogeny. It can be loaded from any
    valid DendroPy tree, and can optionally contain additional information associated with each
    labeled node on the phylogeny.
    """

    def __init__(self, phylogeny_id, dendropy_tree, additional_node_properties):
        """ Create a Phylogeny using a DendroPy tree object and the labeled data to be associated with it.
        """

        self.id = phylogeny_id

        # Labeled node data.
        self.additional_node_properties = additional_node_properties

        # Other variables.
        self.annotations = []

        # Tree
        self.dendropy_tree = dendropy_tree

        # Node count management
        self.node_count = 0
        self.nodes_by_id = dict()
        self.tunits_by_node = dict()
        self.phylogeny_nodes = []
        self.read_tree_to_nodes(dendropy_tree)

    @property
    def nodes(self):
        """ Returns a list of Node objects associated with this Phylogeny. """
        return self.phylogeny_nodes

    @property
    def taxonomic_units(self):
        """ Returns a list of Taxonomic Units associated with nodes in this Phylogeny. """
        tunits = set()

        for tunit_sets in self.tunits_by_node.values():
            tunits.update(tunit_sets)

        return tunits

    def get_id_for_node(self, dendropy_node):
        """ We need to maintain links between DendroPy nodes and our Node objects, so that
        we can determine which node is child to and sibling to other nodes. Given a DendroPy
        node, this function will consistently return the same identifier for that node.
        """

        if dendropy_node in self.nodes_by_id:
            return self.nodes_by_id[dendropy_node]
        else:
            self.nodes_by_id[dendropy_node] = '{0}_node{1}'.format(self.id, self.node_count)
            self.node_count += 1
            return self.nodes_by_id[dendropy_node]

    def read_tree_to_nodes(self, tree):
        """ Reads nodes from a DendroPy tree and stores them in this Phylogeny. """

        # Copy over any annotations from NeXML
        for annotation in tree.annotations:
            self.annotations.append({
                '@type': owlterms.OA_ANNOTATION,
                'annotationName': annotation.name,
                'annotationTarget': self.id,
                'annotationBody': str(annotation.value)
            })

        def add_all_child_nodes(dendropy_node):
            """ Recursively adds a DendroPy node and all of its children to the current Phylogeny. """

            # Create the node.
            node = Node()
            node.id = self.get_id_for_node(dendropy_node)
            node.in_phylogeny = self.id

            annotations = list()
            for annotation in dendropy_node.annotations:
                self.annotations.append({
                    '@type': owlterms.OA_ANNOTATION,
                    'annotationName': annotation.name,
                    'annotationTarget': self.get_id_for_node(node),
                    'annotationBody': str(annotation.value)
                })

            # Do we have any taxonomic names?
            node_labels = list()
            if dendropy_node.taxon is not None:
                node_labels.append(dendropy_node.taxon)
            elif dendropy_node.label is not None:
                node_labels.append(dendropy_node)

            # Identify all distinct taxon associated with this Node
            # and store it in the 'taxa' JSON property.
            tunits = []

            node_label_strs = []
            tunit_count = 1

            # Collect all the node labels.
            for node_label in node_labels:
                # Consider the label itself.
                node_label_strs.append(node_label.label)

                # TODO clean up
                if node_label.label in self.additional_node_properties:
                    node.additional_properties = self.additional_node_properties[node_label.label]

                    # Does the additional_node_properties have an 'additional_labels' property?
                    if 'additional_labels' in node.additional_properties:
                        node_label_strs.extend(node.additional_properties['additional_labels'])

                if node_label.annotations:
                    for closeMatch in node_label.annotations.findall(name='closeMatch'):
                        node_label_strs.append(closeMatch.value)

            # Create taxonomic units for all the node labels.
            for node_label_str in node_label_strs:
                # TODO clean up
                if node_label_str.startswith("expected "):
                    node.expected_phyloref_named = node_label_str[9:]
                    node_label_str = node_label_str[9:]

                tunit = TaxonomicUnit.from_scientific_name(node_label_str)
                tunit.id = self.get_id_for_node(dendropy_node) + ("_tunit%d" % tunit_count)
                tunits.append(tunit)
                tunit_count += 1

                # TODO: check node.additional_properties and see if the user has provided
                # specimen or scientific name information.

            node.taxonomic_units.extend(tunits)
            if dendropy_node not in self.tunits_by_node:
                self.tunits_by_node[dendropy_node] = set()

            self.tunits_by_node[dendropy_node].update(tunits)

            node.children = list()
            for child in dendropy_node.child_nodes():
                node.children.append(self.get_id_for_node(child))

            node.siblings = list()
            for sibling in dendropy_node.sibling_nodes():
                node.siblings.append(self.get_id_for_node(sibling))

            # Add to the list of nodes
            self.phylogeny_nodes.append(node)

            # print("Appended node " + str(node_dict) + " to nodes " + str(nodes))

            # Add all its children.
            for child in dendropy_node.child_nodes():
                add_all_child_nodes(child)

        add_all_child_nodes(tree.seed_node)

    def export_to_jsonld_document(self):
        """ Export this phylogeny as a JSON-LD document. """

        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = owlterms.PHYLOREFERENCE_PHYLOGENY

        # Export dendropy_tree in Newick.
        doc['newick'] = self.dendropy_tree.as_string(schema='newick')

        # Export each node as part of each phylogeny.
        doc['nodes'] = [node.as_jsonld() for node in self.phylogeny_nodes]

        doc['annotations'] = self.annotations

        return doc


class Node(Identified):
    """ A node is a node in a phylogeny. """

    def __init__(self):
        super(Node, self).__init__()

        self.in_phylogeny = None
        self.taxonomic_units = []
        self.children = []
        self.siblings = []
        self.expected_phyloref_named = None
        self.additional_properties = {}

    def as_jsonld(self):
        types = set()
        types.add(owlterms.CDAO_NODE)

        #for tunit in self.taxonomic_units:
        #    types.add(tunit.id)

        jsonld = {
            '@id': self.id,
            '@type': list(types),
            'represents_taxonomic_units': [tunit.as_jsonld() for tunit in self.taxonomic_units],
            'children': self.children,
            'siblings': self.siblings
        }

        if self.in_phylogeny is not None:
            jsonld['inPhylogeny'] = self.in_phylogeny

        if self.expected_phyloref_named is not None:
            jsonld['expected_phyloreference_named'] = self.expected_phyloref_named

        # Add additional properties
        for key in self.additional_properties:
            jsonld[key] = self.additional_properties[key]

        return jsonld
