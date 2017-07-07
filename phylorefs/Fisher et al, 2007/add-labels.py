#!/usr/bin/env python

"""add-labels.py: Adds NeXML file containing OTUs to a paper.json file as Newick and as OTUs."""

import argparse
import dendropy
import json
import os.path
import pystache
import re
import sys
import uuid

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"

# Global variables
FLAG_VERBOSE = False

# Step 1. Parse command line arguments
input_file = sys.stdin
output_file = sys.stdout

cmdline_parser = argparse.ArgumentParser(
    description="Add trees and labels from NeXML file into an existing paper.json file."
)
cmdline_parser.add_argument(
    'input', metavar='paper.json', type=str, nargs='?',
    help='paper.json file to add data into'
)
cmdline_parser.add_argument(
    '-o', dest='output', metavar='output.json', type=str,
    help='Ontology file to output'
)
cmdline_parser.add_argument(
    '-v', '--version',
    action='version', version='%(prog)s ' + __version__
)
cmdline_parser.add_argument(
    '--verbose', 
    dest='flag_verbose', default=False, action='store_true', 
    help='Display debugging information'
)
args = cmdline_parser.parse_args()

# Set up FLAG_VERBOSE.
FLAG_VERBOSE = args.flag_verbose

# Step 2. Set up input and output streams.
# Try opening the input file.
if args.input:
    input_file = open(args.input, 'r')

# Figure out where the output should go, as well as the output name.
if args.output:
    output_file = open(args.output, 'w')

if FLAG_VERBOSE:
    sys.stderr.write("Input file: {0}\n".format(input_file))
    sys.stderr.write("Output file: {0}\n".format(output_file))

# Step 2. Read the JSON file.
paper = json.load(input_file);

if FLAG_VERBOSE:
    sys.stderr.write("Loaded input file, id: {0}\n".format(paper['@id']))

# Make this .json file into an ontology!
paper['@type'] = [paper['@type'], 'owl:Ontology']

# To be an ontology, it needs to import a bunch of ontologies.
paper['owl:imports'] = [
    "https://www.w3.org/2004/02/skos/core",
    "http://phylotastic.org/terms/tnrs.rdf",
    "http://phyloinformatics.net/phyloref.owl"
]

# Iterate over each inputFile.
# Note that we add elements directly to 'paper' as necessary.
for inputFile in paper['inputFiles']:

    # Where is the tree located?
    treelist = list()

    # If we have a 'filename' tag, then it's a NeXML file.
    if 'filename' in inputFile:
        filename = inputFile['filename']

        if FLAG_VERBOSE:
            sys.stderr.write("Processing input file {0}\n".format(inputFile['filename']))

        if 'phylogenies' in inputFile:
            if FLAG_VERBOSE:
                sys.stderr.write("Skipping file; phylogenies already loaded.\n")

            continue

        if not os.path.exists(filename):
            sys.stderr.write("ERROR: tree file '{0}' could not be loaded!\n".format(filename))

        # Load the tree file.
        try:
            treelist = dendropy.TreeList.get(path=filename, schema='nexml')
        except dendropy.utility.error.DataParseError as err:
            sys.stderr.write("Error: could not parse input!\n{0}\n".format(err))
            continue

        if len(treelist) == 0:
            continue

    elif 'newick' in inputFile:
        try:
            treelist = dendropy.TreeList.get(data=inputFile['newick'], schema='newick')
        except dendropy.utility.error.DataParseError as err:
            sys.stderr.write("Error: could not parse input!\n{0}\n".format(err))
            continue

    else:
        sys.stderr.write("WARNING: input file '{0}' does not contain a phylogeny.".format(inputFile))
        continue

    inputFile['phylogenies'] = list()
    phylogenies = inputFile['phylogenies']

    for tree in treelist: 
        phylogeny = dict()

        phylogeny_id = tree.annotations.get_value('isDefinedBy')
        if phylogeny_id is None:
            # TODO: come up with a proper phylogeny ID if we don't already have one.
            phylogeny_id = "http://phyloref.org/example/" + str(uuid.uuid4())
        
        phylogeny['@id'] = phylogeny_id

        phylogeny['annotations'] = list()
        for annotation in tree.annotations:
            phylogeny['annotations'].append({
                '@type': "Annotation",
                'annotationName': annotation.name,
                'annotationTarget': phylogeny_id,
                'annotationBody': str(annotation.value)
            })

        phylogeny['newick'] = tree.as_string('newick').strip()

        node_index = 1
        nodes_by_id = dict()
        def get_id_for_node(node):
            global nodes_by_id
            global node_index
            
            if node in nodes_by_id:
                return nodes_by_id[node]
            else:
                nodes_by_id[node] = phylogeny_id + '#Node_{0}'.format(node_index)
                node_index += 1
                return nodes_by_id[node]

        def add_all_child_nodes(node, add_to):
            # Create the node.
            node_dict = dict()
            node_dict['@id'] = get_id_for_node(node)

            node_dict['@type'] = ['obo:CDAO_0000140', 'owl:Thing'],
            annotations = list()
            for annotation in node.annotations:
                annotations.append({
                    '@type': "Annotation",
                    'annotationName': annotation.name,
                    'annotationTarget': get_id_for_node(node),
                    'annotationBody': str(annotation.value)
                })

            if len(annotations) > 0:
                node_dict['annotations'] = annotations

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

                # Extract all annotations
                #annotations = list()
                #for annotation in node.taxon.annotations:
                #    annotations.append({
                #        '@type': "Annotation",
                #        'annotationName': annotation.name,
                #        'annotationTarget': get_id_for_node(node),
                #        'annotationBody': str(annotation.value)
                #    })
                #
                #if len(annotations) > 0:
                #    node_dict['taxonAnnotations'] = annotations

            node_dict['children'] = list()
            for child in node.child_nodes():
                node_dict['children'].append(get_id_for_node(child))

            node_dict['siblings'] = list()
            for sibling in node.sibling_nodes():
                node_dict['siblings'].append(get_id_for_node(sibling))

            # Add the node.
            add_to.append(node_dict)

            # Add all its children.
            for child in node.child_nodes():
                add_all_child_nodes(child, add_to)

        phylogeny['nodes'] = list()
        add_all_child_nodes(tree.seed_node, phylogeny['nodes'])

        phylogenies.append(phylogeny)


    # Now translate all phylorefs into OWL classes.
    phyloref_count = 1
    for phyloref in inputFile['phylorefs']:
        internal_specifiers = phyloref['internalSpecifiers']
        external_specifiers = phyloref['externalSpecifiers']

        # Represent this phyloreference as an OWL class expression
        # in JSON-LD.

        def internal_specifier_to_OWL_repr(specifier):
            specifiers = list()
            for key in specifier:
                if key == 'dc:description':
                    continue

                specifiers.append({
                    "@type": "owl:Class",
                    "intersectionOf": [
                        { "@id": "obo:CDAO_0000140" },
                        { "@type": "owl:Restriction",
                          "onProperty": key,
                          "hasValue": specifier[key]
                        }
                    ]
                })

            return {
                "@type": "owl:Restriction",
                "onProperty": "obo:CDAO_0000174",
                "someValuesFrom": {
                    "@type": "owl:Class",
                    "unionOf": specifiers
                }
            }

        def external_specifier_to_OWL_repr(specifier):
            specifiers = list()
            for key in specifier:
                if key == 'dc:description':
                    continue

                specifiers.append({
                    "@type": "owl:Class",
                    "intersectionOf": [
                        { "@id": "obo:CDAO_0000140" },
                        { "@type": "owl:Restriction",
                          "onProperty": key,
                          "hasValue": specifier[key]
                        }
                    ]
                })

            return {
                "@type": "owl:Restriction",
                "onProperty": "phyloref:excludes_lineage_to",
                "someValuesFrom": {
                    "@type": "owl:Class",
                    "unionOf": specifiers
                }
            }

        specifiers_repr = list()
        for internal_specifier in internal_specifiers:
            specifiers_repr.append(internal_specifier_to_OWL_repr(internal_specifier))

        for external_specifier in external_specifiers:
            specifiers_repr.append(external_specifier_to_OWL_repr(external_specifier))

        if len(specifiers_repr) > 0:
            # We have specifiers! Make this into a phyloreference.
            phyloref['@id'] = phylogeny_id + "phyloref_" + str(phyloref_count)
            phyloref['@type'] = "owl:Class"
            phyloref['equivalentClass'] = {
                '@type': 'owl:Class',
                'intersectionOf': specifiers_repr
            }
            phyloref_count += 1

        # Let's write out a Manchester/Protege string too,
        # just for kicks.

        def internal_specifier_to_OWL_expression(specifier):
            specifiers = list()
            for key in specifier:
                if key == 'dc:description':
                    continue

                specifiers.append("{0} value \"{1}\"^^xsd:string".format(key, specifier[key]))

            return "(has_Descendant some (Node that " + " or ".join(specifiers) + "))"

        def external_specifier_to_OWL_expression(specifier):
            specifiers = list()
            for key in specifier:
                if key == 'dc:description':
                    continue

                specifiers.append("{0} value \"{1}\"^^xsd:string".format(key, specifier[key]))

            return "(excludes_lineage_to some (Node that " + " or ".join(specifiers) + "))"

        specifiers = [internal_specifier_to_OWL_expression(sp) for sp in internal_specifiers]
        specifiers.extend([external_specifier_to_OWL_expression(sp) for sp in external_specifiers])

        # Create a phyloref in this form:
        #   Node and ...
        phyloref['manchesterSyntax'] = "Node and (" + " and ".join(specifiers) + ")"

# Write the paper back out again.
json.dump(paper, output_file, indent=4, sort_keys=True)
