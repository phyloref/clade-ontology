#!/usr/bin/env python

"""
Taxonomic Units are associated with phylogeny nodes, and contain information
on the specimens or taxa represented by that node.
"""

import re

from phyloref import owlterms
from phyloref.Identified import Identified

# In Python 2, unicode(obj) calls obj.__str__() and expected unicode as output.
# In Python 3, the way to do that is calling str(obj). So we create an alias
# so we don't get NameErrors when using unicode(obj).
try:
    UNICODE_EXISTS = bool(type(unicode))
except NameError:
    # Python 3!
    unicode = str

class TaxonomicUnit(Identified):
    """
    A taxonomic unit describes any unit of taxonomy. It may consist
    of a single specimen, a set of specimens, a taxon or any other
    description of a unit of taxonomy.

    Taxonomic units have three possible properties:
        - external references: a URI that represents this taxonomic unit
        - scientific names: a ScientificName that identifies this Taxonomic Unit
          as a taxon.
        - specimens: a set of Specimens associated with this taxonomic unit.

    While we don't assert any requirements, taxonomic units without
    any of these three properties cannot be matched.
    """

    def __init__(self):
        super(TaxonomicUnit, self).__init__()

        """
        Creates an empty taxonomic unit.
        """

        self.owl_classes = [owlterms.CDAO_TAXONOMIC_UNIT]
        self.external_refs = []
        self.scnames = []
        self.specimen_list = []

    def __str__(self):
        """ Return a string representation of this taxonomic unit. """
        consists_of = []

        if len(self.external_refs) > 0:
            consists_of.append(u"{0} external references ({1})".format(
                len(self.external_refs),
                u", ".join(self.external_refs)
            ))

        if len(self.scnames) > 0:
            consists_of.append(u"{0} scientific names ({1})".format(
                len(self.scnames),
                u", ".join([unicode(scname) for scname in self.scnames])
            ))

        if len(self.specimen_list) > 0:
            consists_of.append(u"{0} specimens ({1})".format(
                len(self.specimen_list),
                u", ".join([unicode(specimen) for specimen in self.specimen_list])
            ))

        if len(consists_of) > 0:
            return u"taxonomic unit consisting of " + ", ".join(consists_of)

        return u"empty taxonomic unit"

    @staticmethod
    def from_scientific_name(scname):
        """ Create a taxonomic unit from a scientific name. """
        tunit = TaxonomicUnit()
        tunit.scnames.append(ScientificName(scname))
        return tunit

    def as_jsonld(self):
        """ Return this taxonomic unit as a JSON-LD object. """
        # print("TU.as_jsonld(" + self.id + "): " + str(self.matches_specifiers))

        jsonld = {
            '@id': self.id,
            '@type': self.owl_classes
            # '@type': owlterms.OWL_CLASS,
            # 'subClassOf': list(superclasses)
        }

        if len(self.external_refs) > 0:
            jsonld['externalReferences'] = self.external_refs

        if len(self.scnames) > 0:
            jsonld['scientificNames'] = list(map(lambda sn: sn.as_jsonld(), self.scnames))

        if len(self.specimen_list) > 0:
            jsonld['includesSpecimens'] = list(map(lambda sp: sp.as_jsonld(), self.specimen_list))

        return jsonld

    def load_from_jsonld(self, jsonld):
        """ Load this taxonomic unit from a JSON-LD object.

        This overwrites any current information stored in this object.
        """

        self.external_refs = []
        self.scnames = []
        self.specimen_list = []

        if '@id' in jsonld:
            self.id = jsonld['@id']

        if 'externalReferences' in jsonld:
            self.external_refs.extend(jsonld['externalReferences'])

        if 'scientificNames' in jsonld:
            self.scnames.extend(map(lambda sn: ScientificName.from_jsonld(sn), jsonld['scientificNames']))

        if 'includesSpecimens' in jsonld:
            self.specimen_list.extend(map(lambda sp: Specimen.from_jsonld(sp), jsonld['includesSpecimens']))

    @staticmethod
    def from_jsonld(jsonld):
        """ Create a taxonomic unit from a JSON-LD object. """
        tunit = TaxonomicUnit()
        tunit.load_from_jsonld(jsonld)
        return tunit

    @property
    def external_references(self):
        """ Returns the external references of this taxonomic unit. """
        return self.external_refs

    @external_references.setter
    def external_references(self, refs):
        """ Sets the external references for this taxonomic unit. Replaces the previous references. """
        self.external_refs = refs

    @property
    def scientific_names(self):
        """ Return the taxon names associated with this specimen. """
        return self.scnames

    @scientific_names.setter
    def scientific_names(self, names):
        """ Sets the taxa associated with this specimen. """

        self.scnames = names

    @property
    def specimens(self):
        """ Returns the list of specimens. """
        return self.specimen_list

    @specimens.setter
    def specimens(self, specimens):
        """ Set the list of specimens. """

        self.specimen_list = specimens


class ScientificName(object):
    """
    A scientific name is used to identify taxa. This is currently a pretty
    simple model, with a verbatim name that is parsed into a binomial name,
    genus and specific epithet. But we can make this more sophisticated as
    required.
    """

    def __init__(self, verbatim_name):
        """ Create a scientific name based on a verbatim name. """
        self.scname_verbatim_name = None
        self.scname_genus = None
        self.scname_specific_epithet = None
        self.scname_binomial_name = None

        self.verbatim_name = verbatim_name

    def __str__(self):
        """ Returns a string representation of this scientific name """

        if self.binomial_name is not None and self.binomial_name != "":
            return self.binomial_name + u" from '" + self.verbatim_name + "'"

        if self.verbatim_name is not None and self.verbatim_name != "":
            return self.verbatim_name

        return u"empty scientific name"

    def load_from_jsonld(self, jsonld):
        """ Load this scientific name from a JSON-LD object.

        This overwrites any information in the current object.
        """
        if 'scientificName' in jsonld:
            self.__init__(jsonld['scientificName'])
        else:
            self.__init__(None)

        # By this point, the parsed components should
        # be set up. We'll override any set explicitly.

        if 'binomialName' in jsonld:
            self.scname_binomial_name = jsonld['binomialName']

        if 'genus' in jsonld:
            self.scname_genus = jsonld['genus']

        if 'specificEpithet' in jsonld:
            self.scname_specific_epithet = jsonld['specificEpithet']

    @staticmethod
    def from_jsonld(jsonld):
        """ Create a scientific name from a JSON-LD object. """
        scname = ScientificName(None)
        scname.load_from_jsonld(jsonld)
        return scname

    def as_jsonld(self):
        """ Returns this scientific name as a JSON-LD object. """
        jsonld = {
            "@type": "dwc:Taxon",
            "scientificName": self.verbatim_name
        }

        if self.scname_binomial_name is not None:
            jsonld['binomialName'] = self.scname_binomial_name

        if self.scname_genus is not None:
            jsonld['genus'] = self.scname_genus

        if self.scname_specific_epithet is not None:
            jsonld['specificEpithet'] = self.scname_specific_epithet

        return jsonld

    @property
    def genus(self):
        """ Returns the genus of this scientific name or None if not present. """
        return self.scname_genus

    @property
    def specific_epithet(self):
        """ Returns the specific epithet associated with this scientific name or None if not present. """
        return self.scname_specific_epithet

    @property
    def binomial_name(self):
        """ Returns the binomial name associated with this scientific name or None if not present. """
        return self.scname_binomial_name

    @property
    def verbatim_name(self):
        """ Returns the verbatim name associated with this scientific name or None if not present. """
        return self.scname_verbatim_name

    @verbatim_name.setter
    def verbatim_name(self, verbatim_name):
        """ Sets the verbatim name. Also causes it to be reparsed, with genus, specific
        epithet and binomial name extracted if possible.
        """
        self.scname_verbatim_name = verbatim_name
        self.scname_genus = None
        self.scname_specific_epithet = None
        self.scname_binomial_name = None

        if verbatim_name is None:
            return

        # Parse verbatim name into a scientific name
        # We do very simple parsing for now, but eventually
        # we might have to port taxamatch or gnparser to
        # Python.

        self.scname_binomial_name = None

        # Is this a uninomial name?
        match = re.search(u'^(\w+)$', self.verbatim_name)
        if match:
            self.scname_binomial_name = match.group(1)
            self.scname_genus = match.group(1)

        # Is this a binomial name?
        match = re.search(u'^(\w+) ([\w\-]+)\\b', self.verbatim_name)
        if match:
            self.scname_binomial_name = match.group(1) + " " + match.group(2)
            self.scname_genus = match.group(1)
            self.scname_specific_epithet = match.group(2)


class Specimen(object):
    """
    Represents a single specimen included in a taxonomic unit.
    """

    def __init__(self, props=dict()):
        """ Create a Specimen based on key-value properties.

        :param props: A dict consisting of key-value properties.
        """
        self.properties = props

        if '@type' not in self.properties:
            self.properties['@type'] = 'dwc:MaterialSample'

    def __str__(self):
        """ Return a string representation of this Specimen. """
        return u"specimen containing properties {0!s}".format(self.properties)

    def load_from_jsonld(self, jsonld):
        """ Load this specimen from a JSON-LD object. Overwrites current properties. """
        self.properties = dict(jsonld)

    @staticmethod
    def from_jsonld(jsonld):
        """ Read a Specimen from a JSON-LD object and return it. """
        sp = Specimen()
        sp.load_from_jsonld(jsonld)
        return sp

    def as_jsonld(self):
        """ Return this Specimen as a JSON-LD object. """
        return self.properties

    # Helper properties to access some common ways of identifying specimens.
    @property
    def identifier(self):
        """
        Retrieves a single identifier for this specimen.

        Based on http://dx.doi.org/10.1371/journal.pone.0114069, there appear to be two common schemes
        for doing this:
         - institutionCode + ':' + (collectionCode + ':')? + catalogNumber
         - occurrenceID, preferably expressed as 'urn:catalog:[institutionCode]:[collectionCode]:[catalogNumber]'

        Oddly, they don't refer to materialSampleID; Darwin Core refers to this as a reference to the sample and not
        just its digital record, so that might be why.

        At the level of the Taxonomic Unit, CDAO provides a third option: setting an external reference to a URI that
        identifies a specimen, such as:
         - http://portal.vertnet.org/o/ku/kuh?id=be1b5c81-b069-11e3-8cfe-90b11c41863e
         - https://www.idigbio.org/portal/records/07e2d181-cc8b-4b6d-9e27-58756ea08c9b

        :return: A combined identifier if one is detectable, or None.
        """

        # Option 1. Compare occurrenceIDs
        if 'occurrenceID' in self.properties and self.properties['occurrenceID'].strip() != '':
            return self.properties['occurrenceID']

        if 'catalogNumber' in self.properties:
            catalogNumber = self.properties['catalogNumber']
            collectionCode = self.properties.get('collectionCode')
            institutionCode = self.properties.get('institutionCode')

            if institutionCode is None:
                if collectionCode is None:
                    return catalogNumber
                else:
                    return collectionCode + ':' + catalogNumber
            else:
                if collectionCode is None:
                    return institutionCode + ':' + catalogNumber
                else:
                    return institutionCode + ':' + collectionCode + ':' + catalogNumber

        return None

    @identifier.setter
    def identifier(self, value):
        """ Sets the occurrenceId and look for Darwin Core Triplet components. """
        self.properties['occurrenceID'] = value

        # Reset the Darwin Core Triplet components.
        del(self.properties['catalogNumber'])
        del(self.properties['collectionCode'])
        del(self.properties['institutionCode'])

        components = value.strip().split(':')
        if len(components) <= 1:
            # Nothing we can do.
            pass

        elif len(components) == 2:
            # Darwin Core Doublet
            self.properties['institutionCode'] = components[0]
            self.properties['catalogNumber'] = components[1]

        elif len(components) == 3:
            # Darwin Core Triplet
            self.properties['institutionCode'] = components[0]
            self.properties['collectionCode'] = components[1]
            self.properties['catalogNumber'] = components[2]

        else:
            # Can't split; ignore.
            pass

        # All done!