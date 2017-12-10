#!/usr/bin/env python

"""
Taxonomic Units are associated with phylogeny nodes, and contain information
on the specimens or taxa represented by that node.
"""

import re

from lib import owlterms
from lib.Identified import Identified


class TaxonomicUnit(Identified):
    """
    A taxonomic unit describes any unit of taxonomy. It may consist
    of a single specimen, a set of specimens, a taxon or any other
    description of a unit of taxonomy.

    Taxonomic units have three properties:
        - external_reference: a URI that represents this taxonomic unit
        - scientific_name: a ScientificName that identifies this Taxonomic Unit
          as a taxon.
        - specimens: a set of Specimen associated with this taxonomic unit.

    While we don't assert any requirements, taxonomic units without
    any of these three properties cannot be matched.
    """

    @staticmethod
    def from_scientific_name(scname):
        tunit = TaxonomicUnit()
        tunit.scnames.append(ScientificName(scname))
        return tunit

    def __init__(self):
        super(TaxonomicUnit, self).__init__()

        """
        Creates an empty taxonomic unit.
        """

        self.owl_class = [owlterms.CDAO_TAXONOMIC_UNIT]
        self.external_refs = []
        self.scnames = []
        self.specimen_list = []

    def as_jsonld(self):
        jsonld = {
            '@id': self.id,
            '@type': self.owl_class
        }

        if len(self.external_refs) > 0:
            jsonld['external_references'] = self.external_refs

        if len(self.scnames) > 0:
            jsonld['scientific_names'] = list(map(lambda sn: sn.as_jsonld(), self.scnames))

        if len(self.specimen_list) > 0:
            jsonld['includes_specimens'] = list(map(lambda sp: sp.as_jsonld(), self.specimen_list))

        return jsonld

    def get_reference(self):
        return {
            '@id': self.id
        }

    def load_from_jsonld(self, jsonld):
        self.external_refs = []
        self.scnames = []
        self.specimen_list = []

        if '@id' in jsonld:
            self.id = jsonld['@id']

        if 'external_references' in jsonld:
            self.external_refs.extend(jsonld['external_references'])

        if 'scientific_names' in jsonld:
            self.scnames.extend(map(lambda sn: ScientificName.from_jsonld(sn), jsonld['scientific_names']))

        if 'includes_specimens' in jsonld:
            self.specimen_list.extend(map(lambda sp: Specimen.from_jsonld(sp), jsonld['includes_specimens']))

    @staticmethod
    def load_jsonld(jsonld):
        tunit = TaxonomicUnit()
        tunit.add_from_jsonld(jsonld)
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

# We might need to process labeled data later, in which case
# I'll leave this around for now.
# taxon_dict = taxon.as_dict()
#
# if node_label.annotations:
#     closeMatches = node_label.annotations.findall(name='closeMatch')
#     taxon_dict['skos:closeMatch'] = [closeMatch.value for closeMatch in closeMatches]
#
# if len(taxon.keys()) > 1:
#     # This node contains has a taxon!
#     node_dict['taxa'].append(taxon_dict)
#
# # Do we have any labeled data for this label?
# if node_label.label in self.labeled_data:
#     nodeData = self.labeled_data[node_label.label]
#
#     for key in nodeData:
#         if key in node_dict:
#             if isinstance(nodeData[key], list):
#                 node_dict[key].extend(nodeData[key])
#             else:
#                 node_dict[key].append(nodeData[key])
#
#             # hackity hack hack
#             # TODO: cleanup
#             # remove duplicates
#             try:
#                 node_dict[key] = list(set(node_dict[key]))
#             except TypeError as e:
#                 raise TypeError(
#                     "Deduplication of nodeData failed on key '" + str(key) + "', value: " + str(node_dict[key]))
#
#         else:
#             node_dict[key] = [nodeData[key]]


class ScientificName:
    """
    A scientific name is used to identify taxa.
    """

    def __init__(self, verbatim_name):
        self.scname_verbatim_name = None
        self.scname_genus = None
        self.scname_specific_epithet = None
        self.scname_binomial_name = None

        self.verbatim_name = verbatim_name

    def load_from_jsonld(self, jsonld):
        if 'scientific_name' in jsonld:
            self.__init__(jsonld['scientific_name'])
        else:
            self.__init__(None)

        # By this point, the parsed components should
        # be set up. We'll override any set explicitly.

        if 'binomial_name' in jsonld:
            self.scname_binomial_name = jsonld['binomial_name']

        if 'genus' in jsonld:
            self.scname_genus = jsonld['genus']

        if 'specific_epithet' in jsonld:
            self.scname_specific_epithet = jsonld['specific_epithet']

    @staticmethod
    def from_jsonld(jsonld):
        scname = ScientificName(None)
        scname.load_from_jsonld(jsonld)
        return scname

    def as_jsonld(self):
        jsonld = {
            "@type": "dwc:Taxon",
            "scientific_name": self.verbatim_name
        }

        if self.scname_binomial_name is not None:
            jsonld['binomial_name'] = self.scname_binomial_name

        if self.scname_genus is not None:
            jsonld['genus'] = self.scname_genus

        if self.scname_specific_epithet is not None:
            jsonld['specific_epithet'] = self.scname_specific_epithet

        return jsonld

    @property
    def genus(self):
        return self.scname_genus

    @property
    def specific_epithet(self):
        return self.scname_specific_epithet

    @property
    def binomial_name(self):
        return self.scname_binomial_name

    @property
    def verbatim_name(self):
        return self.scname_verbatim_name

    @verbatim_name.setter
    def verbatim_name(self, verbatim_name):
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
        match = re.search('^(\w+)$', self.verbatim_name)
        if match:
            self.scname_binomial_name = match.group(1)
            self.scname_genus = match.group(1)

        # Is this a binomial name?
        match = re.search('^(\w+) ([\w\-]+)\\b', self.verbatim_name)
        if match:
            self.scname_binomial_name = match.group(1) + " " + match.group(2)
            self.scname_genus = match.group(1)
            self.scname_specific_epithet = match.group(2)

class Specimen:
    """
    This class is here mainly as a placeholder; eventually, we'll support pretty
    complex representations of specimens based on Darwin Core (where it is called
    a "material sample", https://terms.tdwg.org/wiki/dwc:MaterialSample).
    """

    def __init__(self, props):
        self.properties = props

        if not '@type' in self.properties:
            self.properties['@type'] = 'dwc:MaterialSample'

    def load_from_json(self, jsonld):
        self.properties = dict(jsonld)

    @staticmethod
    def from_json(jsonld):
        sp = Specimen()
        sp.load_from_json(jsonld)
        return sp

    def as_json(self):
        return self.properties

    @property
    def properties(self):
        """ Return key-value properties known about this specimen in JSON-LD. """
        return self.properties

    @properties.setter
    def properties(self, props):
        """ Set the key-value properties known about this specimen in JSON-LD. """
        self.properties = props
