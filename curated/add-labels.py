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

# Add './lib' to lookup path.
sys.path.append(os.path.join(os.path.dirname(__file__), "lib"))

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
    sys.stderr.write("Could not read '" + str(input_file) + "': " + e.message)
    exit(1)

if FLAG_VERBOSE:
    sys.stderr.write("Loaded test case, id: {0}\n".format(testCase.id))

# Write the paper back out again.
doc = testCase.export_to_jsonld_document()
doc['@context'] = '../paper-context.json'
json.dump(doc, output_file, indent=4, sort_keys=True)
