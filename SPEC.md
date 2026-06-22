# SPEC.md — Avo Inspector Server SDK Specification

**Version:** 1.0.0
**Status:** Normative
**Repository:** `avohq/spec-first-inspector-server-sdk`

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
> "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in
> [RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

---

## Table of Contents

1. [Problem Statement and Repo Purpose](#1-problem-statement-and-repo-purpose)
2. [Source-of-Truth Strategy](#2-source-of-truth-strategy)
3. [Server-Side Requirements](#3-server-side-requirements)
4. [Public API Surface](#4-public-api-surface)
5. [Constructor Options Table](#5-constructor-options-table)
6. [Env Enum](#6-env-enum)
7. [HTTP Wire Protocol](#7-http-wire-protocol)
8. [ID Generation Format](#8-id-generation-format)
9. [Schema Extraction Algorithm](#9-schema-extraction-algorithm)
10. [Schema Extraction Golden Fixtures](#10-schema-extraction-golden-fixtures)
11. [Deduplication Behavior](#11-deduplication-behavior)
12. [Encryption](#12-encryption)
13. [Keepalive Timer and Flush](#13-keepalive-timer-and-flush)
14. [Open Questions](#14-open-questions)
15. [Out of Scope](#15-out-of-scope)

---

## 1. Problem Statement and Repo Purpose

Avo receives requests for Inspector SDKs in languages beyond Node.js (Ruby, Python, Rust, Scala,
C#, Go, etc.). Staffing and maintaining N independent hand-written implementations across language
ecosystems is prohibitive. The Inspector HTTP wire protocol is stable and well-understood; the
correct long-term strategy is to distribute one canonical specification plus a conformance suite,
and let customers (or their AI coding agents) generate conformant SDKs on demand.

This repository, `avohq/spec-first-inspector-server-sdk`, serves as the **single source of truth**
for all future server-side Inspector SDK implementations. It is Avo's first "AI-native open source"
artifact: optimized for AI agent consumption, not hand-written SDK maintenance.

A customer with a Ruby ask MUST be able to point their AI agent at this repository, follow the
instructions in `AGENTS.md`, and produce a working, conformant Ruby Inspector SDK in under one hour.

---

## 2. Source-of-Truth Strategy

**The Inspector HTTP wire protocol is the true source of truth.** Both the Node.js reference SDK
(`node-avo-inspector`) and this specification describe how to implement it. This specification
does NOT mirror Node.js SDK internals — it captures the contract: what the API expects, what
events look like on the wire, and what the public SDK surface MUST be.

When reading the Node.js SDK to understand a behavior, distinguish:

- **Wire-protocol behaviors** — MUST be in this spec and MUST be implemented by all conformant SDKs.
- **Node.js-idiomatic choices** — MAY be adapted idiomatically in other languages.
- **Node.js-specific quirks** — SHOULD NOT propagate to generated SDKs; flagged explicitly in this spec.

**Practical implication:** Generated SDKs are conformant if they pass the conformance suite and
implement the normative requirements in this document. They are NOT required to match the Node.js
SDK's internal implementation details.

---

## 3. Server-Side Requirements

All conformant SDK implementations MUST satisfy the following requirements. These are
server-side-only requirements; browser/client-side concerns are out of scope.

### 3.1 Thread and Async Safety

- Implementations MUST be safe to use in concurrent environments (multi-threaded servers, async
  runtimes, goroutines, Ractors, etc.).
- Shared mutable state (sampling rate, logging flag, deduplication store) MUST be protected
  by appropriate synchronization primitives (mutex, lock, atomic, etc.) in multi-threaded
  runtimes.
- The `samplingRate` field MUST be updated using a lock or atomic primitive in Go, Python
  (threaded), Ruby (Ractors), and JVM languages. Last-write-wins is acceptable; strict ordering
  between concurrent responses is NOT required.

### 3.2 No Persistent Storage

- Implementations MUST NOT write to disk or any persistent store (database, file system, etc.).
- All state is in-memory only.
- The deduplication store (if implemented) is in-memory and ephemeral — it does not survive
  process restart.

### 3.3 No sessionId or visitorId

- Implementations MUST NOT include `sessionId`, `visitorId`, or `userId` in the wire body.
- The Inspector server SDK does not model end-user sessions.
- `anonymousId` in the wire body is the caller-supplied `streamId` (or `""` if not provided).
  It is NOT a generated session identifier.
- AI coding agents generating SDKs MUST NOT add browser-style session tracking.

### 3.4 Keepalive and Flush

- Node.js SDKs MUST implement a keepalive timer (see Section 13).
- Non-Node.js SDKs MUST implement a `flush()` method (see Section 4.6 and Section 13).
- The shutdown contract MUST be documented in the SDK README: callers MUST invoke `flush()`
  (non-Node) or `await` the promise returned by `trackSchemaFromEvent` before process exit,
  if events may be in-flight.

### 3.5 No Event-Spec Validation in v1

- Event-spec validation (validating event properties against Avo event schemas fetched from
  the backend) is out of scope for v1. Implementations MAY stub this subsystem. It will be
  specified in v2.

---

## 4. Public API Surface

All conformant implementations MUST expose the following public methods. Method names SHOULD be
adapted to language-idiomatic naming conventions (e.g., `trackSchemaFromEvent` →
`track_schema_from_event` in Ruby/Python, `TrackSchemaFromEvent` in Go/C#).

### 4.1 Constructor

```typescript
new AvoInspector(options: {
  apiKey: string;                    // REQUIRED
  env: "dev" | "staging" | "prod";   // REQUIRED (falls back to "dev" if invalid)
  version: string;                   // REQUIRED
  appName?: string;                  // OPTIONAL, defaults to ""
  publicEncryptionKey?: string;      // OPTIONAL, see Section 12
})
```

**Validation at construction time.** The constructor MUST throw synchronously if validation fails:

| Option | Validation | Error message (exact) |
|---|---|---|
| `apiKey` | MUST be a non-empty, non-whitespace string | `"[Avo Inspector] No API key provided. Inspector can't operate without API key."` |
| `version` | MUST be a non-empty, non-whitespace string | `"[Avo Inspector] No version provided. Many features of Inspector rely on versioning. Please provide comparable string version, i.e. integer or semantic."` |
| `env` | If absent, empty, or not one of `"dev"`/`"staging"`/`"prod"`: fall back to `"dev"` and emit a console warning. MUST NOT throw. | — |
| `publicEncryptionKey` | If provided and `env != "prod"`, SHOULD emit a console warning if the value is not 66 or 130 hex chars. MUST NOT throw. | — |

**Whitespace-only strings** for `apiKey` or `version` MUST be treated identically to empty
strings (MUST throw with the error above).

**Side effects at construction time:**

- If `env == "dev"`, logging MUST be enabled by default (`shouldLog = true`).
- If `env != "dev"`, logging MUST be disabled by default (`shouldLog = false`).
- Encryption is initialized if `publicEncryptionKey` is provided and non-empty.

---

### 4.2 `trackSchemaFromEvent`

```typescript
trackSchemaFromEvent(
  eventName: string,
  eventProperties: { [propName: string]: any },
  streamId?: string
): Promise<Array<{ propertyName: string; propertyType: string; children?: any }>>
```

**Semantics (in order of execution):**

1. Constructs a stream-scoped dedup key: `streamId + "\0" + eventName`. If `streamId` is absent
   or empty, the key uses an empty prefix (`"" + "\0" + eventName`). See Section 11 for the full
   deduplication algorithm.
2. Checks the deduplicator (if implemented): if the same event+properties combination was sent
   via Avo Codegen (the `avoFunctions` bucket) within the last 500 ms for the same stream,
   MUST return `Promise.resolve([])` immediately without sending an HTTP request.
3. If not deduplicated: calls `extractSchema(eventProperties)`, then sends the extracted schema
   to the Inspector API (see Section 7).
4. Returns a promise that resolves to the extracted schema array (or `[]` if deduplicated). On
   a non-200 HTTP response, the promise still resolves but with `[]` regardless of whether
   `eventProperties` was non-empty (see §7.5 error taxonomy). The fixture `error-2` (non-empty
   props + 400 → `[]`) is the source of truth for this behavior.
5. On any synchronous internal error (e.g., stream ID validation throwing): MUST log to
   `console.error` (or language-equivalent) and MUST return
   `Promise.reject("Avo Inspector: something went wrong. Please report to support@avo.app.")`.
   The rejection value MUST be this exact string, not the original error object or message.
6. MUST keep the process alive (via keepalive timer in Node.js, or pending-count tracking for
   `flush()` in non-Node.js) until the network call completes.

**`streamId` rules:**

- Implementations SHOULD pass `streamId` through as-is without modification. No hard validation
  is required.
- If `streamId` contains `:`, the SDK MUST emit a console warning and MUST still use the value
  unchanged as `anonymousId` in the wire body.
- If `streamId` is absent or empty, `anonymousId` in the wire body MUST be `""`.

**Network errors and timeouts:** Network failures are swallowed inside the internal send handler.
`trackSchemaFromEvent` MUST resolve with the extracted event schema even when the HTTP call
fails or times out. See Section 7.5 (Error Taxonomy) for the full table.

---

### 4.3 `extractSchema`

```typescript
extractSchema(
  eventProperties: { [propName: string]: any },
  shouldLogIfEnabled?: boolean   // internal default: true
): Array<{ propertyName: string; propertyType: string; children?: any }>
```

**Semantics:**

- Synchronous. MUST NOT send any network calls.
- Delegates to the schema parser (see Section 9).
- MUST return an empty array `[]` if `eventProperties` is `null`, `undefined`, or not provided.
- MUST NOT throw to the caller. On any internal error, MUST catch the exception and return `[]`.

**Note on the safe-wrapper boundary:** The schema parser itself (`AvoSchemaParser` in the Node.js
reference SDK) does not have its own try/catch and may throw on pathological input.
`AvoInspector.extractSchema` is the safe wrapper that catches all exceptions and returns `[]`.
Implementations MUST apply this catch at the `extractSchema` boundary, not inside the parser.

**Note on `extractSchema` side effect:** Implementations MAY emit a console warning inside
`extractSchema` if recently Codegen-tracked params match (to detect double-reporting). The
return value is unaffected by this warning.

---

### 4.4 `enableLogging`

```typescript
enableLogging(enable: boolean): void
```

Sets the process-wide logging flag. Logging state MUST be process-wide (one flag for all
instances), not per-instance.

**Cross-language implementation requirement:** `shouldLog` MUST be implemented as a process-wide
global. An implementation where `enableLogging(true)` on one instance does not affect behavior
of another instance is non-conformant.

**Production hazard:** Callers MUST NOT call `enableLogging(true)` in production contexts.
Because the flag is process-wide, enabling logging in a shared process affects all Inspector
instances, including those operating in production environments. This is particularly relevant
in monorepos, test helpers, and serverless warm containers where dev-mode and production
instances may coexist in the same process.

Language-specific canonical approaches:

- **Java:** `private static boolean logsEnabled` with `static` accessor methods
- **Go:** package-level `var shouldLog bool`
- **Python:** module-level variable `_should_log = False`
- **Ruby:** class-level variable `@@should_log = false`
- **Rust:** process-wide atomic (e.g., `static SHOULD_LOG: AtomicBool`)

---

### 4.5 `destroy`

```typescript
destroy(): void
```

Cleans up all resources. After `destroy()` is called, state MUST be as follows:

| Field | Post-`destroy()` value | Notes |
|---|---|---|
| `pendingCount` | `0` | Reset; in-flight network calls are abandoned |
| `keepAliveTimer` | `null` / cleared | Timer is cancelled |
| `eventSpecFetcher` | `null` | Destroyed |
| `eventSpecCache` | `null` | Flushed and cleared |
| `eventValidator` | `null` | Cleared |
| `samplingRate` | persisted (NOT reset) | Value from last 200 response is retained |
| `apiKey`, `env`, `version`, `appName` | persisted (NOT reset) | Constructor options retained |
| `shouldLog` (process-wide) | persisted (NOT reset) | Process-wide flag is not affected |

`destroy()` is "cancel and clean up": it abandons in-flight requests and resets state. It does
NOT flush pending requests. Callers who need delivery guarantees MUST await the
`trackSchemaFromEvent` promise before calling `destroy()`, or use `flush()` (non-Node.js).

After `destroy()`, the instance SHOULD NOT be reused. Implementations MAY allow reuse (a
subsequent `trackSchemaFromEvent` call will re-create the keepalive timer if needed), but MUST
document this behavior.

---

### 4.6 `flush`

> **(New requirement — not present in the node reference SDK.)**
> Non-Node.js SDKs MUST implement `flush()`. Node.js SDKs MAY omit it (the keepalive timer
> serves the same purpose in that runtime).

```typescript
flush(timeoutMs?: number): Promise<void>   // or synchronous equivalent
```

**Semantics:**

- Resolves (returns) once all pending sends initiated before the `flush()` call have either
  completed or been abandoned.
- Default `timeoutMs`: **10,000 ms** (10 seconds). Callers MAY pass a custom timeout.
- `flush()` MUST resolve (not reject) in all cases — even if one or more in-flight requests
  time out or error during the flush window. `flush()` is a **completion guarantee**, not a
  delivery guarantee.
- `flush()` does NOT prevent the instance from being used further. A subsequent
  `trackSchemaFromEvent` call after `flush()` MUST work normally.
- `destroy()` is distinct from `flush()` and MUST NOT be conflated:
  - `destroy()` — cancel and clean up (abandons in-flight requests, resets state).
  - `flush()` — wait and continue (waits for completion, preserves state).

**Serverless requirement:** In serverless environments (AWS Lambda, Google Cloud Functions,
Vercel, etc.), the SDK MUST expose `flush()` and callers MUST invoke it before the function
handler returns.

MUST be documented in the SDK README as required before process/function exit when events may
be in-flight.

---

### 4.7 `_avoFunctionTrackSchemaFromEvent` (Avo Codegen Integration — Optional)

```typescript
_avoFunctionTrackSchemaFromEvent(
  eventName: string,
  eventProperties: { [propName: string]: any },
  eventId: string,
  eventHash: string,
  streamId?: string
): Promise<Array<{ propertyName: string; propertyType: string; children?: any }>>
```

This method is called by Avo Codegen-generated code, not by the end user. It behaves identically
to `trackSchemaFromEvent` but uses the `avoFunctions` deduplication bucket (so manual-instrumented
and Codegen-instrumented calls can cross-detect duplicates). Implementations MAY implement this
method to support Avo Codegen integration.

**Same-bucket dedup clarification:** Calls within the same bucket (e.g., two
`_avoFunctionTrackSchemaFromEvent` calls for the same event) are NOT suppressed. Codegen-generated
code is assumed to call this method exactly once per event invocation; if the same event fires
twice from Codegen, both sends are intentional and MUST NOT be silently dropped.

---

## 5. Constructor Options Table

| Name | Type | Required | Default | Semantics |
|---|---|---|---|---|
| `apiKey` | string | YES | — | Inspector API key from the Avo Inspector dashboard. Sent in the request body as `apiKey`. MUST be non-empty and non-whitespace. |
| `env` | `"dev"` or `"staging"` or `"prod"` | YES | Falls back to `"dev"` if invalid/absent | Controls logging defaults and encryption applicability. Sent in the request body as `env`. Exact string values are part of the wire protocol. |
| `version` | string | YES | — | Application version. Sent in the request body as `appVersion`. MUST be non-empty and non-whitespace. Comparable string (integer or semantic version). |
| `appName` | string | NO | `""` | Application name. Sent in the request body as `appName`. |
| `publicEncryptionKey` | string | NO | `undefined` (no encryption) | P-256 public key in hex (compressed 66 chars or uncompressed 130 chars). When present in dev/staging, property values are ECIES-encrypted before sending. In prod, this option is accepted but encryption is NOT applied. |

---

## 6. Env Enum

### 6.1 Exact Wire Values

The `env` option maps to an enum with exactly three values. The following wire strings MUST be
used in the `env` field of every request body:

| Enum constant | Wire string |
|---|---|
| `AvoInspectorEnv.Dev` | `"dev"` |
| `AvoInspectorEnv.Staging` | `"staging"` |
| `AvoInspectorEnv.Prod` | `"prod"` |

Generated SDKs MUST use these exact string values. The Inspector backend depends on them.

### 6.2 Behavioral Implications

| Env | Logging default | Encryption active? | Event spec validation |
|---|---|---|---|
| `"dev"` | Enabled (`shouldLog = true`) | Yes (if `publicEncryptionKey` provided) | Yes (if implemented) |
| `"staging"` | Disabled (`shouldLog = false`) | Yes (if `publicEncryptionKey` provided) | Yes (if implemented) |
| `"prod"` | Disabled (`shouldLog = false`) | **No** (encryption is never applied in prod) | No |

### 6.3 Invalid Env Fallback

If `env` is absent, an empty string, or a value not in `{ "dev", "staging", "prod" }`, the SDK
MUST fall back to `"dev"` and emit a console warning. The SDK MUST NOT throw. This behavior
applies at construction time.

---

## 7. HTTP Wire Protocol

### 7.1 Endpoint

```text
POST https://api.avo.app/inspector/v1/track
```

- **Scheme:** HTTPS only. HTTP is not acceptable.
- **Host:** `api.avo.app`
- **Port:** 443 (implicit for HTTPS)
- **Path:** `/inspector/v1/track`
- **Method:** POST
- **TLS validation:** SDKs MUST use the host platform's default TLS certificate validation.
  SDKs MUST NOT provide any configuration option to disable certificate validation.

When the environment variable `AVO_INSPECTOR_MOCK_ENDPOINT` is set, the SDK MUST send HTTP
calls to that URL instead of `https://api.avo.app`. This is used by the conformance suite.

> **Security requirement:** SDKs MUST gate `AVO_INSPECTOR_MOCK_ENDPOINT` behind a test-only
> build flag, debug build, or environment-restriction check. Production builds MUST NOT honor
> this variable. Honoring this variable in production would allow HTTP downgrade attacks by
> redirecting traffic to an attacker-controlled endpoint.

### 7.2 Request Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `Accept` | `application/json` |
| `Content-Length` | Byte length of the request body actually sent (compressed length when `Content-Encoding: gzip` is present, otherwise the byte length of the serialized JSON) |
| `Content-Encoding` | `gzip` — present ONLY when the body is gzip-compressed (see Section 7.3.7). MUST be absent for uncompressed bodies. |

There is no `Authorization` header. Authentication is carried inside the JSON body via the
`apiKey` field. See Section 14 (Open Questions) for the auth discussion.

> **`Content-Type` stays `application/json` for server SDKs.** The browser SDK sends
> compressed bodies with `Content-Type: text/plain` to avoid a CORS preflight (`OPTIONS`)
> round-trip. Server-side SDKs are not subject to CORS and MUST keep `Content-Type:
> application/json` whether or not the body is compressed; the Inspector backend
> distinguishes compressed bodies by the `Content-Encoding` header alone.

### 7.3 Request Body

The request body MUST be a JSON array of event objects. Each call MUST send an array with
exactly one element (no time-based batching in v1).

```json
[
  {
    "apiKey": "string",
    "appName": "string",
    "appVersion": "string",
    "libVersion": "1.2.0",
    "env": "dev",
    "libPlatform": "ruby",
    "messageId": "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
    "anonymousId": "string",
    "createdAt": "2026-05-25T12:00:00.000Z",
    "samplingRate": 1.0,
    "type": "event",
    "eventName": "string",
    "eventProperties": [],
    "avoFunction": false,
    "eventId": null,
    "eventHash": null
  }
]
```

#### 7.3.1 Base Body Fields

These fields MUST be present on every event object:

| Field | Type | Description |
|---|---|---|
| `apiKey` | string | The Inspector API key passed to the constructor. |
| `appName` | string | `appName` constructor option (empty string `""` if not provided). |
| `appVersion` | string | `version` constructor option. |
| `libVersion` | string | SDK library version. MUST be a plain SemVer string (e.g., `"1.2.0"`). No suffix. See Section 7.3.3 for canonical version file guidance. |
| `env` | string | One of `"dev"`, `"staging"`, `"prod"` (exact wire values from `AvoInspectorEnv`). |
| `libPlatform` | string | Identifies the SDK platform/language (e.g., `"node"`, `"ruby"`, `"python"`, `"go"`). MUST be a non-empty string. |
| `messageId` | string | UUID v4 (random). MUST be unique per event. See Section 8. |
| `anonymousId` | string | The caller-supplied `streamId`, or `""` if none provided. |
| `createdAt` | string | ISO 8601 UTC timestamp at event send time (e.g., `"2026-05-25T12:00:00.000Z"`). Millisecond precision MUST be included (`.000Z` suffix). |
| `samplingRate` | number | Current sampling rate `[0.0, 1.0]`. Initial value `1.0`. Updated from server response. |

> **Note on omitted fields:** `trackingId` and `sessionId` MUST NOT be sent in v1. They are
> dead weight from the browser SDK and carry no information for server-side use cases.
> Implementations MUST NOT include these fields.

#### 7.3.2 Event-Specific Fields (`type: "event"`)

| Field | Type | Description |
|---|---|---|
| `type` | `"event"` | Literal string. MUST be present. |
| `eventName` | string | Name of the tracked event. |
| `eventProperties` | array | Extracted schema (array of property objects). See Section 9. |
| `avoFunction` | boolean | `true` if sent via `_avoFunctionTrackSchemaFromEvent` (Codegen path); `false` for `trackSchemaFromEvent`. |
| `eventId` | string or null | Avo Codegen event ID. MUST be `null` when `avoFunction` is `false`. |
| `eventHash` | string or null | Avo Codegen event hash. MUST be `null` when `avoFunction` is `false`. |

#### 7.3.3 `libVersion` Format

Implementations MUST set `libVersion` to a plain SemVer string (e.g., `"1.2.0"`) — no suffix.

Implementations MUST define a `VERSION` constant in a dedicated version file. Language-specific
canonical approaches:

- **Node.js:** version constant or `package.json` version field
- **Ruby:** `AvoInspector::VERSION` constant in `lib/avo_inspector/version.rb`
- **Python:** `importlib.metadata.version('avo-inspector')` with fallback to hardcoded constant
- **Go:** `const Version = "x.y.z"` in `version.go`. MUST NOT read `go.mod` at runtime.
- **Rust:** `env!("CARGO_PKG_VERSION")` macro
- **All other languages:** hardcoded constant in a dedicated version file

The SDK README MUST instruct maintainers to update the version constant on each release.

#### 7.3.4 Property Object (Plain, No Encryption)

```json
{
  "propertyName": "string",
  "propertyType": "string | int | float | boolean | null | object | list(string) | list(int) | list(float) | list(boolean) | list(object) | list(null) | unknown",
  "children": []
}
```

**`children` field normative rule:** `children` MUST be present when `propertyType` is `"object"`
OR any list type (including `"list(string)"`, `"list(int)"`, `"list(float)"`, `"list(boolean)"`,
`"list(null)"`, `"list(object)"`). `children` MUST be absent for all primitive scalar types
(`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"unknown"`).

**`children` data structure:** `children` is a JSON array where each element is one of:

- A **type string** (`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"unknown"`) — for
  primitive elements within an array.
- A **SchemaEntry array** (array of `{ propertyName, propertyType, children? }` objects) — for
  object or nested-array elements within an array.

This is a heterogeneous union type. In statically-typed languages (Go, Rust, Java), implementations
MUST use a union/sum type or interface/any type for `children` elements.

#### 7.3.5 Property Object (Encrypted)

When encryption is active (see Section 12):

```json
{
  "propertyName": "string",
  "propertyType": "string",
  "encryptedPropertyValue": "base64-encoded-string",
  "children": []
}
```

List-type properties are OMITTED ENTIRELY from the encrypted property array when encryption
is active (not sent to the server).

#### 7.3.6 `publicEncryptionKey` in Base Body

The `publicEncryptionKey` field MUST be included in the base body only when a non-empty key
was provided at constructor time.

#### 7.3.7 Request Body Compression (gzip)

To reduce egress, SDKs SHOULD gzip-compress the serialized request body before sending it.
Compression is a transport optimization and is OPTIONAL: an SDK that always sends uncompressed
bodies remains fully conformant. The Inspector backend accepts both compressed and uncompressed
request bodies on the same endpoint.

**Compression threshold.** Compression SHOULD be applied only when the serialized JSON body is at
least **1024 bytes** (UTF-8 encoded). Bodies smaller than 1024 bytes SHOULD be sent uncompressed —
for small payloads the gzip framing overhead outweighs the savings. The comparison is on UTF-8
**byte length** (`>= 1024`), not character count. (The browser SDK compares JavaScript string
`.length`; server SDKs MUST use byte length, which is the same value already reported in
`Content-Length`.)

**Algorithm.** When compression is applied, the body MUST be compressed with gzip (RFC 1952 — the
gzip wrapper around DEFLATE, not raw zlib/RFC 1950 and not raw DEFLATE/RFC 1951). Every
server-side language provides this in its standard library (e.g., Go `compress/gzip`, Python
`gzip`, Ruby `Zlib::GzipWriter`, Node.js `zlib.gzipSync`, Java `GZIPOutputStream`,
Rust `flate2`).

**Headers when compressed.** A compressed request MUST set `Content-Encoding: gzip` and MUST set
`Content-Length` to the byte length of the compressed body. `Content-Type` MUST remain
`application/json` (see the note in Section 7.2). A request that is NOT compressed MUST NOT send a
`Content-Encoding` header.

**Mandatory fallback to uncompressed.** SDKs MUST fall back to sending the original, uncompressed
body (and MUST NOT set `Content-Encoding`) in any of these cases:

- a gzip implementation is unavailable on the runtime, or
- compression raises/returns an error for the given body, or
- the body is below the 1024-byte threshold.

Compression MUST NOT change the logical request: the bytes the server obtains after gunzip MUST be
byte-identical to the JSON body that would have been sent uncompressed. Compression MUST NOT alter
any other observable behavior — the 10-second timeout, error taxonomy (Section 7.5), and promise
outcomes are identical for compressed and uncompressed requests.

### 7.4 Response

**200 OK:**

```json
{ "samplingRate": 0.5 }
```

The SDK MUST update its internal `samplingRate` when the response body contains a numeric
`samplingRate` value in `[0.0, 1.0]`. The update MUST only occur on status code `200`.

**Non-200:**

The SDK MUST resolve (not reject) the promise on non-200 responses. In dev/staging with logging
enabled, the status code SHOULD be logged.

### 7.5 Error Taxonomy

Implementations MUST follow this table exactly. The promise outcome refers to the promise
returned by `trackSchemaFromEvent`.

| Error category | Example | Promise outcome | Logged? | Retry? |
|---|---|---|---|---|
| **SDK internal error** | Bug in schema extraction; unexpected synchronous exception inside `trackSchemaFromEvent` try/catch | `Promise.reject("Avo Inspector: something went wrong. Please report to support@avo.app.")` — reject with this exact string | Yes, via `console.error` with the error object appended | No |
| **Network timeout** (10 s exceeded) | Connection timeout, read timeout | `Promise.resolve(eventSchema)` — network errors are swallowed inside the internal send handler; `trackSchemaFromEvent` resolves with the extracted schema | Yes, via `console.error` | No |
| **Network error** | DNS failure, connection refused, TLS error | `Promise.resolve(eventSchema)` — same swallowing behavior as network timeout | Yes, via `console.error` | No |
| **Non-200 HTTP response** | 4xx, 5xx from Inspector API | `Promise.resolve([])` — resolve, NOT reject | Yes, in dev/staging with logging enabled | No |

**Boundary clarification:** `AvoInspector.extractSchema` MUST return `[]` on internal error and
MUST NOT throw — it catches all exceptions and returns `[]`. The outer `trackSchemaFromEvent`
catch block intercepts only synchronous throws (e.g., stream ID validation throwing). Async
network errors are swallowed inside the internal send handler and MUST NOT reach the outer
catch block.

### 7.5.1 Security Constraints on Error Logging

SDKs MUST NOT log the `apiKey` value, the `publicEncryptionKey` value, or full request bodies
that contain the `apiKey`. Error logs MUST redact these fields if they appear in an error
object or response body before passing the error to `console.error` or the language-equivalent
logging facility.

### 7.6 Timeout

- Request timeout: **10 seconds**. Implementations MUST apply this timeout to every outbound
  HTTP call.
- On timeout: the SDK MUST destroy the request and reject the internal (send handler) promise.
  The error string used internally is `"Request timed out"`.
- On network error: the SDK MUST reject the internal promise with the error string
  `"Request failed"`.
- These internal rejections MUST be caught inside the send handler. The outer
  `trackSchemaFromEvent` promise MUST still resolve with the extracted schema.
- Implementations MUST NOT automatically retry failed or timed-out requests.

### 7.7 Sampling

- Default `samplingRate`: `1.0` (send all events).
- Before sending, the SDK MUST compare a random number (uniformly distributed in `[0.0, 1.0)`)
  against `samplingRate`. If `random > samplingRate`, the event MUST be dropped silently (no
  network call is made).
- **Boundary values:**
  - `samplingRate = 1.0` MUST send all events (random from `[0.0, 1.0)` is never `> 1.0`).
  - `samplingRate = 0.0` MUST effectively drop all events (`random > 0.0` is true for all
    non-zero values; treat as "drop all" in practice).
- The sampling rate is updated from the response body of any successful 200 response.
- In multi-threaded runtimes, `samplingRate` MUST be updated using a lock or atomic primitive.
  Last-write-wins is acceptable.

---

## 8. ID Generation Format

### 8.1 Message ID (`messageId`)

- Format: UUID v4, lowercase hex, hyphenated.
- Pattern: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
  - `4` in position 13 is literal (UUID version 4 marker).
  - `y` in position 17 MUST be one of `8`, `9`, `a`, `b` (RFC 4122 variant bits).
- Validation regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`
- MUST be unique per event object. MUST be generated fresh for each event body.
- Implementations MAY use a cryptographic UUID v4 library. The format MUST match; the entropy
  source MAY differ.

### 8.2 Stream ID (`streamId` / `anonymousId`)

- User-supplied string. No generation logic on the SDK side — it is whatever the caller passes.
- Implementations MUST pass `streamId` through as-is without modification.
- If absent or empty, `anonymousId` in the wire body MUST be `""` (empty string).
- `trackingId` and `sessionId` MUST NOT be sent. They have been removed from the server SDK
  wire format.

> **Note (informational):** The Node.js SDK has an internal `generatedAnonymousId` field reserved
> for future use. Currently it is always `""`, so the observable fallback is `""`. Generated SDKs
> do not need to implement this field.

---

## 9. Schema Extraction Algorithm

### 9.1 Entry Point

```text
AvoSchemaParser.extractSchema(eventProperties: object) → Array<SchemaEntry>
```

A `SchemaEntry` is:

```typescript
{
  propertyName: string,
  propertyType: string,
  children?: any        // present iff propertyType is "object" or any list type
}
```

### 9.2 Pseudocode

```text
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
    return getPropValueType(object)    // scalar case (used inside array mapping)

function getPropValueType(val):
  if val is an Array:
    first = val[0]
    if first is null or undefined:
      return "list(string)"           // default for empty array
    return "list(" + getBasicPropType(first) + ")"
  else:
    return getBasicPropType(val)

function getBasicPropType(val):
  if val is null or undefined:  return "null"
  if typeof val == "string":    return "string"
  if typeof val == "number" or "bigint":
    // Use the language's native type to distinguish int from float.
    // If the runtime type is integer → "int"; if float/double → "float".
    if runtime type is integer: return "int"
    else:                       return "float"
  if typeof val == "boolean":   return "boolean"
  if typeof val == "object":    return "object"
  return "unknown"

function removeDuplicates(array):
  // For primitive types (string, number, boolean), deduplicate by value.
  // For non-primitive types (objects, arrays), deduplicate by reference identity.
  // Returns array with first occurrence of each unique value preserved.
```

### 9.3 Type Classification Rules

**Key invariants. Conformant implementations MUST produce these exact classifications:**

| Input value | Expected `propertyType` |
|---|---|
| `0.0` (float zero) | `"float"` |
| `0` (integer zero) | `"int"` |
| `""` (empty string) | `"string"` |
| `false` | `"boolean"` |
| `null` | `"null"` |
| `undefined` | `"null"` |
| `{}` (empty object) | `"object"` (with `children: []`) |
| `[]` (empty array) | `"list(string)"` (with `children: []`) |

#### 9.3.1 Float vs. Integer Distinction

**In statically-typed languages** (Go, Java, Rust, C#, Scala): use the declared/runtime type.
`float32`/`float64`/`double` → `"float"`; `int`/`int32`/`int64`/`long` → `"int"`. The static
type declaration is authoritative.

**In dynamically-typed languages** (Ruby, Python): use the runtime type. `Float` → `"float"`;
`Integer`/`Fixnum` → `"int"`. In Python, `isinstance(val, float)` → `"float"`;
`isinstance(val, int)` → `"int"`.

**In JavaScript/TypeScript:** `0.0` and `0` are the same value (`typeof` is `"number"` for both).
`Number.isInteger(0)` returns `true`; `Number.isInteger(0.0)` also returns `true`. Per this spec,
`0.0` MUST be classified as `"float"`. JS SDK authors MUST document this known deviation: the
`Number.isInteger` check alone cannot distinguish `0.0` from `0`. The practical rule for
conformance fixture 3 is:

- If the calling language passes a literal `0.0` and the runtime cannot distinguish it from `0`,
  the SDK MUST classify it as `"float"` per this spec.
- This is a spec design intent — it is intentionally different from the Node.js reference SDK
  output of `"int"` for `0.0`.

> **Spec design intent note:** The `0.0` → `"float"` rule is a forward-looking requirement for
> generated SDKs in statically-typed languages where `0.0` and `0` are genuinely different
> runtime types. The Node.js reference SDK produces `"int"` for `0.0` because `Number.isInteger`
> returns `true`. Generated SDKs in statically-typed languages MUST use the declared type.

#### 9.3.1.1 Parser Configuration Requirements

When a conformance fixture is delivered via JSON stdin (e.g., from the conformance harness), the
host language's JSON parser MUST be configured to preserve the `int` vs. `float` distinction in
the literal source. Most default JSON parsers lose this distinction.

**Per-language requirements:**

| Language | Default behavior | Required configuration |
|---|---|---|
| **JavaScript** | `JSON.parse` produces `number` for both `0` and `0.0` | Use `Number.isInteger()` per existing guidance in §9.3.1 |
| **Python** | `json.loads` maps all numbers to `int` or `float` based on presence of decimal point — correctly preserves distinction by default | No special config needed |
| **Go** | `encoding/json` maps all JSON numbers to `float64` by default — loses distinction | MUST use `json.Decoder` with `UseNumber()` to get `json.Number`, then check `strings.Contains(n.String(), ".")` or attempt integer parse |
| **Java** | Jackson maps JSON numbers to `int`/`long`/`double` based on magnitude — may lose `0.0` vs `0` distinction | MUST enable `DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS` or use `JsonNode.isFloatingPointNumber()` |
| **C#** | `System.Text.Json` maps JSON numbers: integers to `long`, decimals to `double` — preserves `.0` presence via `GetRawText()` | Use `JsonElement.GetRawText()` and check for decimal point in source |
| **Ruby** | `JSON.parse` maps integers to `Integer` and floats to `Float` by default — correctly preserves distinction | No special config needed |
| **Rust** | `serde_json` preserves `i64` vs `f64` distinction by default when using typed deserialization | Use `serde_json::Value` which distinguishes `Number` with integer vs. float variants |

**Normative rule:** For SDKs whose host language JSON parser conflates `0` and `0.0` by default,
the conformance harness MUST configure the parser to preserve the literal-source `int` vs.
`float` distinction. The fixture input JSON `{"d": 0.0}` MUST be parsed such that `d` is
treated as a float, not an integer. This is a harness configuration requirement — the SDK's
own `extractSchema` method operates on the host language's native types and MUST use the
declared/runtime type as the authority.

#### 9.3.2 Recursion Depth

The `mapping` function is recursive. The Node.js reference SDK has no recursion limit.
Implementations in languages with fixed recursion limits (Python default: 1000; Ruby fiber:
limited) SHOULD impose a maximum recursion depth of 10 levels. If the limit is reached, the
property MUST be included with `propertyType: "object"` and `children: []` (depth truncation,
not an error). Implementations MAY choose a higher limit; they MUST NOT silently crash on
pathological inputs.

> **Note:** The 10-level truncation rule is a spec recommendation for languages with fixed stack
> limits. It is NOT verified by conformance fixtures against the Node.js reference SDK (which
> has no such limit). Conformance fixtures test to a maximum of 3 levels of nesting.

#### 9.3.3 `removeDuplicates` Cross-Language Guidance

> *(Added in spec revision — Thing Rev 1 requirement.)*

`removeDuplicates` deduplicates the output of `mapping()` applied to each array element:

- **Primitive type strings** (`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"unknown"`):
  deduplicate by value equality (string comparison).
- **Arrays of SchemaEntry objects** (output of `mapping()` on nested objects): deduplicate by
  reference identity in JavaScript. In other languages where reference identity is not available
  or idiomatic, implementations MAY compare by structural equality (deep comparison). The
  observable behavior for the conformance fixtures is the same because fixture objects are
  distinct by construction.

In practice, `removeDuplicates` ensures that repeated array element types collapse to a single
occurrence. For example, `["a", "b", "c"]` mapped to `["string", "string", "string"]` deduplicates
to `["string"]`.

---

## 10. Schema Extraction Golden Fixtures

These fixtures are normative. A conformant implementation MUST produce the exact `expected`
output for each `input`. These are also present as machine-readable JSON in
`conformance/schema-extraction/fixtures.json`.

### Fixture 1 — Basic primitives

```json
{
  "fixture_id": "fixture-1",
  "input": { "a": true, "b": 1, "c": "hello", "d": 3.14 },
  "expected": [
    { "propertyName": "a", "propertyType": "boolean" },
    { "propertyName": "b", "propertyType": "int" },
    { "propertyName": "c", "propertyType": "string" },
    { "propertyName": "d", "propertyType": "float" }
  ]
}
```

### Fixture 2 — Null and undefined

```json
{
  "fixture_id": "fixture-2",
  "input": { "a": null, "b": null },
  "expected": [
    { "propertyName": "a", "propertyType": "null" },
    { "propertyName": "b", "propertyType": "null" }
  ]
}
```

Note: `undefined` values MUST be treated identically to `null`.

### Fixture 3 — Empty and falsy values

```json
{
  "fixture_id": "fixture-3",
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

Note: `0.0` MUST be `"float"` because the runtime type is float/double. In statically-typed
languages, use the declared type. In JavaScript, `0.0` is indistinguishable from `0` at runtime;
JS SDKs MUST classify it as `"float"` per this spec, which intentionally differs from the
Node.js reference SDK output of `"int"` for `0.0`.

### Fixture 4 — Nested object

```json
{
  "fixture_id": "fixture-4",
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

### Fixture 5 — Simple list of strings

```json
{
  "fixture_id": "fixture-5",
  "input": { "tags": ["a", "b", "c"] },
  "expected": [
    { "propertyName": "tags", "propertyType": "list(string)", "children": ["string"] }
  ]
}
```

Note: `children` for a list of primitives is an array of deduplicated type strings.

### Fixture 6 — Empty array defaults to list(string)

```json
{
  "fixture_id": "fixture-6",
  "input": { "items": [] },
  "expected": [
    { "propertyName": "items", "propertyType": "list(string)", "children": [] }
  ]
}
```

### Fixture 7 — Heterogeneous array (type from first element)

```json
{
  "fixture_id": "fixture-7",
  "input": { "mixed": [1.2, "two", {"three": 3}] },
  "expected": [
    {
      "propertyName": "mixed",
      "propertyType": "list(float)",
      "children": [
        "float",
        "string",
        [{ "propertyName": "three", "propertyType": "int" }]
      ]
    }
  ]
}
```

Note: `propertyType` is determined by the type of the **first** element only (`1.2` → `"float"` →
`"list(float)"`). The `children` array contains the output of `mapping()` applied to each element
in order after `removeDuplicates`. All three elements are unique (two different primitive strings
and one object by reference identity), so all three appear.

### Fixture 8 — Null top-level input

```json
{
  "fixture_id": "fixture-8",
  "input": null,
  "expected": []
}
```

### Fixture 9 — Complex mixed-type array with nested structures

```json
{
  "fixture_id": "fixture-9",
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

### Fixture 10 — List deduplication

```json
{
  "fixture_id": "fixture-10",
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

Note: Duplicate string values `"true"` and duplicate numbers `10` and `0.1` are deduplicated.
Resulting type strings are deduplicated by value equality.

### Fixture 11 — Object with a nested list property

```json
{
  "fixture_id": "fixture-11",
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

### Fixture 12 — All property types in one event

```json
{
  "fixture_id": "fixture-12",
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
    {
      "propertyName": "obj",
      "propertyType": "object",
      "children": [{ "propertyName": "key", "propertyType": "string" }]
    },
    { "propertyName": "list_str", "propertyType": "list(string)", "children": ["string"] },
    { "propertyName": "list_int", "propertyType": "list(int)", "children": ["int"] },
    { "propertyName": "list_float", "propertyType": "list(float)", "children": ["float"] },
    { "propertyName": "list_bool", "propertyType": "list(boolean)", "children": ["boolean"] }
  ]
}
```

### Fixture 13 — 3-level nesting (recursion conformance)

```json
{
  "fixture_id": "fixture-13",
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

Note: Verifies that recursive schema extraction operates correctly to at least 3 levels of nesting.
See Section 9.3.2 for the recursion depth truncation rule.

---

## 11. Deduplication Behavior

### 11.1 Status: OPTIONAL / SHOULD Implement

Deduplication is OPTIONAL for implementations. The Inspector backend handles duplicate-event
semantics server-side. Implementations MAY implement deduplication for HTTP-traffic reduction,
but MUST NOT implement it as a correctness mechanism.

**Decision rationale:** The Inspector backend is idempotent — receiving the same event schema
twice does no harm. Deduplication prevents double-reporting when Avo Codegen and manual
instrumentation both fire for the same event (a common instrumentation pattern). This is an
SDK-level performance optimization, not a wire-protocol requirement.

### 11.2 Two-Bucket Algorithm

When implemented, dedup MUST use exactly two buckets:

- `avoFunctionEvents` — for calls via `_avoFunctionTrackSchemaFromEvent` (Codegen path)
- `manualEvents` — for calls via `trackSchemaFromEvent` (manual instrumentation path)

### 11.3 Dedup Key Formula

The dedup record key MUST be: `streamId + "\0" + eventName`

Where:

- `streamId` is the caller-supplied stream ID (or `""` if absent).
- `"\0"` is the null byte separator.
- `eventName` is the event name string.

Implementations MUST NOT embed event properties inside the key string. Event properties are
stored separately alongside the key and compared via deep structural equality when a cross-bucket
lookup occurs.

### 11.4 Parameter Matching

Event properties are stored alongside the key and compared via **recursive deep structural
equality over own properties** when a cross-bucket lookup occurs:

- Two objects are equal iff they have the same own property names and each corresponding value
  is deeply equal: primitives by `===` (or language-equivalent strict equality), arrays
  element-wise, objects recursively.
- Key insertion order MUST NOT affect the result (property lookup is order-independent).
- Implementations MAY use canonical-JSON serialization as an alternative, as long as semantics
  match for plain JSON-like inputs (i.e., `{a:1, b:2}` and `{b:2, a:1}` are considered equal).

Two calls with the same `streamId` and `eventName` but different `eventProperties` MUST NOT be
deduplicated (the deep-equality check on properties will fail).

### 11.5 Dedup Window

Events older than **500 ms** MUST be evicted from the dedup store. A subsequent duplicate
event after eviction MUST be registered and sent.

### 11.6 Cross-Bucket Suppression

- If an event is recorded in the `avoFunctions` bucket, a subsequent call to the `manual`
  bucket with the same key and same params within 500 ms MUST be suppressed (and vice versa).
- Same-bucket same-key events are NOT suppressed. Two `trackSchemaFromEvent` calls for the
  same event are both sent.
- Once a dedup suppression fires, both records MUST be deleted from their respective buckets
  (one-shot deletion).

### 11.7 Cross-Stream Non-Deduplication

Two calls with different `streamId` values for the same event name and properties MUST NOT be
deduplicated. The dedup key includes `streamId`, making them distinct keys.

### 11.8 Conformance Testing Note

> **Cross-bucket multi-step conformance requires manual testing.**
>
> The single-invocation harness protocol (see "Implementation checklist" in `conformance/runner-contract.md`) cannot
> support stateful multi-step sequences where one invocation sets up bucket state for a second
> invocation. SDK authors MUST manually verify cross-bucket dedup scenarios (e.g.,
> `_avoFunctionTrackSchemaFromEvent` followed by `trackSchemaFromEvent` suppression) by writing
> a custom integration test in the SDK's test suite. The conformance suite deduplication fixtures
> cover only single-invocation scenarios. Conformance suite deduplication tests are marked
> OPTIONAL.

---

## 12. Encryption

### 12.1 Status: OPTIONAL / MAY Implement in v1

Encryption is an opt-in feature. Generated SDKs MAY omit it in v1 and add it in a later release.
When implemented, the wire format MUST be followed exactly (it is cross-SDK and the backend
depends on the byte layout).

### 12.2 Applicability Rules

Encryption is ACTIVE when ALL of the following are true:

- `publicEncryptionKey` was provided at constructor time AND is non-empty.
- `env != "prod"`.

Encryption is INACTIVE in `prod` even if a key is provided.

### 12.3 Algorithm

**Algorithm:** ECIES (Elliptic Curve Integrated Encryption Scheme) with P-256 (prime256v1 /
secp256r1).

**Key input — accepted formats:**

- Compressed: 66 hex characters, prefix `02` or `03`
- Uncompressed: 130 hex characters, prefix `04`

### 12.4 Wire Format

The encrypted property value is base64-encoded. The decoded bytes MUST have this exact layout:

```text
[0x00][65-byte uncompressed ephemeral P-256 pubkey][16-byte AES-256-GCM IV][16-byte GCM auth tag][variable-length ciphertext]
```

| Byte range | Content |
|---|---|
| Byte 0 | Version `0x00` |
| Bytes 1–65 | Ephemeral public key (uncompressed, starts with `0x04`) |
| Bytes 66–81 | AES-256-GCM IV (16 bytes, random) |
| Bytes 82–97 | GCM auth tag (16 bytes) |
| Bytes 98+ | AES-256-GCM encrypted ciphertext |

> **IV size normative note:** The IV is **16 bytes**, NOT the 12-byte (96-bit) GCM standard.
> AES-256-GCM with a 16-byte IV is valid per the GCM specification but non-standard.
> Implementations MUST use exactly 16 bytes to maintain wire compatibility. Do NOT "fix" this
> to 12 bytes — doing so will produce ciphertext that the Inspector backend cannot decrypt.

### 12.5 KDF

AES key = `SHA-256(ECDH shared secret X-coordinate)`

The X-coordinate MUST be the raw 32-byte big-endian representation as returned by the P-256
ECDH shared secret extraction. The SHA-256 hash is computed over these 32 raw bytes.

Implementations MUST NOT hex-encode the shared secret before hashing:
`SHA-256(raw_bytes)` ≠ `SHA-256(hex_string)`. Cross-implementation encryption will be silently
incompatible if the wrong encoding is used.

### 12.6 Plaintext

`JSON.stringify(rawPropertyValue)` — the JSON-encoded raw property value, not the type string.
Missing properties MUST encrypt the string literal `"null"`.

### 12.7 List-Type Omission

List-type properties MUST be omitted entirely from the encrypted property array when encryption
is active. They are not sent to the server.

### 12.8 Encryption Failure

When encryption fails (invalid key, crypto error): the property MUST be omitted from the array;
a warning MUST be logged; other properties MUST continue to be sent.

---

## 13. Keepalive Timer and Flush

### 13.1 Node.js Keepalive

Node.js SDKs MUST use a keepalive mechanism to prevent the process from exiting while a network
send is in-flight. Callers typically do not `await` the promise returned by `trackSchemaFromEvent`,
so without a keepalive the process may exit before the HTTP call completes.

**Keepalive behavior:**

- Timer is started when `pendingCount` increments from 0 to 1 (first pending operation).
- Timer interval: **60 seconds** (no-op callback — the sole purpose is to hold the event loop).
- Timer is cleared when `pendingCount` returns to 0 (all pending operations complete).

### 13.2 Non-Node.js: `flush()` Requirement

Non-Node.js SDKs MUST NOT implement the 60-second no-op timer (it would cause hangs in
long-running server processes and serverless functions).

Instead, non-Node.js SDKs MUST implement `flush()` (see Section 4.6) and MUST document it
in the SDK README as required before process exit.

### 13.3 Serverless Guidance

In serverless environments (AWS Lambda, Google Cloud Functions, Vercel Edge Functions, Cloudflare
Workers, etc.), the runtime reclaims resources when the function handler returns. SDKs MUST
expose `flush()` and MUST document that callers MUST invoke it before the function handler
returns to ensure in-flight events are delivered.

### 13.4 `destroy()` vs. `flush()` Clarification

These are distinct operations and MUST NOT be conflated:

- `destroy()` — **cancel and clean up.** Abandons in-flight requests, resets `pendingCount` to
  0, clears the keepalive timer. Does NOT wait for in-flight requests.
- `flush()` — **wait and continue.** Waits for all pending operations to complete (or timeout),
  then resolves. Does NOT reset state. Instance is fully usable after `flush()` returns.

---

## 14. Open Questions

The following questions are tracked but intentionally unresolved in v1. SDK authors SHOULD be
aware of them.

1. **Inspector API docs availability.** Do public or internal API docs for
   `https://api.avo.app/inspector/v1/track` exist that the spec should reference as authoritative?
   This spec was derived from the Node.js reference SDK source. If official docs exist, they
   should be linked and treated as authoritative over this spec.

2. **Auth and API key handling.** The wire protocol embeds `apiKey` inside the JSON body. There
   is no `Authorization` header. This is unusual by modern API standards. Open questions:
   whether this is intentional and permanent; whether a future version will add header-based
   auth; whether generated SDKs should forward the key as a header as well.

3. **License of generated SDKs.** The spec repo is MIT-licensed. Generated SDKs are derivative
   works of the spec; the MIT license permits customers to re-license derivatives. This should
   be explicitly stated in the spec repo's `LICENSE` and `AGENTS.md`. Generated SDKs MAY use
   any license the customer chooses.

4. **`libPlatform` registered values.** Is there a registry of approved `libPlatform` values,
   or can implementations choose freely? The backend may use this field for analytics or routing.
   Confirm with the Inspector backend team. Currently, any non-empty string is acceptable.

5. **Telemetry from generated SDKs.** Should generated SDKs report their own usage to Avo (e.g.,
   `libPlatform: "ruby-generated"`)? Currently out of scope, but `libPlatform` is the correct
   hook for this if implemented.

6. **Batching vs. per-event sends.** The wire protocol accepts an array (batch), but spec v1
   defines only per-event sends (array with exactly one element). A future version MAY define
   a batching behavior (configurable batch size, time-based flush) as an optional optimization.
   Current answer: no batching in v1.

---

## 15. Out of Scope

The following are explicitly out of scope for spec v1. Implementations MUST NOT include them;
AI agents generating SDKs MUST NOT add them.

- **Browser/client-side SDK concerns.** `localStorage`, page events, `visitorId`, `userId`,
  session management — none of these apply to server-side SDKs.
- **Hosting, publishing, or packaging generated SDKs.** Publishing to RubyGems, PyPI,
  Crates.io, npm, Maven Central, etc. is the customer's responsibility.
- **Avo Codegen integration specifics.** SDK authors MAY implement `_avoFunctionTrackSchemaFromEvent`
  but it is not required for minimal conformance.
- **Event-spec validation.** Validating event properties against Avo event schemas is deferred
  to spec v2. The validation subsystem (event spec fetcher, cache, validator) MAY be stubbed.
- **Batching.** Time-based or count-based batching is deferred to v1.1.0. Each event MUST be
  sent as a single-element array.
- **Telemetry or usage reporting** from generated SDKs.
- **sessionId / visitorId / userId.** Server SDKs MUST NOT include these fields.

---

## Conformance Harness Reference

The conformance suite is operationalized via a language-agnostic stdin/stdout JSON protocol.
SDK authors implement a thin CLI harness; the suite runner drives it with fixture data and
validates results. The full normative harness protocol is defined in
`conformance/runner-contract.md`. This section provides a summary for reference.

### Entry Point

A CLI binary named `avo-inspector-conformance` (language-idiomatic equivalents accepted:
`bin/conformance`, `conformance.rb`, `conformance.py`). Invoked once per fixture.

### Invocation

```sh
echo '<fixture-json>' | avo-inspector-conformance
```

Reads one line of JSON from stdin, executes the operation, writes one line of JSON to stdout,
exits with code `0` (pass), `1` (fail), or `2` (harness config error).

### Format Validation Patterns

Some wire body fields cannot be asserted by exact value (they vary per run). The suite runner
MUST validate these fields by format:

| Field | Format | Validation regex or rule |
|---|---|---|
| `messageId` | UUID v4, lowercase hex | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` |
| `createdAt` | ISO 8601 UTC with milliseconds | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` |
| `libVersion` | Plain SemVer string | `/^\d+\.\d+\.\d+$/` |
| `libPlatform` | Non-empty string | Any non-empty string; suite runner accepts any |

When a fixture's `expected_request_body` contains a placeholder value (e.g., `"<uuid-v4>"`,
`"<iso8601>"`, `"<semver>"`, `"<sdk-platform>"`), the suite runner MUST validate that field
using the corresponding regex rather than comparing to the placeholder string exactly.

### Environment Variable

`AVO_INSPECTOR_MOCK_ENDPOINT` — when set, the SDK under test MUST send HTTP calls to this URL
instead of `https://api.avo.app`. The wire-protocol suite injects a local mock server URL here.

---

## Versioning Policy

This spec follows semantic versioning:

| Bump | When | SDK regeneration required? |
|---|---|---|
| MAJOR | Breaking wire-protocol change (new required field, changed endpoint, changed type contract) | MUST regenerate |
| MINOR | Additive wire-protocol change or new optional feature | SHOULD regenerate |
| PATCH | Clarification, typo fix, new conformance fixture for existing behavior | MAY ignore |

CHANGELOG entries are tagged `[WIRE]` (SDK regeneration needed) or `[SPEC]` (documentation
update only). SDK authors SHOULD subscribe to releases to learn when regeneration is required.

Generated SDKs MUST declare the spec version they implement (e.g., in the SDK README, package
manifest metadata, or a `SPEC_VERSION` constant).

---

*Spec version: 1.0.0 — Initial publication.*
*Last updated: 2026-05-25.*
