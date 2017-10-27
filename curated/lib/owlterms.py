#!/usr/bin/env python

"""
owlterms.py: A list of OWL terms used in Phyloreferencing.
"""

import argparse
import dendropy
import json
import os.path
import re
import sys

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"

# Other OWL terms we use
OWL_ONTOLOGY = 'owl:Ontology'

# Base URL for Phyloreferencing
BASE_URL = 'http://vocab.phyloref.org/phyloref/'

# Phyloreference test suites belong to this class.
PHYLOREFERENCE_TEST_CASE = BASE_URL + 'PhyloreferenceTestSuite'

# Specifiers
SPECIFIER = BASE_URL + 'Specifier'
INTERNAL_SPECIFIER = BASE_URL + 'InternalSpecifier'
EXTERNAL_SPECIFIER = BASE_URL + 'ExternalSpecifier'
