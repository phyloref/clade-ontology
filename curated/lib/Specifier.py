"""
A Specifier matches one or more Nodes on a phylogeny. Specifier-matching occurs outside of OWL and is
inserted into OWL as a model. Once specifiers have matched, phyloreferences can be matched by reference
to their specifiers.
"""

import warnings

from lib import owlterms
from lib.TaxonomicUnit import TaxonomicUnit
from lib.Identified import Identified


class Specifier(Identified):
    """
    A Specifier is a part of a phyloreference that matches nodes. It can
    consist of one or more taxonomic units.
    """

    def __init__(self, *tunits):
        """ Create a Specifier that contains one or more taxonomic units. """

        super(Specifier, self).__init__()

        self.owl_classes = [owlterms.SPECIFIER]
        self.taxonomic_units = set()
        self.taxonomic_units.update(tunits)

    def as_jsonld(self):
        """ Return this Specifier as a JSON-LD object. """

        return {
            '@id': self.id,
            '@type': self.owl_classes,
            'references_taxonomic_units': [tu.as_jsonld() for tu in self.taxonomic_units]
        }

    @staticmethod
    def from_jsonld(json):
        """ Create a Specifier from a JSON-LD object. """

        specifier = Specifier()

        if '@id' in json:
            specifier.identified_as_id = json['@id']

        if 'references_taxonomic_units' not in json:
            return specifier

        for tu_as_json in json['references_taxonomic_units']:
            tu = TaxonomicUnit.from_jsonld(tu_as_json)
            specifier.taxonomic_units.add(tu)

        if len(specifier.taxonomic_units) == 0:
            warnings.warn("Specifier '{!s}' created without any taxonomic units.".format(specifier))

        return specifier


class InternalSpecifier(Specifier):
    def __init__(self):
        """ Create an internal specifier. """
        super(InternalSpecifier, self).__init__()

        self.owl_classes.append(owlterms.INTERNAL_SPECIFIER)

    @staticmethod
    def from_jsonld(json):
        """ Create an internal specifier by loading it from a JSON-LD object. """
        specifier = Specifier.from_jsonld(json)
        specifier.owl_classes.append(owlterms.INTERNAL_SPECIFIER)
        return specifier


class ExternalSpecifier(Specifier):
    def __init__(self):
        """ Create an external specifier. """
        super(ExternalSpecifier, self).__init__()

        self.owl_classes.append(owlterms.EXTERNAL_SPECIFIER)

    @staticmethod
    def from_jsonld(json):
        """ Create an external specifier by loading it from a JSON-LD object. """
        specifier = Specifier.from_jsonld(json)
        specifier.owl_classes.append(owlterms.EXTERNAL_SPECIFIER)
        return specifier
