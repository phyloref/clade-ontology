"""
test_json2owl.py: Convert paper.json into paper.owl.
"""

import pytest
import os
import subprocess
import sys
import warnings

@pytest.mark.json
def test_json_to_owl(paper_json):
    """ Convert paper.json file to paper.owl via labeled.owl. """
    path = paper_json[:-11]

    # Switch to the path of the JSON file.
    current_path = os.getcwd()
    os.chdir(path)

    # Run testcase2owl.py and rdfpipe; in case of exceptions or non-zero exit values,
    # report any error as a failed test.
    try:
        output_str = subprocess.check_output('python ../../testcase2owl/testcase2owl.py paper.json -o paper_as_owl.json',
            shell=True,
            stderr=subprocess.STDOUT
        ).decode('utf-8')

        # Will only be run if testcase2owl.py returned zero!
        assert os.system('rdfpipe -i json-ld -o xml paper_as_owl.json > paper.owl') == 0

    except subprocess.CalledProcessError as err:
        output_str = u'ERROR: ' + err.output.decode('utf-8')

    finally:
        os.chdir(current_path)

    # Did testcase2owl report any errors?
    if 'ERROR' in output_str:
        pytest.fail(u"testcase2owl.py failed: " + output_str)

    # Did testcase2owl report any warnings?
    if 'WARNING' in output_str:
        warnings.warn(u"testcase2owl.py reported warnings: " + output_str)

@pytest.mark.owl
def test_owl_to_rdf(paper_owl):
    """ Test paper.owl using jphyloref. """
    path = paper_owl[:-10]

    current_path = os.getcwd()
    try:
        os.chdir(path)

        assert os.system('java -jar ../../jphyloref/jphyloref.jar test paper.owl') == 0

    finally:
        os.chdir(current_path)


