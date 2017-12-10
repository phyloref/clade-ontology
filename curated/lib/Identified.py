"""
Identified is a base class for any class that needs an identifier.
It generates one at random, but then replaces it with a proper name later.
"""

import uuid


class Identified(object):
    def __init__(self):
        super(Identified, self).__init__()
        self.identified_as_id = "_:%s" % (uuid.uuid4())

    @property
    def id(self):
        return self.identified_as_id

    @id.setter
    def id(self, new_id):
        self.identified_as_id = new_id

    def get_reference(self):
        """ Returns a reference to this specifier, which should also be exported using
        as_jsonld().
        """

        return {
            '@id': self.id
        }
