# SPEC.md — Avo Inspector Server SDK Specification

**Version:** 3.0.0
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
11. [Flush and Shutdown](#11-flush-and-shutdown)
12. [Batching](#12-batching)

---

## 1. Problem Statement and Repo Purpose

This repository is one canonical specification plus a conformance suite that lets customers (or
their AI coding agents) generate conformant backend Inspector SDKs on demand.

It is the **single source of truth** for all future server-side Inspector SDK implementations: a
customer with a Ruby ask MUST be able to point their AI agent at this repository, follow the
instructions in `AGENTS.md`, and produce a working, conformant Ruby Inspector SDK in under one hour.

---

## 2. Source-of-Truth Strategy

**The Inspector HTTP wire protocol is the true source of truth.** This specification captures the
contract: what the API expects, what events look like on the wire, and what the public SDK surface
MUST be. It is self-contained — everything a conformant SDK must do is stated here and verified by
the conformance suite.

When implementing a behavior, distinguish:

- **Wire-protocol behaviors** — MUST be implemented by all conformant SDKs exactly as specified here.
- **Language-idiomatic choices** — MAY be adapted idiomatically per target language.

**Practical implication:** Generated SDKs are conformant if they pass the conformance suite and
implement the normative requirements in this document.

---

## 3. Server-Side Requirements

All conformant SDK implementations MUST satisfy the following requirements. These are
server-side-only requirements; browser/client-side concerns do not apply.

### 3.1 Thread and Async Safety

- Implementations MUST be safe to use in concurrent environments (multi-threaded servers, async
  runtimes, goroutines, Ractors, etc.).
- Shared mutable state (sampling rate, logging flag, the pending batch buffer) MUST be protected
  by appropriate synchronization primitives (mutex, lock, atomic, etc.) in multi-threaded
  runtimes.
- The `samplingRate` field MUST be updated using a lock or atomic primitive in Go, Python
  (threaded), Ruby (Ractors), and JVM languages. Last-write-wins is acceptable; strict ordering
  between concurrent responses is NOT required.
- The pending batch buffer (see Section 12) is concurrently-accessed mutable state. Appending an
  event and the flush "swap-and-clear" (move the buffer contents to a local variable, then reset
  the shared buffer to empty) MUST be mutually atomic under a single lock: no event may be appended
  between the moment a flush reads the buffer and the moment it clears it, and no two flushes may
  dispatch the same buffered event. The HTTP send MUST be performed OUTSIDE the lock — an
  implementation MUST NOT hold the buffer lock across the network call.

### 3.2 No Persistent Storage

- Implementations MUST NOT write to disk or any persistent store (database, file system, etc.).
- All state is in-memory only.
- The pending batch buffer (see Section 12) is held in memory only and MUST NOT be persisted.
  Consequently, events that have been enqueued but not yet sent are lost if the process crashes,
  is killed, or exits without a successful `flush()`. The SDK provides **at-most-once** delivery for
  buffered events and makes no durability guarantee; callers that require delivery MUST `flush()`
  before exit (see Sections 4.6 and 12).

### 3.3 streamId, sessionId, visitorId, and userId

- The Inspector server SDK does not model end-user sessions.
- `streamId` is the only correlation identifier a server SDK sends. It is OPTIONAL and entirely
  caller-supplied: the wire field carries whatever the caller passed, or `""` when the caller
  passed nothing (Sections 7.3.1 and 8.2). It is NOT a generated session identifier, and the SDK
  never invents a value for it.
- `sessionId` is **not part of the wire body** and implementations SHOULD NOT send it. Correlation
  that a caller wants across events belongs in `streamId`. **Read the dated note in Section 7.1
  before dropping the field from a sender that is already in production** — until the ingestion
  change described there ships, an event sent without `sessionId` is answered `200`, is discarded
  before storage, and reports nothing back to the sender that would distinguish it from success.
- Implementations MUST NOT include `visitorId` or `userId` in the wire body.
- AI coding agents generating SDKs MUST NOT add browser-style session tracking. There is no session
  concept to model here, and reintroducing `sessionId` as a generated value would attach a
  high-cardinality identifier to server-side observations that Avo does not read.

### 3.4 Flush and Shutdown

- All SDKs MUST implement a `flush()` method (see Section 4.6 and Section 11), regardless of the
  target runtime. There is no runtime-specific keepalive mechanism, and an SDK MUST NOT rely on
  holding the host process open by itself to deliver events.
- The shutdown contract MUST be documented in the SDK README: callers MUST invoke `flush()` (or
  `await` the promise returned by `trackSchemaFromEvent`) before process exit, if events may be
  in-flight or buffered in a pending batch (see Section 12).

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
  batchSize?: number;                // OPTIONAL, default 30 (forced to 1 when env == "dev"), see Section 12
  batchFlushSeconds?: number;        // OPTIONAL, default 30, see Section 12
  maxQueueSize?: number;             // OPTIONAL, default 1000, see Section 12
  disableBatchTimer?: boolean;       // OPTIONAL, default false, see Section 12
})
```

**Validation at construction time.** The constructor MUST throw synchronously if validation fails:

| Option | Validation | Error message (exact) |
|---|---|---|
| `apiKey` | MUST be a non-empty, non-whitespace string | `"[Avo Inspector] No API key provided. Inspector can't operate without API key."` |
| `apiKey` | MUST NOT contain a carriage return (`U+000D`), line feed (`U+000A`), or NUL (`U+0000`) | `"[Avo Inspector] API key contains a control character. The API key is sent as a request header and cannot contain CR, LF, or NUL."` |
| `version` | MUST be a non-empty, non-whitespace string | `"[Avo Inspector] No version provided. Many features of Inspector rely on versioning. Please provide comparable string version, i.e. integer or semantic."` |
| `env` | If absent, empty, or not one of `"dev"`/`"staging"`/`"prod"`: fall back to `"dev"` and emit a console warning. MUST NOT throw. | — |

**Whitespace-only strings** for `apiKey` or `version` MUST be treated identically to empty
strings (MUST throw with the error above).

**Why the control-character check is at construction time as well as at send time.** The `apiKey`
is the only caller-supplied value that reaches a request header (Section 7.2), and a key carrying
CR, LF or NUL can corrupt every request the instance makes. Section 7.2 requires the SDK to refuse
the send, which is the guard that actually protects the wire — but on its own it turns a
configuration mistake into an application that starts cleanly and silently delivers nothing. Doing
it here too fails loudly, once, at the moment the mistake is made, next to the existing `apiKey`
checks that the caller is already reading. The two checks are deliberately redundant: this one is
for the developer, the Section 7.2 one is for the wire.

This applies to `apiKey` only. `version` is validated for emptiness above but is not
control-character checked, because it travels in the JSON body as `appVersion`, where the JSON
encoder escapes such characters and request framing is unaffected.

**Side effects at construction time:**

- If `env == "dev"`, logging MUST be enabled by default (`shouldLog = true`).
- If `env != "dev"`, logging MUST be disabled by default (`shouldLog = false`).

---

### 4.2 `trackSchemaFromEvent`

The three gateway coordinates are passed either as top-level parameters or grouped in one options
object, decided by the target language — see Section 4.2.1, which is normative for the choice. Both
forms are shown here; the wire body is identical either way.

```typescript
// Shape A — a language WITH named/keyword arguments (Python, Ruby, Kotlin, Swift, C#, ...)
trackSchemaFromEvent(
  eventName: string,
  eventProperties: { [propName: string]: any },
  streamId?: string,
  outputReference?: string,   // which gateway output the payload was bound for; absent = gateway checkpoint
  originHint?: string,        // low-cardinality label of the source the event came from
  originAppVersion?: string   // the originating source's app version (see the rule in Section 7.3.6)
): Promise<Array<{ propertyName: string; propertyType: string; children?: any }>>

// Shape B — a language WITHOUT them (JavaScript/TypeScript, Go, Java, ...)
trackSchemaFromEvent(
  eventName: string,
  eventProperties: { [propName: string]: any },
  streamId?: string,
  options?: TrackOptions
): Promise<Array<{ propertyName: string; propertyType: string; children?: any }>>

interface TrackOptions {
  outputReference?: string;
  originHint?: string;
  originAppVersion?: string;
}
```

**Semantics (in order of execution):**

1. Calls `extractSchema(eventProperties)` to compute the schema synchronously.
2. Applies sampling per event (see Section 7.7): if the event is dropped by sampling, it MUST NOT
   be enqueued and no network call is made.
3. Otherwise, enqueues the event into the pending batch buffer and evaluates the flush triggers
   (see Section 12). The batch is sent to the Inspector API (see Section 7) when a flush trigger
   fires — which, when `env == "dev"` (where `batchSize` is forced to `1`), is immediately within
   this call. When `batchSize > 1`, the actual send is deferred and MAY be triggered by a later
   call, by the scheduled flush, or by `flush()`.
4. Returns a promise that resolves with the extracted schema array **at enqueue time** — it MUST NOT
   wait for the batch to be sent, and the resolved value MUST NOT reflect the eventual HTTP status of
   the batch. (When `batchSize == 1` the send is synchronous to the call, so the per-call HTTP
   outcomes in §7.5 are observable; see §7.5.2 for behavior under batching.)
5. On any synchronous internal error before enqueue (e.g., stream ID validation throwing): MUST log
   to `console.error` (or language-equivalent) and MUST return
   `Promise.reject("Avo Inspector: something went wrong. Please report to support@avo.app.")`.
   The rejection value MUST be this exact string, not the original error object or message.
6. MUST track in-flight sends (e.g. a pending-operation count) so that `flush()` can await their
   completion. The SDK does NOT keep the host process alive on its own; callers MUST `flush()` (or
   `await` the returned promise) before exit if a send for the batch may still be in-flight (see
   Sections 4.6 and 11).

**`streamId` rules:**

- Implementations SHOULD pass `streamId` through as-is without modification. No hard validation
  is required.
- If `streamId` contains `:`, the SDK MUST emit a console warning and MUST still use the value
  unchanged as `streamId` in the wire body.
- If `streamId` is absent or empty, the `streamId` field in the wire body MUST be `""`.

#### 4.2.1 `options` — Gateway Track Options

The gateway coordinates are OPTIONAL trailing inputs that let an SDK be used with a
**gateway-scoped** Inspector API key. Avo's multi-gate
model issues one Inspector API key per *gateway* (e.g. one tag-manager container or one backend
event router that fans events out to several destinations) instead of one Inspector source per
destination, and labels each observation with two coordinates:

| Option | Type | Semantics |
|---|---|---|
| `outputReference` | string | Reference of the gateway **output** (destination checkpoint) this observation was bound for, as shown in Avo (e.g. `"meta-x7k2q"`). Absent = the observation was taken at the **gateway** checkpoint (after gateway-level transformations, before any output's). Present = that output's checkpoint (after that output's transformations). |
| `originHint` | string | Low-cardinality label identifying which **source** the event came from (e.g. `"web"`, `"ios"`, `"android"`); the value is mapped to an Avo source in the Avo UI. It **MUST NOT** be a user identifier or any other high-cardinality value. This is a documentation rule for SDK README/API docs; SDKs do not validate it at runtime. |
| `originAppVersion` | string | App version of the source that produced **this event**, overriding the instance's `version` per the rule in Section 7.3.6. Named for whose version it carries: `originHint` says which source, `originAppVersion` says that source's version. It sets the event's `appVersion` on the wire — the wire field keeps its own name (Section 7.3.1). |

**API requirements:**

**Which shape to implement (normative).** The three coordinates are the same inputs carrying the
same values in either shape, and they produce a byte-identical wire body. What differs is only how
they appear at a call site, so the choice follows the target language:

| Does the target language have named / keyword arguments? | Required shape |
|---|---|
| **Yes** — Python, Ruby, Kotlin, Swift, C#, and similar | The three are **top-level optional parameters** on the track method. A caller writes `originAppVersion: "4.2.0"` at the call site and an IDE surfaces the names directly. |
| **No** — JavaScript/TypeScript, Go, Java, and similar | The three are grouped in **one optional options object / struct / record** parameter. Positional parameters would force callers to pass placeholders to reach the last one. |

Both shapes are conformant. An SDK MUST NOT be judged non-conformant for implementing the shape its
language calls for, and the conformance suite asserts only the wire body, which does not distinguish
them. Where a language is genuinely ambiguous, prefer the shape an idiomatic library in that
ecosystem would expose; record the choice in the SDK's README so a reader knows which to expect.

The reference harness and example SDK under `conformance/runner/` are written in JavaScript, which
is on the "no" row, so every call-site example in this repository shows the options-object shape.
That is **one** conformant shape, picked by the example's own language — not the required one. An
SDK whose language has named or keyword arguments MUST NOT copy it, and MUST flatten the three per
the table above.

- Adding the coordinates MUST NOT break existing call sites: they are trailing and optional. In a
  language without optional parameters, keep the existing three-parameter signature and add an
  overload that it delegates to — adding parameters to the existing method would change its
  signature and break already-compiled consumers. A call that supplies none of the three, or an
  empty options object, MUST produce exactly the body this release defines for a call without
  them: the three add keys only when a caller supplies them and never alter any other field. That
  body is **not** the 2.0.0 body — 3.0.0 also moves the endpoint (Section 7.1) and removes
  `sessionId` (Section 3.3).
- They are read **per call**: each call's values apply only to the event enqueued by that call.
  Two calls for the same event with different `outputReference` values are two distinct
  observations and MUST both be sent (there is no deduplication in server SDKs; gated by the
  `batch-7` fixture).
- Value normalization and the wire mapping are normative in Section 7.3.6.
- They MUST NOT affect `extractSchema`, sampling, batching, or `streamId` handling.

**Network errors and timeouts:** Network failures are swallowed inside the internal send handler.
`trackSchemaFromEvent` MUST resolve with the extracted event schema even when the HTTP call
fails or times out. See Section 7.5 (Error Taxonomy) for the full table.

---

### 4.3 `extractSchema`

```typescript
extractSchema(
  eventProperties: { [propName: string]: any }
): Array<{ propertyName: string; propertyType: string; children?: any }>
```

**Semantics:**

- Synchronous. MUST NOT send any network calls.
- Delegates to the schema parser (see Section 9).
- MUST return an empty array `[]` if `eventProperties` is `null`, `undefined`, or not provided.
- MUST NOT throw to the caller. On any internal error, MUST catch the exception and return `[]`.

**Note on the safe-wrapper boundary:** The underlying schema parser (`AvoSchemaParser`) does not
have its own try/catch and may throw on pathological input. `AvoInspector.extractSchema` is the
safe wrapper that catches all exceptions and returns `[]`. Implementations MUST apply this catch at
the `extractSchema` boundary, not inside the parser.

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
| `pendingBatch` | cleared / empty | Buffered-but-unsent events are discarded (abandoned, NOT sent) |
| scheduled-flush timer | `null` / cleared | Background batch-flush timer (if any, see Section 12) is cancelled |
| `samplingRate` | persisted (NOT reset) | Value from last 200 response is retained |
| `apiKey`, `env`, `version`, `appName` | persisted (NOT reset) | Constructor options retained |
| `shouldLog` (process-wide) | persisted (NOT reset) | Process-wide flag is not affected |

`destroy()` is "cancel and clean up": it abandons in-flight requests and resets state. It does
NOT flush pending requests. Callers who need delivery guarantees MUST await the
`trackSchemaFromEvent` promise before calling `destroy()`, or use `flush()`.

After `destroy()`, the instance MUST be treated as terminated. A subsequent
`trackSchemaFromEvent()` call MUST return `Promise.resolve([])`, MUST NOT enqueue the event, and
MUST NOT send an HTTP request. `destroy()` MUST discard the pending batch buffer without sending it
(consistent with abandoning in-flight requests). (The field-state table above still applies:
`pendingCount` is `0`, the scheduled-flush timer is cleared, the pending batch is
discarded, and the constructor options plus the process-wide `shouldLog` flag persist.)

---

### 4.6 `flush`

> All SDKs MUST implement `flush()`, regardless of the target runtime.

```typescript
flush(timeoutMs?: number): Promise<void>   // or synchronous equivalent
```

**Semantics:**

- `flush()` MUST first **force-flush the pending batch**: atomically swap out and dispatch all
  currently-buffered events as a batch (subject to the size cap), then wait for all in-flight sends —
  including the one it just initiated — to complete or be abandoned, before resolving. Force-flushing
  the buffer is REQUIRED; a `flush()` that only awaits already-dispatched sends without draining the
  buffer is non-conformant (it would silently leave buffered events unsent — see the serverless
  requirement below).
- Resolves (returns) once all pending sends initiated before (and by) the `flush()` call have either
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

## 5. Constructor Options Table

| Name | Type | Required | Default | Semantics |
|---|---|---|---|---|
| `apiKey` | string | YES | — | Inspector API key from the Avo Inspector dashboard. Sent in the `api-key` request header (the copy the endpoint authenticates on) and, unchanged, in the request body as `apiKey`. MUST be non-empty and non-whitespace. |
| `env` | `"dev"` or `"staging"` or `"prod"` | YES | Falls back to `"dev"` if invalid/absent | Controls logging defaults. Sent in the `env` request header (the copy the endpoint reads) and, unchanged, in the request body as `env`. Exact string values are part of the wire protocol. |
| `version` | string | YES | — | Application version. Sent in the request body as `appVersion`. MUST be non-empty and non-whitespace. Comparable string (integer or semantic version). |
| `appName` | string | NO | `""` | Application name. Sent in the request body as `appName`. |
| `batchSize` | integer | NO | `30` | Flush the pending batch when its length reaches `batchSize`. **Forced to `1` when `env == "dev"`** (immediate send), overriding any configured value. MUST be ≥ 1; values < 1 fall back to the default with a console warning. See Section 12. |
| `batchFlushSeconds` | number | NO | `30` | Maximum age (seconds) of the oldest buffered event before a time/idle flush SHOULD occur. MUST be > 0; invalid values fall back to the default with a console warning. See Section 12. |
| `maxQueueSize` | integer | NO | `1000` | Hard cap on buffered events; on overflow the oldest events are dropped first (FIFO). See Section 12. |
| `disableBatchTimer` | boolean | NO | `false` | When `true`, no background/scheduled flush timer is started; flushing relies solely on the size trigger and explicit `flush()`. Serverless deployments SHOULD set this `true`. See Section 12. |

Batch configuration is fixed at construction time. Implementations MAY omit runtime setters; if
provided, mutating batch configuration at runtime MUST be lock-guarded and SHOULD be discouraged.

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

| Env | Logging default |
|---|---|
| `"dev"` | Enabled (`shouldLog = true`) |
| `"staging"` | Disabled (`shouldLog = false`) |
| `"prod"` | Disabled (`shouldLog = false`) |

### 6.3 Invalid Env Fallback

If `env` is absent, an empty string, or a value not in `{ "dev", "staging", "prod" }`, the SDK
MUST fall back to `"dev"` and emit a console warning. The SDK MUST NOT throw. This behavior
applies at construction time.

---

## 7. HTTP Wire Protocol

### 7.1 Endpoint

```text
POST https://api.avo.app/inspector/v2/track
```

- **Scheme:** HTTPS only. HTTP is not acceptable.
- **Host:** `api.avo.app`
- **Port:** 443 (implicit for HTTPS)
- **Path:** `/inspector/v2/track`
- **Method:** POST
- **TLS validation:** SDKs MUST use the host platform's default TLS certificate validation.
  SDKs MUST NOT provide any configuration option to disable certificate validation.

When the environment variable `AVO_INSPECTOR_MOCK_ENDPOINT` is set, the SDK MUST send HTTP
calls to that URL instead of `https://api.avo.app`. This is used by the conformance suite. The
override replaces the request URL only — every header required by Section 7.2 MUST still be sent.

> **Security requirement:** the gate that honors `AVO_INSPECTOR_MOCK_ENDPOINT` MUST be
> **fail-closed (default-deny)**: an instance constructed with `env: "prod"` MUST ignore the
> variable unconditionally, regardless of the surrounding process environment. Gating on the SDK's
> own `env` is the recommended language-agnostic mechanism (a `prod` instance never honors the
> override); a test-only build flag or debug build is also acceptable. SDKs MUST NOT gate on an
> ambient variable that defaults to "non-production" when unset (e.g. `NODE_ENV !== "production"`),
> which **fails open** — many production deployments leave such variables unset, so an attacker who
> can set `AVO_INSPECTOR_MOCK_ENDPOINT` could redirect traffic (an HTTP downgrade) and capture the
> `apiKey`. Because all conformance fixtures construct the SDK with `env: "dev"` or `"staging"`,
> gating on `env` keeps every fixture runnable while production stays locked down.
>
> The gate is therefore only as good as the pairing it rests on: an instance's `apiKey` and `env`
> describe the **same** environment. Constructing an instance with a production-scoped key and
> `env: "dev"` or `"staging"` is a misconfiguration outside this model — it already files that
> instance's observations under the wrong environment, before any override is considered — and no
> environment-variable gate can repair it, since an attacker able to set one variable can set
> another. An SDK that ships a production binary and wants a stronger boundary than `env` SHOULD
> use the test-only build flag option above, which removes the override from the shipped artifact
> entirely.

<!-- Separates the two callouts: without it the blank line reads as one blockquote (MD028). -->

> **What `/inspector/v2/track` is (informative).** v2 is the one Inspector ingestion endpoint
> shared by every Inspector sender; each sender identifies itself with the `X-Avo-Client` header
> (Section 7.2), so traffic can be attributed without decoding a request body. Compared with the
> older `/inspector/v1/track` path it **decodes the gateway coordinate fields** `outputReference`
> and `originHint` (Section 7.3.6), **tolerates a `null` `appVersion`** — the observation is stored
> as `unversioned` instead of the event being dropped — and **does not sample server-side**
> (Section 7.7). Nothing there changes what a conformant SDK sends beyond the endpoint itself and
> the headers in Section 7.2.

<!-- Separates the two callouts: without it the blank line reads as one blockquote (MD028). -->

> **Ingestion note for the removed `sessionId` field (informative, as of 2026-09-04).** This
> release removes `sessionId` from the wire body (Sections 3.3, 7.3.1, 8.2), because the endpoint
> now supplies the value instead of requiring every sender to pad one in. **Both ingestion parsers
> still REQUIRE the field today.** The v1 fast path guards on its presence and drops the event
> outright, and the public parser used by v2 decodes it as a required field, which throws and
> discards the event when it is absent. The status stays `200` and the sender sees success, so a
> sender that drops the field before ingestion accepts its absence loses **every event** it sends.
> The loss is not literally silent — both paths write a decode warning to the server's own logs,
> and one of them additionally answers with a body carrying `ok: false` and a decode-failure count
> at status `200` — but **no signal reaches the sender**: none of it is per-sender, nothing alerts
> on it, and an SDK that reads the HTTP status sees an ordinary success. That is the precise
> failure that made the field required in 2.0.0 in the first place.
>
> The ingestion change that defaults the field is in flight; it **MUST** ship before any
> sender generated from this release reaches production, and confirming that it has is a release
> gate rather than an assumption this document can make on anyone's behalf. Until it is confirmed,
> a sender already running in production SHOULD keep sending `sessionId: ""`. That remains
> conformant: the field is an unknown extra field to this spec's schemas rather than a forbidden
> one, so a body still carrying it validates and the conformance suite passes either way. This
> note will be removed when the ingestion change ships.

### 7.2 Request Headers

| Header | Value | Presence |
|---|---|---|
| `api-key` | The `apiKey` constructor option, verbatim | REQUIRED |
| `env` | The instance's environment — exactly `dev`, `staging`, or `prod` (Section 6.1) | REQUIRED |
| `X-Avo-Client` | The SDK's `libPlatform` value (Section 7.3.1) — e.g. `node`, `ruby`, `csharp`, `go` | REQUIRED |
| `Content-Type` | `application/json` | REQUIRED |
| `Accept` | `application/json` | RECOMMENDED |
| `Content-Length` | Byte length of the request body actually sent (compressed length when `Content-Encoding: gzip` is present, otherwise the byte length of the serialized JSON) | REQUIRED |
| `Content-Encoding` | `gzip` — present ONLY when the body is gzip-compressed (see Section 7.3.5). MUST be absent for uncompressed bodies. | CONDITIONAL |

**Authentication.** There is no `Authorization` header: the API key travels in the `api-key`
request header. `/inspector/v2/track` reads both the API key and the environment from these
headers and never from the JSON body. The body MUST nevertheless keep carrying its own `apiKey`
and `env` fields (Section 7.3.1): v2 ignores those copies, and keeping them keeps one body shape
and one request schema across ingestion paths.

**Rejection behavior.** A request whose `api-key` header is missing or empty, or whose `env`
header is missing or is any string other than `dev` / `staging` / `prod`, is rejected with **HTTP
`400`** and a body of the shape `{"ok":false,"error":"<message>"}`; none of its events are
ingested. For the SDK a `400` is an ordinary non-200 response: it MUST resolve rather than reject,
MUST NOT retry, and the batch is dropped after logging (Sections 7.5, 7.5.2, 12.5). Because both
header values come from constructor options that are validated at construction time (Section 4.1),
a conformant SDK never provokes this response.

**`X-Avo-Client`.** The value identifies the *sender*, not the event: it MUST be the same string
the SDK writes to `libPlatform` on every event object, MUST be constant for the life of the
process, and MUST NOT be derived from per-call input. It exists so that ingestion can attribute
traffic per sender without decoding a body.

**`Content-Length`.** The value MUST be the byte length of the body **actually sent** — the
compressed length when `Content-Encoding: gzip` is present, never the length of the uncompressed
JSON. The requirement is unconditional and always satisfiable: Section 7.3.5 already obliges the
SDK to measure the serialized body's byte length in order to decide whether to compress it, so a
server SDK always holds the complete body and its exact size before the request is sent. An SDK
MUST NOT switch to chunked transfer-encoding to avoid supplying the header. Where the runtime's
HTTP client sets `Content-Length` itself from a fully-buffered body, that satisfies this
requirement — the SDK need only pass the body as bytes rather than as a stream.

**No control characters in any header value.** An SDK MUST NOT transmit a request whose header
value contains a carriage return (`U+000D`), a line feed (`U+000A`), or a NUL (`U+0000`). In
HTTP/1.1 these characters delimit and terminate header fields, so a value carrying one can append
attacker-chosen headers to the request or split it into two — the request the server receives is
not the request the SDK meant to send.

Of the required headers, `env` is one of three literal values chosen by the SDK, `X-Avo-Client` is
a constant compiled into the SDK, and `Content-Type` / `Content-Length` are SDK-controlled. The
`apiKey` constructor option is the **only caller-supplied value that reaches a header**, so it is
where the check belongs and where an implementer should spend the effort. Section 4.1 requires the
constructor to reject such a key outright; this section is the guard on the wire itself, and it
also binds any caller-supplied header a future revision may add.

An SDK MUST perform this check itself and MUST NOT delegate it to the HTTP client. Runtimes differ:
some reject these characters, some throw a language-specific exception, and some pass them through
or re-encode them silently. A conformant SDK behaves the same on all of them.

When a header value cannot be transmitted safely, the SDK MUST **fail the send** — the batch is
dropped and the failure logged per Section 7.5, exactly as any other send failure (Section 12.5),
and `trackSchemaFromEvent` still resolves rather than rejects (Section 4.2). The SDK MUST NOT strip,
escape, truncate, or substitute the offending characters: silently rewriting an API key would send
a *different* key than the caller configured and turn a clear local failure into a confusing
server-side rejection.

> **Why this appears in this release.** Before the move to `/inspector/v2/track` the API key
> travelled only inside the JSON body, where a control character is escaped by the JSON encoder and
> cannot affect request framing. Putting the key in a request header is what creates this class of
> bug, so every SDK generated from this spec inherits it at the same moment. The requirement is
> stated here rather than left to implementers because the person generating an SDK is not
> ordinarily thinking about header injection.

<!-- Separates the two callouts: without it the blank line reads as one blockquote (MD028). -->

> **`Content-Type` stays `application/json` for server SDKs.** Browser SDKs send compressed
> bodies with `Content-Type: text/plain` to avoid a CORS preflight (`OPTIONS`) round-trip.
> Server-side SDKs are not subject to CORS and MUST keep `Content-Type: application/json`
> whether or not the body is compressed; the Inspector backend distinguishes compressed bodies
> by the `Content-Encoding` header alone. `text/plain` is additionally unsafe on
> `/inspector/v2/track`, which does not handle a `text/plain` body correctly, so a server SDK
> MUST NOT send it.

### 7.3 Request Body

The request body MUST be a JSON array of one or more event objects. A request carries a single
event when batching is inactive (e.g. `env == "dev"`, where `batchSize` is forced to `1`) and
multiple events when a batch is flushed (see Section 12).

Each event object in the array MUST be fully self-contained: it MUST carry its own `messageId`,
`createdAt`, `streamId`, `eventName`, and `eventProperties`. A batch MAY contain events with
different `streamId` values, different `eventName`s, and different `createdAt`
timestamps; implementations MUST NOT hoist, share, or deduplicate per-event fields across batch
elements, and MUST NOT assume all events in a batch belong to the same stream. The instance-level
fields (`apiKey`, `appName`, `libVersion`, `env`, and `libPlatform`) are identical across a batch
but are repeated on every element; the wire format has no shared header object. `appVersion` is
instance-level unless overridden per event via `options` (Section 7.3.6), and the OPTIONAL gateway
fields `outputReference` / `originHint` are likewise per event.

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
    "streamId": "string",
    "createdAt": "2026-05-25T12:00:00.000Z",
    "samplingRate": 1.0,
    "type": "event",
    "eventName": "string",
    "eventProperties": []
  }
]
```

#### 7.3.1 Base Body Fields

These fields MUST be present on every event object:

| Field | Type | Description |
|---|---|---|
| `apiKey` | string | The Inspector API key passed to the constructor. Also sent in the `api-key` request header, which is the copy the endpoint authenticates on (Section 7.2); the body copy MUST still be present. |
| `appName` | string | `appName` constructor option (empty string `""` if not provided). |
| `appVersion` | string \| null | The `version` constructor option, unless overridden per event by `options.originAppVersion`. A literal JSON `null` ONLY when `options.originHint` is set and no usable `options.originAppVersion` was provided (rule in Section 7.3.6). The key is always present. |
| `libVersion` | string | SDK library version. MUST be a plain SemVer string (e.g., `"1.2.0"`). No suffix. See Section 7.3.3 for canonical version file guidance. |
| `env` | string | One of `"dev"`, `"staging"`, `"prod"` (exact wire values from `AvoInspectorEnv`). Also sent in the `env` request header, which is the copy the endpoint reads (Section 7.2); the body copy MUST still be present. |
| `libPlatform` | string | Identifies the SDK platform/language (e.g., `"node"`, `"ruby"`, `"python"`, `"go"`). MUST be a non-empty string and MUST equal the `X-Avo-Client` request header value (Section 7.2). |
| `messageId` | string | UUID v4 (random). MUST be unique per event. See Section 8. |
| `streamId` | string | The caller-supplied stream id, or `""` if none provided. |
| `createdAt` | string | ISO 8601 UTC timestamp at event send time (e.g., `"2026-05-25T12:00:00.000Z"`). A 3-digit millisecond suffix (e.g., `.000Z`) MUST be present; the value of those digits is not constrained. |
| `samplingRate` | number | Current sampling rate `[0.0, 1.0]`. Initial value `1.0`. Updated from server response. |

> **Note on omitted fields:** `trackingId`, `visitorId` and `userId` MUST NOT be sent. They are
> dead weight from the browser SDK and carry no information for server-side use cases.
> `sessionId` is likewise not part of this body: a server SDK has no session to report, and the
> endpoint supplies the value itself (Sections 3.3 and 7.1). Callers that need to correlate events
> use `streamId`, which is OPTIONAL and caller-supplied.

#### 7.3.2 Event-Specific Fields (`type: "event"`)

| Field | Type | Description |
|---|---|---|
| `type` | `"event"` | Literal string. MUST be present. |
| `eventName` | string | Name of the tracked event. |
| `eventProperties` | array | Extracted schema (array of property objects). See Section 9. |

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

#### 7.3.4 Property Object

```json
{
  "propertyName": "string",
  "propertyType": "string | int | float | boolean | null | object | list(string) | list(int) | list(float) | list(boolean) | list(object) | unknown",
  "children": []
}
```

**`children` field normative rule:** `children` MUST be present when `propertyType` is `"object"`
OR any list type (including `"list(string)"`, `"list(int)"`, `"list(float)"`, `"list(boolean)"`,
`"list(object)"`). `children` MUST be absent for all primitive scalar types
(`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"unknown"`).

**`children` data structure:** `children` is a JSON array where each element is one of:

- A **type string** (`"string"`, `"int"`, `"float"`, `"boolean"`, `"null"`, `"object"`,
  `"unknown"`) — for primitive elements within an array.
- A **SchemaEntry object** (`{ propertyName, propertyType, children? }`) — when `propertyType`
  is `"object"`, the `children` array holds these directly, one per own property of the object.
- A **(possibly nested) array** of the above — for nested-array elements within a list (e.g. a
  list element that is itself an object maps to a SchemaEntry array; a list element that is itself
  a list of primitives maps to an array of type strings such as `["string"]`).

This is a heterogeneous, recursive union type: element = type string | SchemaEntry object | array
of (element). In statically-typed languages (Go, Rust, Java), implementations MUST use a union/sum
type or interface/any type for `children` elements.

**Example.** The event `{ "user": { "id": 1, "tags": ["a", "b"] }, "scores": [1, 2] }` extracts to:

```json
[
  {
    "propertyName": "user",
    "propertyType": "object",
    "children": [
      { "propertyName": "id", "propertyType": "int" },
      { "propertyName": "tags", "propertyType": "list(string)", "children": ["string"] }
    ]
  },
  { "propertyName": "scores", "propertyType": "list(int)", "children": ["int"] }
]
```

This shows the two most common `children` shapes — SchemaEntry objects for `object` properties and
type-string arrays for lists of primitives — nested recursively. See Section 9 for the full
algorithm (including the `list(object)` case) and Section 10 for golden fixtures.

#### 7.3.5 Request Body Compression (gzip)

To reduce egress, SDKs gzip-compress the serialized request body before sending it. The Inspector
backend accepts both compressed and uncompressed request bodies on the same endpoint.

**Compression is mandatory when feasible.** When a gzip implementation is available on the runtime,
an SDK MUST gzip-compress every request body whose serialized size is at least **1024 bytes**
(UTF-8 encoded). Compression is OPTIONAL only where it is not feasible — the SDK falls back to an
uncompressed body in exactly the cases listed under *Fallback to uncompressed* below (no gzip
implementation, a compression error, or a sub-threshold body). An SDK that simply chooses not to
compress a large body on a gzip-capable runtime is **not** conformant.

**Compression threshold.** Compression applies only when the serialized JSON body is at least
**1024 bytes** (UTF-8 encoded). Bodies smaller than 1024 bytes MUST be sent uncompressed — for
small payloads the gzip framing overhead outweighs the savings. The comparison is on UTF-8 **byte
length** (`>= 1024`), not character count, and is evaluated at flush time on the **assembled batch
body actually sent** (the full JSON array — see Section 12). A multi-event batch is far more likely
to exceed the threshold, but the rule is identical to that for a single-element body. Server SDKs
MUST use byte length, which is the same value already reported in `Content-Length`.

**Algorithm.** When compression is applied, the body MUST be compressed with gzip (RFC 1952 — the
gzip wrapper around DEFLATE, not raw zlib/RFC 1950 and not raw DEFLATE/RFC 1951). Every
server-side language provides this in its standard library (e.g., Go `compress/gzip`, Python
`gzip`, Ruby `Zlib::GzipWriter`, Node.js `zlib.gzipSync`, Java `GZIPOutputStream`,
Rust `flate2`).

**Headers when compressed.** A compressed request MUST set `Content-Encoding: gzip` and MUST set
`Content-Length` to the byte length of the compressed body. `Content-Type` MUST remain
`application/json` (see the note in Section 7.2). A request that is NOT compressed MUST NOT send a
`Content-Encoding` header.

**Fallback to uncompressed.** SDKs MUST fall back to sending the original, uncompressed body (and
MUST NOT set `Content-Encoding`) in — and only in — these cases:

- a gzip implementation is unavailable on the runtime, or
- compression raises/returns an error for the given body, or
- the body is below the 1024-byte threshold.

These are the only conditions under which a `>= 1024`-byte body may be sent uncompressed. An SDK
that targets a runtime with no gzip implementation MUST document this limitation in its README (it
is exempt from the `wire-6` conformance assertion but MUST still send a correct uncompressed body).

Compression MUST NOT change the logical request: the bytes the server obtains after gunzip MUST be
byte-identical to the JSON body that would have been sent uncompressed. Compression MUST NOT alter
any other observable behavior — the 10-second timeout, error taxonomy (Section 7.5), and promise
outcomes are identical for compressed and uncompressed requests.

#### 7.3.6 Gateway Coordinate Fields (`outputReference`, `originHint`) and Per-Event `appVersion`

These OPTIONAL fields carry the gateway coordinates from `options` (Section 4.2.1). They are
**top-level siblings of `eventProperties`** on the event object — never nested inside the schema.
An event property that happens to be named `outputReference`, `originHint`, or `appVersion` is an
ordinary property: it stays in `eventProperties` untouched and does not populate these fields.

| Field | Type | Presence | Description |
|---|---|---|---|
| `outputReference` | string | OPTIONAL | Normalized `options.outputReference`. Absent = gateway checkpoint. |
| `originHint` | string | OPTIONAL | Normalized `options.originHint`. |

**Normalization (MUST, applied to each of the three option values independently):**

1. A string value is trimmed (leading/trailing whitespace removed).
2. A value that is absent, `null`, empty, or whitespace-only after trimming is **absent**.
3. In dynamically-typed languages, a non-string value (number, boolean, object, array) is
   **absent** — SDKs MUST NOT stringify it. (The Inspector backend decodes these fields as optional
   strings and silently discards any other JSON type. A caller whose inputs are untyped — a
   tag-manager template, a config file — is expected to stringify numbers and booleans itself
   *before* calling the SDK; the SDK accepts strings only.) Statically-typed languages enforce this
   at compile time.
4. No length cap is imposed by the SDK.

**Wire mapping (MUST):**

- `outputReference` and `originHint`: when the normalized value is present, send it as a string;
  when absent, **omit the key entirely** — never send `null` or `""`.
- `appVersion` (always present as a key) is resolved per event:

  | `originHint` (normalized) | `options.originAppVersion` (normalized) | wire `appVersion` |
  |---|---|---|
  | present | present | `options.originAppVersion` |
  | present | absent | `null` — the instance's configured version never applies to a source-scoped event |
  | absent | present | `options.originAppVersion` |
  | absent | absent | the instance's `version` (unchanged 2.0.0 behavior) |

  Rationale: an event carrying `originHint` came from a *different* source than the app this SDK
  instance was configured for, so the instance-level version would be wrong; sending `null` is
  preferable to a misleading version.

- A `null` `appVersion` needs no special handling in the SDK: `/inspector/v2/track` accepts the
  event and records the observation as `unversioned`. An SDK MUST NOT suppress, substitute, or drop
  such an event, and no warning is required. (If an SDK chooses to log one anyway, the log MUST NOT
  include the option values — Section 7.5.1.)
- Session-started or any other non-`event` body types (not part of this spec) are unaffected.

**Example** — a call of
`trackSchemaFromEvent("purchase", { items: [] }, "", { outputReference: "meta-x7k2q", originHint: "android" })`
on an instance constructed with `version: "1.0.0"`:

```json
[
  {
    "apiKey": "<gateway key>",
    "appName": "my-app",
    "appVersion": null,
    "libVersion": "1.2.0",
    "env": "prod",
    "libPlatform": "ruby",
    "messageId": "550e8400-e29b-41d4-a716-446655440001",
    "streamId": "",
    "createdAt": "2026-09-03T12:00:00.000Z",
    "samplingRate": 1.0,
    "type": "event",
    "eventName": "purchase",
    "outputReference": "meta-x7k2q",
    "originHint": "android",
    "eventProperties": [ { "propertyName": "items", "propertyType": "list(string)", "children": [] } ]
  }
]
```

Conformance: `wire-9` – `wire-13` (presence, omission, trimming, the four-cell `appVersion` table,
and the property-name collision) and `batch-7` (per-event options inside one batch).

### 7.4 Response

**200 OK — accepted:**

```json
{ "samplingRate": 1.0, "success": true }
```

**200 OK — dropped by the workspace event limit:**

```json
{ "success": false }
```

The SDK MUST update its internal `samplingRate` when the response body contains a numeric
`samplingRate` value in `[0.0, 1.0]`. The update MUST only occur on status code `200`; a `200`
body that carries no `samplingRate` field leaves the current value unchanged. `success: false`
reports a workspace-level drop, not a transport failure: it MUST NOT be treated as an error, MUST
NOT be retried (Section 12.5), and MAY be logged when logging is enabled.

**Non-200:**

The SDK MUST resolve (not reject) the promise on non-200 responses. In dev/staging with logging
enabled, the status code SHOULD be logged. A `400` carries `{"ok":false,"error":"<message>"}` and
means the `api-key` or `env` request header was missing or invalid (Section 7.2).

### 7.5 Error Taxonomy

Implementations MUST follow this table exactly. The promise outcome refers to the promise
returned by `trackSchemaFromEvent`. The table describes the **immediate-send contract** — i.e. the
behavior observable per call when the send is synchronous to the call (`batchSize == 1`, always true
in `dev`). When `batchSize > 1` the send is decoupled from the call; see Section 7.5.2.

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

SDKs MUST NOT log the `apiKey` value or full request bodies that contain the `apiKey`. Error logs
MUST redact this field if it appears in an error object or response body before passing the error
to `console.error` or the language-equivalent logging facility.

### 7.5.2 Behavior Under Batching (`batchSize > 1`)

When batching defers the send, the batch's HTTP outcome is not attributable to any individual
`trackSchemaFromEvent` call (the events in a batch may originate from many calls, and the batch may
be triggered by a later call, by the scheduled flush, or by `flush()`). Therefore:

| Situation | Behavior |
|---|---|
| Event enqueued successfully | `trackSchemaFromEvent` resolves with the extracted schema at enqueue time. |
| Event dropped by sampling at enqueue | `trackSchemaFromEvent` resolves with the extracted schema; the event is not buffered and no call is made (see §7.7). |
| Synchronous internal error before enqueue | `Promise.reject("Avo Inspector: something went wrong. Please report to support@avo.app.")` — unchanged from the table above. |
| Batch send returns non-200 | Logged per §7.5 (in dev/staging with logging enabled). The batch MUST NOT be re-queued; it is dropped. Not observable to any `trackSchemaFromEvent` promise. |
| Batch send network error / timeout | Logged per §7.5. The batch MUST NOT be re-queued; its events are dropped (at-most-once delivery — see §3.2, §12.6). Not observable to any `trackSchemaFromEvent` promise. |

Consequently, the `Promise.resolve([])`-on-non-200 behavior in the §7.5 table is observable per call
**only** when the send is synchronous to the call (`batchSize == 1`, always true in `dev`). When
`batchSize > 1`, `trackSchemaFromEvent` always resolves with the extracted schema at enqueue,
regardless of the batch's eventual HTTP outcome. A batch that fails to send (for any reason) is
dropped after logging and MUST NOT be re-queued — the SDK provides at-most-once delivery for
buffered events (see §3.2, §12.6) and performs no retry.

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
- Sampling MUST be evaluated **per event, at enqueue time** — before the event is appended to the
  pending batch (see Section 12). The SDK MUST compare a random number (uniformly distributed in
  `[0.0, 1.0)`) against `samplingRate`. If `random > samplingRate`, the event MUST be dropped
  silently: it MUST NOT be enqueued and no network call is made. Whole-batch sampling (a single
  random check that drops an entire batch) MUST NOT be used — sampling granularity is per event,
  because a batch MAY mix events from different streams.
- **Boundary values:**
  - `samplingRate = 1.0` MUST send all events (random from `[0.0, 1.0)` is never `> 1.0`).
  - `samplingRate = 0.0` MUST effectively drop all events (`random > 0.0` is true for all
    non-zero values; treat as "drop all" in practice).
- The `samplingRate` value written into an event's wire body is the snapshot in effect **at the
  event's enqueue time** (the value that governed that event's sampling decision), not the value at
  flush time.
- The sampling rate is updated from the body of a `200` response **when that body carries a numeric
  `samplingRate` in `[0.0, 1.0]`**. A `200` whose body has no `samplingRate` — including the
  event-limit drop shape `{"success": false}` — leaves the current value unchanged (Section 7.4).
  Non-`200` responses never update it.
- In multi-threaded runtimes, `samplingRate` MUST be updated using a lock or atomic primitive.
  Last-write-wins is acceptable.
- **`/inspector/v2/track` does not sample server-side.** That ingestion path pins the
  `samplingRate` it returns to `1.0`, and the counts it stores are exact rather than extrapolated
  from a sampled fraction. This changes none of the SDK obligations above: an SDK still reads
  `samplingRate` from a `200` that carries one, still leaves the rate unchanged on a `200` that does
  not, still evaluates the per-event check at enqueue, and still honors whatever value it is given.
  It only means the value an SDK receives from the server is `1.0`, so server-driven sampling no
  longer reduces what the SDK sends.

---

## 8. ID Generation Format

### 8.1 Message ID (`messageId`)

- Format: UUID v4, lowercase hex, hyphenated.
- Pattern: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
  - `4` in position 13 is literal (UUID version 4 marker).
  - `y` in position 17 MUST be one of `8`, `9`, `a`, `b` (RFC 4122 variant bits).
- Validation regex (lowercase hex only — no `/i` flag):
  `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`
- MUST be unique per event object. MUST be generated fresh for each event body.
- Implementations MAY use a cryptographic UUID v4 library. The format MUST match; the entropy
  source MAY differ.

### 8.2 Stream ID (`streamId`)

- User-supplied string. No generation logic on the SDK side — it is whatever the caller passes.
- Implementations MUST pass `streamId` through as-is without modification.
- If absent or empty, `streamId` in the wire body MUST be `""` (empty string).
- `streamId` is the only correlation identifier on the wire, and it is OPTIONAL — the SDK sends
  `""` when the caller supplies nothing rather than generating a value.
- `trackingId`, `visitorId` and `userId` MUST NOT be sent. They are forbidden outright: a body
  carrying any of them is non-conformant (see Section 3.3 and Section 7.3.1).
- `sessionId` is not part of the wire body either, and the SDK MUST NOT generate one. It differs
  from the three above in the one respect that matters while the ingestion transition in Section
  7.1 is open: it is **not** forbidden, so a sender that still emits `""` stays conformant until
  that change ships.

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
| `0.0` (float zero) | `"float"` in statically-typed languages; **not asserted for JS/TS** — the JS reference parser emits `"int"` (see §9.3.1) |
| `0` (integer zero) | `"int"` |
| `""` (empty string) | `"string"` |
| `false` | `"boolean"` |
| `null` | `"null"` |
| `undefined` | `"null"` |
| `{}` (empty object) | `"object"` (with `children: []`) |
| `[]` (empty array) | `"list(string)"` (with `children: []`) |

#### 9.3.1 Float vs. Integer Distinction

The `int` vs. `float` distinction is **runtime-type dependent**, and the rule deliberately differs
by language family. Float-zero (`0.0`, `1.0`, and any whole-valued float) is the only contested
case; non-whole floats (`3.14`, `1.2`) classify as `"float"` everywhere.

**In statically-typed languages** (Go, Java, Rust, C#, Scala) — `0.0 → "float"` is a **MUST**: use
the declared/runtime type. `float32`/`float64`/`double` → `"float"`; `int`/`int32`/`int64`/`long`
→ `"int"`. The static type declaration is authoritative and unambiguous, so a `float64(0.0)` MUST
classify as `"float"`.

**In dynamically-typed languages with a distinct float runtime type** (Ruby, Python) — `0.0 →
"float"` is **RECOMMENDED**: use the runtime type where it is reliably available. `Float` →
`"float"`; `Integer`/`Fixnum` → `"int"`. In Python, `isinstance(val, float)` → `"float"`;
`isinstance(val, int)` → `"int"`.

**In JavaScript/TypeScript** — `0.0` and `0` are the **same runtime value** (`typeof` is `"number"`
for both; `Number.isInteger(0.0)` is `true`). The canonical reference parser (`node-avo-inspector`,
`AvoSchemaParser`) classifies any whole-valued float as `"int"` because `(0.0).toString() === "0"`
has no decimal point. JS/TS SDKs are therefore **NOT REQUIRED** to classify `0.0` as `"float"` and
MAY emit `"int"`; matching the reference parser (`"int"`) is conformant.

**Conformance:** the universal `schema-extraction` fixture-3 does **not** include a `0.0` input, so
the JS/TS reference SDK passes the suite unchanged. The `0.0 → "float"` invariant is verified only
for statically-typed SDKs (via their own typed test inputs), where it is a MUST.

> **Spec design intent note:** `0.0 → "float"` is a forward-looking requirement for statically-typed
> languages where `0.0` and `0` are genuinely different runtime types. It is intentionally **not** a
> wire-level conformance gate for dynamically-typed SDKs, because their runtime cannot always
> distinguish the two — and forcing it would make the canonical JS reference SDK non-conformant
> against its own spec.

#### 9.3.1.1 Parser Configuration Requirements

When a conformance fixture is delivered via JSON stdin (e.g., from the conformance harness), a
statically-typed SDK's JSON parser SHOULD preserve the `int` vs. `float` distinction from the
literal source where the language requires it (e.g. mapping a JSON `3` to an integer type and a
JSON `3.14` to a float type). Most default JSON parsers in dynamically-typed languages already
expose this via the runtime numeric type.

**Normative rule (statically-typed SDKs):** A statically-typed SDK whose harness materializes JSON
numbers into declared types MUST preserve the literal-source `int` vs. `float` distinction so that
a fixture's float literal is treated as a float and an integer literal as an integer. *How* this is
achieved is an implementation detail left to the SDK author. The SDK's own `extractSchema` method
operates on the host language's native types and MUST use the declared/runtime type as the
authority. Note that the universal `schema-extraction` fixtures avoid the only ambiguous case
(whole-valued floats such as `0.0`); see §9.3.1.

#### 9.3.2 Recursion Depth

The `mapping` function is recursive. Implementations in languages with fixed recursion limits
(Python default: 1000; Ruby fiber: limited) SHOULD impose a maximum recursion depth of 10 levels.
If the limit is reached, the property MUST be included with `propertyType: "object"` and
`children: []` (depth truncation, not an error). Implementations MAY choose a higher limit; they
MUST NOT silently crash on pathological inputs.

> **Note:** The 10-level truncation rule is a spec recommendation for languages with fixed stack
> limits. It is not exercised by the conformance fixtures, which test to a maximum of 3 levels of
> nesting.

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

#### 9.3.4 List Element and Null Edge Cases (reference-parser behavior)

The list `propertyType` is `"list(" + getBasicPropType(firstElement) + ")"` — it is determined by
the **first** element only (see §9.2). The following edge cases describe the behavior of the
canonical JS/TS reference parser (`node-avo-inspector`, `AvoSchemaParser`). They are documented as
guidance, not as universal golden fixtures: behaviors that depend on JS runtime typing (e.g. a
`null` element, a nested array) are reference-parser behaviors, and statically-typed SDKs SHOULD
follow their own natural type system rather than reproduce a JS-specific quirk.

- **Empty array `[]` → `"list(string)"`** with `children: []`. The empty list defaults to
  `list(string)` (the first element is `undefined`). The Inspector backend additionally has an
  internal "empty list" concept and accepts `list(empty)`, but a conformant SDK emits
  `"list(string)"` for an empty array; the backend treats the SDK's `list(string)` as a concrete
  string list. There is **no** `list(null)` or `list(empty)` requirement on the SDK.

- **`list(object)` covers two shapes.** `getBasicPropType` returns `"object"` for any non-null
  object, including a nested array. So both an array of objects (`[{...}, {...}]`) **and** an array
  whose first element is itself an array (`[[1], [2]]`) classify as `"list(object)"`. In the
  array-of-objects case, `children` is an array of **per-element** results — one `SchemaEntry[]`
  per source object — deduplicated only by reference identity, so distinct objects are never merged
  (this is the shape shown in fixtures 7 and 9). Example: `[[1], [2]]` →
  `"list(object)"` with `children: [["int"], ["int"]]`.

- **A `null` or `undefined` element inside a list does not produce `"list(null)"`.** `"list(null)"`
  is not a valid `propertyType` (it is not in the §7.3.4 enum). When a list's first element is
  `null`/`undefined`, the list still classifies as `"list(string)"` (the empty-list default). The
  reference parser's `children` for such an element are JS-specific: a `null` element maps to an
  empty array `[]` (it takes the object branch and has no keys), while an `undefined` element maps
  to the type string `"null"`. Example (JS reference): `{ "v": [null, 1] }` →
  `"list(string)"` with `children: [[], "int"]`; `{ "v": [undefined, 1] }` →
  `"list(string)"` with `children: ["null", "int"]`. Statically-typed SDKs MAY differ here per their
  own type system; this asymmetry is not a conformance gate.

  **Divergence from the §9.2 pseudocode.** The §9.2 pseudocode treats a `null` value as the scalar
  type string `"null"` (its object branch is explicitly "non-null Object"). The JS reference parser
  diverges because `typeof null === "object"`, so `null` falls into the object branch and yields
  `[]`. These two descriptions are intentionally different: the §9.2 pseudocode is the recommended
  normative behavior for new SDKs, and this reference-parser quirk is documented only for fidelity
  with `node-avo-inspector`. Neither the quirk nor the divergence is a conformance gate.

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
  "input": { "a": false, "b": 0, "c": "", "e": null, "f": {}, "g": [] },
  "expected": [
    { "propertyName": "a", "propertyType": "boolean" },
    { "propertyName": "b", "propertyType": "int" },
    { "propertyName": "c", "propertyType": "string" },
    { "propertyName": "e", "propertyType": "null" },
    { "propertyName": "f", "propertyType": "object", "children": [] },
    { "propertyName": "g", "propertyType": "list(string)", "children": [] }
  ]
}
```

Note: float-zero (`0.0`) is intentionally **not** part of this universal fixture. Classifying `0.0`
as `"float"` is a statically-typed-language-only invariant — the canonical JS/TS reference parser
(`node-avo-inspector`) classifies any whole-valued float as `"int"` (`(0.0).toString() === "0"`,
no decimal point), so a universal `0.0 → "float"` assertion would fail the reference SDK. See
§9.3.1 for the per-language rule.

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

## 11. Flush and Shutdown

### 11.1 Flush Is the Universal Delivery Guarantee

All SDKs MUST implement `flush()` (see Section 4.6), regardless of target runtime, so that callers
can deterministically deliver in-flight and buffered events before the host process or function
handler exits. There is **no** runtime-specific keepalive mechanism: an SDK MUST NOT rely on any
mechanism that holds the host process open by itself (such as a no-op keepalive timer) to deliver
events. Delivery before exit is the caller's responsibility, performed by invoking `flush()` or by
`await`-ing the promise returned by `trackSchemaFromEvent`.

Callers that do not `flush()` (or `await`) before exit may lose events that are still in-flight or
buffered in the pending batch (at-most-once delivery — see Sections 3.2 and 12.6). SDKs MUST
document this shutdown contract in the README.

> **Implementation note.** An SDK MAY register a best-effort at-exit / shutdown hook (e.g. an
> `atexit` handler, a runtime shutdown callback, or the language-idiomatic equivalent) that calls
> `flush()` automatically. This is OPTIONAL convenience only: it MUST NOT be the SDK's sole
> delivery mechanism, and an explicit `flush()` before exit remains the documented contract.

### 11.2 Serverless Guidance

In serverless environments (AWS Lambda, Google Cloud Functions, Vercel Edge Functions, Cloudflare
Workers, etc.), the runtime reclaims resources when the function handler returns. SDKs MUST
expose `flush()` and MUST document that callers MUST invoke it before the function handler
returns to ensure in-flight events are delivered. Serverless SDKs SHOULD also set
`disableBatchTimer` (see Section 12).

### 11.3 `destroy()` vs. `flush()` Clarification

These are distinct operations and MUST NOT be conflated:

- `destroy()` — **cancel and clean up.** Discards the pending batch unsent, abandons in-flight
  requests, resets `pendingCount` to 0, and clears the scheduled-flush timer. Does NOT wait for
  in-flight requests.
- `flush()` — **wait and continue.** Force-flushes (sends) the pending batch, then waits for all
  pending operations to complete (or timeout), then resolves. Does NOT reset state. Instance is
  fully usable after `flush()` returns.

### 11.4 Scheduled Flush Timer

The batching scheduled-flush timer (Section 12) periodically flushes a non-empty pending batch so
partial batches do not linger on idle/low-traffic processes. It MUST NOT hold the process open — in
runtimes with a reference-counted event loop it MUST be unref'd (or the language-idiomatic
equivalent: daemon thread, weak/background timer). It is therefore a best-effort drain that runs
only while the process is otherwise alive; it is **not** a substitute for `flush()` before exit. The
scheduled-flush timer MUST be cleared by `destroy()`.

---

## 12. Batching

### 12.1 Overview

Conformant SDKs accumulate events in an in-memory **pending batch buffer** and send them to the
Inspector API as a single JSON array (see Section 7.3), flushed when a size or time trigger fires.
Batching reduces the number of HTTP requests on busy servers. The wire body is already an array, so
batching changes buffering and lifecycle, not the per-event wire shape.

### 12.2 Configuration

Batch behavior is controlled by the constructor options in Section 5:

| Option | Default | Meaning |
|---|---|---|
| `batchSize` | `30` | Flush when the buffer length reaches `batchSize`. **Forced to `1` when `env == "dev"`** (immediate send), overriding any configured value. MUST be ≥ 1. |
| `batchFlushSeconds` | `30` | Maximum age (seconds) of the oldest buffered event before a time/idle flush SHOULD occur. MUST be > 0. |
| `maxQueueSize` | `1000` | Hard cap on buffered events; FIFO-oldest drop on overflow. |
| `disableBatchTimer` | `false` | When `true`, no background/scheduled flush timer is started. |

**`dev` forces `batchSize = 1` (MUST).** When `env == "dev"`, the SDK MUST behave as if
`batchSize == 1` regardless of the configured value, sending each event immediately. This guarantees
immediate visibility during development.

Batch configuration is fixed at construction time (Section 5).

### 12.3 Flush Triggers

The buffer is flushed when **either** trigger fires:

- **Size (MUST):** when the buffer length reaches `batchSize`.
- **Time / idle (SHOULD):** when the oldest buffered event is older than `batchFlushSeconds`,
  *independently of whether new events arrive*. Evaluating the time trigger only on the next enqueue
  is NOT sufficient for a long-running server process and MUST NOT be the sole time-flush mechanism
  in non-serverless, long-running deployments; such SDKs SHOULD run a scheduled flush. Any
  scheduled/background flush MUST be non-blocking and MUST NOT prevent the process from exiting
  (Section 11.4). The size trigger remains MUST in all deployments.

A flush of an empty buffer is a no-op (no request is made).

### 12.4 Send and Concurrency

Under a single lock, the SDK appends the event and evaluates the triggers; if flushing, it moves the
buffer contents to a local variable and resets the shared buffer to empty (the atomic "swap and
clear" of Section 3.1). The HTTP send (the assembled array as the request body) MUST be performed
OUTSIDE the lock. The buffer is shared mutable state and MUST be synchronized per Section 3.1.

### 12.5 Buffer Bound and Failure Handling

- The buffer MUST be bounded by `maxQueueSize` (default **1000**). When appending would exceed the
  cap, the SDK MUST drop the **oldest** buffered events first (FIFO) to make room for the newest.
- Drops due to the cap MUST be logged (a count only — never event contents; see §7.5.1) when logging
  is enabled. Silent data loss is not acceptable on a long-running server.
- On **any** send failure — transient (network error or timeout) or a **non-200** HTTP response —
  the batch MUST NOT be re-queued; its events are dropped and the failure is logged per §7.5. The
  SDK does not retry sends: buffered events have at-most-once delivery (see §3.2, §12.6).
- The Inspector backend does not deduplicate on `messageId`, so retrying a failed batch would
  double-count events. At-most-once delivery is the deliberate contract; callers that need
  stronger guarantees must `flush()` and handle failures themselves.

### 12.6 Persistence and Lifecycle

- The buffer is in-memory only and MUST NOT be persisted (Section 3.2). Buffered-but-unsent events
  are lost on crash/kill/exit-without-flush (at-most-once delivery).
- `flush()` MUST force-flush the pending batch then await (Section 4.6). In serverless environments,
  callers MUST `flush()` before the handler returns, and SDKs SHOULD set `disableBatchTimer` (a
  background timer may be suspended between invocations or leak across warm-container reuse).
- `destroy()` MUST discard the pending batch unsent and stop the scheduled-flush timer (Section 4.5).

### 12.7 Wire Shape

A flushed batch is a JSON array of one or more self-contained event objects (Section 7.3); a batch
MAY mix `streamId`/`eventName`/`createdAt` across elements, and MAY mix elements with and without
the gateway fields (`outputReference`/`originHint`) or with different per-event `appVersion`
values (Section 7.3.6) — `options` are resolved per event at enqueue and travel with that element.
`Content-Type` remains `application/json` (Section 7.2). gzip applies to the assembled batch body
per the 1024-byte rule (Section 7.3.5).

### 12.8 Promise and Sampling Semantics

- `trackSchemaFromEvent` resolves with the extracted schema at enqueue time (Section 4.2); the
  batch's eventual HTTP outcome is not observable per call when `batchSize > 1` (Section 7.5.2).
- Sampling is evaluated per event at enqueue (Section 7.7); dropped events are never buffered.

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
| `messageId` | UUID v4, lowercase hex | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` |
| `createdAt` | ISO 8601 UTC with milliseconds | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` |
| `libVersion` | Plain SemVer string | `/^\d+\.\d+\.\d+$/` |
| `libPlatform` | Non-empty string | Any non-empty string; suite runner accepts any |
| *(any key)* | `"<absent>"` placeholder | The key MUST NOT be present in the captured event object at all (used to assert omitted gateway fields, Section 7.3.6) |

When a fixture's `expected_request_body` contains a placeholder value (e.g., `"<uuid-v4>"`,
`"<iso8601>"`, `"<semver>"`, `"<sdk-platform>"`, `"<absent>"`), the suite runner MUST validate that
field using the corresponding rule rather than comparing to the placeholder string exactly.

### Environment Variable

`AVO_INSPECTOR_MOCK_ENDPOINT` — when set, the SDK under test MUST send HTTP calls to this URL
instead of `https://api.avo.app`. The wire-protocol suite injects a local mock server URL here.
The SDK MUST honor it only for non-`prod` instances and MUST fail closed in production (see the
§7.1 security requirement); all fixtures construct the SDK with `env: "dev"` or `"staging"`.

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

*Spec version: 3.0.0 — moves every request to `POST https://api.avo.app/inspector/v2/track` and
makes the `api-key`, `env` and `X-Avo-Client` request headers REQUIRED (Sections 7.1, 7.2); also
adds the OPTIONAL gateway coordinates `outputReference` / `originHint` and the per-event
`appVersion` override (`options.originAppVersion`, Sections 4.2.1 and 7.3.6), lets the target
language decide whether those three are top-level parameters or one options object (Section 4.2.1),
and REMOVES `sessionId` from the wire body, which 2.0.0 had made a required empty string (Sections
3.3, 7.3.1, 8.2 — read the dated ingestion note in Section 7.1 before dropping it from a sender
already in production).*
*Last updated: 2026-09-04.*
