# AGENTS.md — AI Agent SDK Generation Guide

This file is the primary entry point for an AI coding agent tasked with generating an
Avo Inspector server-side SDK. Read this file first, then follow the reading order in
Section 2 and the checklist in Section 3.

---

## 1. What to Build

Generate a `<language>` Inspector SDK — a class named `AvoInspector` (or the
language-idiomatic equivalent) — that conforms to the normative contract in `SPEC.md`.
The SDK sends analytics event schemas to the Avo Inspector HTTP API at
`POST https://api.avo.app/inspector/v1/track`. It is server-side only: no browser,
no localStorage, no session management, no user-facing UI concerns. The SDK MUST
extract a type schema from arbitrary event property maps and POST that schema to
the Inspector API, handling sampling, deduplication (optional), and graceful error
recovery transparently to the caller.

---

## 2. Files to Read and in What Order

Read every file in this order before writing any code. Do not skip files.

1. **`AGENTS.md`** (this file) — Read first. Contains the checklist, conformance
   instructions, and definition of done.
2. **`SPEC.md`** — The normative prose contract. Read in full. All normative requirements
   (MUST/SHOULD/MAY) come from this document.
3. **`openapi.yaml`** — Machine-readable OpenAPI 3.1 contract for the Inspector HTTP API.
   Use this to generate wire-compatible serialization and HTTP client code.
4. **`schemas/`** — JSON Schema definitions for all request and response shapes. Cross-reference
   with `openapi.yaml` and `SPEC.md §7.3` when implementing wire serialization.
5. **`conformance/runner-contract.md`** — Normative harness protocol. Read before implementing
   the conformance CLI binary (`avo-inspector-conformance`).
6. **`conformance/schema-extraction/fixtures.json`** — 13 golden schema-extraction fixtures.
   Your `extractSchema` implementation MUST produce the exact `expected` output for each `input`.
7. **`conformance/wire-protocol/fixtures.json`** — Wire-protocol golden fixtures (wire-1 through
   wire-6). Your `trackSchemaFromEvent` implementation MUST pass all of these.
8. **`conformance/error-handling/fixtures.json`** — Error-handling fixtures. Your implementation
   MUST pass all of these (REQUIRED suite).
9. **`conformance/deduplication/fixtures.json`** — Deduplication fixtures (OPTIONAL suite).
   Your implementation SHOULD pass these; they do not block a conformance pass grade.

---

## 3. SDK Generation Checklist

Complete every item before declaring the SDK done. Each item is binary: it either passes or fails.

### Constructor and Initialization

- [ ] Constructor throws synchronously with the exact message
  `"[Avo Inspector] No API key provided. Inspector can't operate without API key."`
  when `apiKey` is absent, empty, or whitespace-only (SPEC.md §4.1).
- [ ] Constructor throws synchronously with the exact message for missing `version`
  (copy as a single string — do not split across lines):

  ```text
  [Avo Inspector] No version provided. Many features of Inspector rely on versioning. Please provide comparable string version, i.e. integer or semantic.
  ```

  Throw when `version` is absent, empty, or whitespace-only (SPEC.md §4.1).
- [ ] Invalid or absent `env` falls back to `"dev"` and emits a console warning. The constructor
  MUST NOT throw on invalid `env` (SPEC.md §4.1, §6.3).
- [ ] When `env == "dev"`, logging is enabled by default (`shouldLog = true`).
  When `env != "dev"`, logging is disabled by default (`shouldLog = false`) (SPEC.md §4.1).

### enableLogging

- [ ] `enableLogging(enable)` sets a process-wide flag. Calling `enableLogging(true)` on one
  instance MUST affect behavior of all other instances in the same process. Implement as a
  static/package-level variable, not a per-instance field (SPEC.md §4.4).

### Schema Extraction

- [ ] `extractSchema` returns `[]` when `eventProperties` is `null`, `undefined`, or absent.
  It MUST NOT throw to the caller (SPEC.md §4.3).
- [ ] All 13 schema-extraction fixtures pass: `extractSchema` produces the exact `expected`
  output for every fixture in `conformance/schema-extraction/fixtures.json` (SPEC.md §10).
- [ ] The value `0.0` (float zero) MUST be classified as `"float"`, not `"int"`. In
  statically-typed languages, use the declared type. In JavaScript, `0.0` is indistinguishable
  from `0`; the SDK MUST classify it as `"float"` per spec design intent (SPEC.md §9.3.1).

### Wire Protocol

- [ ] `trackSchemaFromEvent` POSTs to `https://api.avo.app/inspector/v1/track` (HTTPS, port 443)
  unless `AVO_INSPECTOR_MOCK_ENDPOINT` is set, in which case it MUST POST to that URL
  verbatim (SPEC.md §7.1).
- [ ] Every outgoing request body is a JSON array with exactly one event object (SPEC.md §7.3).

  **Required fields (MUST be present in every wire body):**
  `anonymousId`, `apiKey`, `appName`, `appVersion`, `avoFunction`, `createdAt`, `env`,
  `eventHash`, `eventId`, `eventName`, `eventProperties`, `libPlatform`, `libVersion`,
  `messageId`, `samplingRate`, `type`.

  **Forbidden fields (MUST NOT appear in any wire body):**
  `sessionId`, `trackingId`.
- [ ] `libVersion` MUST be a plain SemVer string (e.g., `"1.2.0"`). No suffix (`+spec`, `-rc1`,
  etc.) is permitted. Define it as a constant in a dedicated version file (SPEC.md §7.3.3).
- [ ] `messageId` MUST be a UUID v4, lowercase hex, hyphenated, unique per event object.
  Pattern: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`
  (SPEC.md §8.1).
- [ ] `createdAt` MUST be an ISO 8601 UTC timestamp with millisecond precision
  (e.g., `"2026-05-25T12:00:00.000Z"`). The `.000Z` suffix MUST be present (SPEC.md §7.3.1).
- [ ] The dedup key formula is `streamId + "\0" + eventName` (null-byte separator).
  When `streamId` is absent or empty, the key prefix is `""` (SPEC.md §11.3).
- [ ] Request bodies ≥ 1024 bytes (UTF-8) SHOULD be gzip-compressed (RFC 1952) with
  `Content-Encoding: gzip` and `Content-Length` set to the compressed length; `Content-Type`
  stays `application/json`. Smaller bodies, or any runtime without gzip / on a compression error,
  MUST fall back to an uncompressed body with no `Content-Encoding` header (SPEC.md §7.3.7).

### Error Handling and Resilience

- [ ] Non-200 HTTP responses MUST resolve the `trackSchemaFromEvent` promise (MUST NOT reject).
  Resolved value is ALWAYS `[]` on non-200 — even when `eventProperties` was non-empty
  (SPEC.md §4.2 step 4, §7.4, §7.5). The `error-2` fixture (non-empty props + 400 → `[]`)
  is the source of truth.
- [ ] Network timeout (10 s) and network errors are swallowed inside the internal send handler.
  `trackSchemaFromEvent` MUST resolve with the extracted event schema even when the HTTP call
  fails or times out (SPEC.md §7.5, §7.6).
- [ ] When `samplingRate` is `0.0`, the event MUST be dropped silently and zero HTTP calls MUST
  be made (SPEC.md §7.7).
- [ ] `samplingRate` MUST be updated from the `samplingRate` field in every successful 200
  response body. Updates MUST use a lock or atomic primitive in multi-threaded runtimes
  (SPEC.md §7.4, §7.7).

### Flush and Lifecycle (Non-Node.js SDKs)

- [ ] Non-Node.js SDKs MUST implement `flush(timeoutMs?: number): Promise<void>` (or synchronous
  equivalent). `flush()` MUST resolve (never reject) once all pending sends initiated before
  the call have completed or been abandoned. Default timeout: 10,000 ms (SPEC.md §4.6).
  This requirement is NOT present in the Node.js reference SDK; it is a new requirement for
  all non-Node.js implementations.
- [ ] `flush()` MUST be documented in the SDK README as required before process exit or function
  handler return (serverless) when events may be in-flight (SPEC.md §3.4, §13.2, §13.3).

### Lifecycle

- [ ] `destroy()` is implemented and after `destroy()`, `trackSchemaFromEvent()` is a no-op
  (returns `Promise.resolve([])`). `pendingCount` MUST be `0` and the keepalive timer MUST be
  cleared after `destroy()`. Constructor options (`apiKey`, `env`, `version`, `appName`,
  `samplingRate`) and the process-wide `shouldLog` flag MUST NOT be reset (SPEC.md §4.5,
  AC-19).

---

## 4. How to Run Conformance

### Build the Harness

Implement a CLI binary named `avo-inspector-conformance` (language-idiomatic equivalents
accepted: `bin/conformance`, `conformance.rb`, `conformance.py`). Read
`conformance/runner-contract.md` for the full normative harness protocol.

### Run a Fixture

```sh
echo '<fixture-json>' | avo-inspector-conformance
```

The harness reads one JSON line from stdin, constructs an `AvoInspector` instance with the
`constructor` options, invokes the operation, and writes one JSON result line to stdout.

### Wire-Protocol Fixtures

Wire-protocol fixtures require the `AVO_INSPECTOR_MOCK_ENDPOINT` environment variable to be
set before invoking the harness. The suite runner starts a local mock HTTP server and injects
its URL:

```sh
AVO_INSPECTOR_MOCK_ENDPOINT=http://localhost:9876 echo '<fixture-json>' | avo-inspector-conformance
```

The SDK MUST POST to `http://localhost:9876` (no trailing slash, no path appended) when this
variable is set.

### Conformance Pass Criteria

An SDK is conformant when:

- All 13 `schema-extraction` suite fixtures pass.
- All 6 `wire-protocol` suite fixtures pass.
- All `error-handling` suite fixtures pass.
- `deduplication` fixtures are OPTIONAL (SHOULD pass; they do not block a conformance grade).

---

## 5. Definition of Done

The SDK is complete when all 19 SPEC.md acceptance criteria are satisfied.

### AC-1 — Constructor apiKey validation (SPEC.md §4.1)

Constructor throws synchronously with the exact error message when `apiKey` is absent, empty,
or whitespace-only.

### AC-2 — Constructor version validation (SPEC.md §4.1)

Constructor throws synchronously with the exact error message when `version` is absent, empty,
or whitespace-only.

### AC-3 — Invalid env fallback (SPEC.md §4.1, §6.3)

Invalid or absent `env` falls back to `"dev"` with a console warning. Constructor MUST NOT
throw on invalid `env`.

### AC-4 — Logging default tied to env (SPEC.md §4.1, §6.2)

`shouldLog` is `true` when `env == "dev"` and `false` for all other env values at construction
time.

### AC-5 — enableLogging is process-wide (SPEC.md §4.4)

`enableLogging(true)` on one instance affects all instances in the same process. Implemented
as a static/package-level variable.

### AC-6 — extractSchema null-safe (SPEC.md §4.3)

`extractSchema` returns `[]` for `null`, `undefined`, or absent input without throwing.

### AC-7 — All 13 schema-extraction fixtures pass (SPEC.md §9, §10)

`extractSchema` produces the exact expected output for every fixture in
`conformance/schema-extraction/fixtures.json`, including `0.0` classified as `"float"` (not
`"int"`) in fixture-3 (SPEC.md §9.3.1).

### AC-8 — Wire endpoint and HTTPS (SPEC.md §7.1)

`trackSchemaFromEvent` POSTs to `https://api.avo.app/inspector/v1/track` over HTTPS.
When `AVO_INSPECTOR_MOCK_ENDPOINT` is set, the SDK MUST POST to that URL instead.

### AC-9 — Complete wire body fields (SPEC.md §7.3)

Every outgoing event object contains all required fields:
`anonymousId`, `apiKey`, `appName`, `appVersion`, `avoFunction`, `createdAt`, `env`,
`eventHash`, `eventId`, `eventName`, `eventProperties`, `libPlatform`, `libVersion`,
`messageId`, `samplingRate`, `type`.
`sessionId` and `trackingId` MUST NOT be sent.

### AC-10 — libVersion plain SemVer, no suffix (SPEC.md §7.3.3)

`libVersion` is a plain SemVer string (e.g., `"1.2.0"`). No suffix of any kind. Defined in
a dedicated version file. SDK README instructs maintainers to update it on each release.

### AC-11 — messageId UUID v4 format (SPEC.md §8.1)

`messageId` is a UUID v4, lowercase hex, hyphenated, unique per event.

### AC-12 — createdAt ISO 8601 UTC with milliseconds (SPEC.md §7.3.1)

`createdAt` includes millisecond precision and the `Z` suffix (e.g., `"2026-05-25T12:00:00.000Z"`).

### AC-13 — Non-200 responses resolve (SPEC.md §7.4, §7.5)

`trackSchemaFromEvent` resolves (does not reject) on any non-200 HTTP response.

### AC-14 — Network errors swallowed (SPEC.md §7.5, §7.6)

Network timeouts (10 s) and network errors are swallowed inside the send handler.
`trackSchemaFromEvent` resolves with the extracted schema even when the HTTP call fails.

### AC-15 — 10-second request timeout (SPEC.md §7.6)

Every outbound HTTP call has a 10-second timeout. On timeout, the request is destroyed and
the internal promise is rejected with `"Request timed out"`. The outer promise still resolves.

### AC-16 — Sampling drop at samplingRate 0.0 (SPEC.md §7.7)

When `samplingRate` is `0.0`, all events are dropped silently and zero HTTP calls are made.
When `samplingRate` is `1.0`, all events are sent.

### AC-17 — samplingRate updated from 200 response (SPEC.md §7.4, §7.7)

`samplingRate` is updated from the `samplingRate` field of every successful 200 response.
Guarded by a lock or atomic primitive in multi-threaded runtimes.

### AC-18 — flush() implemented for non-Node SDKs (SPEC.md §3.4, §4.6, §13.2)

Non-Node.js SDKs implement `flush()`. It resolves once all pending sends have completed or
been abandoned. Default timeout: 10,000 ms. It MUST resolve (never reject). Documented in
the SDK README as required before process/function exit.

### AC-19 — destroy() post-state correct (SPEC.md §4.5)

After `destroy()`, `pendingCount` is `0` and the keepalive timer is cleared. `apiKey`, `env`,
`version`, `appName`, `samplingRate`, and the process-wide `shouldLog` flag are NOT reset.
`destroy()` is distinct from `flush()`: it cancels and cleans up; it does not wait for
in-flight requests.
