"""
conftest.py: Sets up some fixtures to simplify test writing.
In this library, we mostly use this to prepare lists of files
that need processing.
"""

import pytest
import os
import fnmatch
import glob

# All Phyx files should be in the 'phyx/' directory.
PHYLOREF_PATH = 'phyx/'

def pytest_generate_tests(metafunc):
    """ 
    Add hooks for tests that need a parameterized list of 
    curated files to read.
    """

    paper_json_filenames = []

    # Recurse through all the files in the PHYLOREF_PATH
    for root, subdirs, files in os.walk(PHYLOREF_PATH):
        for filename in files:
            # Check if it's a JSON file but not an '_as_owl.json' file.
            if filename.endswith('.json') and not filename.endswith('_as_owl.json'):
                # Add it to the list.
                paper_json_filenames.append(os.path.join(root, filename))

    if "paper_json" in metafunc.fixturenames:
        metafunc.parametrize(
            "paper_json",
            paper_json_filenames 
        )

