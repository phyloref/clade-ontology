"""
Identified is a base class for any class that needs an identifier.
It generates one at sequence and provides it as a blank node for JSON-LD.
"""

import uuid


class Identified(object):
    """ A base class for any class that needs an identifier.
    It generates one at sequence and provides it as a blank node for JSON-LD.
    """

    identifier_count = 1
    # - Set to None if

    def __init__(self):
        """ Creates a unique identifier for this object.

        Subclasses should invoke this using:
            super(ClassName, self).__init__().
        """
        super(Identified, self).__init__()

        # Use sequentially increasing identifier numbers.
        if Identified.identifier_count is None:
            self.identified_as_id = "_:{!s}".format(uuid.uuid4())
        else:
            self.identified_as_id = "_:_{!s}".format(Identified.identifier_count)
            Identified.identifier_count += 1

    @property
    def id(self):
        """ Return the identifier as a CURIE (e.g. '_:_1') """
        return self.identified_as_id

    @id.setter
    def id(self, new_id):
        """ Set the identifier. For JSON-LD purposes, this should
        be a CURIE or a URI. """
        self.identified_as_id = new_id

    def get_reference(self):
        """ Returns a reference to this object as a JSON-LD object.
        Using this form is only useful if the full object is included
        elsewhere in the JSON-LD document using the same identifier.
        """

        return {
            '@id': self.id
        }
