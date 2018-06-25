"""
conftest.py: Sets up some fixtures to simplify test writing.
In this library, we mostly use this to prepare lists of files
that need processing.
"""

import pytest
import os
import fnmatch
import glob

phyloref_paths = [
    "private/*/*.json",
    "phyx/*/paper.json"
]

def pytest_generate_tests(metafunc):
    """ 
    Add hooks for tests that need a parameterized list of 
    curated files to read.
    """

    files = []

    for path in phyloref_paths:
        # Look for files that match the glob patterns provided above.
        files.extend([f for f in glob.glob(path) if 
            # The matched file should be a file
            os.path.isfile(f) and
            # The matched file shouldn't be an '..._as_owl.json' JSON-LD file.
            not f.endswith('_as_owl.json')
        ])

    if "paper_json" in metafunc.fixturenames:
        metafunc.parametrize(
            "paper_json",
            files
        )

