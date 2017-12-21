#!/usr/bin/env python

"""
A taxonomic unit match encapsulates the match made between
two or more taxonomic units. Rather than simply asserting
that some taxonomic units overlap, we can document exactly
how much these taxonomic units through these matches.
"""

from lib import owlterms
from lib.Identified import Identified


class TUMatch(Identified):
    """
    A Taxonomic Unit match describes a match between
    two or more Taxonomic Units. At the moment, we
    only support a simple string describing the match,
    but we will eventually flesh out this object with
    precise information on the possible relationship
    between sets of taxonomic units.

    As a utility, this class also provides static methods
    for identifying matching TUs within a Test Suite.
    """

    def __init__(self, tunits=list(), reason="No reason given"):
        super(TUMatch, self).__init__()

        self.types = [owlterms.PHYLOREF_TAXONOMIC_UNIT_MATCH]
        self.taxonomic_units = set()
        self.taxonomic_units.update(tunits)
        self.reason = reason

    def as_jsonld(self):
        return {
            '@id': self.id,
            '@type': self.types,
            'reason': self.reason,
            'matches_taxonomic_units': [tu.as_jsonld() for tu in self.taxonomic_units]
                # TODO: eventually, we'll probably want to use a reference here instead
                # of repeating the TUs. But being explicit is useful is debugging!
        }

    # Static methods for identifying matching taxonomic units
    # within a Test Suite.
    @staticmethod
    def try_match(tunit1, tunit2):
        """
        Attempt to create a match of the two taxonomic units provided.

        Eventually, we'll extend this to matching multiple taxonomic units.

        :param tunits: A list of taxonomic units to compare.
        :return: a TUMatch if there is a match, or None if there isn't one.
        """

        methods_to_try = list()
        methods_to_try.append(TUMatch.try_match_by_binomial_name)

        for method in methods_to_try:
            ret = method(tunit1, tunit2)

            if ret is not None:
                return ret

        return None

    @staticmethod
    def try_match_by_binomial_name(tunit1, tunit2):
        tunit1_scnames = tunit1.scientific_names
        tunit2_scnames = tunit2.scientific_names

        for tunit1_scname in tunit1_scnames:
            for tunit2_scname in tunit2_scnames:
                if tunit1_scname.binomial_name == tunit2_scname.binomial_name:
                    return TUMatch(
                        [tunit1, tunit2],
                        "Scientific name '{!s}' of taxonomic unit '{!s}' and scientific name '{!s}' of taxonomic unit '{!s}' share the same binomial name: '{!s}'".format(
                            tunit1_scname, tunit1,
                            tunit2_scname, tunit2,
                            tunit1_scname.binomial_name
                        )
                    )

        return None
