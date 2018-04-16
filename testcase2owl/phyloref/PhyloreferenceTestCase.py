"""
PhyloreferenceTestCase.py: A test case represents a single JSON file containing multiple phylogenies and phyloreferences.
"""

from phyloref import owlterms
from phyloref.PhylogenyGroup import PhylogenyGroup
from phyloref.Phyloreference import Phyloreference
from phyloref.TUMatch import TUMatch


class TestCaseException(Exception):
    """
    An exception used to indicate that something went wrong in processing a test case.
    """
    pass


class PhyloreferenceTestCase(object):
    """
    A test case can be loaded from JSON and exported to JSON-LD. It is designed to model one publication, but will
    likely be extended to other sources of phylogenies and phyloreferences.

    It consists of multiple phylogenies (organized into phylogeny groups) and phyloreferences.

    Currently, matching taxonomic units is not explicit, and needs a separate call to the "match_specifiers" method.
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

        # Make sure the identifier ends with '#' or '/', since we're going to extend it to build identifiers
        # for phylogeny groups, phylogenies, nodes and phyloreferences.
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
        """ Load a test case from a JSON file. """
        if '@id' not in doc:
            raise TestCaseException("Document does not contain required key '@id'")

        testCase = PhyloreferenceTestCase(doc['@id'])

        # Load document-level properties
        PhyloreferenceTestCase.append_extend_or_ignore(testCase.type, doc, '@type')
        PhyloreferenceTestCase.append_extend_or_ignore(testCase.owl_imports, doc, 'owl:imports')

        PhyloreferenceTestCase.append_extend_or_ignore(testCase.citation, doc, 'citation')
        PhyloreferenceTestCase.append_extend_or_ignore(testCase.url, doc, 'url')
        PhyloreferenceTestCase.append_extend_or_ignore(testCase.year, doc, 'year')
        PhyloreferenceTestCase.append_extend_or_ignore(testCase.curator, doc, 'curator')
        PhyloreferenceTestCase.append_extend_or_ignore(testCase.comments, doc, 'comments')

        # Load all test phylogenies. Each "phylogeny" is actually a PhylogenyGroup, to account for
        # a single NeXML file containing multiple phylogenies.

        if 'phylogenies' in doc:
            phylogenies_count = 0
            for phylogenies in doc['phylogenies']:
                phylogenies_count += 1
                phylogenies_id = testCase.id + 'phylogenies' + str(phylogenies_count)
                testCase.phylogeny_groups.append(PhylogenyGroup.load_from_json(phylogenies_id, phylogenies))


        # Load all phyloreferences.
        if 'phylorefs' in doc:
            phyloref_count = 0
            for phyloref in doc['phylorefs']:
                phyloref_count += 1
                phyloref_id = testCase.id + 'phyloref' + str(phyloref_count)
                testCase.phylorefs.append(Phyloreference.load_from_json(phyloref_id, phyloref))

        return testCase

    def export_to_jsonld_document(self):
        """ Export to a JSON-LD document that can be saved as a JSON file. """
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = self.type
        doc['owl:imports'] = self.owl_imports
        doc['hasTaxonomicUnitMatches'] = [tumatch.as_jsonld() for tumatch in self.tu_matches]

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
        Matches specifiers to taxonomic units. Matches are stored in self.tu_matches,
        so this will add on to existing matches.
        """

        results = dict()

        # Retrieve all taxonomic units from the phylogeny
        taxonomic_units = set()
        for phylogeny_group in self.phylogeny_groups:
            for phylogeny in phylogeny_group.phylogenies:
                taxonomic_units.update(phylogeny.taxonomic_units)

        # Add all the taxonomic units from the specifiers
        specifier_taxonomic_units = set()
        for phyloref in self.phylorefs:
            for specifier in phyloref.specifiers:
                taxonomic_units.update(specifier.taxonomic_units)
                specifier_taxonomic_units.update(specifier.taxonomic_units)

        results['taxonomic_units'] = len(taxonomic_units)

        # Match taxonomic units with each other.
        results['tunits_matched'] = 0

        # Which taxonomic units were matched?
        matched_taxonomic_units = set()

        # For now, we only match taxonomic units associated with specifiers
        # with all taxonomic units, as matching every taxonomic unit against
        # every other is prohibitively slow, and we're really only trying to
        # match the specifiers anyway.

        for tunit1 in specifier_taxonomic_units:
            for tunit2 in taxonomic_units:
                if tunit1 == tunit2:
                    continue

                # print("Trying to match {!s} with {!s}".format(tunit1, tunit2))

                # Do these taxonomic units match?
                tu_match = TUMatch.try_match(
                    tunit1,
                    tunit2
                )

                if tu_match is not None:
                    matched_taxonomic_units.add(tunit1)
                    matched_taxonomic_units.add(tunit2)

                    self.tu_matches.add(tu_match)
                    results['tunits_matched'] += 1

        # Make a list of unmatched specifiers and return that in a dictionary
        # that provides sets of unmatched specifiers for each phyloreference.
        results['unmatched_specifiers_by_phyloref'] = dict()

        for phyloref in self.phylorefs:
            matched_specifiers = set()
            unmatched_specifiers = set()

            for specifier in phyloref.specifiers:
                flag_specifier_matched = False

                for tu in specifier.taxonomic_units:
                    if tu in matched_taxonomic_units:
                        flag_specifier_matched = True

                if flag_specifier_matched:
                    # At least one TU in this specifier matched.
                    matched_specifiers.add(specifier)
                else:
                    unmatched_specifiers.add(specifier)

            if len(phyloref.specifiers) == 0:
                pass
            elif len(matched_specifiers) == len(phyloref.specifiers):
                pass
            elif len(matched_specifiers) < len(phyloref.specifiers):
                phyloref.unmatched_specifiers = unmatched_specifiers
                results['unmatched_specifiers_by_phyloref'][phyloref] = unmatched_specifiers
            elif len(matched_specifiers) == 0:
                phyloref.unmatched_specifiers = unmatched_specifiers
                results['unmatched_specifiers_by_phyloref'][phyloref] = unmatched_specifiers
            else:
                raise RuntimeError("Impossible code path")

        return results
