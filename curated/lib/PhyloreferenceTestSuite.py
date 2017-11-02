#!/usr/bin/env python

"""
TestCase.py: A test case represents a single JSON file, containing multiple phylogenies and phyloreferences.
"""

import owlterms
from lib.Phylogeny import TestPhylogenyGroup

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"


class TestException(Exception):
    pass


class PhyloreferenceTestSuite:
    """
    A test case can loaded from JSON and exported to JSON-LD. It is designed to model
    one publication, but will likely be extended to other sources of phylogenies and
    phyloreferences.
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
        self.owl_imports = [
            "https://www.w3.org/2004/02/skos/core",
            "https://raw.githubusercontent.com/phyloref/curation-workflow/refactor_add_labels/curated/phyloref_testcase.owl",
                # Will become "http://vocab.phyloref.org/phyloref/testcase.owl",
            "http://raw.githubusercontent.com/hlapp/phyloref/master/phyloref.owl"
                # Will become "http://phyloinformatics.net/phyloref.owl"
        ]

        # Metadata
        self.citation = []
        self.url = []
        self.year = []
        self.curator = []
        self.comments = []

        # Made up of
        self.phylogenies = []
        self.phylorefs = []

    @staticmethod
    def load_from_document(doc):
        if '@id' not in doc:
            raise PhyloreferenceTestSuite.TestException("Document does not contain required key '@id'")

        testSuite = PhyloreferenceTestSuite(doc['@id'])

        # Load document-level properties
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.type, doc, '@type')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.owl_imports, doc, 'owl:imports')

        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.citation, doc, 'citation')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.url, doc, 'url')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.year, doc, 'year')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.curator, doc, 'curator')
        PhyloreferenceTestSuite.append_extend_or_ignore(testSuite.comments, doc, 'comments')

        # Load all test phylogenies
        if 'phylogenies' in doc:
            phylogenies_count = 0
            for phylogenies in doc['phylogenies']:
                phylogenies_count += 1
                phylogenies_id = testSuite.id + 'phylogenies' + str(phylogenies_count)
                testSuite.phylogenies.append(TestPhylogenyGroup.load_from_json(phylogenies_id, phylogenies))

        return testSuite

    def export_to_jsonld_document(self):
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = self.type
        doc['owl:imports'] = self.owl_imports

        def export_unless_blank(prop, var):
            if len(var) == 1:
                doc[prop] = var[0]
            elif len(var) > 1:
                doc[prop] = var

        export_unless_blank('citation', self.citation)
        export_unless_blank('url', self.url)
        export_unless_blank('year', self.year)
        export_unless_blank('curator', self.curator)
        export_unless_blank('comments', self.comments)

        if len(self.phylogenies) > 0:
            doc['phylogenies'] = []

            for phylogeny in self.phylogenies:
                doc['phylogenies'].append(phylogeny.export_to_jsonld_document())

        return doc
