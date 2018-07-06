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
    """ Convert input JSON file to OWL file via `[filename]_as_owl.json`. """

    paper_as_owl_json = os.path.splitext(paper_json)[0] + '_as_owl.json'
    paper_owl = os.path.splitext(paper_json)[0] + '.owl'

    # Check the contents of paper_json.
    with open(paper_json, 'rb') as f:
        contents = f.read()

        # There are two error states we should test for here:
        # 1. What if paper_json is git-crypted?
        if contents.startswith(b"\x00GITCRYPT"):
            pytest.skip("'%s' is a git-crypt encrypted file" % (paper_json))
            return

        # 2. What if paper_json is not in UTF-8? If so, we throw a
        # UnicodeDecodeError, which will cause this test to fail.
        contents.decode('utf-8')

    # Run phyx2owl.py and rdfpipe; in case of exceptions or non-zero exit values,
    # report any error as a failed test.
    try:
        output_str = subprocess.check_output(
            'python ./phyx2owl/phyx2owl.py "%s" -o "%s"' % (paper_json, paper_as_owl_json),
            shell=True,
            stderr=subprocess.STDOUT
        ).decode('utf-8')

        # Make sure we have paper_as_owl_json
        assert os.path.isfile(paper_as_owl_json)

        # Will only be run if phyx2owl.py returned zero!
        # rdfpipe doesn't support arguments that contain spaces, so

        assert 0 == os.system(
            'rdfpipe -i json-ld -o xml "%s" > "%s"' % (paper_as_owl_json, paper_owl)
        )

    except subprocess.CalledProcessError as err:
        output_str = u'ERROR: ' + err.output.decode('utf-8')

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
