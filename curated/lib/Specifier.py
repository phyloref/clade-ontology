"""
A Specifier matches one or more Nodes on a phylogeny on the basis of provided properties, such as taxonomic name,
concept label, or any other property. Once the specifier has matched a taxonomic unit, this makes resolving the
phyloreference much easier.
"""

import owlterms

__version__ = "0.1"
__author__ = "Gaurav Vaidya"
__copyright__ = "Copyright 2017 The Phyloreferencing Project"


class Specifier:
    """ A Specifier provides the information necessary to  """

    def __init__(self, specifier_id, specifier_type, match_on):
        """ Create a specifier on the basis of:
         - An identifier (specifier_id)
         - A specifier_type (either owlterms.EXTERNAL_SPECIFIER or owlterms.INTERNAL_SPECIFIER)
         - Key-value pairs in match_on

        This is extremely messy, and will be cleaned up as
        part of https://github.com/phyloref/curation-workflow/issues/6
        """

        self.id = specifier_id
        self.type = [owlterms.OWL_CLASS, specifier_type]
        self.match_on = match_on

    def get_reference(self):
        """ Returns a reference to this specifier, which should also be exported using
        export_to_jsonld_document().

        :return: A JSON-LD object that resolves to this object.
        """

        return {
            '@id': self.id
        }

    def export_to_jsonld_document(self):
        """ Return this specifier as a JSON-LD document. """

        specifier_exprs = list()

        for key in self.match_on:
            if key == 'dc:description':
                continue

            # TODO: add support for fields containing other fields

            specifier_exprs.append({
                "@type": "owl:Class",
                "intersectionOf": [
                    {"@id": owlterms.CDAO_NODE},  # Node and
                    {"@type": owlterms.OWL_RESTRICTION,  # <key> <value>
                     "onProperty": key,
                     "hasValue": self.match_on[key]
                     }
                ]
            })

        return {
            "@id": self.id,
            "@type": self.type,
            "unionOf": specifier_exprs
        }
