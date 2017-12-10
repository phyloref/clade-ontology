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
    "https://raw.githubusercontent.com/phyloref/curation-workflow/refactor_add_labels_with_hasTaxon/curated/phyloref_testcase.owl",
        # Will become "http://vocab.phyloref.org/phyloref/testcase.owl",
    "https://raw.githubusercontent.com/phyloref/phyloref-ontology/master/phyloref.owl",
        # Will become "http://phyloinformatics.net/phyloref.owl"
    "http://purl.obolibrary.org/obo/bco.owl"
        # Contains OWL definitions for Darwin Core terms
        # TODO remove once we've implemented these properties ourselves.
]

# CDAO terms
CDAO_NODE = 'obo:CDAO_0000140'
CDAO_HAS_DESCENDANT = "obo:CDAO_0000174"
CDAO_TAXONOMIC_UNIT = "obo:CDAO_0000138"

# Phyloref terms
PHYLOREF_HAS_SIBLING = "phyloref:has_Sibling"
PHYLOREF_MATCHED_BY_SPECIFIER = "testcase:matched_by_specifier"
PHYLOREF_MATCHED_TAXONOMIC_UNIT = "testcase:matched_taxonomic_unit"

# Base URL for Phyloreferencing
BASE_URL = 'http://vocab.phyloref.org/phyloref/'

# Empty node URLs

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

# Oh hey it's RDFS
RDFS_CLASS = 'rdfs:Class'
