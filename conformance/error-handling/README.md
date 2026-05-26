# Error-Handling Conformance Suite

This suite verifies that an SDK handles error conditions and boundary values correctly — specifically
that promises resolve (not reject) in all non-SDK-internal-error cases, and that boundary sampling
values behave as specified.

## Fixtures

| Fixture ID | Description |
|---|---|
| `error-1` | `samplingRate=1.0` boundary — always sends (1 HTTP call expected) |
| `error-2` | Non-200 HTTP response (400) — SDK MUST resolve, not reject |
| `error-3` | Empty `eventProperties` — schema extracts to `[]`, promise resolves with `[]` |

## Error Taxonomy

All error-handling fixtures map to SPEC.md Section 7.5 (Error Taxonomy). The full table is:

| Error category | Promise outcome | Logged? | Retry? |
|---|---|---|---|
| SDK internal error (unexpected synchronous exception) | `reject("Avo Inspector: something went wrong. Please report to support@avo.app.")` | Yes, via `console.error` | No |
| Network timeout (10 s exceeded) | `resolve(eventSchema)` — swallowed inside send handler | Yes, via `console.error` | No |
| Network error (DNS, connection refused, TLS) | `resolve(eventSchema)` — same swallowing behavior | Yes, via `console.error` | No |
| Non-200 HTTP response (4xx, 5xx) | `resolve([])` — resolve, NOT reject | Yes, in dev/staging with logging enabled | No |

The fixtures in this suite cover the **non-200** case (`error-2`) and boundary **sampling** case
(`error-1`). Network timeout and network error are not directly testable via the mock server
protocol and MUST be verified by the SDK author via unit tests.

## Fixture Details

### error-1 — Sampling Boundary: `samplingRate=1.0`

The `precondition` field instructs the harness to set `samplingRate` to `1.0` before invoking the
operation. At `samplingRate=1.0`, a random value drawn from `[0.0, 1.0)` is never `> 1.0`, so
the event MUST always be sent.

This is the upper-boundary complement to `wire-2` (which tests `samplingRate=0.0`, the drop-all
boundary). Together they bracket the sampling behavior.

### error-2 — Non-200 Response

The mock server returns HTTP 400. The SDK MUST:

1. Attempt the HTTP call (the request IS sent).
2. Receive the 400 response.
3. Resolve the promise with `[]` (NOT reject).
4. Optionally log the status code (SHOULD log in dev/staging with logging enabled).

An SDK that rejects the promise on non-200 fails this fixture.

### error-3 — Empty `eventProperties`

`eventProperties: {}` is a valid input, not an error. The schema extractor returns `[]` for an
empty object. The SDK MUST:

1. Extract the schema → `[]`.
2. Send the HTTP request with `eventProperties: []` in the wire body.
3. Resolve the promise with `[]`.

This fixture confirms that empty input is handled gracefully without throwing or rejecting.

## Scenarios Requiring Manual Testing

The following error-handling scenarios cannot be expressed as single-invocation harness fixtures
and MUST be tested manually or via SDK-level unit tests:

### Network Timeout

Configure an HTTP client with a very short timeout (or mock a server that never responds) and
verify that:

- `trackSchemaFromEvent` still resolves (does not reject).
- The resolved value is the extracted event schema (not `[]`).
- The timeout error is logged via `console.error` (or language equivalent).

### Network Error (DNS / Connection Refused)

Point the SDK at an unreachable endpoint and verify:

- `trackSchemaFromEvent` resolves (does not reject).
- The resolved value is the extracted event schema.
- The error is logged.

### SDK Internal Error

Introduce a bug in the schema extraction path (or use a mock) that causes a synchronous exception
inside `trackSchemaFromEvent`. Verify:

- The promise rejects with exactly `"Avo Inspector: something went wrong. Please report to support@avo.app."`.
- The original error object is appended in the `console.error` call.

## Conformance Definition

An SDK **passes** the error-handling suite when all 3 fixtures pass:

- `error-1`: Harness exits with code `0` and mock server recorded exactly 1 request.
- `error-2`: Harness exits with code `0` (promise resolved, not rejected); resolved value is `[]`.
- `error-3`: Harness exits with code `0`; mock server recorded 1 request with `eventProperties: []`;
  resolved value is `[]`.

## Running the Suite

See [`conformance/runner-contract.md`](../runner-contract.md) for the full harness protocol.
The error-handling suite requires a mock HTTP server (`AVO_INSPECTOR_MOCK_ENDPOINT`) for all
three fixtures.
