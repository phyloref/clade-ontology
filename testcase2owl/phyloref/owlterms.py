#!/usr/bin/env python

"""
owlterms.py: A list of OWL terms used in Phyloreferencing.
"""

# OWL Imports: a list of OWL ontologies that should be imported.
# This list should contain URIs from where the ontologies can be
# downloaded -- eventually, this will be final URIs, but for now
# this can be direct links to particular versions of the ontologies
# we want to use.
OWL_IMPORTS = [
    "https://raw.githubusercontent.com/phyloref/curation-workflow/develop/ontologies/phyloref_testcase.owl",
        # Will become "http://vocab.phyloref.org/phyloref/testcase.owl",
    "https://raw.githubusercontent.com/phyloref/phyloref-ontology/master/phyloref.owl",
        # Will become "http://phyloinformatics.net/phyloref.owl"
    "http://purl.obolibrary.org/obo/bco.owl",
        # Contains OWL definitions for Darwin Core terms
        # TODO remove once we've implemented these properties ourselves.
    "http://www.ontologydesignpatterns.org/cp/owl/timeinterval.owl",
        # OWL definitions for time intervals; used by the Publication Status Ontology
    # "http://www.essepuntato.it/2012/04/tvc",
        # OWL definitions for tvc:atTime, which links publication statuses with
        # time intervals
        # TODO: cannot be imported as one of its prerequisties don't work
    # "http://purl.org/spar/pso",
        # Publication Status Ontology: used to assign publication statuses to
        # individual phyloreferences
        # TODO: cannot be imported as one of its prerequisites don't work
]

# CDAO terms
CDAO_NODE = "obo:CDAO_0000140"
CDAO_HAS_DESCENDANT = "obo:CDAO_0000174"
CDAO_TAXONOMIC_UNIT = "obo:CDAO_0000138"

# Base URL for Phyloreferencing
BASE_URL = 'http://vocab.phyloref.org/phyloref/'

# Phyloreference-related terms
PHYLOREFERENCE = "http://phyloinformatics.net/phyloref.owl#Phyloreference"
PHYLOREFERENCE_TEST_CASE = "testcase:PhyloreferenceTestCase"
PHYLOREFERENCE_TEST_PHYLOGENY_GROUP = "testcase:PhyloreferenceTestPhylogenyGroup"
PHYLOREFERENCE_PHYLOGENY = "testcase:PhyloreferenceTestPhylogeny"

PHYLOREF_HAS_SIBLING = "http://phyloinformatics.net/phyloref.owl#has_Sibling"

# TU Match-related terms
PHYLOREF_TAXONOMIC_UNIT_MATCH = "testcase:TUMatch"

# Specifier-related terms
SPECIFIER = "testcase:Specifier"
INTERNAL_SPECIFIER = "testcase:InternalSpecifier"
EXTERNAL_SPECIFIER = "testcase:ExternalSpecifier"

# Terms from the Annotation Ontology
OA_ANNOTATION = "http://www.w3.org/ns/oa#Annotation"

# Other OWL terms we use
OWL_ONTOLOGY = "owl:Ontology"
OWL_CLASS = "owl:Class"
OWL_RESTRICTION = "owl:Restriction"
