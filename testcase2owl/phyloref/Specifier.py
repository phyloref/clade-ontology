"""
A Specifier matches one or more Nodes on a phylogeny. Specifier-matching occurs outside of OWL and is
inserted into OWL as a model. Once specifiers have matched, phyloreferences can be matched by reference
to their specifiers.
"""

import warnings

from phyloref import owlterms
from phyloref.TaxonomicUnit import TaxonomicUnit
from phyloref.Identified import Identified


class Specifier(Identified):
    """
    A Specifier is a part of a phyloreference that matches nodes. It can
    consist of one or more taxonomic units.

    Contains a specifier_will_not_match property that can be set to a
    string explaining why we expect this specifier to not match.
    """

    def __init__(self, *tunits):
        """ Create a Specifier that contains one or more taxonomic units. """

        super(Specifier, self).__init__()

        self.owl_classes = [owlterms.SPECIFIER]
        self.specifier_will_not_match = None
        self.taxonomic_units = set()
        self.taxonomic_units.update(tunits)

    def __str__(self):
        """ Return a string representation of this specifier. """
        str_repr = ""

        # What type of specifier is this?
        specifier_type = "specifier"
        if owlterms.INTERNAL_SPECIFIER in self.owl_classes:
            specifier_type = "internal " + specifier_type

        if owlterms.EXTERNAL_SPECIFIER in self.owl_classes:
            specifier_type = "external " + specifier_type

        if len(self.taxonomic_units) == 1:
            str_repr = "{0} consisting of a {1}".format(specifier_type, list(self.taxonomic_units)[0])
        elif len(self.taxonomic_units) > 0:
            str_repr = "{0} consisting of {1} taxonomic units: {2}".format(
                specifier_type,
                len(self.taxonomic_units),
                ", ".join([str(tu) for tu in sorted(list(self.taxonomic_units))])
            )
        else:
            str_repr = "empty {0}".format(specifier_type)

        if self.specifier_will_not_match is not None:
            return "{0}, not expected to match because '{1}'".format(str_repr, self.specifier_will_not_match)

        return str_repr

    def as_jsonld(self):
        """ Return this Specifier as a JSON-LD object. """

        return {
            '@id': self.id,
            '@type': self.owl_classes,
            'referencesTaxonomicUnits': [tu.as_jsonld() for tu in self.taxonomic_units]
        }

    @staticmethod
    def from_jsonld(json):
        """ Create a Specifier from a JSON-LD object. """

        specifier = Specifier()

        if '@id' in json:
            specifier.identified_as_id = json['@id']

        if 'specifierWillNotMatch' in json:
            specifier.specifier_will_not_match = json['specifierWillNotMatch']

        if 'referencesTaxonomicUnits' not in json:
            return specifier

        for tu_as_json in json['referencesTaxonomicUnits']:
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
