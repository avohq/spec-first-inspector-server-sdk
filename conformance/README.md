# Conformance Suite

This directory contains the language-agnostic conformance fixtures for the Avo Inspector Server SDK.

## Structure

```text
conformance/
  README.md                        (this file)
  schema-extraction/
    README.md                      (schema extraction suite docs)
    fixtures.json                  (13 golden fixtures)
```

## Suites

### schema-extraction

Tests the `extractSchema` / `AvoSchemaParser.extractSchema` function in isolation. These fixtures
are pure input/output: given `input` (an event properties object), the SDK must produce `expected`
(an array of `SchemaEntry` objects). No network calls, no constructor options required.

See `schema-extraction/README.md` for details and `schema-extraction/fixtures.json` for the
machine-readable fixtures.

## Out of Scope in v1

- `batching/` — time-based or count-based batching is deferred to v1.1.0 and is explicitly
  out of scope. This directory does not exist and MUST NOT be created.

## Runner Contract

The conformance suite is driven via a language-agnostic stdin/stdout JSON protocol. SDK authors
implement a thin CLI harness (`avo-inspector-conformance` or equivalent). The full normative
runner contract is defined in `SPEC.md` under the "Conformance Harness Reference" section.

Invocation:

```sh
echo '<fixture-json>' | avo-inspector-conformance
```

The harness reads one line of JSON from stdin, executes the operation, writes one line of JSON
to stdout, and exits with code `0` (pass), `1` (fail), or `2` (harness config error).
