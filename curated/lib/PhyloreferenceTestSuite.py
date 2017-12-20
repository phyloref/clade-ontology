"""
PhyloreferenceTestSuite.py: A test case represents a single JSON file containing multiple phylogenies and phyloreferences.
"""

from lib import owlterms
from lib.PhylogenyGroup import PhylogenyGroup
from lib.Phyloreference import Phyloreference
from lib.TUMatch import TUMatch

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"


class TestSuiteException(Exception):
    """
    An exception used indicate that something went wrong in processing a test case.
    """
    pass


class PhyloreferenceTestSuite(object):
    """
    A test suite can be loaded from JSON and exported to JSON-LD. It is designed to model one publication, but will
    likely be extended to other sources of phylogenies and phyloreferences.
    """

    @staticmethod
    def append_extend_or_ignore(property, dict, key):
        """
        Many values may be stored in JSON as either a list or a single element.
        This method differentiates between those, and either extends the current
        value with all elements from that list, or appends the single element.
        """
        if key not in dict:
            return

        if isinstance(dict[key], list):
            property.extend(dict[key])
        else:
            property.append(dict[key])

    def __init__(self, id):
        """ Create a test case for a given identifier. """
        self.id = id

        # Make sure the identifier ends with '#' or '/'
        if self.id[-1] != '#' and self.id[-1] != '/':
            self.id.append('#')

        # Set up other properties
        self.type = [owlterms.PHYLOREFERENCE_TEST_CASE, owlterms.OWL_ONTOLOGY]
        self.owl_imports = owlterms.OWL_IMPORTS

        # Metadata
        self.citation = []
        self.url = []
        self.year = []
        self.curator = []
        self.comments = []

        # A test case is made up of:
        self.phylogeny_groups = []
        self.phylorefs = []
        self.tu_matches = set()

    @staticmethod
    def load_from_document(doc):
        """ Load a test suite from a JSON file. """
        if '@id' not in doc:
            raise PhyloreferenceTestSuite.TestSuiteException("Document does not contain required key '@id'")

        testSuite = PhyloreferenceTestSuite(doc['@id'])

        # Load document-level properties
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.type, doc, '@type')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.owl_imports, doc, 'owl:imports')

        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.citation, doc, 'citation')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.url, doc, 'url')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.year, doc, 'year')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.curator, doc, 'curator')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.comments, doc, 'comments')

        # Load all test phylogenies. Each "phylogeny" is actually a PhylogenyGroup, to account for
        # a single NeXML file containing multiple phylogenies, but usually it corresponds to a single
        # phylogeny.

        if 'phylogenies' in doc:
            phylogenies_count = 0
            for phylogenies in doc['phylogenies']:
                phylogenies_count += 1
                phylogenies_id = testSuite.id + 'phylogenies' + str(phylogenies_count)
                testSuite.phylogeny_groups.append(PhylogenyGroup.load_from_json(phylogenies_id, phylogenies))


        # Load all phyloreferences.
        if 'phylorefs' in doc:
            phyloref_count = 0
            for phyloref in doc['phylorefs']:
                phyloref_count += 1
                phyloref_id = testSuite.id + 'phyloref' + str(phyloref_count)
                testSuite.phylorefs.append(Phyloreference.load_from_json(phyloref_id, phyloref))

        return testSuite

    def export_to_jsonld_document(self):
        """ Export to a JSON-LD document that can be saved as a JSON file. """
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = self.type
        doc['owl:imports'] = self.owl_imports
        doc['has_taxonomic_unit_matches'] = list(self.tu_matches)

        def export_unless_blank(prop, var):
            """ Export variables unless they are blank.
            Also tidies up lists of a single element so they are exported
            as a single element, rather than a list.
            """
            if len(var) == 1:
                doc[prop] = var[0]
            elif len(var) > 1:
                doc[prop] = var

        export_unless_blank('citation', self.citation)
        export_unless_blank('url', self.url)
        export_unless_blank('year', self.year)
        export_unless_blank('curator', self.curator)
        export_unless_blank('comments', self.comments)

        # Export all phylogenies.
        if len(self.phylogeny_groups) > 0:
            doc['phylogenies'] = []

            for phylogeny in self.phylogeny_groups:
                doc['phylogenies'].append(phylogeny.export_to_jsonld_document())

        # Export all phylorefs.
        if len(self.phylorefs) > 0:
            doc['phylorefs'] = []

            for phyloref in self.phylorefs:
                doc['phylorefs'].append(phyloref.export_to_jsonld_document())

        return doc

    def match_specifiers(self):
        """
        Matches specifiers to taxonomic units. Matches are stored internally, so
        if there are any matches, this test suite will be modified.

        :param matcher: A function taking two arguments (a specifier and a taxonomic
        unit respectively) and returns True if they should be matched.
        :return: A dictionary describing the matches that have been made.
        """

        results = dict()

        # Retrieve all taxonomic units
        taxonomic_units = set()
        for phylogeny_group in self.phylogeny_groups:
            for phylogeny in phylogeny_group.phylogenies:
                taxonomic_units.update(phylogeny.taxonomic_units)

        results['taxonomic_units'] = len(taxonomic_units)

        # Match taxonomic units with each other.
        results['tunits_matched'] = 0

        # TODO: match only the leading triangle

        for tunit1 in taxonomic_units:
            for tunit2 in taxonomic_units:
                if tunit1 == tunit2:
                    continue

                # Do these taxonomic units match?
                tu_match = TUMatch.try_match(
                    tunit1,
                    tunit2
                )

                if tu_match is not None:
                    self.tu_matches.add(tu_match)
                    results['tunits_matched'] += 1

        return results