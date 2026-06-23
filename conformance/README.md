# Conformance Suite

This directory contains the language-agnostic conformance fixtures for the Avo Inspector Server SDK.

## Structure

```text
conformance/
  README.md                        (this file)
  runner-contract.md               (normative harness protocol — read this before implementing)
  schema-extraction/
    README.md                      (schema extraction suite docs)
    fixtures.json                  (13 golden fixtures)
  wire-protocol/
    README.md                      (wire protocol suite docs)
    fixtures.json                  (7 golden fixtures: wire-1 through wire-7)
  error-handling/
    README.md                      (error handling suite docs)
    fixtures.json                  (error handling fixtures)
```

## Suites

### schema-extraction

Tests the `extractSchema` / `AvoSchemaParser.extractSchema` function in isolation. These fixtures
are pure input/output: given `input` (an event properties object), the SDK must produce `expected`
(an array of `SchemaEntry` objects). No network calls, no constructor options required.

See `schema-extraction/README.md` for details and `schema-extraction/fixtures.json` for the
machine-readable fixtures.

### wire-protocol

Tests the full `trackSchemaFromEvent` wire behavior: correct HTTP body shape, field values,
format-validated fields (`messageId`, `createdAt`, `libVersion`, `libPlatform`), sampling drop,
and non-200 response handling. Requires `AVO_INSPECTOR_MOCK_ENDPOINT` to be set before
invoking the harness.

See `wire-protocol/README.md` for details and `wire-protocol/fixtures.json` for the
machine-readable fixtures (wire-1 through wire-7).

### error-handling

Tests SDK error-handling resilience: non-200 responses, network errors, sampling drops, and
constructor validation errors. All fixtures in this suite are REQUIRED for a conformance pass.

See `error-handling/README.md` for details and `error-handling/fixtures.json` for the
machine-readable fixtures.

## Runner Contract

The conformance suite is driven via a language-agnostic stdin/stdout JSON protocol. SDK authors
implement a thin CLI harness (`avo-inspector-conformance` or equivalent). The full normative
runner contract is defined in **`conformance/runner-contract.md`** — read it before implementing
the harness.

Invocation:

```sh
echo '<fixture-json>' | avo-inspector-conformance
```

The harness reads one line of JSON from stdin, executes the operation, writes one line of JSON
to stdout, and exits with code `0` (pass), `1` (fail), or `2` (harness config error).

## Out of Scope in v1

- `batching/` — time-based or count-based batching is deferred to v1.1.0 and is explicitly
  out of scope. This directory does not exist and MUST NOT be created.
