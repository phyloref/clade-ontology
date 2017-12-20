"""
A Specifier matches one or more Nodes on a phylogeny. Specifier-matching occurs outside of OWL and is
inserted into OWL as a model. Once specifiers have matched, phyloreferences can be matched by reference
to their specifiers.
"""

from lib import owlterms
from lib.TaxonomicUnit import TaxonomicUnit
from lib.Identified import Identified

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"


class Specifier:
    """
    A Specifier is a part of a phyloreference that matches nodes.
    """

    def __init__(self):
        # super(Specifier, self).__init__()

        # self.owl_classes.append(owlterms.SPECIFIER)
        self.taxonomic_units = list()

    @staticmethod
    def from_jsonld(json):
        # A specifier should consist entirely of taxonomic units.
        

class InternalSpecifier(Specifier):
    def __init__(self):
        super(InternalSpecifier, self).__init__()

        # self.owl_classes.append(owlterms.INTERNAL_SPECIFIER)


class ExternalSpecifier(Specifier):
    def __init__(self):
        super(ExternalSpecifier, self).__init__()

        # self.owl_classes.append(owlterms.EXTERNAL_SPECIFIER)
