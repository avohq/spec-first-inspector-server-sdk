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

Batching is part of the v1 contract (SPEC.md §13). It cannot be fully automated under the
single-invocation harness, which cannot enqueue events across calls or model "track N events → one
batched send." Automated coverage is therefore limited to:

- The `dev` fixtures (`wire-1`–`wire-7`, all `env: "dev"`) run with `batchSize` forced to 1, so they
  exercise the immediate-send (`batchSize == 1`) path.
- `wire-8` (`env: "staging"`, `batchSize: 30`) asserts that a single tracked event is buffered, not
  sent (0 HTTP calls before flush).

The remaining batching behaviors MUST be verified manually (or via the SDK's own integration tests):

| Scenario | Expectation |
|---|---|
| Track `batchSize` events | Exactly 1 HTTP call containing all `batchSize` events as one array |
| Track 1 event, wait > `batchFlushSeconds` | The scheduled/idle flush sends the partial batch (long-running, non-serverless) |
| Track events then call `flush()` | `flush()` force-sends the pending batch and resolves |
| Track events then call `destroy()` | The pending batch is discarded unsent; no HTTP call |
| Buffer exceeds `maxQueueSize` | Oldest events dropped (FIFO); drop count logged (no contents) |
| Send fails transiently (network/timeout) | Batch re-queued at the front; retried on next flush; `messageId` unchanged |
| Send returns non-200 | Batch NOT re-queued; status logged |
| Batch mixes `streamId`/`eventName` | Each event self-contained; `anonymousId`/`eventName` per element |
| Concurrent enqueue + flush | No lost, duplicated, or torn events (atomic swap-and-clear) |

## Out of Scope in v1

- **Persistent / durable queuing.** The pending batch buffer is in-memory only (SPEC.md §3.2, §13.6);
  writing it to disk or any persistent store, and cross-process or cross-restart batch durability,
  are out of scope and MUST NOT be implemented.
