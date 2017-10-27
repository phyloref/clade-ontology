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

# CDAO terms
CDAO_NODE = 'obo:CDAO_0000140'
CDAO_HAS_DESCENDANT = "obo:CDAO_0000174"

# Other OWL terms we use
OWL_ONTOLOGY = 'owl:Ontology'
OWL_CLASS = 'owl:Class'
OWL_THING = 'owl:Thing'
OWL_RESTRICTION = "owl:Restriction"

# Phyloref terms
PHYLOREF_HAS_SIBLING = "phyloref:has_Sibling"

# Base URL for Phyloreferencing
BASE_URL = 'http://vocab.phyloref.org/phyloref/'

# Phyloreference test suites belong to this class.
PHYLOREFERENCE = BASE_URL + 'Phyloreference'
PHYLOREFERENCE_TEST_CASE = BASE_URL + 'PhyloreferenceTestSuite'
PHYLOREFERENCE_TEST_PHYLOGENY = BASE_URL + 'PhyloreferenceTestPhylogeny'

# Specifiers
SPECIFIER = BASE_URL + 'Specifier'
INTERNAL_SPECIFIER = BASE_URL + 'InternalSpecifier'
EXTERNAL_SPECIFIER = BASE_URL + 'ExternalSpecifier'
