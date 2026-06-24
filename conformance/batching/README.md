# Batching Conformance Suite

This suite verifies multi-event batching behavior (SPEC.md §12) by driving a **single**
`AvoInspector` instance through an ordered sequence of actions in one harness invocation, then
asserting the HTTP requests the mock server captured. It uses the `operation: "sequence"` mode of
the runner contract — see [Multi-event sequence mode](../runner-contract.md#multi-event-sequence-mode-operation-sequence).

All fixtures use `env: "staging"` so `batchSize` is honored (under `env: "dev"` the SDK forces
`batchSize = 1`, which disables batching). Like the wire-protocol suite, this suite requires the
mock server and `AVO_INSPECTOR_MOCK_ENDPOINT`.

## Fixtures

| Fixture ID | Behavior verified |
|---|---|
| `batch-1` | **Size trigger + mixed-stream batch.** `batchSize: 3`; the 3rd `track` flushes exactly 3 events as one array (a 4th starts a fresh batch drained by `flush()`). A single batch MAY mix `streamId`/`eventName`. |
| `batch-2` | **`flush()` drains a partial batch.** `batchSize: 30`; two buffered events are force-sent as one batch by `flush()`. |
| `batch-3` | **`destroy()` discards unsent.** Two buffered events, then `destroy()` → zero HTTP calls. |
| `batch-4` | **`maxQueueSize` FIFO overflow.** `maxQueueSize: 2`; appending a 3rd event drops the oldest; the flushed batch is `[E2, E3]`. |
| `batch-5` | **Non-200 is not re-queued.** `batchSize: 2` with per-call `mock_responses` `[500, 200]`; the failed first batch is NOT resent in the second call. |

## How it works

1. The suite runner starts a local mock HTTP server and sets `AVO_INSPECTOR_MOCK_ENDPOINT`.
2. It pipes the fixture (with `operation: "sequence"`) to the harness. The harness constructs one
   instance and runs each `steps` entry in order — `track` / `flush` / `destroy` — awaiting each
   `track` and `flush`, and performing **no implicit flush** of its own.
3. After the harness exits, the runner queries `GET /requests` and asserts `expected_request_count`
   and `expected_request_bodies` (each batch is one captured POST body; placeholder fields such as
   `<uuid-v4>` / `<iso8601>` / `<semver>` / `<sdk-platform>` are format-validated).

**Determinism:** because `trackSchemaFromEvent` resolves at enqueue (SPEC.md §4.2, §7.5.2) and there
is no keepalive timer (SPEC.md §11), any fixture that expects an HTTP call ends with a `flush` step
so the harness awaits all in-flight sends before exiting.

## Conformance Definition

An SDK **passes** the batching suite when all five fixtures pass: the captured request count and the
ordered batch bodies match each fixture's expectations (with format validation applied to placeholder
fields).

## Still verified manually

These batching behaviors are not yet expressible as deterministic, single-process fixtures and remain
in the manual matrix in [`../README.md`](../README.md):

- **Time / idle flush** (`batchFlushSeconds`) — needs a controllable clock / test-only time hook.
- **Transient (network/timeout) re-queue at the front** — needs the mock to simulate a dropped
  connection or timeout rather than an HTTP status.
- **Concurrent enqueue + flush** — needs real concurrency; not deterministic in a single-threaded
  harness run.
