# Feature Spec: spec-first-server-sdk

**Feature Name:** spec-first-server-sdk
**Created:** 2026-05-25
**Status:** Draft v1

---

## Problem Statement

Avo receives requests for Inspector SDKs in languages beyond Node.js (Ruby, Python, Rust, Scala, C#, Go, etc.). Staffing and maintaining N independent hand-written implementations across language ecosystems is prohibitive. The Inspector HTTP wire protocol is stable and well-understood; the correct long-term strategy is to distribute one canonical specification plus a conformance suite, and let customers (or their AI coding agents) generate conformant SDKs on demand.

This spec defines the content and structure of a new public repository, `avohq/spec-first-inspector-server-sdk`, which serves as the single source of truth for all future server-side Inspector SDK implementations. It is Avo's first "AI-native open source" artifact: optimized for AI agent consumption, not hand-written SDKs.

---

## Goals

1. A customer with a Ruby ask can generate a working, conformant Ruby Inspector SDK in under one hour by pointing their AI agent at the spec repo.
2. Avo eliminates the need to staff or maintain Ruby, Python, Rust, Scala, C#, or Go SDKs.
3. All generated SDKs across languages behave identically on the wire — verified by the shared conformance suite.
4. The spec is durable: a single update to the spec repo (when the Inspector wire protocol evolves) triggers regeneration of all downstream SDKs without human SDK-authoring work.
5. The spec is version-controlled with semver; CHANGELOG entries explicitly distinguish wire-protocol changes from clarifications.

---

---

## User Stories Overview

1. **As a customer developer** using Ruby (or Python, Rust, Go, etc.), I want to point my AI agent at `avohq/spec-first-inspector-server-sdk`, run a single prompt, and get a working Inspector SDK for my language — without waiting for Avo to release one.
2. **As an Avo engineer**, I want a single place to update when the Inspector wire protocol changes, so all downstream language SDKs can be regenerated without per-language SDK work.
3. **As an AI coding agent** (Claude, Cursor, Codex, Gemini), I want machine-readable contracts (OpenAPI, JSON Schema, conformance fixtures) plus explicit `MUST`/`SHOULD`/`MAY` language so I can generate a conformant SDK with minimal ambiguity.
4. **As a customer engineer reviewing a generated SDK**, I want human-readable prose alongside the machine-readable contracts so I can audit correctness without reading source code.
5. **As an Avo engineering team**, I want a conformance suite that any SDK author can run to prove correctness, so Avo does not need to review or certify individual generated SDKs.
6. **As a spec consumer**, I want a clear CHANGELOG that tells me whether a spec update requires regenerating or just re-reading, so I can decide how urgently to act.
7. **As a customer running a serverless function or long-running server process**, I want the generated SDK to not block process shutdown — keepalive/flush behavior must be explicitly specified.

---

## Affected Areas

The spec repo is a new repository (`avohq/spec-first-inspector-server-sdk`). The table below describes the proposed top-level file layout. See also the **Proposed Spec Repo Layout** section for the full tree.

| Area | Description |
|---|---|
| `README.md` | Human-oriented overview: what this repo is, how to generate an SDK, quick start |
| `AGENTS.md` | AI-agent-oriented guide: step-by-step SDK generation instructions, checklist, pitfalls |
| `SPEC.md` | Full normative prose specification (or split into `spec/` subdirectory) |
| `openapi.yaml` | OpenAPI 3.1 document covering the Inspector HTTP API |
| `schemas/` | JSON Schema files for each data shape (event body, property, etc.) |
| `conformance/` | Language-agnostic test fixtures (JSON) and runner contract (markdown) |
| `CHANGELOG.md` | Semver-tagged changelog distinguishing wire-protocol changes from clarifications |
| `VERSIONING.md` | Versioning policy: semver rules, when downstream SDKs must regenerate |
| `LICENSE` | MIT license |

---

---

## Constraints

- The spec MUST be optimized for AI agent consumption: exhaustive examples, RFC 2119 normative language, machine-readable schemas.
- The spec MUST NOT prescribe language-specific idioms (class vs. module, checked exceptions, etc.) — only behavior and wire format.
- The spec MUST be permissively licensed (MIT) so generated SDKs can use any license the customer chooses.
- The conformance suite MUST be language-agnostic: JSON/YAML fixtures + a documented runner contract, not a test runner in any specific language.
- v1 of the spec MUST cover only server-side use cases. Browser/client-side concerns are out of scope.

---

## Out of Scope

- Hosting, publishing, or packaging generated SDKs (RubyGems, PyPI, Crates.io, etc.).
- Browser/client-side SDK concerns (localStorage, page events, visitorId, etc.).
- Telemetry or usage reporting from generated SDKs (flagged as open question).
- Avo Codegen integration specifics — SDK authors MAY implement it but it is not required for minimal conformance.
- Event-spec validation — deferred to spec v2 (see "Event-Spec Validation" section).

---

## Edge Cases

1. **Empty event properties map** — `extractSchema({})` MUST return an empty list, not throw.
2. **Null/undefined top-level input** — `extractSchema(null)` MUST return an empty list, not throw.
3. **Empty array property** — value `[]` MUST yield type `list(string)` (default when first element is absent).
4. **Array with heterogeneous types** — type is determined by the first element only (e.g., `[1.2, "two"]` → `list(float)`).
5. **Array with duplicate values** — duplicates MUST be removed before type determination (dedup per primitive type bucket, object identity for objects).
6. **Nested object properties** — MUST include a `children` field containing the recursively extracted schema.
7. **`0.0` (float zero)** — MUST be classified as `"float"`. The language's native type (float/double) takes precedence. The cross-language rule: **if the runtime type is integer → `"int"`; if the runtime type is float/double → `"float"`; for JS-style runtimes where `0.0` and `0` are the same value, classify as `"float"`.**
8. **`undefined` value** — MUST be classified as `null`.
9. **streamId containing `:`** — MUST warn and MUST still send the event (colon is not a fatal error).
10. **Empty string streamId** — MUST be treated as "no stream ID"; `anonymousId` in the request body becomes `""`.
11. **Invalid env string** — MUST silently fall back to `dev` and warn; MUST NOT throw.
12. **Missing apiKey or version** — MUST throw an error at constructor time (not at first send).
13. **Whitespace-only apiKey or version** — MUST throw (same as missing).
14. **Network timeout (10 s)** — the internal HTTP-handler promise MUST reject with the exact string `"Request timed out"`; MUST NOT retry automatically (fire-and-forget per call, no retry loop). The outer `trackSchemaFromEvent` promise MUST still resolve with the extracted schema — the network failure MUST NOT propagate to the caller.
15. **Non-200 response** — MUST log in dev/staging; MUST resolve (not reject) the promise; sampling rate update is skipped.
16. **200 response with `samplingRate` field** — MUST update internal sampling rate. Value MUST be in [0.0, 1.0].
17. **(If dedup implemented) Dedup across streams** — two calls with different `streamId` values for the same event+params MUST NOT be deduplicated.
18. **(If dedup implemented) Dedup window expiry** — events older than 500 ms MUST be evicted; a subsequent duplicate MUST be registered.
19. **Keepalive timer** — timer MUST be started when the first pending operation is registered and MUST be cleared when `pendingCount` drops to zero.
20. **`destroy()` call** — MUST clear keepalive timer and reset pending count; subsequent calls to `trackSchemaFromEvent` SHOULD still work (timer is re-created if needed).

---

## Acceptance Criteria

1. [ ] Spec repo structure is defined with a file-tree showing what lives where and why.
2. [ ] Public API surface is fully inventoried with method signatures, return types, semantics, and idiomatic naming guidance for target languages.
3. [ ] Constructor options are documented with types, defaults, validation rules, and thrown error messages.
4. [ ] Env enum is documented with exact wire string values (`"dev"`, `"staging"`, `"prod"`) and behavioral implications per value.
5. [ ] HTTP wire protocol is fully specified: endpoint URL, HTTP method, request headers, request body JSON schema, response body schema, timeout, error behavior.
6. [ ] Batching/sampling behavior is documented: sampling rate default (1.0), server-controlled update mechanism, drop behavior on sample-out.
7. [ ] Schema extraction algorithm is specified with at least 10 golden conformance fixtures covering all primitive types, nested objects, arrays, nulls, empty inputs, and edge cases.
8. [ ] Deduplication behavior is specified as OPTIONAL (node-specific optimization); when implemented, the 500 ms window, per-stream keying, and codegen-vs-manual two-bucket logic MUST be followed.
9. [ ] Server-side requirements (thread/async safety, no persistent storage, no sessionId/visitorId, optional keepalive) are explicitly stated with RFC 2119 normative language.
10. [ ] An `AGENTS.md` guide is included, written for AI agent consumption, with all of the following required sections: (1) What to build — one-paragraph summary, (2) Files to read and in what order — ordered list of spec repo files with purpose, (3) SDK generation checklist — minimum 10 binary pass/fail items, (4) How to run conformance — exact command invocation, (5) Definition of done — exact criteria an agent must satisfy before declaring the SDK complete.
11. [ ] Conformance suite shape is defined: directory layout, fixture JSON schema, runner contract, how an SDK author wires it up.
12. [ ] Versioning and CHANGELOG conventions are documented; wire-protocol changes vs. clarifications are distinguished.
13. [ ] Source-of-truth strategy is documented (wire protocol is the source of truth; this spec describes how SDKs implement it).
14. [ ] Encryption feature (`publicEncryptionKey`) is documented as opt-in with exact wire format, algorithm, and applicability rules.
15. [ ] Open questions (API doc availability, auth key handling, SDK license) are tracked.
16. [ ] Schema-extraction fixtures 1–13 are present as machine-readable JSON in `conformance/schema-extraction/fixtures.json` using the `{ input, expected }` schema defined in this spec.
17. [ ] Runner contract defines a CLI entry point and stdin/stdout JSON protocol sufficient for an AI agent to write the harness without additional research — no TBD sections in `runner-contract.md`.
18. [ ] Non-Node SDKs implement `flush(timeoutMs?)` that resolves (not rejects) once all pending sends complete or are abandoned; `flush()` resolves even when in-flight requests timeout or error during the flush window.
19. [ ] After `destroy()` is called, `pendingCount` is 0 and the keepalive timer is cleared; a subsequent `trackSchemaFromEvent` call MUST succeed and MUST re-create the keepalive timer if a new pending operation is registered. **Note:** The conformance suite does not test multi-step lifecycle sequences — this criterion MUST be manually verified by the SDK author. The behavioral requirement is normative; conformance fixture coverage is intentionally omitted because the harness protocol is single-invocation.

---

---

### Conformance Runner Contract (Normative)

The conformance suite is operationalized via a language-agnostic stdin/stdout JSON protocol. SDK authors implement a thin CLI harness; the suite runner drives it with fixture data and validates results. An SDK author MUST be able to implement and run the conformance suite without any tooling beyond what is specified here.

#### Harness Entry Point

A CLI binary named `avo-inspector-conformance` (language-idiomatic equivalent accepted, e.g. `bin/conformance`, `conformance.rb`, `conformance.py`). The binary is invoked once per fixture.

#### Invocation Protocol

```
echo '<fixture-json>' | avo-inspector-conformance
```

The harness reads exactly one line of JSON from stdin (the fixture input envelope), executes the operation, writes exactly one line of JSON to stdout (the result envelope), and exits.

**Input envelope (JSON, one line on stdin):**
```json
{
  "suite": "schema-extraction | wire-protocol | deduplication | error-handling",
  "fixture_id": "string",
  "constructor": {
    "apiKey": "string",
    "env": "dev | staging | prod",
    "version": "string",
    "appName": "string (optional)",
    "publicEncryptionKey": "string (optional)"
  },
  "operation": "extractSchema | trackSchemaFromEvent | _avoFunctionTrackSchemaFromEvent",
  "input": {},
  "precondition": { "samplingRate": 1.0 }
}
```

- `suite`: which conformance suite this fixture belongs to.
- `fixture_id`: the fixture identifier from `fixtures.json` (e.g., `"fixture-1"`).
- `constructor`: options passed to the SDK constructor. MUST be respected even if the harness uses a default instance.
- `operation`: the SDK method to invoke.
- `input`: operation-specific input (see fixture schemas in each suite's `fixtures.json`).
- `precondition` (optional): state to apply to the SDK instance BEFORE invoking the operation. The suite runner reads this field from the fixture and includes it in the stdin envelope; the harness MUST apply these overrides (e.g., set `samplingRate`) via internal setter or test hook before calling the operation. If absent, the SDK starts with its default state. Currently supported key: `"samplingRate"` (number). Example: `{ "samplingRate": 0.0 }` sets the SDK's internal sampling rate to 0.0 before the operation runs (used in Wire Fixture 2 to test sampling-drop behavior).

**Output envelope (JSON, one line on stdout):**
```json
{
  "fixture_id": "string",
  "passed": true,
  "actual": {},
  "error": null
}
```

- `passed`: `true` if actual output matches expected; `false` otherwise.
- `actual`: the raw output produced by the SDK method.
- `error`: `null` on success; error message string if the SDK threw or rejected unexpectedly.

**Exit codes:**
- `0`: fixture passed
- `1`: fixture failed (actual != expected, or SDK error on a non-error fixture)
- `2`: harness configuration error (bad input envelope, unrecognized operation)

**Environment variable:** `AVO_INSPECTOR_MOCK_ENDPOINT` — when set, the SDK under test MUST send HTTP calls to this URL instead of `https://api.avo.app`. The wire-protocol suite injects a local mock server URL here.

#### Format Validation Patterns (Normative)

Some wire body fields cannot be asserted by exact value (they vary per run). The suite runner MUST validate these fields by format instead of exact value. The following patterns are normative — implementations MUST match them; the suite runner MUST use them:

| Field | Format | Validation regex / rule |
|---|---|---|
| `messageId` | UUID v4, lowercase hex, hyphenated | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` |
| `createdAt` | ISO 8601 UTC with milliseconds | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` — Go implementations MUST use `time.Now().UTC().Format("2006-01-02T15:04:05.000Z")` to include the `.000Z` millisecond suffix. |
| `libVersion` | Plain SemVer string (e.g., `"1.2.0"`) | `/^\d+\.\d+\.\d+$/` |
| `libPlatform` | Non-empty string identifying SDK language | MUST be a non-empty string; suite runner accepts any non-empty value |

When a fixture's `expected_request_body` contains a placeholder value (e.g., `"<uuid-v4>"`, `"<iso8601>"`, `"<semver>"`, `"<sdk-platform>"`), the suite runner MUST validate that field using the corresponding regex or rule from the table above rather than comparing to the placeholder string exactly. The presence of a placeholder signals format-validation intent. All fields in this table that appear in `expected_request_body` MUST be present in the actual request body — they are required fields. An absent field is a conformance failure regardless of the format-validation rule.

#### Wire-Protocol Suite: Mock Server

For wire-protocol fixtures, the suite runner starts a local HTTP server before invoking the harness and passes its URL via `AVO_INSPECTOR_MOCK_ENDPOINT`. The mock server:
- Records incoming POST requests (headers + body).
- Returns a configurable response (specified in the fixture's `mock_response` field).
- Exposes a `GET /requests` endpoint that returns all recorded requests as a JSON array.

The suite runner calls `GET /requests` after the harness exits and compares the captured request bodies against `expected_request_body` in the fixture.

---

### Wire-Protocol Conformance Fixtures

The following examples define the normative fixture format for `conformance/wire-protocol/fixtures.json`. At minimum, these three fixtures MUST be present.

**Fixture format:**
```json
{
  "fixture_id": "string",
  "description": "string",
  "constructor": { ... },
  "operation": "trackSchemaFromEvent",
  "input": { "eventName": "string", "eventProperties": {}, "streamId": "string (optional)" },
  "precondition": { "samplingRate": 0.0 },
  "mock_response": { "status": 200, "body": { "samplingRate": 1.0 } },
  "expected_request_body": [ { ... } ],
  "expected_request_count": 0,
  "expected_promise_outcome": "resolve | reject",
  "expected_resolve_value": [],
  "notes": "string (optional)"
}
```

**Fixture format field definitions:**

| Field | Required | Description |
|---|---|---|
| `fixture_id` | YES | Unique identifier for the fixture (e.g., `"wire-1"`). |
| `description` | YES | Human-readable description of what the fixture tests. |
| `constructor` | YES | Options passed verbatim to the SDK constructor (see Constructor Options). |
| `operation` | YES | The SDK method to invoke: `"trackSchemaFromEvent"` or `"_avoFunctionTrackSchemaFromEvent"`. |
| `input` | YES | Operation-specific input object. For `trackSchemaFromEvent`: `{ "eventName", "eventProperties", "streamId?" }`. Fields marked `(optional)` MAY be omitted. When `streamId` is absent, the SDK MUST behave as if `streamId` was not provided (i.e., `anonymousId` is `""` in the wire body). |
| `precondition` | NO | State to establish in the SDK instance BEFORE invoking the operation. The harness MUST apply these overrides via internal setter or test hook. Currently supported: `{ "samplingRate": <number> }` — sets the SDK's internal sampling rate before the operation runs. If absent, the SDK starts with its default state (sampling rate `1.0`). |
| `mock_response` | NO | Response the mock server will return. If `null`, the mock server is not started (use when no HTTP call is expected). |
| `expected_request_body` | NO | Array of expected JSON request bodies captured by the mock server. Use when one or more HTTP calls are expected. Mutually exclusive with `expected_request_count: 0`. |
| `expected_request_count` | NO | Expected number of HTTP calls captured by the mock server. Use `0` to assert no HTTP call was made. When present alongside a `null` `mock_response`, the harness MUST verify the mock server recorded exactly this many requests. When `expected_request_body` is present, `expected_request_count` is implied by the length of that array. |
| `expected_promise_outcome` | YES | `"resolve"` or `"reject"` — the expected settlement of the promise returned by the operation. |
| `expected_resolve_value` | NO | The expected resolved value (for `"resolve"` outcomes). MAY be omitted if the resolved value is unimportant. |
| `notes` | NO | Human-readable notes for implementors. Not used for assertion. |

**Note on `(optional)` fields:** In fixture `input` objects, fields annotated `(optional)` MAY be omitted. When `streamId` is absent, the SDK MUST behave as if `streamId` was not provided — i.e., `anonymousId` in the wire body MUST be `""`. Wire Fixture 1 includes `streamId`; Wire Fixture 2 omits it. Both are valid fixture inputs.

**Wire Fixture 1 — Basic event send:**
```json
{
  "fixture_id": "wire-1",
  "description": "Basic event with primitive properties sends correct wire body",
  "constructor": { "apiKey": "test-key", "env": "dev", "version": "1.0.0", "appName": "TestApp" },
  "operation": "trackSchemaFromEvent",
  "input": { "eventName": "User Signed Up", "eventProperties": { "plan": "pro", "seats": 3 }, "streamId": "stream-abc" },
  "mock_response": { "status": 200, "body": { "samplingRate": 1.0 } },
  "expected_request_body": [
    {
      "apiKey": "test-key",
      "appName": "TestApp",
      "appVersion": "1.0.0",
      "libVersion": "<semver>",
      "env": "dev",
      "libPlatform": "<sdk-platform>",
      "messageId": "<uuid-v4>",
      "anonymousId": "stream-abc",
      "createdAt": "<iso8601>",
      "samplingRate": 1.0,
      "type": "event",
      "eventName": "User Signed Up",
      "eventProperties": [
        { "propertyName": "plan", "propertyType": "string" },
        { "propertyName": "seats", "propertyType": "int" }
      ],
      "avoFunction": false,
      "eventId": null,
      "eventHash": null
    }
  ],
  "notes": "libVersion, messageId, and createdAt are validated by format only (not exact value) — their placeholder values signal format-validation to the suite runner. libVersion must be a plain SemVer string (e.g., '1.2.0'). libPlatform must be a non-empty string matching the SDK language."
}
```

**Wire Fixture 2 — Sampling drop (no HTTP call):**
```json
{
  "fixture_id": "wire-2",
  "description": "Event is dropped when samplingRate is 0.0 (effectively drop all)",
  "constructor": { "apiKey": "test-key", "env": "dev", "version": "1.0.0" },
  "operation": "trackSchemaFromEvent",
  "input": { "eventName": "Dropped Event", "eventProperties": { "x": 1 } },
  "precondition": { "samplingRate": 0.0 },
  "mock_response": null,
  "expected_request_count": 0,
  "expected_promise_outcome": "resolve",
  "notes": "Harness must set internal samplingRate to 0.0 before invoking. No HTTP call should be made. Suite runner verifies zero captured requests at mock server."
}
```

**Wire Fixture 3 — Non-200 response resolves (not rejects):**
```json
{
  "fixture_id": "wire-3",
  "description": "Non-200 HTTP response resolves the promise (does not reject)",
  "constructor": { "apiKey": "test-key", "env": "dev", "version": "1.0.0" },
  "operation": "trackSchemaFromEvent",
  "input": { "eventName": "Test Event", "eventProperties": {} },
  "mock_response": { "status": 500, "body": {} },
  "expected_promise_outcome": "resolve",
  "expected_resolve_value": [],
  "notes": "SDK must resolve (not reject) on non-200. The promise value may be [] or the extracted schema depending on timing."
}
```

---

## Open Questions Resolved

None — open questions are intentionally deferred (see Open Questions section). The spec writer's job is to document them, not resolve them unilaterally.

---

## Dependencies

- `avohq/spec-first-inspector-server-sdk` — new GitHub repo to be created; this spec describes its content.
- GitHub Releases + semver tagging — required for versioned spec distribution.

---

## Extracted Contract

### Public API Surface

All public methods on `AvoInspector` with their normative signatures.

#### Constructor

```
new AvoInspector(options: {
  apiKey: string;           // REQUIRED
  env: "dev" | "staging" | "prod";  // REQUIRED
  version: string;          // REQUIRED
  appName?: string;         // OPTIONAL, defaults to ""
  publicEncryptionKey?: string;  // OPTIONAL, see Encryption section
})
```

**Validation at construction time (MUST throw if violated):**

| Option | Validation | Error message |
|---|---|---|
| `apiKey` | MUST be a non-empty, non-whitespace string | `"[Avo Inspector] No API key provided. Inspector can't operate without API key."` |
| `version` | MUST be a non-empty, non-whitespace string | `"[Avo Inspector] No version provided. Many features of Inspector rely on versioning. Please provide comparable string version, i.e. integer or semantic."` |
| `env` | If absent or empty string, falls back to `"dev"` with a console warning (does NOT throw) | — |
| `env` | If provided but not one of `"dev"`, `"staging"`, `"prod"`, falls back to `"dev"` with a console warning (does NOT throw) | — |

**Side effects at construction time:**

- If `env == "dev"`, logging is enabled by default (`shouldLog = true`).
- If `env != "dev"`, logging is disabled by default (`shouldLog = false`).
- If `env != "prod"` (i.e., dev or staging), event spec validation subsystem is initialized (optional enhancement; not required for minimal conformance).

---

#### `trackSchemaFromEvent`

```
trackSchemaFromEvent(
  eventName: string,
  eventProperties: { [propName: string]: any },
  streamId?: string
): Promise<Array<{ propertyName: string; propertyType: string; children?: any }>>
```

**Semantics:**

1. Constructs a stream-scoped dedup key. See the **Deduplication Behavior** section for the complete key formula: `streamId + "\0" + eventName`. If `streamId` is absent or empty, the key uses an empty prefix (i.e., the `streamId` segment is `""`). Event properties are stored alongside the key and compared via deep structural equality. Two calls with the same `streamId` and `eventName` but different `eventProperties` MUST NOT be deduplicated (the deep-equality check on properties will fail).
2. Checks the deduplicator: if the same event+properties combination was sent via Avo Codegen (the `avoFunctions` bucket) within the last 500 ms for the same stream, returns `Promise.resolve([])` without sending.
3. If not deduplicated: calls `extractSchema(eventProperties)`, then sends the extracted schema to the Inspector API.
4. Returns a promise that resolves to the extracted schema array (or `[]` if deduplicated).
5. On any synchronous internal error (e.g., `new AvoStreamId(streamId)` throwing), MUST log to `console.error` and MUST return `Promise.reject("Avo Inspector: something went wrong. Please report to support@avo.app.")` — reject with this exact string, NOT the original error's message.
6. MUST keep the process alive (via keepalive timer) until the network call completes, even if the caller does not await the promise.

**`streamId` rules:**

- Implementations SHOULD pass `streamId` through as-is. No hard validation on `streamId` is required; values are used verbatim in the dedup key and as `anonymousId` in the request body. Implementations MAY emit a warning if `streamId` contains `:`, but this is advisory only — the value MUST still be used unchanged.
- If absent/empty, `anonymousId` is `""`.

---

#### `extractSchema`

```
extractSchema(
  eventProperties: { [propName: string]: any },
  shouldLogIfEnabled?: boolean  // internal default: true
): Array<{ propertyName: string; propertyType: string; children?: any }>
```

**Semantics:**

- Synchronous. Does not send any network calls.
- Calls `AvoSchemaParser.extractSchema(eventProperties)`.
- Returns an empty array if `eventProperties` is `null`, `undefined`, or not provided.
- On any internal error, returns `[]` (never throws to the caller).

See the **Schema Extraction Algorithm** subsection for the full algorithm and golden fixtures.

---

#### `enableLogging`

```
enableLogging(enable: boolean): void
```

Sets the class-level `shouldLog` flag. Logging is class-wide (one flag for all instances), not per-instance.

**Cross-language implementation requirement:** `shouldLog` MUST be implemented as a process-wide global, not per-instance. In languages without class-level state:
- **Java:** `private static boolean logsEnabled = false` with `static` accessor methods
- **Go:** package-level `var shouldLog bool`
- **Python:** module-level variable `_should_log = False`
- **Ruby:** class-level variable `@@should_log = false`
- **Rust:** process-wide atomic (e.g., `static SHOULD_LOG: AtomicBool`)

An implementation where `enableLogging(true)` on one instance does not affect behavior of another instance is non-conformant.

---

#### `destroy`

```
destroy(): void
```

Cleans up all resources:
- Clears the keepalive timer.
- Resets `pendingCount` to 0.
- Destroys the event spec fetcher (if initialized).
- Flushes the event spec cache (if initialized).

**State after `destroy()` (normative):**

| Field | Post-destroy value | Notes |
|---|---|---|
| `pendingCount` | `0` | Reset; in-flight network calls are abandoned |
| `keepAliveTimer` | `null` / cleared | Timer is cancelled |
| `eventSpecFetcher` | `null` | Destroyed |
| `eventSpecCache` | `null` | Flushed and cleared |
| `eventValidator` | `null` | Cleared |
| `samplingRate` | persisted (NOT reset) | Value from last 200 response is retained |
| `apiKey`, `env`, `version`, `appName` | persisted (NOT reset) | Constructor options are retained |
| `shouldLog` (class-level) | persisted (NOT reset) | Class-level flag is not affected by instance destroy |

After `destroy()`, the instance SHOULD NOT be re-used. Generated SDKs MAY allow re-use (a subsequent call to `trackSchemaFromEvent` will re-create the keepalive timer if needed), but MUST document this behavior. `destroy()` does NOT flush pending in-flight requests — it abandons them. If the caller needs to ensure all events are delivered before shutdown, they MUST await the promise returned by `trackSchemaFromEvent` before calling `destroy()`. See also `flush()` in the Keepalive Timer section for non-Node SDKs.

---

#### `flush`

```
flush(timeoutMs?: number): Promise<void>  // or synchronous equivalent in the target language
```

Non-Node.js SDKs MUST implement `flush()`. Node.js SDKs MAY omit it (the keepalive timer serves the same purpose).

**Semantics:**

- Blocks (or returns a promise that resolves) until all pending sends initiated before the `flush()` call have either completed or been abandoned.
- Default `timeoutMs`: **10,000 ms** (10 seconds). Callers MAY pass a custom timeout.
- After `flush()` returns, all events that were in-flight at the time of the call have either been delivered or abandoned.
- `flush()` MUST resolve (not reject) even if one or more pending requests time out or error during the flush window. `flush()` is a completion guarantee, not a delivery guarantee. If a pending HTTP request times out or errors during the flush window, `flush()` MUST still resolve — it signals "all pending operations are done" regardless of their individual outcomes.
- `flush()` does NOT prevent the instance from being used further — unlike `destroy()`, it does not clear state. A subsequent call to `trackSchemaFromEvent` after `flush()` MUST work normally.
- `destroy()` is "cancel + clean up" (abandons in-flight requests, resets state). `flush()` is "wait + continue" (waits for completion, preserves state). These are distinct operations and MUST NOT be conflated.
- MUST be documented in the SDK README as required before process/function exit when events may be in-flight.

---

#### `_avoFunctionTrackSchemaFromEvent` (Avo Codegen integration — optional)

```
_avoFunctionTrackSchemaFromEvent(
  eventName: string,
  eventProperties: { [propName: string]: any },
  eventId: string,
  eventHash: string,
  streamId?: string
): Promise<Array<{ propertyName: string; propertyType: string; children?: any }>>
```

This method is called by Avo Codegen-generated code, not by the end user. It behaves identically to `trackSchemaFromEvent` but uses the `avoFunctions` dedup bucket (so manual-instrumented and codegen-instrumented calls can cross-detect duplicates). Generated SDKs MAY implement this method to support Avo Codegen integration.

**Same-bucket dedup clarification:** Calls within the same bucket (e.g., two `_avoFunctionTrackSchemaFromEvent` calls for the same event) are NOT suppressed. Codegen-generated code is assumed to call `_avoFunctionTrackSchemaFromEvent` exactly once per event invocation; if the same event fires twice from Codegen, both sends are intentional and MUST NOT be silently dropped. Double-calling from Codegen indicates a code generation bug and should not be masked by dedup.

---

### Constructor Options Table

| Name | Type | Required | Default | Semantics |
|---|---|---|---|---|
| `apiKey` | string | YES | — | Inspector API key obtained from the Avo Inspector dashboard. Sent in the request body as `apiKey`. MUST be non-empty. |
| `env` | `"dev"` \| `"staging"` \| `"prod"` | YES | Falls back to `"dev"` if invalid/absent | Controls logging defaults and encryption applicability. Sent in the request body as `env`. Exact string values are part of the wire protocol. |
| `version` | string | YES | — | Application version. Sent in the request body as `appVersion`. Comparable string (integer or semantic version). MUST be non-empty. |
| `appName` | string | NO | `""` | Application name. Sent in the request body as `appName`. |
| `publicEncryptionKey` | string | NO | `undefined` (no encryption) | P-256 public key in hex (compressed 66 chars or uncompressed 130 chars). When present in dev/staging, property values are ECIES-encrypted before sending. In prod, this option is accepted but encryption is NOT applied. |

---

### HTTP Wire Protocol

#### Endpoint

```
POST https://api.avo.app/inspector/v1/track
```

- **Scheme:** HTTPS only.
- **Host:** `api.avo.app`
- **Port:** 443 (implicit)
- **Path:** `/inspector/v1/track`
- **Method:** `POST`

#### Request Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Accept` | `application/json` |
| `Content-Length` | Byte length of the serialized JSON body |

Note: There is no `Authorization` header. Authentication is carried inside the JSON body via the `apiKey` field. See Open Questions for the auth discussion.

#### Request Body

The request body is a JSON array of event objects. Each call sends an array with exactly one element (no time-based batching in v1 — individual events are sent immediately).

```json
[
  {
    "apiKey": "string",
    "appName": "string",
    "appVersion": "string",
    "libVersion": "string",
    "env": "dev" | "staging" | "prod",
    "libPlatform": "<sdk-platform>",
    "messageId": "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
    "anonymousId": "string",
    "createdAt": "2026-05-25T12:00:00.000Z",
    "samplingRate": 1.0,
    "type": "event",
    "eventName": "string",
    "eventProperties": [ ... ],
    "avoFunction": false,
    "eventId": null,
    "eventHash": null
  }
]
```

**Base body fields (present on every event):**

| Field | Type | Description |
|---|---|---|
| `apiKey` | string | The Inspector API key passed to the constructor. |
| `appName` | string | `appName` constructor option (empty string if not provided). |
| `appVersion` | string | `version` constructor option. |
| `libVersion` | string | SDK library version. Implementations MUST set this to a plain SemVer string (e.g., `"1.2.0"`) — no suffix. Implementations MUST define a `VERSION` constant in a dedicated version file — runtime manifest reading is OPTIONAL. Language-specific canonical approaches: Node.js → version constant or `package.json`; Ruby → `AvoInspector::VERSION` constant in `lib/avo_inspector/version.rb`; Python → `importlib.metadata.version('avo-inspector')` (fallback to hardcoded constant if unavailable); Go → `const Version = "x.y.z"` in `version.go` (do NOT read `go.mod` for `libVersion`); Rust → `env!("CARGO_PKG_VERSION")` macro; all other languages → hardcoded constant in a dedicated version file. The SDK README MUST instruct maintainers to update the version constant on each release. |
| `env` | string | One of `"dev"`, `"staging"`, `"prod"` (exact wire values from `AvoInspectorEnv`). |
| `libPlatform` | string | A string identifying the SDK platform/language. Implementations MUST set this to an appropriate value identifying the language/runtime (e.g., `"node"`, `"ruby"`, `"python"`, `"go"`). |
| `messageId` | string | UUID v4 (random). MUST be unique per event. Format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`. |
| `anonymousId` | string | The caller-supplied `streamId`, or `""` if none. |

> **Note on dropped fields:** `trackingId` and `sessionId` are omitted from this spec. They carry no information and are not part of the wire protocol. Implementations MUST NOT send these fields.
| `createdAt` | string | ISO 8601 UTC timestamp at event send time (e.g., `"2026-05-25T12:00:00.000Z"`). |
| `samplingRate` | number | Current sampling rate [0.0, 1.0]. Initial value `1.0`. Updated from server response. |
| `publicEncryptionKey` | string? | Present only when a `publicEncryptionKey` was provided at construction AND it is non-empty. Absent when no encryption key. |

**Event-specific fields (`type: "event"`):**

| Field | Type | Description |
|---|---|---|
| `type` | `"event"` | Literal string. |
| `eventName` | string | Name of the tracked event. |
| `eventProperties` | array | Extracted schema (see Property Object below). When encryption is active, contains encrypted property objects. |
| `avoFunction` | boolean | `true` if sent via `_avoFunctionTrackSchemaFromEvent` (Codegen path); `false` for `trackSchemaFromEvent`. |
| `eventId` | string \| null | Avo Codegen event ID. `null` when `avoFunction` is `false`. |
| `eventHash` | string \| null | Avo Codegen event hash. `null` when `avoFunction` is `false`. |
| `streamId` | string? | Present only in validated event calls (`bodyForValidatedEventSchemaCall`). Set to `anonymousId`. |
| `eventSpecMetadata` | object? | Present only in validated event calls. Contains validation metadata. |

**Property object (plain, no encryption):**

```json
{
  "propertyName": "string",
  "propertyType": "string | int | float | boolean | null | object | list(string) | list(int) | list(float) | list(boolean) | list(object) | list(null) | unknown",
  "children": [ ... ],
  "failedEventIds": ["string"],
  "passedEventIds": ["string"]
}
```

**`children` field normative rule:** `children` is present when `propertyType` is `"object"` OR any list type (including `list(string)`, `list(int)`, `list(float)`, `list(boolean)`, `list(null)`, `list(object)`). `children` is ABSENT for all primitive scalar types (`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"unknown"`).

**`children` field data structure:** `children` is a JSON array where each element is one of:
- A **type string** (`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"unknown"`) — for primitive elements within an array.
- A **SchemaEntry array** (an array of `{ propertyName, propertyType, children? }` objects) — for object or nested-array elements within an array.

This is a heterogeneous union type. In typed languages (Go, Rust, Java), implementations MUST use a union/sum type or interface/any type for `children` elements. In dynamically typed languages (Ruby, Python), the natural list type is sufficient.

`failedEventIds` / `passedEventIds` are present only when validation results are merged in (Codegen integration path).

**Property object (encrypted):**

```json
{
  "propertyName": "string",
  "propertyType": "string",
  "encryptedPropertyValue": "base64-encoded-string",
  "children": [ ... ]
}
```

List-type properties are OMITTED ENTIRELY from the encrypted property array (not sent to the server).

#### Response

**200 OK:**

```json
{
  "samplingRate": 0.5
}
```

The SDK MUST update its internal `samplingRate` when the response body contains a numeric `samplingRate` in [0.0, 1.0].

**Non-200:**

The SDK MUST resolve (not reject) the promise on non-200 responses. In dev/staging with logging enabled, the status code SHOULD be logged.

#### Error Taxonomy

The SDK has four distinct error categories with different outcomes. Implementations MUST follow this table exactly:

| Error category | Example | Promise outcome | Logged? | Retry? |
|---|---|---|---|---|
| **SDK internal error** | Bug in schema extraction, unexpected synchronous exception inside `trackSchemaFromEvent` try/catch | `Promise.reject("Avo Inspector: something went wrong. Please report to support@avo.app.")` — reject with this exact string | Yes, via `console.error` with the error object appended | No |
| **Network timeout** (10 s exceeded) | Connection timeout, read timeout | `Promise.resolve(eventSchema)` — network errors are swallowed inside the internal send handler and `trackSchemaFromEvent` resolves with the extracted schema | Yes, via `console.error` | No |
| **Network error** | DNS failure, connection refused, TLS error | `Promise.resolve(eventSchema)` — same swallowing behavior as network timeout | Yes, via `console.error` | No |
| **Non-200 HTTP response** | 4xx, 5xx from Inspector API | `Promise.resolve([])` — resolve, NOT reject | Yes, in dev/staging with logging enabled; status code SHOULD be logged | No |

**Boundary clarification:** The `AvoInspector.extractSchema` wrapper MUST return `[]` on internal error and MUST NOT throw — it catches all exceptions and returns `[]`. The inner schema parser does NOT have its own try/catch and may throw on pathological input; `AvoInspector.extractSchema` is the safe wrapper. The outer `trackSchemaFromEvent` catch block only intercepts synchronous throws (e.g., stream ID validation throwing); async network errors are swallowed inside the internal send handler and do NOT reach this catch block.

#### Timeout

- Request timeout: **10 seconds**.
- On timeout, the SDK MUST destroy the request and reject the internal promise with the error string `"Request timed out"` (see Error Taxonomy above).
- On network error, the SDK MUST reject the internal promise with the error string `"Request failed"`.
- The SDK MUST NOT automatically retry failed or timed-out requests.

#### Sampling

- Default `samplingRate`: `1.0` (send all events).
- Before sending, the SDK MUST compare `Math.random()` (or equivalent language-random) against `samplingRate`. If `random > samplingRate`, the event MUST be dropped silently (no network call).
- The sampling rate is updated from the response body of any successful 200 response. In multi-threaded runtimes (Go, Python with threads, Ruby with Ractors), `samplingRate` MUST be updated using a lock or atomic primitive to prevent data races. Last-write-wins is acceptable (no ordering guarantee between concurrent responses).
- **Boundary values:** `samplingRate = 1.0` MUST send all events (since `random` from standard [0,1) range is never `> 1.0`). `samplingRate = 0.0` MUST drop almost all events (only drops when `random > 0.0`, which is true for all non-zero randoms in [0,1); treat as "effectively drop all"). If your language's random function can return exactly `0.0`, `samplingRate = 0.0` will pass through that single value — this edge case is acceptable per the reference implementation.

---

### Schema Extraction Algorithm

**Entry point:** `AvoSchemaParser.extractSchema(eventProperties: object) → Array<SchemaEntry>`

**A `SchemaEntry` is:**
```
{ propertyName: string, propertyType: string, children?: any }
```

**`children` applicability rule for `SchemaEntry`:** A `SchemaEntry` includes the `children` field when `propertyType` is `"object"` OR any list type (`"list(string)"`, `"list(int)"`, `"list(float)"`, `"list(boolean)"`, `"list(null)"`, `"list(object)"`). `children` is ABSENT for all primitive scalar types (`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"unknown"`). This is the same rule defined in the Wire Protocol → Property Object → `children` field normative rule section. Both sections are normative; they describe the same invariant from different perspectives (wire encoding and extraction output).

**Algorithm (pseudocode):**

```
function extractSchema(eventProperties):
  if eventProperties is null or undefined:
    return []
  return mapping(eventProperties)

function mapping(object):
  if object is an Array:
    list = [mapping(x) for x in object]
    return removeDuplicates(list)
  else if object is a non-null Object:
    result = []
    for each own property key in object:
      val = object[key]
      entry = { propertyName: key, propertyType: getPropValueType(val) }
      if val is a non-null Object (including arrays):
        entry.children = mapping(val)
      result.append(entry)
    return result
  else:
    return getPropValueType(object)   // scalar case (used inside array mapping)

function getPropValueType(val):
  if val is an Array:
    first = val[0]
    if first is null or undefined:
      return "list(string)"           // default for empty array
    return "list(" + getBasicPropType(first) + ")"
  else:
    return getBasicPropType(val)

function getBasicPropType(val):
  if val is null or undefined: return "null"
  if typeof val == "string":   return "string"
  if typeof val == "number" or "bigint":
    // Use the language's native type to distinguish int from float.
    // If the runtime type is integer → "int"; if float/double → "float".
    // For JS-style runtimes where 0.0 and 0 are the same value:
    //   use Number.isInteger(val) — but 0.0 passes Number.isInteger and
    //   would yield "int", contradicting this spec.
    //   Therefore: for JS runtimes, if the literal was written with a
    //   decimal point (i.e., runtime cannot distinguish), classify as "float".
    //   Practical rule: any number that is NOT an exact integer → "float";
    //   any number that IS an exact integer but was passed as a float literal
    //   (0.0, 1.0, 2.0) → "float".
    //   Simplest conformant JS implementation: check if the value has a
    //   fractional part OR if the caller's language marks it float-typed.
    //   For statically-typed languages (Go, Java, Rust): use the native type.
    //   float32/float64 → "float"; int/int64/etc → "int".
    if runtime type is integer: return "int"
    else:                       return "float"
  if typeof val == "boolean":  return "boolean"
  if typeof val == "object":   return "object"
  return "unknown"

function removeDuplicates(array):
  // For primitive types (string, number, boolean), deduplicate by value
  // For non-primitive types, deduplicate by reference identity
  // Returns array with first occurrence of each unique value preserved
```

**Recursion depth:** The `mapping` function is recursive. Implementations in languages with fixed recursion limits (Python default: 1000; Ruby fiber default: limited) SHOULD impose a maximum recursion depth of 10 levels. If the limit is reached, the property MUST be included with `propertyType: "object"` and `children: []` (depth truncation, not an error). Implementations MAY choose a higher limit; they MUST NOT silently crash (stack overflow) on pathological inputs.

**Fixture 13 — 3-level nesting (recursion conformance):**

This fixture verifies that recursive schema extraction works to at least 3 levels of nesting. It MUST be included in `conformance/schema-extraction/fixtures.json` as fixture `fixture-13`.

```json
{
  "input": { "a": { "b": { "c": 42 } } },
  "expected": [
    {
      "propertyName": "a",
      "propertyType": "object",
      "children": [
        {
          "propertyName": "b",
          "propertyType": "object",
          "children": [
            { "propertyName": "c", "propertyType": "int" }
          ]
        }
      ]
    }
  ]
}
```

**Key invariants (MUST be followed by conformant implementations):**

- `0.0` → `"float"` (the runtime float type takes precedence, regardless of string representation)
- `""` (empty string) → `"string"`
- `false` → `"boolean"`
- `0` → `"int"`
- `undefined` → `"null"`
- `null` → `"null"`
- `{}` (empty object) → `{ propertyName: key, propertyType: "object", children: [] }`
- `[]` (empty array) → `list(string)` (default, first element is absent)

---

### Schema Extraction Golden Fixtures

These fixtures are normative. A conformant implementation MUST produce the exact output for each input.

**Fixture 1 — Basic primitives**
```json
{
  "input": { "a": true, "b": 1, "c": "hello", "d": 3.14 },
  "expected": [
    { "propertyName": "a", "propertyType": "boolean" },
    { "propertyName": "b", "propertyType": "int" },
    { "propertyName": "c", "propertyType": "string" },
    { "propertyName": "d", "propertyType": "float" }
  ]
}
```

**Fixture 2 — Null and undefined**
```json
{
  "input": { "a": null, "b": null },
  "expected": [
    { "propertyName": "a", "propertyType": "null" },
    { "propertyName": "b", "propertyType": "null" }
  ]
}
```
Note: `undefined` values are treated identically to `null`.

**Fixture 3 — Empty and falsy values**
```json
{
  "input": { "a": false, "b": 0, "c": "", "d": 0.0, "e": null, "f": {}, "g": [] },
  "expected": [
    { "propertyName": "a", "propertyType": "boolean" },
    { "propertyName": "b", "propertyType": "int" },
    { "propertyName": "c", "propertyType": "string" },
    { "propertyName": "d", "propertyType": "float" },
    { "propertyName": "e", "propertyType": "null" },
    { "propertyName": "f", "propertyType": "object", "children": [] },
    { "propertyName": "g", "propertyType": "list(string)", "children": [] }
  ]
}
```
Note: `0.0` is `"float"` because the runtime type is float/double. In statically-typed languages, use the declared type. In JavaScript, `0.0` is indistinguishable from `0` at runtime — JS SDKs MUST classify it as `"float"` per this spec.

**Fixture 4 — Nested object**
```json
{
  "input": { "user": { "name": "Alice", "age": 30 } },
  "expected": [
    {
      "propertyName": "user",
      "propertyType": "object",
      "children": [
        { "propertyName": "name", "propertyType": "string" },
        { "propertyName": "age", "propertyType": "int" }
      ]
    }
  ]
}
```

**Fixture 5 — Simple list of strings**
```json
{
  "input": { "tags": ["a", "b", "c"] },
  "expected": [
    { "propertyName": "tags", "propertyType": "list(string)", "children": ["string"] }
  ]
}
```
Note: `children` for a list of primitives is an array of type strings (deduplicated).

**Fixture 6 — Empty array defaults to list(string)**
```json
{
  "input": { "items": [] },
  "expected": [
    { "propertyName": "items", "propertyType": "list(string)", "children": [] }
  ]
}
```

**Fixture 7 — Heterogeneous array (type from first element)**
```json
{
  "input": { "mixed": [1.2, "two", {"three": 3}] },
  "expected": [
    { "propertyName": "mixed", "propertyType": "list(float)", "children": ["float", "string", [{"propertyName": "three", "propertyType": "int"}]] }
  ]
}
```
Note: `propertyType` is determined by the type of the **first** element only (`1.2` → `"float"` → `"list(float)"`). The `children` array contains the output of `mapping()` applied to each element in order — `mapping(1.2)` → `"float"`, `mapping("two")` → `"string"`, `mapping({"three":3})` → `[{"propertyName":"three","propertyType":"int"}]` — after `removeDuplicates`. All three are unique (two different primitive strings and one object by reference), so all three appear. An implementation conforming to the pseudocode in this spec produces `["float", "string", [...]]`.

**Fixture 8 — Null top-level input**
```json
{
  "input": null,
  "expected": []
}
```

**Fixture 9 — Complex mixed-type array with nested structures**
```json
{
  "input": {
    "prop7": ["a", "list", {"obj in list": true, "int field": 1}, ["another", "list"], [1, 2]]
  },
  "expected": [
    {
      "propertyName": "prop7",
      "propertyType": "list(string)",
      "children": [
        "string",
        [
          { "propertyName": "obj in list", "propertyType": "boolean" },
          { "propertyName": "int field", "propertyType": "int" }
        ],
        ["string"],
        ["int"]
      ]
    }
  ]
}
```

**Fixture 10 — List deduplication**
```json
{
  "input": { "vals": ["true", "false", true, 10, "true", true, 11, 10, 0.1, 0.1] },
  "expected": [
    {
      "propertyName": "vals",
      "propertyType": "list(string)",
      "children": ["string", "boolean", "int", "float"]
    }
  ]
}
```
Note: Duplicate string values `"true"` and duplicate number values `10` and `0.1` are deduplicated. Resulting types are deduplicated by value.

**Fixture 11 — Object with a nested list property**
```json
{
  "input": { "event": { "tags": ["promo", "sale"], "count": 2 } },
  "expected": [
    {
      "propertyName": "event",
      "propertyType": "object",
      "children": [
        { "propertyName": "tags", "propertyType": "list(string)", "children": ["string"] },
        { "propertyName": "count", "propertyType": "int" }
      ]
    }
  ]
}
```

**Fixture 12 — All property types in one event**
```json
{
  "input": {
    "str": "hello",
    "int": 42,
    "float": 3.14,
    "bool": true,
    "null_val": null,
    "obj": {"key": "val"},
    "list_str": ["a"],
    "list_int": [1, 2],
    "list_float": [1.1],
    "list_bool": [true, false]
  },
  "expected": [
    { "propertyName": "str", "propertyType": "string" },
    { "propertyName": "int", "propertyType": "int" },
    { "propertyName": "float", "propertyType": "float" },
    { "propertyName": "bool", "propertyType": "boolean" },
    { "propertyName": "null_val", "propertyType": "null" },
    { "propertyName": "obj", "propertyType": "object", "children": [{"propertyName": "key", "propertyType": "string"}] },
    { "propertyName": "list_str", "propertyType": "list(string)", "children": ["string"] },
    { "propertyName": "list_int", "propertyType": "list(int)", "children": ["int"] },
    { "propertyName": "list_float", "propertyType": "list(float)", "children": ["float"] },
    { "propertyName": "list_bool", "propertyType": "list(boolean)", "children": ["boolean"] }
  ]
}
```

**Fixture 13 — 3-level nesting (recursion conformance)**
```json
{
  "input": { "a": { "b": { "c": 42 } } },
  "expected": [
    {
      "propertyName": "a",
      "propertyType": "object",
      "children": [
        {
          "propertyName": "b",
          "propertyType": "object",
          "children": [
            { "propertyName": "c", "propertyType": "int" }
          ]
        }
      ]
    }
  ]
}
```
Note: Verifies that recursive schema extraction operates correctly to at least 3 levels of nesting. See also the Schema Extraction Algorithm section for the recursion depth truncation rule (default max 10 levels; implementations MUST NOT silently crash on deeper inputs).

---

### Env Enum Exact Values

```
"dev"      → AvoInspectorEnv.Dev
"staging"  → AvoInspectorEnv.Staging
"prod"     → AvoInspectorEnv.Prod
```

These are the exact strings sent over the wire in the `env` field of every request. Generated SDKs MUST use these exact string values — the Inspector backend depends on them.

**Behavioral implications per value:**

| Env | Logging default | Encryption active? | Event spec validation? |
|---|---|---|---|
| `"dev"` | Enabled | Yes (if key provided) | Yes |
| `"staging"` | Disabled | Yes (if key provided) | Yes |
| `"prod"` | Disabled | No | No |

---

### ID Generation Format

**Message ID (`messageId`):**

- Format: UUID v4, lowercase hex, hyphenated.
- Pattern: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
  - `4` in position 13 is literal (version 4 marker).
  - `y` in position 17 is one of `8`, `9`, `a`, `b` (RFC 4122 variant bits).
- MUST be unique per event object (generated fresh for each event body creation).
- Implementations MAY use a cryptographic UUID v4 library — the format MUST match but the entropy source MAY differ.

**Stream ID (`streamId` / `anonymousId`):**

- User-supplied string. No generation logic on the SDK side — it is whatever the caller passes.
- Implementations SHOULD pass `streamId` through as-is without modification. No hard validation on `streamId` is required; values are used verbatim in the dedup key. Implementations MAY emit an advisory warning if `streamId` contains `:` but MUST still use the value unchanged.
- If absent or empty, defaults to `""` (empty string) in the request body's `anonymousId` field.
- `trackingId` and `sessionId` are NOT sent in v1 of this spec. They have been removed as dead weight. See the note in the Request Body section.

---

### Deduplication Behavior (Optional)

Deduplication is OPTIONAL for implementations. The backend handles duplicate-event semantics server-side. Implementations MAY implement deduplication for HTTP-traffic reduction, but MUST NOT implement it as a correctness mechanism.

When implemented, dedup MUST follow the algorithm below for cross-SDK conformance.

**Decision: Dedup is an optional performance optimization, NOT a wire-protocol requirement.**

**Justification:** The Inspector backend is idempotent — receiving the same event schema twice does no harm. Deduplication prevents double-reporting when Avo Codegen and manual instrumentation both fire for the same event (a common instrumentation pattern). This is an SDK-level concern, not a wire-protocol concern. The wire protocol has no dedup token or sequence number.

**SHOULD implement (spec recommendation, not MUST):**

Generated SDKs SHOULD implement deduplication with the following semantics:

- **Two buckets:** `avoFunctionEvents` (Codegen path) and `manualEvents` (manual instrumentation path).
- **Dedup key:** `streamId + "\0" + eventName`. Events from different streams MUST NOT be cross-deduplicated.
- **Window:** 500 milliseconds. Events older than 500 ms are evicted.
- **Cross-bucket detection:** If an event is recorded in the `avoFunctions` bucket, a subsequent call to the `manual` bucket with the same key+params within 500 ms is suppressed (and vice versa). Same-bucket same-key events are NOT suppressed.
- **Parameter matching:** Event properties are stored separately from the key and compared via recursive deep structural equality over own properties. Two objects are equal iff they have the same own property names and each corresponding value is deeply equal (primitives by `===`, arrays element-wise, objects recursively). Key insertion order does NOT affect the result. Implementations MAY use canonical-JSON serialization as an alternative, as long as semantics match for plain JSON-like inputs (i.e., `{a:1, b:2}` and `{b:2, a:1}` are considered equal).
- **Complete dedup record key formula:** The key stored in each bucket is `streamId + "\0" + eventName`. The event properties are stored alongside the key and compared via deep structural equality when a cross-bucket lookup occurs. Two calls with the same key but different params are NOT considered duplicates because the deep-equality check fails. Implementations MUST NOT embed event properties inside the key string.
- **One-shot:** Once a dedup suppression fires, both records are deleted from the stores.

**MAY omit** if the language/runtime makes it impractical (e.g., cross-thread state management in Go). The conformance suite marks dedup tests as `OPTIONAL`.

**Deduplication fixture format:** Deduplication fixtures mirror schema-extraction fixtures and use the same harness stdin/stdout protocol. Each fixture has the form:
```json
{
  "suite": "deduplication",
  "fixture_id": "string",
  "constructor": { "apiKey": "...", "env": "dev", "version": "..." },
  "operation": "trackSchemaFromEvent",
  "input": { "eventName": "...", "eventProperties": {}, "streamId": "..." },
  "expected_request_count": 1
}
```
The suite runner verifies that the mock server recorded exactly `expected_request_count` HTTP calls after executing the fixture (and any preceding fixture in the same test sequence). For cross-bucket suppression scenarios (e.g., `_avoFunctionTrackSchemaFromEvent` followed by `trackSchemaFromEvent`), two sequential fixtures share the same SDK instance state — the suite runner MUST invoke them in order and assert that only one total HTTP call was made across both.

---

### Encryption

**Decision: Encryption is an opt-in feature, NOT part of the core wire-protocol contract.**

**Justification:** Encryption is absent by default (no `publicEncryptionKey` means no encryption) and is explicitly disabled in `prod` environments. It is a privacy feature for dev/staging debugging, not a fundamental part of the Inspector protocol. Generated SDKs MAY omit it in v1 and add it later.

**If implemented, the following MUST be exactly followed (wire format is cross-SDK):**

**Algorithm:** ECIES with P-256 (prime256v1 / secp256r1)

**Key input:** Recipient public key as hex string. Accepted formats:
- Compressed: 66 hex chars, prefix `02` or `03`
- Uncompressed: 130 hex chars, prefix `04`

**Applicability rules:**
- Encryption is ACTIVE when: `publicEncryptionKey` is provided AND non-empty AND `env != "prod"`.
- Encryption is INACTIVE in `prod` even if a key is provided.

**Wire format (base64-encoded):**
```
[0x00][65-byte uncompressed ephemeral P-256 pubkey][16-byte AES-256-GCM IV][16-byte GCM auth tag][variable-length ciphertext]
```

Byte layout:
- Byte 0: Version `0x00`
- Bytes 1–65: Ephemeral public key (uncompressed, starts with `0x04`)
- Bytes 66–81: AES-256-GCM IV (16 bytes, random)
- Bytes 82–97: GCM auth tag (16 bytes)
- Bytes 98+: AES-256-GCM encrypted ciphertext

**IV size normative note:** The IV is **16 bytes**, NOT the 12-byte (96-bit) GCM standard. AES-256-GCM with a 16-byte IV is valid per the GCM specification but non-standard. Implementations MUST use exactly 16 bytes to maintain wire compatibility. Do NOT "fix" this to 12 bytes — doing so will produce ciphertext that the Inspector backend cannot decrypt.

**KDF:** AES key = SHA-256(ECDH shared secret X-coordinate). The X-coordinate MUST be the raw 32-byte big-endian representation as returned by the P-256 ECDH shared secret extraction (i.e., the raw bytes, NOT a hex-encoded string). The SHA-256 hash is computed over these 32 raw bytes. Implementations MUST NOT hex-encode the shared secret before hashing — `SHA-256(raw_bytes)` ≠ `SHA-256(hex_string)` and cross-implementation encryption will be silently incompatible if the wrong encoding is used.

**Plaintext:** `JSON.stringify(rawPropertyValue)` (the JSON-encoded value, not the type string). Missing properties encrypt the string literal `"null"`.

**List-type properties:** OMITTED ENTIRELY from the encrypted property array when encryption is active.

**When encryption fails** (invalid key, crypto error): the property is omitted from the array; a warning is logged; other properties continue to be sent.

**`publicEncryptionKey` in base body:** Included in the request body's base fields only when a non-empty key is provided.

---

### Keepalive Timer Behavior and Generated SDK Gotcha

Node.js SDKs MUST use a keepalive mechanism (e.g., a 60-second no-op `setInterval`) to prevent the process from exiting while a network send is in flight. This is required because callers typically do not `await` the promise returned by `trackSchemaFromEvent`.

**Behavior:**
- Timer is started when `pendingCount` increments from 0 to 1 (first pending operation).
- Timer is cleared when `pendingCount` returns to 0 (all operations complete).
- Timer fires every 60 seconds but does nothing — its sole purpose is to hold the event loop open.

**Cross-language keepalive guidance:**

- In Node.js: MUST implement the keepalive timer to prevent premature process exit.
- In Ruby/Python/Go/etc.: SHOULD NOT implement a 60-second idle timer. Instead, implementations MUST provide a `flush()` method (see below) and document it as required before process exit.
- In serverless environments (AWS Lambda, Google Cloud Functions, Vercel, etc.): The SDK MUST expose a `flush()` method that the caller invokes before the function returns, because the runtime reclaims resources when the function handler returns.

**`flush()` method (required for non-Node.js SDKs):**

See the `flush` entry in the **Public API Surface** section for the full normative definition, including the resolve/reject semantics when in-flight requests timeout or error during the flush window. Summary: `flush()` MUST resolve (not reject) in all cases — it is a completion guarantee, not a delivery guarantee.

**Normative requirement for all implementations:** The `flush()` method (non-Node.js) or keepalive timer (Node.js) MUST be documented in the SDK's README as required before process/request shutdown if any events may be in-flight. `destroy()` alone is NOT sufficient to ensure delivery.

---

## Open Questions

1. **Inspector API docs availability.** Do public or internal API docs for `https://api.avo.app/inspector/v1/track` exist that the spec should reference as authoritative? If docs exist, they should be linked. If not, the derivation process should be documented so it can be re-validated when docs do exist.

2. **Auth and API key handling.** The wire protocol embeds `apiKey` inside the JSON body. There is no `Authorization` header. This is unusual by modern API standards. To be clarified:
   - This is intentional and documented.
   - A future version will add a header-based auth scheme.
   - Generated SDKs should forward the key as a header as well.

3. **License of generated SDKs.** The spec repo itself SHOULD be MIT-licensed. Generated SDKs are derivative works of the spec; the MIT license permits customers to re-license derivatives. This should be explicitly stated in the spec repo's `LICENSE` and `AGENTS.md`.

4. **`libPlatform` registered values.** Is there a registry of approved `libPlatform` values, or can implementations choose their own string freely? The backend may use this field for analytics or routing — confirm with the Inspector backend team.

5. **Telemetry from generated SDKs.** Should generated SDKs report their own usage to Avo (e.g., `libPlatform: "ruby-generated"`)? Currently out of scope, but the spec should at minimum document that `libPlatform` is the correct hook for this.

6. **Batching vs. per-event sends.** The wire protocol accepts an array (batch), but spec v1 defines only per-event sends. Should the spec define a batching behavior (e.g., configurable batch size, time-based flush) as an optional optimization? Current answer: no batching in v1 spec; each SDK MAY implement batching as long as the wire format is correct.

---

## Proposed Spec Repo Layout

```
avohq/spec-first-inspector-server-sdk/
├── README.md
│   # Human-readable overview: what this repo is, why it exists, how to generate an SDK
│   # from it in 3 steps. Links to AGENTS.md for AI agents and SPEC.md for the full contract.
│
├── AGENTS.md
│   # AI-agent-oriented step-by-step SDK generation guide. Written to be consumed
│   # verbatim as a system prompt or attached document.
│   #
│   # REQUIRED sections (normative — AGENTS.md MUST contain all of these):
│   #
│   # 1. What to build
│   #    One paragraph: generate a <language> Inspector SDK that conforms to this spec.
│   #
│   # 2. Files to read, in order
│   #    Ordered list: SPEC.md → openapi.yaml → schemas/ → conformance/
│   #    Each entry explains what to extract from that file.
│   #
│   # 3. SDK generation checklist (minimum 10 items, each binary pass/fail)
│   #    Examples:
│   #    - [ ] Constructor throws on missing apiKey with exact error string
│   #    - [ ] extractSchema returns [] for null input
│   #    - [ ] All 13 schema-extraction fixtures pass
│   #    - [ ] trackSchemaFromEvent POSTs to https://api.avo.app/inspector/v1/track
│   #    - [ ] libVersion is a plain SemVer string read from the SDK's version constant/manifest (e.g., "1.2.0") — no +spec suffix
│   #    - [ ] enableLogging is process-wide (not per-instance)
│   #    - [ ] Non-200 responses resolve (do not reject) the promise
│   #    - [ ] Timeout (10s) rejects with exact string "Request timed out"
│   #    - [ ] samplingRate drop produces zero HTTP calls
│   #    - [ ] IV is 16 bytes when encryption is implemented
│   #    - [ ] flush() is implemented and documented in README as required before process exit (non-Node SDKs)
│   #    - [ ] destroy() resets pendingCount to 0 and clears the keepalive timer; subsequent trackSchemaFromEvent calls succeed
│   #
│   # 4. How to run conformance
│   #    Exact command: `echo '<fixture-json>' | avo-inspector-conformance`
│   #    Link to runner-contract.md for harness implementation details.
│   #
│   # 5. Definition of done
│   #    All 17 acceptance criteria in the spec pass. All non-OPTIONAL conformance
│   #    fixtures pass. SDK README documents flush()/destroy() shutdown requirement.
│
├── SPEC.md
│   # Full normative prose specification. The human-readable contract that AGENTS.md
│   # references. Contains: problem statement, public API surface, constructor options,
│   # env enum, HTTP wire protocol, schema extraction algorithm, dedup semantics,
│   # encryption spec, keepalive gotcha, server-side requirements.
│   # All normative requirements use RFC 2119 MUST/SHOULD/MAY language.
│
├── openapi.yaml
│   # OpenAPI 3.1 document for the Inspector HTTP API:
│   #   POST /inspector/v1/track
│   # Includes request body schema (referencing schemas/), response schema,
│   # error responses, and server definition (https://api.avo.app).
│
├── schemas/
│   ├── event-batch.json
│   │   # JSON Schema for the top-level request body array.
│   ├── event-body.json
│   │   # JSON Schema for a single event object (plain, no encryption).
│   ├── event-body-encrypted.json
│   │   # JSON Schema for a single event object (with encrypted properties).
│   ├── base-body.json
│   │   # JSON Schema for the base fields common to all event types.
│   ├── event-property-plain.json
│   │   # JSON Schema for a plain (non-encrypted) property entry.
│   ├── event-property-encrypted.json
│   │   # JSON Schema for an encrypted property entry.
│   └── schema-entry.json
│       # JSON Schema for a schema entry returned by extractSchema().
│
├── conformance/
│   ├── README.md
│   │   # Explains the conformance suite: how it works, what an SDK author must
│   │   # implement to run it, and what "passing" means.
│   ├── runner-contract.md
│   │   # Normative harness protocol — SDK authors implement this to make the
│   │   # conformance suite executable. The protocol is stdin/stdout JSON framing:
│   │   #
│   │   # Entry point: a CLI binary named `avo-inspector-conformance` (or language
│   │   # equivalent, e.g. `bin/conformance`). Invocation: `avo-inspector-conformance`
│   │   # reads a single-line JSON fixture object from stdin and writes a single-line
│   │   # JSON result object to stdout, then exits with code 0 (pass) or 1 (fail).
│   │   #
│   │   # For the exact input envelope, output envelope, exit code semantics, and
│   │   # environment variable definitions, see the "Conformance Runner Contract
│   │   # (Normative)" section in SPEC.md — that section is the single canonical
│   │   # source. Do NOT duplicate the schema here.
│   │   #
│   │   # The suite runner calls the harness once per fixture, compares actual vs.
│   │   # expected from fixtures.json, and reports results.
│   ├── schema-extraction/
│   │   ├── README.md
│   │   │   # Describes the fixture format and how to run schema extraction tests.
│   │   └── fixtures.json
│   │       # Array of { input, expected } fixtures (Fixtures 1-13 from spec + more).
│   ├── wire-protocol/
│   │   ├── README.md
│   │   │   # Describes how to use HTTP wire fixtures: mock server setup, request
│   │   │   # capture, assertion against expected JSON.
│   │   └── fixtures.json
│   │       # Array of { scenario, input, expected_request_body, expected_response }
│   │       # covering: basic event, codegen event, streamId set, encryption active.
│   ├── deduplication/
│   │   ├── README.md
│   │   │   # Marks these tests as OPTIONAL (dedup is SHOULD, not MUST).
│   │   └── fixtures.json
│   │       # Scenarios: avo-then-manual dedup, manual-then-avo dedup, 500ms window,
│   │       # cross-stream no-dedup, same-bucket no-dedup.
│   ├── batching/
│   │   ├── README.md
│   │   │   # Describes time/count batching scenarios. Currently OPTIONAL.
│   │   └── fixtures.json
│   │       # Scenarios: N events → expected number of HTTP calls and their bodies.
│   └── error-handling/
│       ├── README.md
│       │   # Describes network failure, timeout, 4xx, 5xx scenarios.
│       └── fixtures.json
│           # Scenarios: timeout → no retry, 500 → resolve (not reject), sampling
│           # drop → no HTTP call.
│
├── CHANGELOG.md
│   # Semver-tagged release history. Each entry is marked either:
│   #   [WIRE] — a wire-protocol change; downstream SDKs MUST regenerate.
│   #   [SPEC] — a clarification or documentation fix; SDKs MAY ignore.
│   # First entry: v1.0.0 — initial spec publication.
│
├── VERSIONING.md
│   # Versioning policy:
│   #   MAJOR bump: breaking wire-protocol change (e.g., new required field,
│   #     changed endpoint, changed type contract).
│   #   MINOR bump: additive wire-protocol change or new optional feature spec.
│   #   PATCH bump: clarification, typo fix, new conformance fixture for existing behavior.
│   # Generated SDKs MUST declare the spec version they implement (e.g., in README,
│   # gemspec metadata, package manifest, etc.).
│
└── LICENSE
    # MIT license. Generated SDKs MAY use any license; they are not required to
    # be MIT-licensed. The spec itself is MIT.
```

---

## Event-Spec Validation — Deferred to Spec v2

Event-spec validation is out of scope for spec v1. It will be added in spec v2 once the backend wire contract is finalized.

---

**Status:** Draft v1
**Last updated:** 2026-05-25
