"""
test_json2owl.py: Convert paper.json into paper.owl.
"""

import pytest
import os

def test_json_to_owl(paper_json):
    """ Convert paper.json file to paper.owl via labeled.owl. """
    path = paper_json[:-11]
    
    labeled_json = paper_json[:-10] + "labeled.owl"
    paper_owl = paper_json[:-5] + ".owl"

    # For now, let's just use 
    # Since these are all Python tasks, eventually we should be able to
    # execute them straight from Python.

    current_path = os.getcwd()
    try:
        os.chdir(path)
        assert os.system('python ../add-labels.py paper.json -o labeled.json') == 0
        assert os.system('rdfpipe -i json-ld -o xml labeled.json > paper.owl') == 0

        # On Windows, this will end up being Unicode 16 -- which is fine,
        # Java seems to be able to load them just fine!

        assert os.system('java -jar ../../jphyloref/jphyloref.jar test paper.owl') == 0

    finally:
        os.chdir(current_path)

