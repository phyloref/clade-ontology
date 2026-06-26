# Test fixtures

Fixtures for the `regnum2phyx` tests (`test/regnum2phyx/exec.js`).

## `correct/`

Regnum dumps that convert cleanly, with no errors. Each case is a self-contained
directory named for the case:

```
correct/<Case>/
├── <Case>.json       # input Regnum dump
└── expected/         # the Phyx files regnum2phyx should produce from it
    └── <Label>.json
```

The test runs `regnum2phyx.js` on `<Case>/<Case>.json` and checks that the
produced files match `<Case>/expected/` exactly (filenames + contents), and that
each output validates against the Phyx JSON Schema (`test/phyx_schema.json`).

## `incorrect/`

Reserved for Regnum dumps crafted to trigger specific errors (e.g.
`Crocodylia-invalid-specifier.json`), used to test error reporting. The exact
layout will be finalized when those tests are written.
