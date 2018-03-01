"""
Test the code underlying taxonomic units and taxonomic unit matching.
"""

# Running py.test won't add the current path to the directory -- in order
# to run this test, you need to run `python -m pytest tests/`.
from phyloref.TaxonomicUnit import Specimen


def test_specimen_identifiers():
    # Parse a Darwin Core Triplets and make sure it is parsed correctly.
    specimen = Specimen()
    specimen.identifier = 'MVZ:Herp:148929'
    assert specimen.identifier == 'MVZ:Herp:148929'
    assert specimen.properties.get('occurrenceID') == 'MVZ:Herp:148929'
    assert specimen.properties.get('institutionCode') == 'MVZ'
    assert specimen.properties.get('collectionCode') == 'Herp'
    assert specimen.properties.get('catalogNumber') == '148929'

    # Parse a Darwin Code Double and make sure it is parsed correctly.
    specimen.identifier = 'MVZ:148929'
    assert specimen.identifier == 'MVZ:148929'
    assert specimen.properties.get('occurrenceID') == 'MVZ:148929'
    assert specimen.properties.get('institutionCode') == 'MVZ'
    assert specimen.properties.get('collectionCode') is None
    assert specimen.properties.get('catalogNumber') == '148929'

    # Parse a raw catalog number as a catalog number.
    specimen.identifier = '148929'
    assert specimen.identifier == '148929'
    assert specimen.properties.get('occurrenceID') == '148929'
    assert specimen.properties.get('institutionCode') is None
    assert specimen.properties.get('collectionCode') is None
    assert specimen.properties.get('catalogNumber') == '148929'

    # Make sure URNs are not treated as Darwin Core Triplets.
    specimen.identifier = 'urn:lsid:biocol.org:col:34777' # Actually a reference to the MVZ
    assert specimen.identifier == 'urn:lsid:biocol.org:col:34777'
    assert specimen.properties.get('occurrenceID') == 'urn:lsid:biocol.org:col:34777'
    assert specimen.properties.get('institutionCode') is None
    assert specimen.properties.get('collectionCode') is None
    assert specimen.properties.get('catalogNumber') is None

    # Make sure that URLs are not treated as Darwin Core Triplets.
    specimen.identifier = 'http://arctos.database.museum/guid/MVZ:Herp:148929?seid=886464'
    assert specimen.identifier == 'http://arctos.database.museum/guid/MVZ:Herp:148929?seid=886464'
    assert specimen.properties.get('occurrenceID') == 'http://arctos.database.museum/guid/MVZ:Herp:148929?seid=886464'
    assert specimen.properties.get('institutionCode') is None
    assert specimen.properties.get('collectionCode') is None
    assert specimen.properties.get('catalogNumber') is None
