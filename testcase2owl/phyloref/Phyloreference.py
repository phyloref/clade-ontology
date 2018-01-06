"""
A Phyloreference is a definition that unambiguously refers to a node on a phylogeny. It consists of a set of
internal and external specifiers, and resolves to a set of Nodes.
"""

from phyloref.Specifier import InternalSpecifier, ExternalSpecifier
from phyloref import owlterms


class Phyloreference(object):
    """ A Phyloreference is a definition that unambiguously refers to a node on a phylogeny. It consists
    of a set of internal and external specifiers.

    This class also includes static functions that construct the class expressions used to represent phyloreferences.
    """

    def __init__(self, phyloref_id):
        """ Create a empty phyloreference with a provided identifier. """

        self.id = phyloref_id

        self.label = ""
        self.clade_definition = ""

        # Information on matches among specifiers
        self.unmatched_specifiers = set()

        # Additional classes
        self.additional_classes = []

        # Store specifiers
        self.count_specifiers = 0
        self.internal_specifiers_list = []
        self.external_specifiers_list = []

    @property
    def internal_specifiers(self):
        """ Returns a list of internal specifiers. """
        return self.internal_specifiers_list

    @property
    def external_specifiers(self):
        """ Returns a list of external specifiers. """
        return self.external_specifiers_list

    @property
    def specifiers(self):
        """ Returns a set of all specifiers, internal and external. """
        specifiers_list = set(self.internal_specifiers)
        specifiers_list.update(self.external_specifiers)
        return specifiers_list

    @staticmethod
    def load_from_json(phyloref_id, json):
        """ Load a phyloreference from a JSON document. """

        phyloref = Phyloreference(phyloref_id)

        if 'label' in json:
            phyloref.label = json['label']

        if 'clade_definition' in json:
            phyloref.clade_definition = json['clade_definition']

        if 'internalSpecifiers' in json:
            for specifier in json['internalSpecifiers']:
                phyloref.count_specifiers += 1
                internal_specifier = InternalSpecifier.from_jsonld(specifier)
                internal_specifier.id = '{0}_specifier{1}'.format(phyloref_id, phyloref.count_specifiers)
                phyloref.internal_specifiers_list.append(internal_specifier)

        if 'externalSpecifiers' in json:
            for specifier in json['externalSpecifiers']:
                phyloref.count_specifiers += 1
                external_specifier = ExternalSpecifier.from_jsonld(specifier)
                external_specifier.id = '{0}_specifier{1}'.format(phyloref_id, phyloref.count_specifiers)
                phyloref.external_specifiers_list.append(external_specifier)

        return phyloref

    def export_to_jsonld_document(self):
        """ Export this phyloreference as a JSON-LD document. """

        types = [owlterms.PHYLOREFERENCE, owlterms.OWL_CLASS]

        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = types
        doc['label'] = self.label
        doc['clade_definition'] = self.clade_definition

        # Write out all specifiers.
        doc['hasInternalSpecifier'] = [specifier.as_jsonld() for specifier in self.internal_specifiers_list]
        doc['hasExternalSpecifier'] = [specifier.as_jsonld() for specifier in self.external_specifiers_list]

        # Which specifiers could not be matched?
        if len(self.unmatched_specifiers) > 0:
            doc['hasUnmatchedSpecifiers'] = [specifier.get_reference() for specifier in self.unmatched_specifiers]

        # What type of phyloreference is this?
        # Check for malformed specifiers.
        if len(self.external_specifiers_list) == 0 and len(self.internal_specifiers_list) == 0:
            doc['malformedPhyloreference'] = "No specifiers providers"
            doc['equivalentClass'] = {
                "@type": owlterms.CDAO_NODE
            }

        elif len(self.internal_specifiers_list) == 0:
            doc['malformedPhyloreference'] = "No internal specifiers provided"

        elif len(self.external_specifiers_list) > 1:
            doc['malformedPhyloreference'] = "More than one external specifier provided"

        elif len(self.external_specifiers_list) == 0 and len(self.internal_specifiers_list) == 1:
            doc['malformedPhyloreference'] = "Single internal specifier provided"

        elif len(self.external_specifiers_list) == 0:
            # This phyloreference is made up entirely of internal specifiers, calculated
            # in a pairwise fashion.
            #
            # (has_Child some (internal(<node 1>) and external(<node 2>)) and
            #       has_Child some (internal(<node 2>) and external (<node 1>))
            #

            accum_equivalentClass = Phyloreference.get_class_expression_for_mrca(
                self.id,
                self.additional_classes,
                self.internal_specifiers_list[0].get_reference(),
                self.internal_specifiers_list[1].get_reference()
            )

            last_internal_specifier = self.internal_specifiers_list[1]
            for i in range(2, len(self.internal_specifiers_list)):
                accum_equivalentClass = Phyloreference.get_class_expression_for_mrca(
                    self.id,
                    self.additional_classes,
                    accum_equivalentClass,
                    self.internal_specifiers_list[i].get_reference()
                )
                last_internal_specifier = self.internal_specifiers_list[i]

            doc['equivalentClass'] = accum_equivalentClass

        else:
            # This phyloreference is made up of one external specifier and
            # some number of internal specifiers.

            specifiers_repr = []
            for internal_specifier in self.internal_specifiers_list:
                specifiers_repr.append(Phyloreference.get_class_expression_for_internal_specifier(internal_specifier.get_reference()))

            for external_specifier in self.external_specifiers_list:
                specifiers_repr.append(Phyloreference.get_class_expression_for_external_specifier(external_specifier.get_reference()))

            # Filter out Nones
            specifiers_repr = [x for x in specifiers_repr if x is not None]

            if len(specifiers_repr) > 0:
                # We have specifiers! Make this into a phyloreference.
                doc['equivalentClass'] = {
                    '@type': 'owl:Class',
                    'intersectionOf': specifiers_repr
                }

        # Write out all additional classes.
        doc['hasAdditionalClass'] = self.additional_classes

        return doc

    @staticmethod
    def get_class_expression_for_internal_specifier(specifier):
        """ Create a class expression for internal specifiers, based on the specifier provided. """

        if specifier is None:
            return None

        # matched_by_specifier :specifier or (hasDescendant some (matched_by_specifier :specifier))

        return {
            "@type": owlterms.OWL_RESTRICTION,
            "unionOf": [
                {
                    "@type": owlterms.OWL_RESTRICTION,
                    "onProperty": "testcase:matches_specifier",
                    "hasValue": specifier
                },
                {
                    "@type": owlterms.OWL_RESTRICTION,
                    "onProperty": owlterms.CDAO_HAS_DESCENDANT,
                    "someValuesFrom": {
                        "@type": owlterms.OWL_RESTRICTION,
                        "onProperty": "testcase:matches_specifier",
                        "hasValue": specifier
                    }
                }
            ]
        }

    @staticmethod
    def get_class_expression_for_external_specifier(specifier):
        """ Create a class expression for external specifiers, based on the specifier provided. """

        if specifier is None:
            return None

        return {
            "@type": owlterms.OWL_RESTRICTION,
            "onProperty": owlterms.PHYLOREF_HAS_SIBLING,
            "someValuesFrom": Phyloreference.get_class_expression_for_internal_specifier(specifier)
        }

    @staticmethod
    def get_class_expression_for_mrca(phyloref_id, additional_classes, specifier1, specifier2):
        """ Create a class expression that matches the most recent common ancestor between two provided specifiers.
        """

        count_additional_classes = len(additional_classes)

        mrca_as_owl = {
            "@type": "owl:Class",
            "unionOf": [
                # What if the correct answer *is* specifier1 or
                # specifier2, such as if specifier2 is a direct
                # descendant of specifier1? We encode that here.
                {
                    "@type": "owl:Class",
                    "intersectionOf": [
                        {
                            "@type": owlterms.OWL_RESTRICTION,
                            "onProperty": "testcase:matches_specifier",
                            "hasValue": specifier1
                        },
                        {
                            "@type": "owl:Restriction",
                            "onProperty": owlterms.CDAO_HAS_DESCENDANT,
                            "someValuesFrom": {
                                "@type": owlterms.OWL_RESTRICTION,
                                "onProperty": "testcase:matches_specifier",
                                "hasValue": specifier2
                            }
                        }
                    ]
                },

                {
                    "@type": "owl:Class",
                    "intersectionOf": [
                        {
                            "@type": owlterms.OWL_RESTRICTION,
                            "onProperty": "testcase:matches_specifier",
                            "hasValue": specifier2
                        },
                        {
                            "@type": "owl:Restriction",
                            "onProperty": owlterms.CDAO_HAS_DESCENDANT,
                            "someValuesFrom": {
                                "@type": owlterms.OWL_RESTRICTION,
                                "onProperty": "testcase:matches_specifier",
                                "hasValue": specifier1
                            }
                        }
                    ]
                },

                # Standard mrca formula
                {
                    "@type": "owl:Class",
                    "intersectionOf": [
                        {
                            "@type": "owl:Restriction",
                            "onProperty": "obo:CDAO_0000149",
                            "someValuesFrom": {
                                "@type": "owl:Class",
                                "intersectionOf": [
                                    Phyloreference.get_class_expression_for_internal_specifier(specifier1),
                                    Phyloreference.get_class_expression_for_external_specifier(specifier2)
                                ]
                            }
                        },
                        {
                            "@type": "owl:Restriction",
                            "onProperty": "obo:CDAO_0000149",
                            "someValuesFrom": {
                                "@type": "owl:Class",
                                "intersectionOf": [
                                    Phyloreference.get_class_expression_for_internal_specifier(specifier2),
                                    Phyloreference.get_class_expression_for_external_specifier(specifier1)
                                ]
                            }
                        }
                    ]
                }
            ]
        }

        # This is fine, in terms of complexity, but if you start
        # using mrca on itself, the expression grows exponentially.
        # So, instead of returning this class expression, let's
        # safe it as its own class and return just that name.

        additional_class_id = '{0}_additional{1}'.format(phyloref_id, count_additional_classes)
        count_additional_classes += 1

        additional_classes.append({
            '@id': additional_class_id,
            '@type': 'owl:Class',
            'equivalentClass': mrca_as_owl
        })

        return {
            '@id': additional_class_id
        }
