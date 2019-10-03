# Phyxtract can be used to extract a series of interesting information
# from a directory containing Phyx files.
#
# Synopsis:
#   python phyxtract.py directory-of-phyx-files
#
# Requirements: pandas

import json
import sys
import os
import pandas
from pandas.io.json import json_normalize

# The command line should provide input files.
input_files = sys.argv[1:]

# Extract phylogenies and phylorefs from input files.
phylogenies = []
phylorefs = []

for input_file in input_files:
    input_filename = os.path.basename(input_file)
    with open(input_file) as fd:
        data = json.load(fd)
        if 'phylogenies' in data:
            for phylogeny in data['phylogenies']:
                phylogeny['00filename'] = input_filename
                phylogenies.append(phylogeny)
        if 'phylorefs' in data:
            phylogenies.extend(data['phylorefs'])

# Helper code to extract DOIs from a BibJSON citation.
def extract_dois(citation):
    if 'identifier' in citation:
        identifiers = citation['identifier']
        dois = filter(lambda id: 'type' in id and id['type'] == 'doi', identifiers)
        doi_urls = map(lambda doi: "http://doi.org/" + doi['id'], dois)
        return list(doi_urls)

    return []

# When we don't care about comparisons between items in arrays, we can "expand" them
# to make them easier to read in CSV. For example, instead of:
#   authors: [author1, author2, ...]
# we can expand this into:
#   authors1: author1, authors2: author2
def expand_arrays(data):
    output = dict()

    for field in data:
        value = data[field]
        if isinstance(value, list):
            index = 1
            for item in value:
                output['z_{}{:03}'.format(field, index)] = item
                index += 1
        else:
            output[field] = value

    return output

# Extract reference citations from phylogenies.
citations = []
for phylogeny in phylogenies:
    if 'primaryPhylogenyCitation' in phylogeny:
        citation = phylogeny['primaryPhylogenyCitation']
        citation['0_filename'] = phylogeny['00filename']
        citation['1_citationType'] = 'primary'
        citation['dois'] = extract_dois(citation)
        citation = expand_arrays(citation)
        if 'z_dois001' in citation:
            citation['2_doi'] = citation['z_dois001']
        citation['4_title'] = citation['title']
        citations.append(citation)
    if 'phylogenyCitation' in phylogeny:
        citation = phylogeny['phylogenyCitation']
        citation['0_filename'] = phylogeny['00filename']
        citation['1_citationType'] = 'secondary'
        citation['dois'] = extract_dois(citation)
        citation = expand_arrays(citation)
        if 'z_dois001' in citation:
            citation['2_doi'] = citation['z_dois001']
        citation['4_title'] = citation['title']
        citations.append(citation)

# Display citations.
print(json_normalize(citations).to_csv())
