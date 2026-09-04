# Wire-Protocol Conformance Suite

This suite verifies that an SDK sends correct HTTP requests to the Inspector API, handles responses correctly,
and correctly handles `streamId` edge cases.

## Fixtures

| Fixture ID | Description |
|---|---|
| `wire-1` | Basic event send — happy path with primitive properties, plus the SPEC.md §7.2 required request headers (`api-key`, `env`, `X-Avo-Client`, `Content-Type`) |
| `wire-2` | Sampling drop — `samplingRate = 0.0` produces zero HTTP calls |
| `wire-3` | Non-200 response — SDK resolves (does not reject) |
| `wire-4` | `streamId` with colons — verbatim passthrough as `streamId` (spec Edge Case 9) |
| `wire-5` | Empty `streamId` — `streamId` becomes `""` (spec Edge Case 10) |
| `wire-6` | Large body (≥ 1024 bytes) — MUST be gzip-compressed on any gzip-capable runtime (SPEC.md §7.3.5); transparent after gunzip |
| `wire-7` | Small body (< 1024 bytes) — MUST be sent uncompressed (no `Content-Encoding` header) |
| `wire-8` | Batching — `env: staging` + `batchSize: 30`; one tracked event is buffered, not sent (0 HTTP calls before flush) (SPEC.md §12) |
| `wire-9` | Gateway fields — `options.outputReference` + `originHint` + `appVersion` all set, all padded → all three on the wire as top-level siblings of `eventProperties`, trimmed, with internal line terminators preserved (SPEC.md §4.2.1, §7.3.6) |
| `wire-10` | `originHint` set (padded, trimmed on the wire) with no `appVersion` → `appVersion` is a literal `null`; `outputReference` absent (SPEC.md §7.3.6 table row 2) |
| `wire-11` | `outputReference` + `appVersion` set (padded, trimmed), no `originHint` → `appVersion` overrides the constructor version; `originHint` absent (SPEC.md §7.3.6 table row 3) |
| `wire-12` | Empty / whitespace-only options → both gateway keys absent (never `null` / `""`), `appVersion` falls back to the constructor version; body identical to the no-options shape (SPEC.md §7.3.6 table row 4) |
| `wire-13` | Property-name collision — event properties literally named `outputReference` / `originHint` / `appVersion` stay in the schema untouched while the top-level gateway fields come from `options` only (SPEC.md §7.3.6) |

> **Batching coverage.** The `dev` fixtures (`wire-1`–`wire-7`, all `env: "dev"`) run with
> `batchSize` forced to 1, so they also serve as the automated check for the immediate-send
> (`batchSize == 1`) batching path, and `wire-8` covers buffered-not-sent. Multi-event batching
> (size-trigger flush, `flush()` drain, `destroy()` discard, `maxQueueSize` overflow, non-200
> no-requeue) is automated by the dedicated [`batching` suite](../batching/README.md); the two
> behaviors that need a controllable clock or a connection-drop mock — the SHOULD-level time/idle
> flush (SPEC.md §12.3) and the MUST-level transient send-failure drop (SPEC.md §12.5, where the
> batch MUST NOT be re-queued or retried) — are in the manual matrix in
> [`../README.md`](../README.md).

## Required Request Headers

Every request to the Inspector API carries `api-key`, `env`, `X-Avo-Client` and
`Content-Type: application/json` (SPEC.md §7.2). The suite runner asserts all four on **every**
captured request in every suite, whether or not the fixture declares an `expected_request_headers`
block:

- `api-key` — a non-empty string, **and** equal to the `apiKey` of every event in that request's body.
- `env` — exactly `dev` / `staging` / `prod`, **and** equal to the `env` of every event in that body.
- `x-avo-client` — non-empty, **and** equal to the `libPlatform` of every event in that body.
- `content-type` — media type exactly `application/json`. A server SDK MUST NOT send `text/plain`;
  that is the browser-SDK CORS workaround and `/inspector/v2/track` mishandles such a body.

The three header/body equalities matter because all three headers and their body counterparts come
from the same constructor options (SPEC.md §7.3.1) — without the cross-check an SDK could send a
well-formed header set describing a different instance than the body does. `Content-Length` is the
fifth §7.2 REQUIRED header and is *not* asserted: the HTTP stack sets it, and a chunked request
legitimately omits it. See [runner-contract.md](../runner-contract.md#required-request-headers).

`wire-1` additionally pins the exact values: `api-key: "test-key"` and `env: "dev"` come from its
`constructor` block, and `x-avo-client` is format-validated with `"<sdk-platform>"` because the
token differs per SDK. `batch-1` pins the same headers with `env: "staging"`, so an SDK that
hardcodes either value fails one of the two fixtures.

## How It Works

For wire-protocol fixtures, the suite runner starts a local HTTP mock server before invoking the harness
and passes its URL via the `AVO_INSPECTOR_MOCK_ENDPOINT` environment variable. The override replaces
the request URL only — the SDK MUST still send every header above.

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
| `"<absent>"` | any key (`outputReference` / `originHint`) | The key MUST NOT be present on the captured event at all — not `null`, not `""`. Asserts the omission rule of SPEC.md §7.3.6; the runner otherwise tolerates extra keys, so omission needs an explicit placeholder. |

The first four placeholders may also appear as `expected_request_headers` values, where they
validate a header by the same rule (`"<sdk-platform>"` for `x-avo-client`). `"<absent>"` has no
meaning for a header — assert an absent header with `null`.

The four format-validated fields are **required** on every event sent. A missing field is a
conformance failure. `"<absent>"` is the inverse: presence is the failure. A literal `null` expected
value (e.g. `"appVersion": null` in `wire-10`) requires a literal JSON `null` on the wire.

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
    "streamId": "string (optional)",
    "options": { "outputReference": "string (optional)", "originHint": "string (optional)", "appVersion": "string (optional)" }
  },
  "precondition": { "samplingRate": 1.0 },
  "mock_response": { "status": 200, "body": { "samplingRate": 1.0 } },
  "expected_request_body": [ { "...": "..." } ],
  "expected_request_headers": { "api-key": "test-key", "env": "dev", "x-avo-client": "<sdk-platform>", "content-encoding": null },
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
| `input` | YES | Operation-specific input. `streamId` is optional; when absent, `streamId` MUST be `""` in the wire body. `options` is optional (SPEC.md §4.2.1); when present the harness passes it verbatim as the fourth argument, when absent the harness omits the argument. |
| `precondition` | NO | State to establish before invoking the operation. Harness MUST apply `samplingRate` override via internal setter or test hook before calling the operation. |
| `mock_response` | NO | Response the mock server returns. `null` means no HTTP call is expected — the mock server is still started and the SDK still pointed at it, so any erroneous send is captured locally (fail-closed) and the runner asserts zero requests. |
| `expected_request_body` | NO | Array of expected JSON request bodies. Use when one or more HTTP calls are expected. |
| `expected_request_headers` | NO | Object asserting request headers (case-insensitive names). A literal string means the header MUST be present and equal; a placeholder (e.g. `"<sdk-platform>"`) validates by format; `null` means the header MUST be absent. Independently of this field, the runner always asserts the SPEC.md §7.2 required headers on every captured request. See [runner-contract.md](../runner-contract.md#expected_request_headers-assertions). |
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

An SDK **passes** the wire-protocol suite when all 13 fixtures pass:

- `wire-1`: The harness exits with code `0` and the mock server recorded exactly 1 request matching the
  expected body (with format validation applied to placeholder fields) and carrying
  `api-key: test-key`, `env: dev` and a non-empty `X-Avo-Client` equal to the event's `libPlatform`
  (SPEC.md §7.2).
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
- `wire-9`: exactly 1 request whose event carries `outputReference`, `originHint` and
  `appVersion: "4.2.0"` (the per-event override, not the constructor's `"1.0.0"`) as top-level keys,
  with `eventProperties` unchanged. All three inputs are padded, so the fixture also pins that
  normalization is trim-only: surrounding whitespace is removed while the LF inside
  `outputReference` and the CR inside `originHint` survive byte for byte. An SDK that strips or
  collapses internal line terminators fails this fixture.
- `wire-10`: exactly 1 request with `originHint: "android"` (input was `"  android  "`), a literal
  `appVersion: null`, and **no** `outputReference` key.
- `wire-11`: exactly 1 request with `outputReference: "meta-x7k2q"` and `appVersion: "4.2.0"` (both
  trimmed), and **no** `originHint` key.
- `wire-12`: exactly 1 request with **neither** gateway key present and `appVersion: "1.0.0"` (constructor
  fallback) — whitespace-only / empty option values are treated as absent and never serialized.
- `wire-13`: exactly 1 request whose `eventProperties` still contains the four properties (`outputReference`
  string, `originHint` int, `appVersion` boolean, `plan` string) while the top-level `outputReference` /
  `originHint` come from `options` and `appVersion` is `null` (originHint set, no override).
