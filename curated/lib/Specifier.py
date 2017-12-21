"""
A Specifier matches one or more Nodes on a phylogeny. Specifier-matching occurs outside of OWL and is
inserted into OWL as a model. Once specifiers have matched, phyloreferences can be matched by reference
to their specifiers.
"""

import warnings

from lib import owlterms
from lib.TaxonomicUnit import TaxonomicUnit
from lib.Identified import Identified

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"


class Specifier(Identified):
    """
    A Specifier is a part of a phyloreference that matches nodes.

    NOTES:
        - For now, we treat TUs within Specifiers as a set, not a list.
    """

    def __init__(self, *tunits):
        super(Specifier, self).__init__()

        self.owl_classes = [owlterms.SPECIFIER]
        self.taxonomic_units = set()
        self.taxonomic_units.update(tunits)

    def as_jsonld(self):
        return {
            '@id': self.id,
            '@type': self.owl_classes,
            'matches_TUs': [tu.as_jsonld() for tu in self.taxonomic_units]
        }

    @staticmethod
    def from_jsonld(json):
        # A specifier should consist entirely of taxonomic units.
        specifier = Specifier()

        if '@id' in json:
            specifier.identified_as_id = json['@id']

        if 'matches_TUs' not in json:
            return specifier

        for tu_as_json in json['matches_TUs']:
            tu = TaxonomicUnit.from_jsonld(tu_as_json)
            specifier.taxonomic_units.add(tu)

        if len(specifier.taxonomic_units) == 0:
            warnings.warn("Specifier '{!s}' created without any taxonomic units.".format(specifier))

        return specifier


class InternalSpecifier(Specifier):
    def __init__(self):
        super(InternalSpecifier, self).__init__()

        self.owl_classes.append(owlterms.INTERNAL_SPECIFIER)

    @staticmethod
    def from_jsonld(json):
        specifier = Specifier.from_jsonld(json)
        specifier.owl_classes.append(owlterms.INTERNAL_SPECIFIER)
        return specifier


class ExternalSpecifier(Specifier):
    def __init__(self):
        super(ExternalSpecifier, self).__init__()

        self.owl_classes.append(owlterms.EXTERNAL_SPECIFIER)

    @staticmethod
    def from_jsonld(json):
        specifier = Specifier.from_jsonld(json)
        specifier.owl_classes.append(owlterms.EXTERNAL_SPECIFIER)
        return specifier
