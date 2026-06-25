# Wire-Protocol Conformance Suite

This suite verifies that an SDK sends correct HTTP requests to the Inspector API, handles responses correctly,
and correctly handles `streamId` edge cases.

## Fixtures

| Fixture ID | Description |
|---|---|
| `wire-1` | Basic event send — happy path with primitive properties |
| `wire-2` | Sampling drop — `samplingRate = 0.0` produces zero HTTP calls |
| `wire-3` | Non-200 response — SDK resolves (does not reject) |
| `wire-4` | `streamId` with colons — verbatim passthrough as `streamId` (spec Edge Case 9) |
| `wire-5` | Empty `streamId` — `streamId` becomes `""` (spec Edge Case 10) |
| `wire-6` | Large body (≥ 1024 bytes) — MUST be gzip-compressed on any gzip-capable runtime (SPEC.md §7.3.5); transparent after gunzip |
| `wire-7` | Small body (< 1024 bytes) — MUST be sent uncompressed (no `Content-Encoding` header) |
| `wire-8` | Batching — `env: staging` + `batchSize: 30`; one tracked event is buffered, not sent (0 HTTP calls before flush) (SPEC.md §12) |

> **Batching coverage.** The `dev` fixtures (`wire-1`–`wire-7`, all `env: "dev"`) run with
> `batchSize` forced to 1, so they also serve as the automated check for the immediate-send
> (`batchSize == 1`) batching path, and `wire-8` covers buffered-not-sent. Multi-event batching
> (size-trigger flush, `flush()` drain, `destroy()` discard, `maxQueueSize` overflow, non-200
> no-requeue) is automated by the dedicated [`batching` suite](../batching/README.md); the few
> remaining SHOULD-level behaviors (time/idle flush, transient re-queue) are in the manual matrix in
> [`../README.md`](../README.md).

## How It Works

For wire-protocol fixtures, the suite runner starts a local HTTP mock server before invoking the harness
and passes its URL via the `AVO_INSPECTOR_MOCK_ENDPOINT` environment variable.

### `AVO_INSPECTOR_MOCK_ENDPOINT`

When this environment variable is set, the SDK under test **MUST** send all HTTP calls to this URL
instead of `https://api.avo.app`. The mock server:

- Records incoming `POST` requests (headers + body).
- Returns the configurable response specified in the fixture's `mock_response` field.
- Exposes a `GET /requests` endpoint that returns all recorded requests as a JSON array.

After the harness exits, the suite runner calls `GET /requests` and compares the captured request bodies
against `expected_request_body` in the fixture.

When a recorded request carries `Content-Encoding: gzip` (SPEC.md §7.3.5), the mock server MUST gunzip the
raw body bytes before parsing the JSON, so the captured `body` is always the decompressed event array. A
`gzip`-labeled body that fails to gunzip is a conformance failure.

**Example:**

```sh
echo '<fixture-json>' | AVO_INSPECTOR_MOCK_ENDPOINT=http://localhost:9876 avo-inspector-conformance
```

## Format Validation

Some wire body fields cannot be asserted by exact value because they vary per run (e.g., `messageId` is
a fresh UUID each invocation). When a fixture's `expected_request_body` contains a placeholder value,
the suite runner validates that field by format using the regex below — not by exact string comparison.

The presence of a placeholder signals format-validation intent. An **absent** field is a conformance failure
regardless of the regex rule.

### Placeholder-to-Regex Mapping

| Placeholder | Field | Validation regex / rule |
|---|---|---|
| `"<uuid-v4>"` | `messageId` | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` — lowercase hex only (no `/i` flag); SPEC.md §8.1 requires lowercase. |
| `"<iso8601>"` | `createdAt` | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` — must include a 3-digit millisecond suffix (e.g., `.000Z`); the digit values are not constrained. |
| `"<semver>"` | `libVersion` | `/^\d+\.\d+\.\d+$/` — plain SemVer, no suffix (e.g., `"1.2.0"`, not `"1.2.0+spec"`). |
| `"<sdk-platform>"` | `libPlatform` | Any non-empty string identifying the SDK language (e.g., `"node"`, `"ruby"`, `"python"`, `"go"`). Suite runner accepts any non-empty value. |

All four fields are **required** on every event sent. A missing field is a conformance failure.

## Fixture Format Reference

```json
{
  "fixture_id": "wire-N",
  "description": "Human-readable description",
  "constructor": {
    "apiKey": "string",
    "env": "dev | staging | prod",
    "version": "string",
    "appName": "string (optional)"
  },
  "operation": "trackSchemaFromEvent",
  "input": {
    "eventName": "string",
    "eventProperties": {},
    "streamId": "string (optional)"
  },
  "precondition": { "samplingRate": 1.0 },
  "mock_response": { "status": 200, "body": { "samplingRate": 1.0 } },
  "expected_request_body": [ { "...": "..." } ],
  "expected_request_headers": { "content-encoding": null },
  "expected_request_count": 1,
  "expected_promise_outcome": "resolve | reject",
  "expected_resolve_value": [],
  "notes": "string (optional)"
}
```

### Field Definitions

| Field | Required | Description |
|---|---|---|
| `fixture_id` | YES | Unique identifier (e.g., `"wire-1"`). |
| `description` | YES | Human-readable description. |
| `constructor` | YES | Options passed verbatim to the SDK constructor. |
| `operation` | YES | SDK method to invoke: `"trackSchemaFromEvent"`. |
| `input` | YES | Operation-specific input. `streamId` is optional; when absent, `streamId` MUST be `""` in the wire body. |
| `precondition` | NO | State to establish before invoking the operation. Harness MUST apply `samplingRate` override via internal setter or test hook before calling the operation. |
| `mock_response` | NO | Response the mock server returns. `null` means no HTTP call is expected — the mock server is still started and the SDK still pointed at it, so any erroneous send is captured locally (fail-closed) and the runner asserts zero requests. |
| `expected_request_body` | NO | Array of expected JSON request bodies. Use when one or more HTTP calls are expected. |
| `expected_request_headers` | NO | Object asserting request headers (case-insensitive names). A string value means the header MUST be present and equal; `null` means the header MUST be absent. See [runner-contract.md](../runner-contract.md#expected_request_headers-assertions). |
| `expected_request_count` | NO | Expected number of HTTP calls. `0` asserts no HTTP call was made. When `expected_request_body` is present, count is implied by array length. |
| `expected_promise_outcome` | YES | `"resolve"` or `"reject"`. |
| `expected_resolve_value` | NO | Expected resolved value. May be omitted if the resolved value is unimportant. |
| `notes` | NO | Human-readable notes for implementors. Not used for assertion. |

## Running the Suite

See [`conformance/runner-contract.md`](../runner-contract.md) for the full harness protocol. The wire-protocol suite requires:

1. Start a local mock HTTP server.
2. Set `AVO_INSPECTOR_MOCK_ENDPOINT` to the mock server URL.
3. Invoke the harness once per fixture via stdin/stdout JSON protocol.
4. After each harness exit, query `GET /requests` on the mock server to retrieve captured requests.
5. Compare captured request bodies against `expected_request_body` using format-validation for placeholder fields.

## Conformance Definition

An SDK **passes** the wire-protocol suite when all 8 fixtures pass:

- `wire-1`: The harness exits with code `0` and the mock server recorded exactly 1 request matching the
  expected body (with format validation applied to placeholder fields).
- `wire-2`: The harness exits with code `0` and the mock server recorded exactly 0 requests.
- `wire-3`: The harness exits with code `0` (promise resolved, not rejected).
- `wire-4`: The harness exits with code `0` and the mock server recorded a request with `streamId`
  equal to `"stream:with:colons"` exactly.
- `wire-5`: The harness exits with code `0` and the mock server recorded a request with `streamId` equal to `""` exactly.
- `wire-6`: The harness exits with code `0` and the mock server recorded exactly 1 request carrying
  `Content-Encoding: gzip` whose gunzipped body matches the expected body. A `gzip`-labeled body that fails
  to gunzip is a failure. (An SDK on a runtime with no gzip implementation is exempt from the header
  assertion per SPEC.md §7.3.5 and MUST document the limitation; it must still send a correct uncompressed body.)
- `wire-7`: The harness exits with code `0` and the mock server recorded exactly 1 request with **no**
  `Content-Encoding` header (the body is below the 1024-byte gzip threshold, so it MUST be sent uncompressed).
- `wire-8`: The harness exits with code `0`, the promise resolves, and the mock server recorded **0**
  requests — with `env: "staging"` and `batchSize: 30`, a single tracked event is buffered (below the
  size threshold) and MUST NOT be sent before a flush (SPEC.md §12.3).
