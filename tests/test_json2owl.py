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
    """ Convert paper.json file to paper.owl via paper_as_owl.json. """
    path = paper_json[:-11]

    # Switch to the path of the JSON file.
    current_path = os.getcwd()
    os.chdir(path)

    # Run phyx2owl.py and rdfpipe; in case of exceptions or non-zero exit values,
    # report any error as a failed test.
    try:
        output_str = subprocess.check_output('python ../../phyx2owl/phyx2owl.py paper.json -o paper_as_owl.json',
            shell=True,
            stderr=subprocess.STDOUT
        ).decode('utf-8')

        # Will only be run if phyx2owl.py returned zero!
        assert os.system('rdfpipe -i json-ld -o xml paper_as_owl.json > paper.owl') == 0

    except subprocess.CalledProcessError as err:
        output_str = u'ERROR: ' + err.output.decode('utf-8')

    finally:
        os.chdir(current_path)

    # Did phyx2owl report any errors?
    if 'ERROR' in output_str:
        pytest.fail(u"phyx2owl.py failed: " + output_str)

    # Did phyx2owl report any warnings?
    if 'WARNING' in output_str:
        warnings.warn(u"phyx2owl.py reported warnings: " + output_str)

@pytest.mark.owl
def test_owl_to_rdf(paper_owl):
    """ Test paper.owl using JPhyloRef. """

    # Check whether arguments are provided to the JVM or to JPhyloRef.
    JVM_ARGS = os.getenv('JVM_ARGS', '')
    JPHYLOREF_ARGS = os.getenv('JPHYLOREF_ARGS', '--reasoner jfact')
        # TODO we don't need to specify a reasoner once
        # https://github.com/phyloref/jphyloref/pull/23 has been merged.

    # Execute JPhyloRef to test the provided filename.
    assert os.system(
        'java {0} -jar jphyloref/jphyloref.jar test "{1}" {2}'.format(
            JVM_ARGS,
            paper_owl,
            JPHYLOREF_ARGS
        )
    ) == 0
