#!/usr/bin/env python

"""
add-labels.py: Converts a Phyloreference curated test file in JSON
into a JSON-LD file with node information. It carries out two conversions:

 1. Converts all phylogenies into a node-based representation in OWL,
    integrating any taxonomic unit-level information to the nodes.

 2. Converts all phyloreferences into an OWL-based representation
    containing specifiers that can be used to match taxonomic units.
"""

import argparse
import json
import os.path
import sys

# Add './lib' to lookup path.
sys.path.append(os.path.join(os.path.dirname(__file__), "lib"))

from lib import PhyloreferenceTestSuite
from lib.Specifier import Specifier

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"


def get_command_line_arguments():
    """
    Describes command line arguments for argparse, allowing them to be parsed.

    :return: An object containing arguments that have been parsed from the command line.
    """

    cmdline_parser = argparse.ArgumentParser(
        description="Process an input JSON file by converting trees and labels into an OWL representation."
    )
    cmdline_parser.add_argument(
        'input', metavar='paper.json', type=str, nargs='?',
        help='Input JSON file to convert to JSON-LD'
    )
    cmdline_parser.add_argument(
        '-o', dest='output', metavar='output.json', type=str,
        help='JSON-LD file to write out'
    )
    cmdline_parser.add_argument(
        '-v', '--version',
        action='version', version='%(prog)s ' + __version__
    )
    cmdline_parser.add_argument(
        '--verbose',
        dest='flag_verbose', default=False, action='store_true',
        help='Display verbose information'
    )

    return cmdline_parser.parse_args()


# Step 1. Parse command line arguments and set up flag and file variables.
args = get_command_line_arguments()

if args.input:
    input_file = open(args.input, 'r')

if args.output:
    output_file = open(args.output, 'w')
else:
    output_file = sys.stdout

FLAG_VERBOSE = args.flag_verbose

if FLAG_VERBOSE:
    sys.stderr.write("Input file: {0}\n".format(input_file))
    sys.stderr.write("Output file: {0}\n".format(output_file))

# Step 2. Read the JSON file.
doc = json.load(input_file)

# Change to the folder containing the JSON file, so that relative paths to files resolve correctly.
current_working_directory = os.getcwd()

if args.input:
    os.chdir(os.path.dirname(os.path.realpath(args.input)))

try:
    testCase = PhyloreferenceTestSuite.PhyloreferenceTestSuite.load_from_document(doc)
    print("match_specifiers: " + str(testCase.match_specifiers()))
except PhyloreferenceTestSuite.TestSuiteException as e:
    sys.stderr.write("Could not read '{0}': {1}\n".format(str(input_file), e.message))
    exit(1)

if FLAG_VERBOSE:
    sys.stderr.write("Loaded test case, id: {0}\n".format(testCase.id))

# Step 3. Prepare the JSON-LD document to be exported.
doc = testCase.export_to_jsonld_document()

# Before writing out the document, change back to the previous working directory.
os.chdir(current_working_directory)

# Step 4. Write the paper back out again.
doc['@context'] = '../paper-context.json'
json.dump(doc, output_file, indent=4, sort_keys=True)
