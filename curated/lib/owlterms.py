#!/usr/bin/env python

"""
owlterms.py: A list of OWL terms used in Phyloreferencing.
"""

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"

# OWL Imports
OWL_IMPORTS = [
    "https://www.w3.org/2004/02/skos/core",
    "https://raw.githubusercontent.com/phyloref/curation-workflow/refactor_add_labels/curated/phyloref_testcase.owl",
        # Will become "http://vocab.phyloref.org/phyloref/testcase.owl",
    "http://raw.githubusercontent.com/hlapp/phyloref/master/phyloref.owl"
        # Will become "http://phyloinformatics.net/phyloref.owl"
]

# CDAO terms
CDAO_NODE = 'obo:CDAO_0000140'
CDAO_HAS_DESCENDANT = "obo:CDAO_0000174"

# Phyloref terms
PHYLOREF_HAS_SIBLING = "phyloref:has_Sibling"

# Base URL for Phyloreferencing
BASE_URL = 'http://vocab.phyloref.org/phyloref/'

# Phyloreference test suites belong to this class.
PHYLOREFERENCE = 'http://phyloinformatics.net/phyloref.owl#Phyloreference'
# PHYLOREFERENCE = BASE_URL + 'Phyloreference'
PHYLOREFERENCE_TEST_CASE = BASE_URL + 'PhyloreferenceTestSuite'
PHYLOREFERENCE_TEST_PHYLOGENY_GROUP = BASE_URL + 'PhyloreferenceTestPhylogenyGroup'
PHYLOREFERENCE_PHYLOGENY = BASE_URL + 'PhyloreferenceTestPhylogeny'

# Specifiers
SPECIFIER = BASE_URL + 'Specifier'
INTERNAL_SPECIFIER = BASE_URL + 'InternalSpecifier'
EXTERNAL_SPECIFIER = BASE_URL + 'ExternalSpecifier'

# Other OWL terms we use
OWL_ONTOLOGY = 'owl:Ontology'
OWL_CLASS = 'owl:Class'
OWL_THING = 'owl:Thing'
OWL_RESTRICTION = "owl:Restriction"
