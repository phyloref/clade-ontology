#!/usr/bin/env python

"""
testcase2owl.py: Converts a Phyloreference curated test case into a 
JSON-LD file with node information. It carries out two conversions:

 1. Converts all phylogenies into a node-based representation in OWL,
    integrating any taxonomic unit-level information to the nodes.

 2. Converts all phyloreferences into an OWL-based representation
    containing specifiers that can be used to match taxonomic units.

For scripting purposes, this program can return one of three exit codes:
 - 0: File processed successfully.
 - 1: File could not be processed; error on stderr.
 - 65: File processed with warnings; warnings on stderr.
    - Chosen to correspond to EX_DATAERR in sysexits.h.
"""

import argparse
import json
import os.path
import sys
import io

from phyloref import PhyloreferenceTestCase

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
    input_file = io.open(args.input, 'r', encoding='utf-8')

if args.output:
    output_file = io.open(args.output, 'w', encoding='utf-8')
else:
    output_file = sys.stdout

FLAG_VERBOSE = args.flag_verbose

if FLAG_VERBOSE:
    sys.stderr.write("Input file: {0}\n".format(input_file))
    sys.stderr.write("Output file: {0}\n".format(output_file))

# Step 2. Read the JSON file.
# Note that json.load can't handle JSON files that contain UTF-8 characters,
# so it's easier to convert the input into UTF-8 first, then let json.load()
# read it.
doc = json.load(input_file, encoding='utf-8')

# Change to the folder containing the JSON file, so that relative paths to files resolve correctly.
current_working_directory = os.getcwd()

if args.input:
    os.chdir(os.path.dirname(os.path.realpath(args.input)))

try:
    testCase = PhyloreferenceTestCase.PhyloreferenceTestCase.load_from_document(doc)
    match_results = testCase.match_specifiers()

    if len(match_results['unmatched_specifiers_by_phyloref']) > 0:
        count_unmatched_specifiers = 0

        for phyloref_containing_unmatched_specifier in match_results['unmatched_specifiers_by_phyloref'].keys():

            # We found a phyloreference containing an unmatched specifier! If this is documented or expected -- by
            # using the 'specifier_will_not_match' property -- then produce a warning. If it is not documented,
            # count them and then throw an exception.

            # Note that we don't currently report an error if a specifier we expect not to match actually
            # does match. To do that, we'd have to check all phyloreferences, which doesn't slow us down
            # much, but I won't implement that until it's necessary.

            for specifier in match_results['unmatched_specifiers_by_phyloref'][phyloref_containing_unmatched_specifier]:
                if specifier.specifier_will_not_match is not None:
                    sys.stderr.write("WARNING: Could not match specifier in {0!s} because '{1!s}': {2!s}\n".format(
                        phyloref_containing_unmatched_specifier,
                        specifier.specifier_will_not_match,
                        specifier
                        )
                    )
                    flag_warnings_emitted = True
                else:
                    sys.stderr.write("ERROR: Could not match specifier in {0!s}: {1!s}\n".format(
                        phyloref_containing_unmatched_specifier,
                        specifier
                        )
                    )
                    count_unmatched_specifiers += 1

        # If we have any unmatched specifiers, throw an exception.

        if count_unmatched_specifiers > 0:
            raise PhyloreferenceTestCase.TestCaseException(
                "One or more specifiers could not be matched. " +
                "Use 'match_not_expected' to document why it could not be matched."
            )

except PhyloreferenceTestCase.TestCaseException as e:
    sys.stderr.write("Could not read '{0}': {1!s}\n".format(input_file, e))
    exit(1)

if FLAG_VERBOSE:
    sys.stderr.write("Loaded test case, id: {0}\n".format(testCase.id))

# Step 3. Prepare the JSON-LD document to be exported.
doc = testCase.export_to_jsonld_document()

# Before writing out the document, change back to the previous working directory.
os.chdir(current_working_directory)

# Step 4. Write the paper back out again.
path_to_this_script = os.path.dirname(os.path.realpath(__file__))
doc['@context'] = path_to_this_script + '/paper-context.json'

# json.dump() has issues with documents that are partially str and partially
# unicode. Instead, we dump it to a string, make sure Python knows to treat
# that string as unicode, and then write it out.

output_as_json = json.dumps(doc, indent=4, sort_keys=True, ensure_ascii=False)
if isinstance(output_as_json, str):
    try:
        unicode = str
    except Exception as ex:
        raise ex

    output_as_json = unicode(output_as_json)
output_file.write(output_as_json)
output_file.close()
