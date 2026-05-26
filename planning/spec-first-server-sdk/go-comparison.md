# Go SDK ↔ Spec Comparison

**Date:** 2026-05-25
**Spec revision:** Rev 5 (Reverse-check fixes)
**Go SDK source:** `avohq/go-avo-inspector` (top-level `.go` files, excluding `/vendor/` and `/example/`)
**Reference SDK:** `avohq/node-avo-inspector` v1.2.0

---

## Summary

- **Spec → Go:** 10 implemented / 9 missing / 8 diverging / 2 N/A
- **Go → Spec:** 6 covered / 5 missing-from-spec / 3 ambiguous

**Headline finding:** The Go SDK and the spec share a common ancestor (the node SDK wire protocol) and agree on the broad strokes — endpoint URL, JSON request body shape, ECIES encryption wire format, GUID v4 format, and crypto-random entropy. However they diverge materially on the schema extraction algorithm (type-string output format for lists and booleans, children representation for arrays), error semantics (Go returns `error` not a swallowed promise), deduplication (Go has none), keepalive/flush (Go has neither), and several required wire body fields (`trackingId`, `sessionId`, `avoFunction`, `eventId`, `eventHash`). Most critically, the Go SDK contains a fully-built event-spec validation subsystem (`event_spec_fetcher`, `event_spec_cache`, `event_validator`) that the spec explicitly places out of scope and gives no normative requirements for — yet Go exposes it as a public API method (`EnableValidation()`). This subsystem makes an additional undocumented HTTP GET request to a second endpoint (`GET /inspector/v1/api/event-spec`) that the spec never mentions. This is the single largest wire-protocol gap.

---

## Critical Gaps (must address before publishing spec)

### 1. Undocumented Second Endpoint (`GET /inspector/v1/api/event-spec`)

`event_spec_fetcher.go:111` constructs:
```
GET {baseURL}/api/event-spec?apiKey=…&streamId=…&eventName=…
```
where `baseURL = "https://api.avo.app/inspector/v1"`, resulting in:
```
GET https://api.avo.app/inspector/v1/api/event-spec?apiKey=…&streamId=…&eventName=…
```
The spec covers **only** `POST /inspector/v1/track`. This second endpoint — its path, query parameters, authentication, response shape (`EventSpecResponse`), and the `MatchRule` / `ValidationResult` types — is entirely absent from the spec. Any SDK author who implements the validation feature using only the spec will get the URL wrong. **The spec must either document this endpoint or explicitly state it is out of scope and MUST NOT be implemented by conformant SDKs.**

### 2. Schema Extraction Algorithm Produces Non-Conformant Output

Go's `avoSchemaParser.go` produces output that will **fail every array-related fixture** (fixtures 3, 5, 6, 7, 9, 10, 11, 12) because:

- **List type string:** Go emits `"list"` (bare) for all arrays. Spec requires `"list(string)"`, `"list(int)"`, `"list(float)"`, `"list(boolean)"`, `"list(object)"`, `"list(null)"` — the element type is embedded in the type string. Go's `getType()` always returns `"list"` for `[]interface{}`.
- **Children for arrays:** Go uses numeric-indexed `Property` structs (`PropertyName: "0"`, `PropertyName: "1"`, etc.) as children. The spec requires children to be type-strings for primitive elements or `SchemaEntry` arrays for object/array elements — a heterogeneous union, not a struct array indexed by position.
- **Boolean type string:** Go emits `"bool"` (`getType()` case `bool:` → `return "bool"`). Spec and node SDK require `"boolean"`.
- **No first-element-only rule for arrays:** Go iterates all elements; spec says the `propertyType` of the list entry is determined solely by the **first** element.
- **No deduplication of array children:** Go includes all elements; spec requires `removeDuplicates`.
- **No empty-array default:** Go returns `nil` children for `[]interface{}{}`. Spec requires `"list(string)"` with `children: []`.
- **Float handling:** Go's type switch matches `float32, float64` → always `"float"`. Spec requires `0.0` → `"int"` (string representation `"0"` has no `.`). This is the JavaScript `String(0.0) == "0"` rule — Go has no equivalent and the test suite does not cover it.
- **`undefined`:** Not applicable in Go (no JS `undefined`). N/A, but spec says `undefined` → `"null"` for any SDK consuming JS-like dynamic input. Go's `nil` already maps to `"null"` correctly.

This means the schema extraction algorithm is the **most broken area** — none of the 13 golden fixtures would pass against the current Go implementation.

### 3. Non-200 Response Causes `error` Return (Breaks Promise-Resolve Contract)

Spec edge case 15 and the Error Taxonomy table both require non-200 responses to **resolve** (not reject) the promise. Go's `callInspectorWithBatchBody` returns `fmt.Errorf("request returned non-200 status code: %d", ...)` and `TrackSchemaFromEventWithStreamId` propagates it as a Go `error`. The test `TestAvoInspector_TrackSchemaFromEvent` explicitly verifies the error string `"Avo Inspector: schema sending failed: request returned non-200 status code: 400"`. This is the opposite of spec behavior — the spec says the outer call MUST resolve (with the extracted schema), not error/reject.

### 4. Missing Wire Body Fields (`trackingId`, `sessionId`, `avoFunction`, `eventId`, `eventHash`)

`BaseBody` in `avoNetworkCallsHandler.go` is missing `trackingId` and `sessionId` fields entirely (the test `TestBaseBody_HasAnonymousId_NotSessionIdOrTrackingId` **asserts** they are absent from JSON). `EventSchemaBody` is missing `avoFunction` (the struct field exists but has zero-value `false` which gets omitted if tagged `omitempty` — actually it does not have `omitempty` so it is present; see below), `eventId` and `eventHash` are present as `string` rather than `string | null`.

Checking `EventSchemaBody`: `AvoFunction bool`, `EventId string`, `EventHash string` — these are present but `eventId` and `eventHash` are always empty strings `""`, whereas spec requires `null` (JSON null). Wire fixture 1 has `"eventId": null, "eventHash": null`.

`trackingId` and `sessionId` are confirmed absent. The test explicitly asserts `!strings.Contains(jsonStr, '"sessionId"')` and `!strings.Contains(jsonStr, '"trackingId"')`. Spec requires both fields to be present as empty strings `""`.

### 5. `enableLogging` is Per-Instance, Not Process-Wide

Spec section "enableLogging" (cross-language implementation requirement) states `shouldLog` MUST be a **process-wide global**, not per-instance. In Go, the requirement is: `package-level var shouldLog bool`. Go's `AvoInspector.shouldLog` is an instance field. `ShouldLog(bool)` is a method on `*AvoInspector`. Test `TestAvoInspector_shouldLogMethod` operates on a single struct instance. Two `AvoInspector` instances will have independent `shouldLog` values — non-conformant.

---

## Spec → Go: Requirements the Go SDK Doesn't Implement

| # | Spec Requirement | Status | Notes |
|---|---|---|---|
| 1 | `flush(timeoutMs?)` method — MUST implement for non-Node SDKs | ❌ MISSING | No `Flush()` method exists. Go has no keepalive timer either. `avoInspector.go` |
| 2 | `destroy()` method | ❌ MISSING | No `Destroy()` method exists. No cleanup of specFetcher or specCache. |
| 3 | `extractSchema()` as public standalone method | ❌ MISSING | `extractSchema()` is package-private (lowercase). No public `ExtractSchema()`. |
| 4 | `_avoFunctionTrackSchemaFromEvent` / codegen integration path | ❌ MISSING | No equivalent. `avoFunction` is always `false`. `eventId` / `eventHash` are always `""`. |
| 5 | `enableLogging` as process-wide global (not per-instance) | ⚠️ DIVERGES | `shouldLog` is an instance field. Method is `ShouldLog(bool)` not `EnableLogging(bool)`. |
| 6 | List type strings: `list(string)`, `list(int)`, etc. | ⚠️ DIVERGES | Go emits `"list"` for all arrays. |
| 7 | Boolean type string: `"boolean"` | ⚠️ DIVERGES | Go emits `"bool"`. |
| 8 | Array children format: heterogeneous union of type-strings / SchemaEntry arrays | ⚠️ DIVERGES | Go uses positional `Property` structs with numeric names. |
| 9 | Array type determined by first element only | ⚠️ DIVERGES | Go iterates all elements and uses a type switch. |
| 10 | `removeDuplicates` in array children | ❌ MISSING | Go includes all array elements without deduplication. |
| 11 | Empty array → `list(string)` with `children: []` | ❌ MISSING | Go returns `nil` children for empty array; type is `"list"`. |
| 12 | `0.0` → `"int"` (string-repr rule) | ❌ MISSING | Go maps all `float32/float64` to `"float"` via type switch. |
| 13 | `trackingId: ""` and `sessionId: ""` in wire body | ❌ MISSING | Both fields absent from `BaseBody`. Tests assert they MUST be absent. |
| 14 | `avoFunction: false/true` in wire body (correct; present) | ✅ IMPLEMENTED | `AvoFunction bool` in `EventSchemaBody`, defaults `false`. |
| 15 | `eventId: null` and `eventHash: null` in wire body | ⚠️ DIVERGES | Go sends `""` (empty string), not JSON `null`. |
| 16 | Non-200 response resolves (does not reject/error) | ⚠️ DIVERGES | Go returns `error` on non-200. Spec says must resolve. |
| 17 | Deduplication (SHOULD): 500ms window, two buckets, cross-bucket detection | ❌ MISSING | No deduplication implemented. |
| 18 | `appName` defaults to `""` when not provided | ✅ IMPLEMENTED | `appName` parameter passed through; empty string handled. |
| 19 | Whitespace-only `apiKey` or `version` MUST throw | ❌ MISSING | Go checks `== ""` only; `"  "` (spaces) would pass validation. |
| 20 | 10-level recursion depth truncation (Spec-Level Addition) | ❌ MISSING | No depth limit. Go goroutine stacks grow dynamically so no crash risk, but spec SHOULD requirement unimplemented. |
| 21 | Keepalive timer (Node) or `flush()` (non-Node) before process exit | ❌ MISSING | No mechanism. Fire-and-forget HTTP call is synchronous/blocking in Go so less urgent, but `flush()` required by spec. |
| 22 | `Content-Type: application/json` header | ⚠️ DIVERGES | Go sends `Content-Type: text/plain` (`req.Header.Set("Content-Type", "text/plain")`). Spec requires `application/json`. |
| 23 | `Accept: application/json` header | ❌ MISSING | Go does not set `Accept` header. |
| 24 | Constructor env fallback: invalid env → `"dev"` with warning (not error/throw) | ✅ IMPLEMENTED | `avoInspector.go:38-40`. Empty env falls back to `Dev` with print. |
| 25 | `samplingRate` thread safety (lock or atomic for concurrent updates) | ⚠️ DIVERGES | `h.samplingRate = responseData.SamplingRate` at `avoNetworkCallsHandler.go:128` is an unprotected write. Go is concurrent; data race possible. |
| 26 | `libVersion` as plain SemVer string | ⚠️ DIVERGES | Hardcoded to `"1.0.0"` in constructor (`avoInspector.go:52`). Spec notes Go MUST NOT read `go.mod` for libVersion but should define `const Version` in `version.go`. No `version.go` file exists. |
| 27 | `createdAt` as ISO 8601 UTC with milliseconds (`2026-05-25T12:00:00.000Z`) | ⚠️ DIVERGES | Go uses `time.RFC3339` which produces `2026-05-25T12:00:00Z` (no milliseconds, timezone offset not always `Z`). Spec requires `.000Z` millisecond precision and `Z` suffix. Regex: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` — Go will fail this. |
| 28 | Event spec validation initialized by default in dev/staging | ⚠️ DIVERGES | Spec says validation subsystem is initialized at construction in dev/staging. Go requires explicit `EnableValidation()` call. Node SDK initializes it automatically. |
| 29 | `extractSchema(null)` → `[]` without throwing | 🚫 N/A | Go uses `map[string]interface{}` parameter — a nil map is safe to range over; returns empty slice. Effectively conforms, though differently typed. |
| 30 | `streamId` containing `:` MUST warn and still send | ✅ IMPLEMENTED | `avoInspector.go:137-139` logs warning and continues. |

---

## Go → Spec: Features the Spec Doesn't Cover

| Feature | Go Location | Status |
|---|---|---|
| **Event Spec Validation subsystem** — `EnableValidation()` public method, async property validation in dev/staging | `avoInspector.go:73-130` | ❌ MISSING FROM SPEC (explicitly deferred as "out of scope" but the method is public API) |
| **Second HTTP endpoint** — `GET /inspector/v1/api/event-spec?apiKey=&streamId=&eventName=` | `event_spec_fetcher.go:111` | ❌ MISSING FROM SPEC (endpoint URL, query params, response schema) |
| **`EventSpecResponse` / `MatchRule` / `ValidationResult` types** — server-side validation result types | `event_spec_types.go` | ❌ MISSING FROM SPEC |
| **`eventSpecCache`** — LRU cache with TTL=60s, max=50 entries, max-access=50, sweep-every-50-ops, `flush()` | `event_spec_cache.go` | ❌ MISSING FROM SPEC |
| **`eventSpecFetcher`** — goroutine-based async fetch with in-flight dedup via `sync.Map` | `event_spec_fetcher.go` | ❌ MISSING FROM SPEC |
| **`NewAvoInspectorWithEncryption`** as a separate constructor | `avoInspector.go:37` | ⚠️ AMBIGUOUS (spec defines a single constructor with optional `publicEncryptionKey` param) |
| **`EnableValidation()` opt-in API** — validation off by default; user must explicitly enable | `avoInspector.go:73` | ❌ MISSING FROM SPEC (spec says validation auto-initializes in dev/staging) |
| **Regex-based property name/type matching** in validation (`MatchRule.Type == "regex"`) | `event_validator.go:52-57` | ❌ MISSING FROM SPEC |
| **PassedEventIds bandwidth optimization** — return `passedEventIds` only when strictly smaller than `failedEventIds` | `event_validator.go:18-21` | ❌ MISSING FROM SPEC |
| **In-flight request dedup for spec fetch** — concurrent fetches for same key coalesced into one HTTP request | `event_spec_fetcher.go:62-103` | ❌ MISSING FROM SPEC |
| **`specCacheKey` format** — `apiKey:streamId:eventName` (colon-delimited, different from dedup key) | `event_spec_cache.go:39` | ❌ MISSING FROM SPEC |
| **Synchronous `TrackSchemaFromEvent`** — Go makes the HTTP call synchronously (blocking goroutine) | `avoInspector.go:154` | ⚠️ AMBIGUOUS (spec describes async/promise semantics; Go's blocking model is effectively different) |

---

## Divergences (Both Have It But Differently)

### Schema Extraction — Summary Table

| Spec Rule | Node / Spec Output | Go Output | Verdict |
|---|---|---|---|
| Boolean type | `"boolean"` | `"bool"` | ⚠️ DIVERGES |
| Integer type | `"int"` | `"int"` | ✅ |
| Float type | `"float"` | `"float"` | ✅ |
| String type | `"string"` | `"string"` | ✅ |
| Null type | `"null"` | `"null"` | ✅ |
| Array type | `"list(elementType)"` | `"list"` | ⚠️ DIVERGES |
| Array type determined by | First element only | Type switch on each element (all) | ⚠️ DIVERGES |
| Empty array type | `"list(string)"` | `"list"` | ⚠️ DIVERGES |
| Empty array children | `[]` (empty array) | `nil` | ⚠️ DIVERGES |
| Array children format | Heterogeneous: `"string"` / `[{...SchemaEntry}]` | `[{PropertyName:"0", ...}, {PropertyName:"1", ...}]` | ⚠️ DIVERGES |
| Array deduplication | `removeDuplicates` applied | No deduplication | ⚠️ DIVERGES |
| `0.0` float zero | `"int"` (string `"0"` has no `.`) | `"float"` (type switch on `float64`) | ⚠️ DIVERGES |
| Object children | `[{propertyName, propertyType, children?}]` | Same ✅ | ✅ |
| `{}` empty object children | `[]` | `nil` (nil slice) | Minor divergence (JSON encodes as `null` vs `[]`) |
| Recursion depth limit (SHOULD) | 10 levels (spec addition) | No limit | ❌ MISSING |
| `map[string]interface{}` iteration order | N/A (JS object) | Non-deterministic (Go map) | Both non-deterministic; conformance fixtures must not rely on order |

### Encryption

The encryption algorithm implementation is **conformant** in all critical respects:
- ECIES / P-256 ✅
- KDF: SHA-256 over raw ECDH shared secret bytes ✅ (`encryption.go:55`)
- 16-byte IV (not 12-byte standard) ✅ (`encryption.go:63`: `cipher.NewGCMWithNonceSize(block, 16)`)
- Wire format: `[0x00][65B ephemeral pubkey][16B IV][16B auth tag][ciphertext]` ✅ (`encryption.go:84-93`)
- AES-256-GCM ✅
- Encryption active: dev + staging only ✅ (`encryption.go:23`)
- Encryption inactive: prod ✅
- List-type properties omitted (`"list"` type) ✅ (checks `prop.PropertyType == "list"` at `encryption.go:111`)
- On failure: log warning, omit property, continue ✅ (`encryption.go:117-120`)

**One divergence:** Go checks `prop.PropertyType == "list"` but since Go always emits `"list"` (not `"list(string)"` etc.), this works for Go's own output. However if the type strings were corrected to `"list(string)"` etc., the omit-list check would need to be updated to match on the prefix `"list("`.

**Another divergence:** The spec says the encrypted plaintext is `JSON.stringify(rawPropertyValue)` — the property **value**, not the type string. Go's `encryptEventProperties` encrypts `prop.PropertyType` (the type string, e.g., `"string"`) rather than the property value. This is because `extractSchema` discards values; properties only retain names and types. The spec's encrypted-property payload is thus fundamentally incompatible with Go's current design — Go would need to retain raw values alongside types to encrypt them correctly.

### GUID / Message ID

Both use cryptographic random (Go: `crypto/rand`; node: `Math.random()` which is NOT crypto). The spec says the node SDK uses `Math.random()`-based (non-crypto) but generated SDKs MAY use cryptographic UUID v4. Go uses `crypto/rand.Read` ✅. Format produced by Go (`avoGuid.go:16`):
```
fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
```
This produces lowercase hex with hyphens at positions 8-4-4-4-12 bytes, matching UUID v4 format. Version byte `b[6] = (b[6] & 0x0f) | 0x40` and variant byte `b[8] = (b[8] & 0x3f) | 0x80` are correct ✅. Format matches spec regex `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` ✅.

### `createdAt` Timestamp Format

Spec requires ISO 8601 UTC with milliseconds matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`.

Go uses `time.Now().Format(time.RFC3339)` which produces `2006-01-02T15:04:05Z07:00` — no milliseconds, and uses `+00:00` for UTC instead of `Z`. Example: `"2026-05-25T12:34:56+00:00"`. This will **fail** the spec's validation regex. Fix: use `time.Now().UTC().Format("2006-01-02T15:04:05.000Z")`.

### Content-Type Header

Go sends `Content-Type: text/plain` (`avoNetworkCallsHandler.go:99`). Spec requires `Content-Type: application/json`. This is a wire-protocol conformance failure. The Inspector backend may or may not enforce this, but the spec is clear.

### `libVersion` Hardcoded vs. Version File

Go hardcodes `"1.0.0"` directly in `NewAvoInspectorWithEncryption` (`avoInspector.go:52`). Spec says Go MUST define `const Version = "x.y.z"` in a dedicated `version.go` file and instructs maintainers to update it on each release. No `version.go` exists in the Go SDK.

### `ShouldLog` vs. `EnableLogging`

Spec specifies the public method name as `enableLogging(enable: boolean)`. Go exposes `ShouldLog(shouldLog bool)` — different name and idiomatic Go casing. Additionally, it is per-instance not global. The spec explicitly requires process-wide behavior.

### Error Handling / Return Semantics

Go uses the Go-idiomatic `(result, error)` return pattern. The spec defines JavaScript Promise semantics. The mapping is:
- Spec `Promise.resolve(schema)` → Go `(schema, nil)` — for success ✅
- Spec `Promise.resolve([])` on non-200 → Go `(nil, error)` ⚠️ — Go returns an error
- Spec `Promise.resolve(schema)` on network error (swallowed) → Go `(nil, error)` ⚠️ — Go surfaces the error
- Spec `Promise.reject("Avo Inspector: something went wrong...")` on internal error → Go `(nil, fmt.Errorf("..."))` — similar intent but different message string

The spec's exact reject/resolve taxonomy is Node-idiomatic. A Go SDK that returns `(nil, err)` on non-200 is arguably more ergonomic but non-conformant with the spec's error taxonomy as written. The spec should clarify the Go-idiomatic equivalent or mark these error-behavior requirements as Node-specific.

### Sampling Rate (`samplingRate`)

Go uses `math/rand.Float64()` (from `import "math/rand"` in `avoNetworkCallsHandler.go:9`). Spec says "equivalent language-random". Go's `math/rand` is seeded from the runtime by default since Go 1.20. No data race protection on `h.samplingRate` update (`avoNetworkCallsHandler.go:128`). Spec MUST on thread safety not met.

---

## Wire-Protocol Findings

### Confirmed Endpoint

`POST https://api.avo.app/inspector/v1/track` — Go `defaultTrackingEndpoint` constant matches ✅.

### Undocumented Endpoint

`GET https://api.avo.app/inspector/v1/api/event-spec` — used by `eventSpecFetcher.doFetch`. This endpoint:
- Query parameters: `apiKey`, `streamId`, `eventName`
- No authentication header (same body-embedded apiKey pattern as track endpoint, but via query string here)
- Response type: `EventSpecResponse` JSON:
  ```json
  {
    "eventName": "string",
    "rules": {
      "properties": [
        {
          "propertyName": "string",
          "propertyType": "string",
          "nameRule": { "type": "exact|regex", "value": "string" },
          "typeRule": { "type": "exact|regex", "value": "string" }
        }
      ]
    },
    "passedEventIds": ["string"],
    "failedEventIds": ["string"]
  }
  ```
- Timeouts: socket 5s, wall 10s

This endpoint and its full contract is **entirely missing from the spec**.

### Headers

| Header | Spec | Go | Status |
|---|---|---|---|
| `Content-Type` | `application/json` | `text/plain` | ⚠️ DIVERGES |
| `Accept` | `application/json` | not sent | ❌ MISSING |
| `Content-Length` | byte length of body | `fmt.Sprintf("%d", len(payload))` | ✅ (functionally correct) |

### Missing Wire Body Fields

| Field | Spec | Go | Status |
|---|---|---|---|
| `trackingId` | `""` (always) | absent | ❌ MISSING |
| `sessionId` | `""` (always) | absent | ❌ MISSING |
| `eventId` | `null` | `""` (empty string) | ⚠️ DIVERGES |
| `eventHash` | `null` | `""` (empty string) | ⚠️ DIVERGES |
| `avoFunction` | `bool` (true for codegen path) | `false` (always) | ✅ for manual path |
| `appName` | string (empty if not provided) | present | ✅ |
| `libPlatform` | non-empty string | `"go"` | ✅ |
| `libVersion` | plain SemVer from version file | `"1.0.0"` hardcoded | ⚠️ DIVERGES |
| `createdAt` | ISO 8601 UTC with `.000Z` | RFC3339 without milliseconds | ⚠️ DIVERGES |
| `samplingRate` | `[0.0, 1.0]` | `1.0` default, server-updated | ✅ |
| `publicEncryptionKey` | present only when non-empty | present when non-empty | ✅ |

### Batching

Both spec and Go send exactly one event per HTTP call (array of length 1). Go wraps in `[]any{...}` — matches spec's "array with exactly one element" behavior ✅.

---

## Verified Parity

The following major behaviors match the spec cleanly:

1. **Endpoint URL** — `POST https://api.avo.app/inspector/v1/track` matches exactly.
2. **Constructor validation** — `apiKey == ""` and `appVersion == ""` both return errors with correct (or near-correct) messages. Empty env defaults to `Dev`.
3. **`libPlatform: "go"`** — correct non-empty string per spec.
4. **ECIES encryption algorithm** — wire format, 16-byte IV, SHA-256 KDF over raw bytes, AES-256-GCM all correct. Encryption inactive in prod. List-type omission logic correct (for Go's `"list"` type string).
5. **GUID format** — UUID v4, lowercase hex, hyphenated, crypto-random entropy. Passes spec regex.
6. **Sampling rate** — default `1.0`, updated from 200 response body, `math/rand.Float64() > samplingRate` drop logic matches spec.
7. **Request timeout** — `http.Client{Timeout: 10 * time.Second}` matches spec's 10-second timeout.
8. **No retry** — single attempt, no retry loop.
9. **`streamId` → `anonymousId`** — passthrough, empty string when absent.
10. **`streamId` containing `:` emits warning** — conformant advisory warning, value still used.
11. **`shouldLog` default** — `true` in dev, `false` otherwise — matches spec.
12. **Primitive type mapping** — `string`, `int`, `float`, `null` correct (except `bool`/`boolean` divergence and `0.0` divergence).
13. **Object children extracted recursively** — correct shape for nested objects.
14. **`publicEncryptionKey` in base body only when non-empty** — correct (`omitempty` tag).

---

## Recommendation

### What the Spec Must Add or Clarify

1. **Event spec validation endpoint** — The spec currently says event spec validation is "out of scope." But the Go SDK exposes it publicly. The spec must make an explicit choice:
   - **Option A (recommended):** Define the endpoint and its contract in an optional/SHOULD section clearly labeled "Dev/Staging Validation (Optional)." This allows conformant SDKs to implement it consistently.
   - **Option B:** Add a normative MUST NOT to the spec: "Conformant SDKs MUST NOT implement event spec validation or contact any endpoint other than `POST /inspector/v1/track`." This is impractical since the Go SDK is already published.

2. **Go-idiomatic error semantics** — The spec's error taxonomy uses Promise terminology. Add a "Go equivalent" row to the error taxonomy table: `(schema, nil)` for resolve, `(nil, fmt.Errorf(...))` for reject/error. Clarify that non-200 MUST return `(schema, nil)` not `(nil, err)` to match spec intent.

3. **`createdAt` format** — Add the exact Go format string: `time.Now().UTC().Format("2006-01-02T15:04:05.000Z")`.

4. **`trackingId` / `sessionId`** — These two required fields are easy to miss because the spec's non-Node reference (Go) actively removes them. Add a callout: "These fields MUST be present even if empty. Do not omit them from the struct even in languages that allow sparse JSON."

5. **`eventId` / `eventHash` as JSON null** — Spec says `null` (JSON null). Typed languages (Go, Rust, Java) need pointer/optional types. Add Go example: `EventId *string \`json:"eventId"\`` set to `nil` to produce JSON `null`.

6. **Schema extraction** — The spec's algorithm is defined for JavaScript semantics. Add a Go translation section:
   - `bool` type switch case → emit `"boolean"` (not `"bool"`)
   - `float64` → check if `strconv.FormatFloat(v, 'f', -1, 64)` contains `.`; if not, emit `"int"`
   - Array type string: `"list(" + elementType + ")"` where elementType comes from first element
   - Array children: heterogeneous `[]interface{}` of `string` (type strings) and `[]Property` (for objects/arrays), not positional `Property` structs

7. **`enableLogging` process-scope** — Add explicit Go implementation note: `var shouldLog bool` (package-level) rather than struct field.

8. **`version.go`** — Add Go-specific guidance: create `version.go` with `const Version = "x.y.z"` and use it as `libVersion` in the constructor.

9. **`samplingRate` concurrency** — Add Go-specific note: use `sync/atomic` or `sync.Mutex` for `samplingRate` updates.

10. **`Content-Type: application/json`** — Spec is correct; Go SDK has a bug here.

### What Should Be Marked Go-Specific Optional

- **`flush()`** — Go's synchronous HTTP model means in-flight requests complete before the goroutine returns. The "keepalive" problem doesn't apply in the same way. However, the spec's `flush()` MUST still be implemented if the SDK is used in goroutines that don't block on the return value. Mark as MUST for goroutine-based async patterns.
- **Deduplication** — Spec already marks as SHOULD and notes it MAY be omitted in Go. Keep as-is.

---

## Final Summary

The Go Inspector SDK (`avohq/go-avo-inspector`) and the spec agree on the wire endpoint, encryption algorithm, GUID format, sampling logic, and timeout value — a solid foundation. However the comparison reveals **9 outright missing requirements**, **8 behavioral divergences**, and **5 Go-only features absent from the spec**. The most publication-blocking issues are: (1) the undocumented `GET /inspector/v1/api/event-spec` endpoint used by Go's validation subsystem, (2) the schema extraction algorithm producing wrong type strings (`"list"` instead of `"list(string)"`, `"bool"` instead of `"boolean"`) and wrong array-children structure, (3) missing `trackingId`/`sessionId` wire fields, (4) wrong `Content-Type` header (`text/plain` vs `application/json`), and (5) wrong `createdAt` format (RFC3339 without milliseconds). Addressing these in the spec — either by updating normative requirements or by adding Go-specific translation guidance — is necessary before the spec can be used as a reliable one-spec-multiple-SDKs source of truth for Go (and by extension other statically-typed languages that face the same translation challenges).
