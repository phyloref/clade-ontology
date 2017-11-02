from lib import owlterms


class TestSpecifier:
    def __init__(self, id, type, matchOn):
        self.id = id
        self.type = [owlterms.OWL_CLASS, type]

        self.matchOn = matchOn

    def get_reference(self):
        return {
            '@id': self.id
        }

    def export_to_jsonld_document(self):
        specifier_exprs = list()

        for key in self.matchOn:
            if key == 'dc:description':
                continue

            # TODO: add support for fields containing other fields

            specifier_exprs.append({
                "@type": "owl:Class",
                "intersectionOf": [
                    {"@id": owlterms.CDAO_NODE},  # Node and
                    {"@type": owlterms.OWL_RESTRICTION,  # <key> <value>
                     "onProperty": key,
                     "hasValue": self.matchOn[key]
                     }
                ]
            })

        return {
            "@id": self.id,
            "@type": self.type,
            "unionOf": specifier_exprs
        }