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
    fixtures.json                  (8 golden fixtures: wire-1 through wire-8)
  error-handling/
    README.md                      (error handling suite docs)
    fixtures.json                  (error handling fixtures)
  batching/
    README.md                      (batching suite docs)
    fixtures.json                  (5 golden fixtures: batch-1 through batch-5)
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
machine-readable fixtures (wire-1 through wire-8). `wire-8` is the batching no-premature-flush
fixture; see **Batching** below.

### error-handling

Tests SDK error-handling resilience: non-200 responses, network errors, sampling drops, and
constructor validation errors. All fixtures in this suite are REQUIRED for a conformance pass.

See `error-handling/README.md` for details and `error-handling/fixtures.json` for the
machine-readable fixtures.

### batching

Tests multi-event batching (SPEC.md §12) by driving a single instance through an ordered sequence of
`track` / `flush` / `destroy` actions (`operation: "sequence"`) and asserting the captured HTTP
calls. Requires the mock server and `AVO_INSPECTOR_MOCK_ENDPOINT`. All fixtures use `env: "staging"`
so `batchSize` is honored.

See `batching/README.md` for details and `batching/fixtures.json` for the machine-readable fixtures.

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

## Batching

Batching (SPEC.md §12) is exercised by the dedicated **`batching` suite** (`operation: "sequence"`),
which drives one instance through an ordered series of `track` / `flush` / `destroy` actions and
asserts the resulting HTTP calls — see [`batching/README.md`](./batching/README.md). The `dev`
wire-protocol fixtures (`wire-1`–`wire-7`, `env: "dev"`) additionally cover the immediate-send
(`batchSize == 1`) path, and `wire-8` covers buffered-not-sent.

**Automated by the `batching` suite** (`batch-1`–`batch-5`): size-trigger flush, `flush()` drain of a
partial batch, `destroy()` discard, `maxQueueSize` FIFO overflow, mixed-stream batches, and non-200
no-requeue.

The following behaviors are not yet expressible as deterministic single-process fixtures and MUST be
verified manually (or via the SDK's own integration tests):

| Scenario | Expectation |
|---|---|
| Track 1 event, wait > `batchFlushSeconds` | The scheduled/idle flush sends the partial batch (long-running, non-serverless); needs a controllable clock |
| Send fails transiently (network/timeout) | Batch re-queued at the front; retried on next flush; `messageId` unchanged; needs the mock to simulate a dropped connection |
| Concurrent enqueue + flush | No lost, duplicated, or torn events (atomic swap-and-clear); needs real concurrency |

## Out of Scope in v1

- **Persistent / durable queuing.** The pending batch buffer is in-memory only (SPEC.md §3.2, §12.6);
  writing it to disk or any persistent store, and cross-process or cross-restart batch durability,
  are out of scope and MUST NOT be implemented.
