from lib import owlterms
from lib.Specifier import TestSpecifier


class TestPhyloreference:
    def __init__(self, id):
        self.id = id

        self.label = ""
        self.description = ""

        # Additional classes
        self.count_additional_classes = 0
        self.additional_classes = []

        # Store specifiers
        self.count_specifiers = 0
        self.internal_specifiers = []
        self.external_specifiers = []

    def get_class_expression_for_internal_specifier(self, specifier):
        if specifier is None:
            return None

        return {
            "@type": owlterms.OWL_RESTRICTION,
                "unionOf": [
                    specifier,
                    {
                        "@type": owlterms.OWL_RESTRICTION,
                        "onProperty": owlterms.CDAO_HAS_DESCENDANT,
                        "someValuesFrom": specifier
                    }
                ]
        }

    def get_class_expression_for_external_specifier(self, specifier):
        if specifier is None:
            return None

        return {
            "@type": owlterms.OWL_RESTRICTION,
            "onProperty": owlterms.PHYLOREF_HAS_SIBLING,
            "someValuesFrom": {
                "@type": owlterms.OWL_CLASS,
                "unionOf": [
                    self.get_class_expression_for_internal_specifier(specifier)
                ]
            }
        }

    def get_class_expression_for_mrca(self, class1, class2):
        mrca_as_owl = {
            "@type": "owl:Class",
                "unionOf": [
                    # What if the correct answer *is* specifier1 or
                    # specifier2, such as if specifier2 is a direct
                    # descendant of specifier1? We encode that here.
                    {
                        "@type": "owl:Class",
                        "intersectionOf": [
                            class1,
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000174",
                                # has_Descendant
                                "someValuesFrom": [class2]
                            }
                        ]
                    },
                    {
                        "@type": "owl:Class",
                        "intersectionOf": [
                            class2,
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000174",
                                # has_Descendant
                                "someValuesFrom": [class1]
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
                                        self.get_class_expression_for_internal_specifier(class1),
                                        self.get_class_expression_for_external_specifier(class2)
                                    ]
                                }
                            },
                            {
                                "@type": "owl:Restriction",
                                "onProperty": "obo:CDAO_0000149",
                                "someValuesFrom": {
                                    "@type": "owl:Class",
                                    "intersectionOf": [
                                        self.get_class_expression_for_internal_specifier(class2),
                                        self.get_class_expression_for_external_specifier(class1)
                                    ]
                                }
                            }
                        ]}
                ]
        }

        # This is fine, in terms of complexity, but if you start
        # using mrca on itself, the expression grows exponentially.
        # So, instead of returning this class expression, let's
        # safe it as its own class and return just that name.

        additional_class_id = '{0}_additional{1}'.format(self.id, self.count_additional_classes)
        self.count_additional_classes += 1

        self.additional_classes.append({
            '@id': additional_class_id,
            '@type': 'owl:Class',
            'equivalentClass': mrca_as_owl
        })

        return {
            '@id': additional_class_id
        }

    def export_to_jsonld_document(self):
        doc = dict()

        doc['@id'] = self.id
        doc['@type'] = [owlterms.PHYLOREFERENCE, owlterms.OWL_CLASS]
        doc['label'] = self.label
        doc['description'] = self.description

        # Write out all specifiers.
        doc['hasInternalSpecifier'] = [specifier.export_to_jsonld_document() for specifier in self.internal_specifiers]
        doc['hasExternalSpecifier'] = [specifier.export_to_jsonld_document() for specifier in self.external_specifiers]

        # Write out all additional classes.
        doc['hasAdditionalClass'] = self.additional_classes

        # What type of phyloreference is this?
        # Check for malformed specifiers.
        if len(self.external_specifiers) == 0 and len(self.internal_specifiers) == 0:
            doc['malformedPhyloreference'] = "No specifiers providers"
            doc['equivalentClass'] = {
                "@type": owlterms.CDAO_NODE
            }
            doc['manchesterSyntax'] = "Node"

        elif len(self.internal_specifiers) == 0:
            doc['malformedPhyloreference'] = "No internal specifiers provided"

        elif len(self.external_specifiers) > 1:
            doc['malformedPhyloreference'] = "More than one external specifier provided"

        elif len(self.external_specifiers) == 0 and len(self.internal_specifiers) == 1:
            doc['malformedPhyloreference'] = "Single internal specifier provided"

        elif len(self.external_specifiers) == 0:
            # This phyloreference is made up entirely of internal specifiers.
            # Calculate in a pairwise fashion.
            #
            # (has_Child some (internal(<node 1>) and external(<node 2>)) and
            #       has_Child some (internal(<node 2>) and external (<node 1>))
            #

            accum_equivalentClass = self.get_class_expression_for_mrca(
                self.internal_specifiers[0].get_reference(),
                self.internal_specifiers[1].get_reference()
            )

            last_internal_specifier = self.internal_specifiers[1]
            for i in range(2, len(self.internal_specifiers)):
                accum_equivalentClass = self.get_class_expression_for_mrca(
                    accum_equivalentClass,
                    self.internal_specifiers[i].get_reference()
                )
                last_internal_specifier = self.internal_specifiers[i]

            doc['equivalentClass'] = accum_equivalentClass

        else:
            # This phyloreference is made up of one external specifier and
            # some number of internal specifiers.

            specifiers_repr = []
            for internal_specifier in self.internal_specifiers:
                specifiers_repr.append(self.get_class_expression_for_internal_specifier(internal_specifier.get_reference()))

            for external_specifier in self.external_specifiers:
                specifiers_repr.append(self.get_class_expression_for_external_specifier(external_specifier.get_reference()))

            # Filter out Nones
            specifiers_repr = [x for x in specifiers_repr if x is not None]

            if len(specifiers_repr) > 0:
                # We have specifiers! Make this into a phyloreference.
                doc['equivalentClass'] = {
                    '@type': 'owl:Class',
                    'intersectionOf': specifiers_repr
                }

        return doc

    @staticmethod
    def load_from_json(phyloref_id, json):
        phyloref = TestPhyloreference(phyloref_id)

        if 'label' in json:
            phyloref.label = json['label']

        if 'description' in json:
            phyloref.description = json['description']

        if 'internalSpecifiers' in json:
            for specifier in json['internalSpecifiers']:
                phyloref.count_specifiers += 1
                specifier_id = '{0}_specifier{1}'.format(phyloref_id, phyloref.count_specifiers)
                phyloref.internal_specifiers.append(TestSpecifier(specifier_id, owlterms.INTERNAL_SPECIFIER, specifier))

        if 'externalSpecifiers' in json:
            for specifier in json['externalSpecifiers']:
                phyloref.count_specifiers += 1
                specifier_id = '{0}_specifier{1}'.format(phyloref_id, phyloref.count_specifiers)
                phyloref.external_specifiers.append(TestSpecifier(specifier_id, owlterms.EXTERNAL_SPECIFIER, specifier))

        return phyloref