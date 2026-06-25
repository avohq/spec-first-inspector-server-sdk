# Conformance Harness Runner Contract

**Version:** 1.0.0
**Status:** Normative

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHOULD", "SHOULD NOT",
> "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in
> [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

---

## Overview

The conformance suite is operationalized via a language-agnostic stdin/stdout JSON protocol.
SDK authors implement a thin CLI harness binary; the suite runner drives it once per fixture
with fixture data piped to stdin and reads the result from stdout. There is no persistent state
between invocations — each harness process starts fresh.

The harness is intentionally thin. It MUST NOT contain assertion logic itself. Its sole
responsibilities are: parse the input envelope, construct an `AvoInspector` instance with the
specified options, invoke the requested operation, and write the output envelope to stdout.
All assertion logic lives in the suite runner, not the harness.

---

## Entry point

The harness MUST be implemented as a CLI binary named `avo-inspector-conformance`. The following
language-idiomatic equivalents are also accepted by the suite runner:

- `bin/conformance` (Ruby, shell-wrapped binaries)
- `conformance.rb` (Ruby script)
- `conformance.py` (Python script)
- `conformance` (compiled binary — Go, Rust, C#, Java fat-jar with wrapper script)

The binary MUST be executable and MUST be discoverable on `$PATH` or invocable from the SDK
repository root. SDK authors SHOULD document the exact invocation in their SDK README.

The harness is invoked exactly once per fixture. It MUST NOT store state across invocations.

---

## Invocation protocol

The suite runner invokes the harness by piping one JSON line to stdin:

```sh
echo '<fixture-json>' | avo-inspector-conformance
```

The suite runner MUST inject the `suite` field into the input envelope before piping it to the
harness. The `suite` value is derived from the parent directory name of the fixture file
(e.g., `conformance/schema-extraction/fixtures.json` → `suite: "schema-extraction"`).

The harness MUST:

1. Read exactly one line of JSON from stdin.
2. Parse the input envelope (see [Input envelope](#input-envelope)).
3. Construct an `AvoInspector` instance using the `constructor` options from the envelope. (The
   `schema-extraction` fixtures carry a minimal `constructor` block for this purpose; `extractSchema`
   is an instance method per SPEC §4.3, so an instance is always required.)
4. Apply any `precondition` state (see [`precondition` field](#precondition)).
5. Invoke the operation named in the `operation` field (for the `schema-extraction` suite, call
   `inspector.extractSchema(input)`, where the entire `input` field is the `eventProperties`
   argument).
6. Capture the result (resolved value or rejection reason).
7. Write exactly one line of JSON to stdout (the output envelope — see [Output envelope](#output-envelope)).
8. Exit with the appropriate exit code (see [Exit codes](#exit-codes)).

The harness MUST write exactly one JSON line to stdout before exiting. Diagnostic output
(logs, warnings) MUST go to stderr only — stdout is reserved for the single output envelope.

For wire-protocol fixtures, the `AVO_INSPECTOR_MOCK_ENDPOINT` environment variable will be set
before the harness is invoked. The SDK under test MUST honor this variable (see
[AVO\_INSPECTOR\_MOCK\_ENDPOINT](#avo_inspector_mock_endpoint)).

---

## Input envelope

The input envelope is a JSON object with the following fields.

### Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `suite` | string | YES — injected by runner | Suite identifier: `"schema-extraction"`, `"wire-protocol"`, `"error-handling"`, or `"batching"`. NOT present in fixture files; the suite runner MUST inject this field from the parent directory name before passing the envelope to the harness. |
| `fixture_id` | string | YES | Unique identifier for this fixture (e.g., `"wire-1"`, `"fixture-3"`, `"batch-1"`). MUST be echoed in the output envelope. |
| `constructor` | object | YES | Options passed verbatim to the `AvoInspector` constructor. The `schema-extraction` fixtures carry a minimal block (`apiKey`/`env`/`version`) so the harness can construct an instance before calling `extractSchema`. |
| `operation` | string | YES — except `schema-extraction` | SDK method to invoke: `"extractSchema"`, `"trackSchemaFromEvent"`, or `"sequence"` (batching suite — see below). Absent for `schema-extraction` fixtures; the harness MUST call `inspector.extractSchema()` on the constructed instance when `suite` is `"schema-extraction"`. |
| `input` | object | YES — except `sequence` | Operation-specific input payload. For `schema-extraction`, the entire `input` object IS the `eventProperties` argument. For other suites, shape depends on `operation` (see below). Replaced by `steps` when `operation` is `"sequence"`. |
| `steps` | array | YES — for `sequence` | Ordered list of actions run against a single instance in the `batching` suite. See [Multi-event sequence mode](#multi-event-sequence-mode-operation-sequence). |
| `precondition` | object | NO | State to apply to the SDK instance before invoking the operation. See [`precondition`](#precondition). |
| `mock_response` | object or null | NO | Response configuration for the mock server (a single response reused for every POST). Present only when an HTTP call is expected. `null` means no HTTP call is expected. |
| `mock_responses` | array | NO | Per-call responses applied to POSTs in receipt order (use instead of `mock_response` when one sequence makes several calls that need different responses). If shorter than the number of calls, the last entry is reused. |

### `constructor` object

| Field | Type | Required | Description |
|---|---|---|---|
| `apiKey` | string | YES | Inspector API key. |
| `env` | string | YES | One of `"dev"`, `"staging"`, `"prod"`. |
| `version` | string | YES | Application version string. |
| `appName` | string | NO | Application name. Defaults to `""` if absent. |
| `batchSize` | integer | NO | Batch flush size (SPEC.md §12). Present only for batching fixtures (e.g. `wire-8`). When absent, the SDK default applies (30, forced to 1 in `dev`). |
| `batchFlushSeconds` | number | NO | Batch time/idle flush threshold in seconds (SPEC.md §12). When absent, the SDK default applies (30). |
| `maxQueueSize` | integer | NO | Maximum buffered events before FIFO-oldest drop (SPEC.md §12). When absent, the SDK default applies (1000). |
| `disableBatchTimer` | boolean | NO | When `true`, the SDK starts no background/scheduled flush timer (SPEC.md §12). When absent, defaults to `false`. |

### `operation` values and `input` shapes

**`"extractSchema"`** — for the `schema-extraction` suite the harness constructs an `AvoInspector`
instance from the fixture's `constructor` block, then calls `inspector.extractSchema(input)`, where
the entire `input` field IS the `eventProperties` argument (no wrapper object). Consistent with
step 3 and the `input` row above:

```json
{
  "key": "value"
}
```

`input` MAY be `null` (fixture-8). The harness MUST pass `null` through to the SDK.

**`"trackSchemaFromEvent"`** — calls `inspector.trackSchemaFromEvent(eventName, eventProperties, streamId?)`:

```json
{
  "eventName": "Event Name",
  "eventProperties": { "key": "value" },
  "streamId": "optional-stream-id"
}
```

`streamId` is optional. When absent, the harness MUST call `trackSchemaFromEvent` without the
third argument (not with `undefined` explicitly, unless the language requires it).

### Multi-event sequence mode (`operation: "sequence"`)

The `batching` suite uses `operation: "sequence"` to run an ordered series of actions against a
**single** `AvoInspector` instance within one harness invocation. This is what makes multi-event
batching behaviors — size-trigger flush, `flush()` drain, `destroy()` discard, `maxQueueSize` FIFO
overflow, mixed-stream batches, and non-200 no-requeue — automatically assertable; they cannot be
expressed by the single-event modes above. Instead of `input`, the envelope carries an ordered
`steps` array:

```json
{
  "suite": "batching",
  "fixture_id": "batch-1",
  "constructor": { "apiKey": "test-key", "env": "staging", "version": "1.0.0", "appName": "TestApp", "batchSize": 3 },
  "operation": "sequence",
  "steps": [
    { "action": "track", "eventName": "E1", "eventProperties": { "a": 1 }, "streamId": "s1" },
    { "action": "track", "eventName": "E2", "eventProperties": { "b": 2 }, "streamId": "s2" },
    { "action": "track", "eventName": "E3", "eventProperties": { "c": 3 }, "streamId": "s1" },
    { "action": "track", "eventName": "E4", "eventProperties": { "d": 4 }, "streamId": "s2" },
    { "action": "flush" }
  ],
  "mock_response": { "status": 200, "body": { "samplingRate": 1.0 } }
}
```

Each element of `steps` is one action, executed in order on the same instance:

| `action` | Harness behavior |
|---|---|
| `"track"` | Call `trackSchemaFromEvent(eventName, eventProperties, streamId?)` and await it. Same `eventProperties` / `streamId` semantics as the single-event `trackSchemaFromEvent` mode. |
| `"flush"` | Call `flush(timeoutMs?)` and await it. |
| `"destroy"` | Call `destroy()`. |
| `"trackN"` | Fire `count` (required int ≥ 1) **concurrent** `trackSchemaFromEvent` calls — real threads/goroutines/parallel tasks where the runtime supports it, else concurrently-scheduled awaited tasks — each enqueuing one distinct event named `${eventNamePrefix}${i}` (`i` from `0` to `count-1`) with empty `eventProperties` and the optional `streamId` (default `""`). The harness MUST join/await all `count` calls before the step resolves. Used to assert the atomic swap-and-clear under real concurrency (SPEC.md §3.1, §12.4); see [Concurrency fan-out](#concurrency-fan-out-trackn). |

**Determinism rules (REQUIRED):**

- The harness MUST execute the steps strictly in order and MUST await each `track` / `flush` before
  starting the next step.
- The harness MUST NOT perform any implicit flush of its own — the buffer's terminal state is
  exactly what the steps left it. A fixture that expects events to remain buffered simply omits a
  trailing `flush` / `destroy` and asserts `expected_request_count: 0`.
- Because `trackSchemaFromEvent` resolves at enqueue (SPEC.md §4.2, §7.5.2), a size-triggered send
  is dispatched but **not** awaited by the triggering `track`. Therefore **a fixture that expects an
  HTTP call to be observed MUST end with a `flush` step**: `flush()` awaits all in-flight sends (and
  drains any remaining buffer), which is what makes the captured-request set deterministic with no
  keepalive timer (SPEC.md §11).

**Assertions** (performed by the suite runner after the harness exits, against the mock server):

| Field | Assertion |
|---|---|
| `expected_request_count` | The number of HTTP POSTs captured MUST equal this value. |
| `expected_request_bodies` | An array of expected batch bodies; each element is itself an array of event objects (one batch = one HTTP call). Each event is format-validated for placeholder fields (`<uuid-v4>`, `<iso8601>`, `<semver>`, `<sdk-platform>`) exactly as in the wire-protocol suite. Batches are matched as an **unordered multiset**: each expected batch MUST match exactly one captured batch by contents, but batch **arrival order is NOT asserted** (a fire-and-forget SDK MAY dispatch a size-triggered batch and a later `flush()` batch concurrently, so SPEC §12 does not require in-order delivery). |
| `expected_event_union_count` | The total number of event objects across **all** captured batches (order-independent union) MUST equal this value. Used with `trackN` to assert no events are lost or duplicated under concurrency, where batch boundaries are nondeterministic. |
| `expected_unique_message_ids` | When `true`, every `messageId` across all captured events MUST be present and **unique** — no duplicates (no event sent twice) and the count of distinct `messageId`s MUST equal `expected_event_union_count`. Together these pin the atomic swap-and-clear invariant (SPEC.md §3.1, §12.4). |

**Output envelope.** For a sequence, `actual` is an array with one entry per step —
`{ "action": "track"|"trackN"|"flush"|"destroy", "outcome": "resolve"|"reject", "value": <value or reason> }`
— and top-level `outcome` is `"resolve"` unless a harness-level error occurred (in which case
`passed` is `false` and `error` is set). A `destroy` step reports `outcome: "resolve"`,
`value: null`. A `trackN` step reports `outcome: "resolve"`, `value: <count>` once all concurrent
tracks have joined.

#### Concurrency fan-out (`trackN`)

The `trackN` step exists to assert the **atomic swap-and-clear** requirement (SPEC.md §3.1, §12.4) —
that under concurrent enqueue and flush, no event is lost, duplicated, or torn — which is a **MUST**
and cannot be expressed by the serial single-event modes. `trackN` directs the harness to fire
`count` `trackSchemaFromEvent` calls **concurrently** against the one instance:

- On runtimes with real parallelism (threads, goroutines, JVM/Go/Rust/Ruby-Ractor), the harness MUST
  dispatch the `count` calls on genuinely concurrent workers and join all of them before the step
  resolves.
- On single-threaded async runtimes (Node.js, single-threaded Python asyncio), the harness dispatches
  all `count` calls as concurrently-scheduled tasks and awaits them together. This exercises
  interleaving of the enqueue/flush continuations but not true parallelism — an honest limitation
  recorded in `conformance/README.md`; the assertion below still holds.

Each generated event is named `${eventNamePrefix}${i}` for `i` in `0..count-1`, carries empty
`eventProperties`, and uses the step's optional `streamId` (default `""`). A following `flush` step
drains the remainder and awaits all in-flight sends, making the captured-request set final.

**Why the assertion is interleaving-invariant.** The runner asserts over the order-independent
**union** of all captured batch bodies — `expected_event_union_count` (exactly `count` events total)
and `expected_unique_message_ids` (`count` distinct `messageId`s, none repeated). A correct atomic
swap-and-clear produces exactly this union for **every** legal interleaving: each enqueued event
lands in exactly one batch exactly once. The runner never asserts batch boundaries or arrival order,
so a conformant SDK always passes regardless of scheduling, and the only way to fail is a genuine
lost, duplicated, or torn event. Raising `count` well above `batchSize` increases the chance a real
race is hit during the concurrent enqueue.

### `precondition`

The `precondition` field is optional. When present, the harness MUST apply the specified state
to the SDK instance before invoking the operation.

| Sub-field | Type | Description |
|---|---|---|
| `samplingRate` | number | Override the SDK's internal `samplingRate` to this value before calling the operation. The harness MUST apply this via an internal setter, test hook, or direct field assignment on the instance. |

Example: wire-2 fixture sets `samplingRate: 0.0` to verify that the SDK drops the event without
making an HTTP call.

> **Security requirement:** The internal setter or test hook used by the harness to override
> `samplingRate` MUST be test-only — compiled out of production builds, package-private,
> marked `@internal`, or otherwise not exposed in the SDK's documented public API. Exposing
> a public `setSamplingRate` method would allow callers to force `samplingRate = 0` and
> silently disable all telemetry.

**Suggested convention.** The name and visibility of this hook are non-normative, but a shared
convention helps a generated harness locate it without per-SDK guesswork. SDKs SHOULD name it
`_setSamplingRateForTesting` or the language-idiomatic equivalent (e.g. a package-private
`SetSamplingRateForTesting` in Go/Java, a `_set_sampling_rate_for_testing` module function in
Python), kept out of the documented public API per the security requirement above.

The harness MUST apply all `precondition` fields before invoking the operation. If a
`precondition` field is not supported by the harness implementation, the harness MUST exit with
code `2` and write an error to the output envelope.

### Complete input envelope example

```json
{
  "suite": "wire-protocol",
  "fixture_id": "wire-1",
  "constructor": {
    "apiKey": "test-key",
    "env": "dev",
    "version": "1.0.0",
    "appName": "TestApp"
  },
  "operation": "trackSchemaFromEvent",
  "input": {
    "eventName": "User Signed Up",
    "eventProperties": { "plan": "pro", "seats": 3 },
    "streamId": "stream-abc"
  },
  "mock_response": { "status": 200, "body": { "samplingRate": 1.0 } }
}
```

---

## Output envelope

The harness MUST write exactly one JSON object to stdout, terminated by a newline.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `fixture_id` | string | YES | MUST match the `fixture_id` from the input envelope. |
| `passed` | boolean | YES | `true` if the operation completed without a harness-level error; `false` if the harness itself failed (parse error, constructor throw, unhandled exception). Note: `passed: true` does not mean the fixture assertion passed — the suite runner performs assertions after the harness exits. |
| `actual` | any | YES | The raw output of the operation. For `extractSchema`: the returned array. For `trackSchemaFromEvent`: the resolved value (array) or rejection reason (string). |
| `outcome` | string | YES | `"resolve"` if the promise resolved; `"reject"` if the promise rejected. For synchronous `extractSchema`, always `"resolve"`. |
| `error` | string or null | YES | `null` on success. On harness error: a string describing the error (e.g., JSON parse failure, constructor validation error thrown). MUST NOT contain the full exception stack trace — use a one-line summary. |

### Output envelope example — success

```json
{
  "fixture_id": "wire-1",
  "passed": true,
  "actual": [
    { "propertyName": "plan", "propertyType": "string" },
    { "propertyName": "seats", "propertyType": "int" }
  ],
  "outcome": "resolve",
  "error": null
}
```

### Output envelope example — rejection

```json
{
  "fixture_id": "wire-1",
  "passed": true,
  "actual": "Avo Inspector: something went wrong. Please report to support@avo.app.",
  "outcome": "reject",
  "error": null
}
```

### Output envelope example — harness error

```json
{
  "fixture_id": "fixture-3",
  "passed": false,
  "actual": null,
  "outcome": "resolve",
  "error": "Constructor threw: [Avo Inspector] No API key provided."
}
```

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Pass — the harness executed the operation and wrote the output envelope successfully. The fixture assertion result is determined by the suite runner, not the exit code. |
| `1` | Harness/runtime invocation failure — after the input envelope was parsed, the harness could not produce a normal output envelope for the operation (for example, an unhandled runtime error). Fixture assertions remain the suite runner's responsibility; the harness MUST NOT use exit code `1` to signal an assertion result. |
| `2` | Harness configuration error — the input envelope was malformed, a required field was missing, the `operation` value is unsupported, or the `precondition` field could not be applied. This exit code signals a problem with the fixture or harness setup, not the SDK under test. |

The suite runner treats any exit code other than `0` or `1` as an unexpected error and marks
the fixture as errored (not counted as a pass or a fail).

---

## AVO\_INSPECTOR\_MOCK\_ENDPOINT

`AVO_INSPECTOR_MOCK_ENDPOINT` is an environment variable that overrides the Inspector API
endpoint used by the SDK under test.

When `AVO_INSPECTOR_MOCK_ENDPOINT` is set to a non-empty string, the SDK MUST send all HTTP
calls to that URL instead of `https://api.avo.app`. The wire-protocol conformance suite sets
this variable to the URL of a local mock HTTP server before invoking the harness.

**SDK implementation requirement:** Implementations MUST check this environment variable at
runtime (not compile time). The check MUST occur before every HTTP call. If the variable is
set, the full URL from the variable MUST be used as-is (no path appending). Example:

```sh
AVO_INSPECTOR_MOCK_ENDPOINT=http://localhost:9876 echo '<fixture-json>' | avo-inspector-conformance
```

In this example, the SDK MUST POST to `http://localhost:9876` instead of
`https://api.avo.app/inspector/v1/track`.

The mock server URL will always be `http://localhost:<port>` (no trailing slash, no path).
SDKs MUST send POST requests directly to this URL.

**Scope:** `AVO_INSPECTOR_MOCK_ENDPOINT` is a test-only override. Production SDKs SHOULD NOT
expose this variable in their public documentation; it is documented here for harness
implementors only.

**Security requirement:** SDKs MUST gate `AVO_INSPECTOR_MOCK_ENDPOINT` behind a test-only
build flag, debug build, or environment-restriction check. Production builds MUST NOT honor
this variable. Honoring it in production would allow HTTP downgrade attacks by redirecting
traffic to an attacker-controlled endpoint.

---

## Format validation

Some wire body fields cannot be asserted by exact value because they vary per run (for example,
`messageId` is a fresh UUID v4 on every invocation). When a fixture's `expected_request_body`
contains a placeholder string, the suite runner MUST validate that field by format — not by
exact string comparison.

The presence of a placeholder signals format-validation intent. An absent field is a conformance
failure regardless of the regex rule.

### Placeholder-to-regex mapping

| Placeholder | Field | Validation regex / rule |
|---|---|---|
| `"<uuid-v4>"` | `messageId` | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` — lowercase hex only (no `/i` flag); SPEC.md §8.1 requires lowercase. |
| `"<iso8601>"` | `createdAt` | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` — a 3-digit millisecond suffix (e.g. `.000Z`) MUST be present; the value of those digits is not constrained. |
| `"<semver>"` | `libVersion` | `/^\d+\.\d+\.\d+$/` — plain SemVer, no suffix (e.g., `"1.2.0"`, not `"1.2.0+spec"`). |
| `"<sdk-platform>"` | `libPlatform` | Any non-empty string identifying the SDK language (e.g., `"node"`, `"ruby"`, `"python"`, `"go"`). Suite runner accepts any non-empty value. |

All four fields are REQUIRED on every event sent to the Inspector API. A missing field is a
conformance failure.

### Suite runner algorithm for format-validated fields

For each field in `expected_request_body`:

1. If the expected value is a placeholder string (e.g., `"<uuid-v4>"`), look up the
   corresponding regex in the table above.
2. Assert that the actual field value is a non-empty string matching the regex.
3. If the actual value is absent or does not match the regex, mark the fixture as failed.
4. If the expected value is not a placeholder, compare by exact equality.

---

## Mock server

For wire-protocol fixtures, the suite runner starts a local HTTP mock server before invoking
the harness. The mock server records all incoming requests and returns configurable responses.

### Suite runner responsibilities

The suite runner MUST:

1. Start the mock server on an available local port before invoking the harness.
2. Set `AVO_INSPECTOR_MOCK_ENDPOINT` to the mock server base URL (e.g., `http://localhost:9876`).
3. Invoke the harness with the fixture JSON piped to stdin.
4. After the harness exits, call `GET /requests` on the mock server to retrieve captured requests.
5. Compare captured request bodies against `expected_request_body` using format-validation for
   placeholder fields.
6. Assert that the number of captured requests matches `expected_request_count` (when specified).
7. Assert recorded request headers against `expected_request_headers` when present (see
   [`expected_request_headers` assertions](#expected_request_headers-assertions)).
8. Stop or reset the mock server between fixtures.

### Mock server API contract

The mock server MUST implement the following endpoints:

**`POST /`** — Records the incoming request and returns the configured response.

- Request body: the SDK's serialized JSON event array. The body MAY be gzip-compressed (see
  SPEC.md §7.3.5). When the request carries a `Content-Encoding: gzip` header, the mock server
  MUST gunzip the raw bytes before parsing the JSON body. When the header is absent, the body
  MUST be parsed as-is.
- Response: the HTTP status and body from the fixture's `mock_response` field.
- If `mock_response` is `null`, the fixture expects zero HTTP calls. The suite runner SHOULD still
  start the mock server and point `AVO_INSPECTOR_MOCK_ENDPOINT` at it, so that an erroneous send is
  captured locally instead of escaping to a real endpoint; it MUST then verify that zero requests
  were recorded. The runner MUST NOT leave `AVO_INSPECTOR_MOCK_ENDPOINT` pointing at a reachable
  production host for these fixtures.

**`GET /requests`** — Returns all requests captured since the server started (or last reset).

Response body:

```json
[
  {
    "method": "POST",
    "path": "/",
    "headers": { "content-type": "application/json", "content-encoding": "gzip" },
    "body": [ { "...": "..." } ]
  }
]
```

Each element in the array represents one recorded request. `body` is the parsed JSON body of
the POST request (the SDK's event array) — decompressed first when `content-encoding` is `gzip`.
The recorded `headers` MUST preserve `content-encoding` so the suite runner can assert
compression behavior. A `content-encoding: gzip` request whose bytes fail to gunzip MUST be
recorded as a malformed request and MUST fail the fixture.

Header names in the recorded `headers` map MUST be lowercased so assertions are
case-insensitive on the name.

**`POST /reset`** — Clears the captured request list. The suite runner SHOULD call this between
fixtures to ensure each fixture starts with a clean request log.

### `expected_request_headers` assertions

A wire-protocol fixture MAY include an `expected_request_headers` object. When present, the
suite runner MUST assert each entry against the headers of every recorded request (header names
are matched case-insensitively). Each value is one of:

| Expected value | Assertion |
|---|---|
| a literal string (e.g., `"gzip"`) | The header MUST be present and equal to this value exactly. |
| `null` | The header MUST be **absent** from the request. |

This is how a fixture asserts that a small body carries **no** `Content-Encoding`
(`{ "content-encoding": null }`), or that a large body was compressed
(`{ "content-encoding": "gzip" }`).

Compression is mandatory when feasible (SPEC.md §7.3.5): on a gzip-capable runtime an SDK MUST
compress every `>= 1024`-byte body. Every conformance harness runs on such a runtime, so the
large-body fixture (`wire-6`) asserts `content-encoding: "gzip"`. The only conformant exception is
an SDK that targets a runtime with no gzip implementation at all; such an SDK is exempt from the
`wire-6` header assertion (it must still send a correct uncompressed body) and MUST document the
limitation in its README. Use `expected_request_headers` only for headers whose presence/absence is
normatively required for the given fixture.

### `mock_response` field

When `mock_response` is present and non-null, the mock server returns:

| Sub-field | Description |
|---|---|
| `status` | HTTP status code to return (e.g., `200`, `500`). |
| `body` | JSON body to return as the response (e.g., `{ "samplingRate": 1.0 }`). |

The mock server MUST set `Content-Type: application/json` on all responses.

### Harness responsibilities for wire-protocol fixtures

The harness is responsible only for invoking the SDK and writing the output envelope. It is
NOT responsible for starting, querying, or resetting the mock server. All mock server
interactions are handled by the suite runner.

The harness MUST honor `AVO_INSPECTOR_MOCK_ENDPOINT` by passing it through to the SDK (or by
ensuring the SDK reads it from the environment at runtime).

---

## Implementation checklist

SDK authors implementing the harness binary MUST verify all items in this checklist before
submitting conformance results.

- [ ] Harness binary is named `avo-inspector-conformance` (or a documented equivalent) and is
      executable.
- [ ] Harness reads exactly one JSON line from stdin and writes exactly one JSON line to stdout.
- [ ] All stdout output is the single output envelope JSON line; all other output goes to stderr.
- [ ] Output envelope includes `fixture_id` matching the input, `passed`, `actual`, `outcome`,
      and `error` fields.
- [ ] Harness applies `precondition.samplingRate` before invoking the operation when present.
- [ ] Harness passes `null` event properties through to `extractSchema` unchanged (fixture-8).
- [ ] Harness honors `AVO_INSPECTOR_MOCK_ENDPOINT` — the SDK under test sends HTTP calls to
      the mock server URL when this variable is set.
- [ ] Harness exits with code `0` on success, `1` on a harness/runtime invocation failure
      (never to signal an assertion result), and `2` on configuration/envelope errors.
- [ ] Harness handles all `operation` values: `"extractSchema"`, `"trackSchemaFromEvent"`, and
      `"sequence"`.
- [ ] Harness handles the `"sequence"` operation (batching suite): runs `steps` in order on one
      instance, awaits each `track` / `flush`, performs no implicit flush, and honors per-call
      `mock_responses`.
- [ ] Harness handles the `"trackN"` sequence action: fires `count` `trackSchemaFromEvent` calls
      concurrently (real parallelism where the runtime supports it), and joins all of them before
      resolving the step (batch-6 concurrency fixture).
- [ ] Harness does not persist state between invocations — each run constructs a fresh
      `AvoInspector` instance.

---

## Conformance Reporting

### Passing criteria

An SDK is considered conformant when:

- All non-OPTIONAL fixtures in the `schema-extraction` suite pass.
- All fixtures in the `wire-protocol` suite pass.
- All fixtures in the `error-handling` suite pass.
- All fixtures in the `batching` suite pass.

### Reporting format

Suite runners SHOULD produce a conformance report with the following structure per fixture:

```text
[PASS] fixture-1 — Basic primitives
[PASS] wire-1 — Basic event send
[FAIL] wire-2 — Sampling drop: expected 0 HTTP calls, got 1
```

### Versioning

The harness contract follows the same versioning policy as the spec (`VERSIONING.md`). The
contract version is `1.0.0` — the initial publication, which includes the optional batch
configuration fields (`batchSize`, `batchFlushSeconds`, `maxQueueSize`, `disableBatchTimer`) in the
`constructor` object, and the `sequence`-mode actions (`track`, `trackN`, `flush`, `destroy`) with
the concurrency union assertions (`expected_event_union_count`, `expected_unique_message_ids`).
Breaking changes to the input/output envelope schema or exit code semantics MUST increment the
MAJOR version. Additive fields (new optional input or output fields) MUST increment the MINOR
version.

SDK authors SHOULD record which version of the runner contract their harness implements (e.g.,
in a `HARNESS_CONTRACT_VERSION` constant or a comment at the top of the harness source file).
