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


class Specifier(TaxonomicUnit, Identified):
    """
    A Specifier provides the information necessary to match a taxonomic unit.
    It is therefore a Taxonomic Unit itself.
    """

    def __init__(self):
        super(Specifier, self).__init__()

        self.owl_class.append(owlterms.SPECIFIER)


class InternalSpecifier(Specifier):
    def __init__(self):
        super(InternalSpecifier, self).__init__()

        self.owl_class.append(owlterms.INTERNAL_SPECIFIER)

    @staticmethod
    def from_jsonld(jsonld):
        specifier = InternalSpecifier()
        specifier.load_from_jsonld(jsonld)
        return specifier


class ExternalSpecifier(Specifier):
    def __init__(self):
        super(ExternalSpecifier, self).__init__()

        self.owl_class.append(owlterms.EXTERNAL_SPECIFIER)

    @staticmethod
    def from_jsonld(jsonld):
        specifier = ExternalSpecifier()
        specifier.load_from_jsonld(jsonld)
        return specifier
