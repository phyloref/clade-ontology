#!/usr/bin/env python

"""
add-labels.py: Converts a Phyloreference curated test file in JSON
into a JSON-LD file with node information. It carries out two conversions:

 1. Converts all phylogenies into a node-based representation in OWL,
    integrating any taxonomic unit-level information to the nodes.

 2. Converts all phyloreferences into an OWL-based representation
    containing specifiers that can match taxonomic units.
"""

import argparse
import dendropy
import json
import os.path
import re
import sys
from lib.PhyloreferenceTestSuite import PhyloreferenceTestSuite

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"

# Step 1. Parse command line arguments
def get_command_line_arguments():
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

    return cmdline_parser.parse_args()

args = get_command_line_arguments()

# Set up FLAG_VERBOSE.
FLAG_VERBOSE = args.flag_verbose

# Step 2. Set up input and output streams.
if args.input:
    input_file = open(args.input, 'r')

if args.output:
    output_file = open(args.output, 'w')
else:
    output_file = sys.stdout

if FLAG_VERBOSE:
    sys.stderr.write("Input file: {0}\n".format(input_file))
    sys.stderr.write("Output file: {0}\n".format(output_file))

# Step 3. Read the JSON file.
doc = json.load(input_file)

try:
    testCase = PhyloreferenceTestSuite.load_from_document(doc)
except PhyloreferenceTestSuite.TestException as e:
    sys.stderr.write("Could not read '" + input_file + "': " + e.message)
    exit(1)

if FLAG_VERBOSE:
    sys.stderr.write("Loaded test case, id: {0}\n".format(testCase.id))

# Write the paper back out again.
json.dump(testCase.export_to_jsonld_document(), output_file, indent=4, sort_keys=True)

##### EVERYTHING BELOW THIS LINE WILL BE MOVED ELSEWHERE

# tbd:nodes should be an object properties,
# so let's declare them as such.

# Iterate over each testCase.
# Note that we add elements directly to 'paper' as necessary.
count_testCase = 0
for testCase in paper['phylogenies']:
    count_testCase += 1
    if '@id' in testCase and testCase['@id'] != '':
        testCase_id = testCase['@id']
        if testCase_id[-1] != '#':
            testCase_id.append('#')
    else:
        testCase_id = '{0}file{1}'.format(paper_id, count_testCase)

    # Before we do anything else, we need to prepare labeled data so that
    # we can incorporate it into phylogeny.
    labeled_data = dict()
    if 'labeledNodeData' in testCase:
        for nodeData in testCase['labeledNodeData']:
            if 'label' not in nodeData:
                continue

            labels = nodeData['label']
            if isinstance(labels, str):
                labels = [labels]

            for label in labels:
                labeled_data[label] = nodeData

    # Where is the tree located?
    treelist = list()

    # If we have a 'filename' tag, then it's a NeXML file.
    if 'filename' in testCase:
        filename = testCase['filename']

        if FLAG_VERBOSE:
            sys.stderr.write("Processing input file {0}\n".format(testCase['filename']))

        if 'phylogenies' in testCase:
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

    elif 'newick' in testCase:
        try:
            treelist = dendropy.TreeList.get(data=testCase['newick'], schema='newick')
        except dendropy.utility.error.DataParseError as err:
            sys.stderr.write("Error: could not parse input!\n{0}\n".format(err))
            continue

    else:
        sys.stderr.write("WARNING: input file '{0}' does not contain a phylogeny.".format(testCase))
        continue

    testCase['phylogenies'] = list()
    phylogenies = testCase['phylogenies']

    count_tree = 0
    for tree in treelist: 
        count_tree += 1

        phylogeny = dict()
        phylogeny_id = '{0}_tree{1}'.format(testCase_id, count_tree)
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
                nodes_by_id[node] = '{0}_node{1}'.format(phylogeny_id, node_index)
                node_index += 1
                return nodes_by_id[node]

        def add_all_child_nodes(node, add_to, phylogeny_id):
            # Create the node.
            node_dict = dict()
            node_dict['@id'] = get_id_for_node(node)
            node_dict['inPhylogeny'] = phylogeny_id

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

                # Do we have any labeled data for this label?
                if node_label.label not in labeled_data:
                    if FLAG_VERBOSE:
                        sys.stderr.write("No labeled data available for label '{0}'.\n".format(
                            node_label.label
                        ))
                else:
                    nodeData = labeled_data[node_label.label]

                    for key in nodeData:
                        #if key == 'label':
                        #    continue

                        # Leave all variables as single elements if possible
                        # but if we see multiple values, turn it into a list 
                        # rather than overwriting the previous value.

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
                add_all_child_nodes(child, add_to, phylogeny_id)

        phylogeny['hasNode'] = list()
        add_all_child_nodes(tree.seed_node, phylogeny['hasNode'], phylogeny_id)

        phylogenies.append(phylogeny)


    # Now translate all phylorefs into OWL classes.
    phyloref_count = 1
    if 'phylorefs' in testCase:

        # Some phyloreferences need additional (ancillary?) OWL classes,
        # so store those here by ID.
        additional_classes = []
        count_additional_classes = 0

        for phyloref in testCase['phylorefs']:
            # Make this into an owl:Thing.
            phyloref_id = "{0}_phyloref{1}".format(phylogeny_id, phyloref_count)
            phyloref['@id'] = phyloref_id
            phyloref['@type'] = ["phyloref:Phyloreference", "owl:Class"],
            phyloref_count += 1

            # Sort out specifiers.
            internal_specifiers = phyloref['internalSpecifiers'] if 'internalSpecifiers' in phyloref else list()
            external_specifiers = phyloref['externalSpecifiers'] if 'externalSpecifiers' in phyloref else list()

            # Convert specifier into an OWL restriction.
            count_specifiers = 1
            def tunit_to_owl_class(tunit, phyloref, specifier_type):
                global count_specifiers

                specifiers = list()
                
                specifier_id = '{0}_specifier{1}'.format(phyloref_id, count_specifiers)
                count_specifiers += 1

                # Figure out the specifier_type
                if specifier_type not in (INTERNAL_SPECIFIER, EXTERNAL_SPECIFIER):
                    specifier_type = SPECIFIER

                for key in tunit:
                    if key == 'dc:description':
                        continue

                    # TODO: add support for fields containing other fields

                    specifiers.append({
                        "@type": "owl:Class",
                        "intersectionOf": [
                            { "@id": "obo:CDAO_0000140" },  # Node and
                            { "@type": "owl:Restriction",   # <key> <value>
                              "onProperty": key,
                              "hasValue": tunit[key]
                            }
                        ]
                    })

                if len(specifiers) == 0:
                    return None

                # Tell the phyloref that we're now one of its specifiers.
                if 'has' + specifier_type not in phyloref:
                    phyloref['has' + specifier_type] = []

                if 'hasSpecifier' not in phyloref:
                    phyloref['hasSpecifier'] = []
                
                phyloref['has' + specifier_type].append({'@id': specifier_id})
                phyloref['hasSpecifier'].append({'@id': specifier_id})

                return {
                    "@id": specifier_id,
                    "@type": [ "owl:Class", "tbd:" + specifier_type ],
                    "unionOf": specifiers
                }


            # Represent this phyloreference as an OWL class expression
            # in JSON-LD.
            def internal_specifier_to_OWL_repr(specifier):
                if specifier is None:
                    return None

                return {
                    "@type": "owl:Class",
                    "unionOf": [
                        specifier,
                        {
                            "@type": "owl:Restriction",
                            "onProperty": "obo:CDAO_0000174",
                            "someValuesFrom": specifier
                        }
                    ]
                }

            def external_specifier_to_OWL_repr(specifier):
                if specifier is None:
                    return None

                return {
                    "@type": "owl:Restriction",
                    "onProperty": "phyloref:has_Sibling",
                    "someValuesFrom": {
                        "@type": "owl:Class",
                        "unionOf": internal_specifier_to_OWL_repr(specifier)
                    }
                }

            def mrca_to_OWL_repr(specifier1, specifier2):
                # Because these class definitions get really long
                # and complicated, we'll "save" these specifiers
                # as temporary classes, then refer to them in our
                # definitions.

                mrca_as_owl = {
                    "@type": "owl:Class",
                    "unionOf": [
                        # What if the correct answer *is* specifier1 or
                        # specifier2, such as if specifier2 is a direct
                        # descendant of specifier1? We encode that here.
                        {
                            "@type": "owl:Class",
                            "intersectionOf": [
                                specifier1,
                                {
                                    "@type": "owl:Restriction",
                                    "onProperty": "obo:CDAO_0000174",
                                        # has_Descendant
                                    "someValuesFrom": [specifier2]
                                }
                            ]
                        },
                        {
                            "@type": "owl:Class",
                            "intersectionOf": [
                                specifier2,
                                {
                                    "@type": "owl:Restriction",
                                    "onProperty": "obo:CDAO_0000174",
                                        # has_Descendant
                                    "someValuesFrom": [specifier1]
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
                                        internal_specifier_to_OWL_repr(specifier1),
                                        external_specifier_to_OWL_repr(specifier2)
                                    ]
                                }
                            },
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000149",
                                "someValuesFrom": {
                                    "@type": "owl:Class",
                                    "intersectionOf": [
                                        internal_specifier_to_OWL_repr(specifier2),
                                        external_specifier_to_OWL_repr(specifier1)
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

                global count_additional_classes, additional_classes
                count_additional_classes += 1
                additional_class_id = '{0}_additional{1}'.format(phylogeny_id, count_additional_classes)

                additional_classes.append({
                    '@id': additional_class_id,
                    '@type': 'owl:Class',
                    'equivalentClass': mrca_as_owl
                })

                return {
                    '@id': additional_class_id
                }

            # Let's write out a Manchester/Protege string too,
            # just for kicks.

            def internal_specifier_to_OWL_expression(specifier):
                specifiers = list()
                for key in specifier:
                    if key == 'dc:description':
                        continue

                    specifiers.append("{0} value \"{1}\"^^xsd:string".format(key, specifier[key]))

                if len(specifiers) > 0:
                    return "(Node that " + " or ".join(specifiers) + ") or has_Descendant some (Node that " + " or ".join(specifiers) + ")"
                else:
                    return ""

            def external_specifier_to_OWL_expression(specifier):
                specifiers = internal_specifier_to_OWL_expression(specifier)

                if len(specifiers) > 0:
                    return "(has_Sibling some (" + specifiers + "))"
                else:
                    return ""

            def mrca_to_OWL_expression(specifier1, specifier2):
                return "has_Child some (" + \
                    internal_specifier_to_OWL_expression(specifier1) + \
                    " and " + \
                    external_specifier_to_OWL_expression(specifier2) + \
                    ") and has_Child some (" + \
                    internal_specifier_to_OWL_expression(specifier2) + \
                    " and " + \
                    external_specifier_to_OWL_expression(specifier1) + \
                    ")"

            # Check for malformed specifiers.
            if len(external_specifiers) == 0 and len(internal_specifiers) == 0:
                phyloref['malformedPhyloreference'] = "No specifiers providers"
                phyloref['equivalentClass'] = {
                    "@type": "obo:CDAO_0000140" # Node
                }
                phyloref['manchesterSyntax'] = "Node"

            elif len(internal_specifiers) == 0:
                phyloref['malformedPhyloreference'] = "No internal specifiers provided"

            elif len(external_specifiers) > 1:
                phyloref['malformedPhyloreference'] = "More than one external specifier provided"
                
            elif len(external_specifiers) == 0 and len(internal_specifiers) == 1:
                phyloref['malformedPhyloreference'] = "Single internal specifier provided"

            elif len(external_specifiers) == 0:
                # This phyloreference is made up entirely of internal specifiers.
                # Calculate in a pairwise fashion.
                # 
                # (has_Child some (internal(<node 1>) and external(<node 2>)) and 
                #       has_Child some (internal(<node 2>) and external (<node 1>))
                # 
                
                accum_equivalentClass = mrca_to_OWL_repr(
                    tunit_to_owl_class(internal_specifiers[0], phyloref, INTERNAL_SPECIFIER),
                    tunit_to_owl_class(internal_specifiers[1], phyloref, INTERNAL_SPECIFIER)
                )

                last_internal_specifier = internal_specifiers[1]
                for i in range(2, len(internal_specifiers)):
                    accum_equivalentClass = mrca_to_OWL_repr(
                        accum_equivalentClass,
                        tunit_to_owl_class(internal_specifiers[i], phyloref, INTERNAL_SPECIFIER)
                    )
                    last_internal_specifier = internal_specifiers[i]

                phyloref['equivalentClass'] = accum_equivalentClass
                # phyloref['manchesterSyntax'] = mrca_to_OWL_expression(
                #        accum_equivalentClass,
                #        tunit_to_owl_class(last_internal_specifier)
                #    )

            else:
                # This phyloreference is made up of one external specifier and
                # some number of internal specifiers.

                specifiers_repr = []
                for internal_specifier in internal_specifiers:
                    specifiers_repr.append(internal_specifier_to_OWL_repr(
                        tunit_to_owl_class(internal_specifier, phyloref, INTERNAL_SPECIFIER))
                    )

                for external_specifier in external_specifiers:
                    specifiers_repr.append(external_specifier_to_OWL_repr(
                        tunit_to_owl_class(external_specifier, phyloref, EXTERNAL_SPECIFIER))
                    )

                # Filter out {}s
                specifiers_repr = [x for x in specifiers_repr if x is not None]
                
                if len(specifiers_repr) > 0:
                    # We have specifiers! Make this into a phyloreference.
                    phyloref['equivalentClass'] = {
                        '@type': 'owl:Class',
                        'intersectionOf': specifiers_repr
                    }

                specifiers = [internal_specifier_to_OWL_expression(sp) for sp in internal_specifiers]
                specifiers.extend([external_specifier_to_OWL_expression(sp) for sp in external_specifiers])

                phyloref['manchesterSyntax'] = "Node and (" + " and ".join(specifiers) + ")"

        # Finally, add all those additional classes in as phylorefs.
        testCase['phylorefs'].extend(additional_classes)


