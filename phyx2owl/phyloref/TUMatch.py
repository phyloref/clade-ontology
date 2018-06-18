#!/usr/bin/env python

"""
A Taxonomic Unit Match encapsulates the match made between
two or more taxonomic units. Rather than simply asserting
that some taxonomic units overlap, we can document exactly
how much these taxonomic units through these matches.
"""

from phyloref import owlterms
from phyloref.Identified import Identified


class TUMatch(Identified):
    """
    A Taxonomic Unit match describes a match between
    two or more Taxonomic Units. At the moment, we
    only support a simple string describing the match (the "reason"),
    but we will eventually flesh out this object with
    precise information on the possible relationship
    between sets of taxonomic units.

    As a utility, this class also provides static methods
    for identifying matching TUs within a Test Case.
    """

    def __init__(self, tunits=list(), reason="No reason given"):
        """ Create a TUMatch with a number of taxonomic units, matched on the basis of the provided reason. """
        super(TUMatch, self).__init__()

        self.types = [owlterms.PHYLOREF_TAXONOMIC_UNIT_MATCH]
        self.taxonomic_units = set()
        self.taxonomic_units.update(tunits)
        self.reason = reason

    def as_jsonld(self):
        """ Return this Taxonomic Unit match as a JSON-LD object. """
        return {
            '@id': self.id,
            '@type': self.types,
            'reason': self.reason,
            'matchesTaxonomicUnits': [tu.as_jsonld() for tu in self.taxonomic_units]
                # TODO: eventually, we'll probably want to use a reference here instead
                # of repeating the TUs. But being explicit is useful is debugging!
        }

    # Static methods for identifying matching taxonomic units.
    @staticmethod
    def try_match(tunit1, tunit2):
        """
        Attempt to create a match of the two taxonomic units provided.
        Eventually, we'll extend this to matching multiple taxonomic units.

        :param tunits: A list of taxonomic units to compare.
        :return: a TUMatch if there is a match, or None if there isn't one.
        """

        methods_to_try = list()
        methods_to_try.append(TUMatch.try_match_by_external_reference)
        methods_to_try.append(TUMatch.try_match_by_binomial_name)
        methods_to_try.append(TUMatch.try_match_by_specimen_identifier)

        for method in methods_to_try:
            ret = method(tunit1, tunit2)

            if ret is not None:
                return ret

        return None

    @staticmethod
    def try_match_by_external_reference(tunit1, tunit2):
        """ Compare two taxonomic units by looking for identical external references (compared case insensitively). """

        tunit1_extrefs = tunit1.external_references
        tunit2_extrefs = tunit2.external_references

        for tunit1_extref in tunit1_extrefs:
            for tunit2_extref in tunit2_extrefs:
                # We might eventually want to support full URI-to-URI comparisons
                # here, possibly using the 'uri' package. For now, just lowercase
                # identical string comparisons are probably good enough.
                if tunit1_extref.strip() != "" and tunit1_extref.lower().strip() == tunit2_extref.lower().strip():
                    return TUMatch(
                        [tunit1, tunit2],
                        "External reference '{!s}' is shared by taxonomic unit {!s} and {!s}".format(
                            tunit1_extref.lower(),
                            tunit1,
                            tunit2
                        )
                    )

        return None

    @staticmethod
    def try_match_by_binomial_name(tunit1, tunit2):
        """ Compare two taxonomic units by looking for identical binomial names. """
        tunit1_scnames = tunit1.scientific_names
        tunit2_scnames = tunit2.scientific_names

        for tunit1_scname in tunit1_scnames:
            for tunit2_scname in tunit2_scnames:
                if tunit1_scname.binomial_name is None or tunit2_scname.binomial_name is None:
                    continue

                if tunit1_scname.binomial_name.strip() != "" and tunit1_scname.binomial_name.strip() == tunit2_scname.binomial_name.strip():
                    return TUMatch(
                        [tunit1, tunit2],
                        u"Scientific name '{0}' of taxonomic unit '{1}' and scientific name '{2}' of taxonomic unit '{3}' share the same binomial name: '{4}'".format(
                            tunit1_scname, tunit1,
                            tunit2_scname, tunit2,
                            tunit1_scname.binomial_name
                        )
                    )

        return None

    @staticmethod
    def try_match_by_specimen_identifier(tunit1, tunit2):
        """ Compare two taxonomic units by looking for matching specimen identifiers. """
        tunit1_specimens = tunit1.specimens
        tunit2_specimens = tunit2.specimens

        for tunit1_specimen in tunit1_specimens:
            for tunit2_specimen in tunit2_specimens:

                if tunit1_specimen.identifier.strip() != "" and tunit1_specimen.identifier.strip() == tunit2_specimen.identifier.strip():
                    return TUMatch(
                        [tunit1, tunit2],
                        "Specimen identifier '{!s}' is shared by taxonomic unit {!s} and {!s}".format(
                            tunit1_specimen.identifier.strip(),
                            tunit1,
                            tunit2
                        )
                    )

        return None