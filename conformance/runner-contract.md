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
3. If `suite` is `"schema-extraction"`: treat the entire `input` field as the `eventProperties`
   argument to `extractSchema()` and proceed to step 5.
   Otherwise: construct an `AvoInspector` instance using the `constructor` options from the
   envelope.
4. Apply any `precondition` state (see [`precondition` field](#precondition)).
5. Invoke the operation named in the `operation` field (or `extractSchema()` for the
   `schema-extraction` suite) with the appropriate input.
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
| `suite` | string | YES — injected by runner | Suite identifier: `"schema-extraction"`, `"wire-protocol"`, `"deduplication"`, or `"error-handling"`. NOT present in fixture files; the suite runner MUST inject this field from the parent directory name before passing the envelope to the harness. |
| `fixture_id` | string | YES | Unique identifier for this fixture (e.g., `"wire-1"`, `"fixture-3"`). MUST be echoed in the output envelope. |
| `constructor` | object | YES — except `schema-extraction` | Options passed verbatim to the `AvoInspector` constructor. Absent for `schema-extraction` fixtures; the harness MUST NOT require it when `suite` is `"schema-extraction"`. |
| `operation` | string | YES — except `schema-extraction` | SDK method to invoke: `"extractSchema"`, `"trackSchemaFromEvent"`, or `"_avoFunctionTrackSchemaFromEvent"`. Absent for `schema-extraction` fixtures; the harness MUST call `extractSchema()` directly when `suite` is `"schema-extraction"`. |
| `input` | object | YES | Operation-specific input payload. For `schema-extraction`, the entire `input` object IS the `eventProperties` argument. For other suites, shape depends on `operation` (see below). |
| `precondition` | object | NO | State to apply to the SDK instance before invoking the operation. See [`precondition`](#precondition). |
| `mock_response` | object or null | NO | Response configuration for the mock server. Present only when a wire-protocol HTTP call is expected. `null` means no HTTP call is expected. |

### `constructor` object

| Field | Type | Required | Description |
|---|---|---|---|
| `apiKey` | string | YES | Inspector API key. |
| `env` | string | YES | One of `"dev"`, `"staging"`, `"prod"`. |
| `version` | string | YES | Application version string. |
| `appName` | string | NO | Application name. Defaults to `""` if absent. |
| `publicEncryptionKey` | string | NO | P-256 public key in hex (66 or 130 chars). Present only for encryption-related fixtures. |

### `operation` values and `input` shapes

**`"extractSchema"`** — calls `inspector.extractSchema(eventProperties)`:

```json
{
  "eventProperties": { "key": "value" }
}
```

`eventProperties` MAY be `null` (fixture-8). The harness MUST pass `null` through to the SDK.

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

**`"_avoFunctionTrackSchemaFromEvent"`** — calls
`inspector._avoFunctionTrackSchemaFromEvent(eventName, eventProperties, eventId, eventHash, streamId?)`:

```json
{
  "eventName": "Event Name",
  "eventProperties": { "key": "value" },
  "eventId": "avo-event-id",
  "eventHash": "avo-event-hash",
  "streamId": "optional-stream-id"
}
```

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
| `actual` | any | YES | The raw output of the operation. For `extractSchema`: the returned array. For `trackSchemaFromEvent`/`_avoFunctionTrackSchemaFromEvent`: the resolved value (array) or rejection reason (string). |
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
| `1` | Fail — the operation produced a result that the harness determined was wrong, OR the promise was rejected when a resolve was expected (or vice versa). Harnesses MAY use exit code `1` for assertion failures when they perform inline checking; otherwise exit `0` and let the suite runner assert. |
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
| `"<uuid-v4>"` | `messageId` | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` |
| `"<iso8601>"` | `createdAt` | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` — millisecond suffix (`.000Z`) MUST be present. |
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
  SPEC.md §7.3.7). When the request carries a `Content-Encoding: gzip` header, the mock server
  MUST gunzip the raw bytes before parsing the JSON body. When the header is absent, the body
  MUST be parsed as-is.
- Response: the HTTP status and body from the fixture's `mock_response` field.
- If `mock_response` is `null`, the mock server SHOULD NOT be started (the fixture expects zero
  HTTP calls). The suite runner MUST verify that zero requests were made.

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
(`{ "content-encoding": null }`), or that a specific header value was sent. Because gzip
compression is OPTIONAL (SPEC.md §7.3.7), a fixture for a large body MUST NOT assert
`content-encoding: "gzip"` as a literal — doing so would fail a conformant SDK that opts out of
compression. Use `expected_request_headers` only for headers whose presence/absence is
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
- [ ] Harness exits with code `0` on success, `1` on assertion failure, and `2` on
      configuration/envelope errors.
- [ ] Harness handles all three `operation` values: `"extractSchema"`,
      `"trackSchemaFromEvent"`, and `"_avoFunctionTrackSchemaFromEvent"`.
- [ ] Harness does not persist state between invocations — each run constructs a fresh
      `AvoInspector` instance.

---

## Conformance Reporting

### Passing criteria

An SDK is considered conformant when:

- All non-OPTIONAL fixtures in the `schema-extraction` suite pass.
- All fixtures in the `wire-protocol` suite pass.
- All fixtures in the `error-handling` suite pass.
- Fixtures in the `deduplication` suite are OPTIONAL (SHOULD pass). Dedup conformance is
  strongly recommended but does not block a conformance pass grade.

### Reporting format

Suite runners SHOULD produce a conformance report with the following structure per fixture:

```text
[PASS] fixture-1 — Basic primitives
[PASS] wire-1 — Basic event send
[FAIL] wire-2 — Sampling drop: expected 0 HTTP calls, got 1
[SKIP] dedup-1 — (deduplication is OPTIONAL)
```

### Versioning

The harness contract follows the same versioning policy as the spec (`VERSIONING.md`). The
contract version is `1.0.0`. Breaking changes to the input/output envelope schema or exit code
semantics MUST increment the MAJOR version. Additive fields (new optional input or output
fields) MUST increment the MINOR version.

SDK authors SHOULD record which version of the runner contract their harness implements (e.g.,
in a `HARNESS_CONTRACT_VERSION` constant or a comment at the top of the harness source file).
