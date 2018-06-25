"""
conftest.py: Sets up some fixtures to simplify test writing.
In this library, we mostly use this to prepare lists of files
that need processing.
"""

import pytest
import os
import fnmatch

phyloref_paths = [
    "phyx",
    "private"
]

def pytest_generate_tests(metafunc):
    """ 
    Add hooks for tests that need a parameterized list of 
    curated files to read.
    """

    for path in phyloref_paths:
        dirs.extend([d for d in os.listdir(path) if 
            os.path.isdir(path + "/" + d) and 
            d[0] != '.' and 
                # Ignore Unix hidden folders
            d != 'lib' and
                # Ignore the 'lib' directory
            os.path.isfile(path + "/" + d + "/paper.json")
                # Only include directories containing 'paper.json'
        ])

    if "paper_json" in metafunc.fixturenames:
        metafunc.parametrize(
            "paper_json",
            [path + "/" + path + "/paper.json" for path in dirs]
        )

    if "paper_as_owl_json" in metafunc.fixturenames:
        metafunc.parametrize(
            "paper_as_owl_json",
            [path + "/" + path + "/paper_as_owl.json" for path in dirs]
        )
    
    if "paper_owl" in metafunc.fixturenames:
        metafunc.parametrize(
            "paper_owl",
            [path + "/" + path + "/paper.owl" for path in dirs]
        )
