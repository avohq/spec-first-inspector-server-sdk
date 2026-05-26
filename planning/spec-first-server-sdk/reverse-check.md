# Reverse Check Report

Verification of `planning/spec-first-server-sdk/spec.md` against the actual node-avo-inspector source code under `src/`.

## Summary

| Category | Count |
|---|---|
| CORRECT | 47 |
| IMPRECISE | 9 |
| WRONG | 6 |
| FABRICATED | 3 |
| UNVERIFIABLE | 4 |

Total concrete claims audited: ~69.

The spec is largely faithful to the wire-protocol surface and constructor/option semantics. The most significant inaccuracies cluster in three areas: (a) the dedup key formula and key-comparison algorithm; (b) the error-handling promise outcomes for network failures from `trackSchemaFromEvent`; (c) `libVersion` wire format (the spec prescribes a `<sdk>+spec<spec>` format that the node SDK does not produce).

---

## Critical Issues (WRONG / FABRICATED — must fix)

### 1. WRONG — Dedup key formula

**Spec claim** (Deduplication Behavior, line 1074):
> "Complete dedup record key formula: The full key stored in each bucket is `streamId + "\0" + eventName + "\0" + canonicalJSON(eventProperties)`"

**Spec claim** (trackSchemaFromEvent, line 409):
> "Constructs a stream-scoped dedup key. See the Deduplication Behavior section for the complete key formula: `streamId + "\0" + eventName + "\0" + canonicalJSON(eventProperties)`."

**Code** (`src/AvoDeduplicator.ts:14-16`):
```ts
private static dedupKey(eventName: string, streamId: string): string {
  return streamId + "\0" + eventName;
}
```

The key contains only `streamId + "\0" + eventName`. `eventProperties` is NOT part of the key; it is stored as a separate value in `*EventsParams[key]` (lines 30, 33) and later compared via `deepEquals` (line 75) inside `hasSameEventAs`.

**Behavioral consequence:** Two calls with the same `streamId`+`eventName` but different `eventProperties` overwrite each other in `*EventsParams` (since they share a key). The current bucket's entry is replaced; the OTHER bucket's entry is what gets compared against. So "different eventProperties → not deduplicated" actually holds in cross-bucket suppression, but for a different reason than the spec describes.

**Recommended fix:** Rewrite the formula to: "The dedup record key is `streamId + "\0" + eventName`. The event properties are stored alongside the key and compared via deep structural equality (own-property, recursive) when a cross-bucket lookup occurs. Two calls with the same key but different params are NOT considered duplicates because the deep-equality check fails."

---

### 2. WRONG — Dedup parameter equality is `deepEquals`, not canonical-JSON

**Spec claim** (Deduplication Behavior, line 1073):
> "Parameter matching: Dedup key is the canonical JSON serialization of the raw event properties object: `JSON.stringify` applied to the object with keys sorted recursively (so `{a:1, b:2}` and `{b:2, a:1}` produce the same dedup key)."

**Code** (`src/AvoDeduplicator.ts:75`, `src/utils.ts:5-47`):
```ts
if (otherParams && deepEquals(params, otherParams)) { ... }
```

`deepEquals` is a recursive own-property comparison. It does NOT canonicalize key order — but because it iterates own properties of `x` and looks them up in `y` by name, key order in the source object does not affect the result (object property lookup is order-independent). However, the implementation is NOT "JSON.stringify with sorted keys" — it never serializes, and `Date`, `Map`, etc. would compare unexpectedly.

**Behavioral consequence:** The end result (order-insensitive equality for plain objects) matches what the spec wants for plain JSON-like inputs, but the algorithm and the prose are different. The spec misleads SDK authors who might implement `JSON.stringify` with sorted keys and then accidentally include functions, undefined values, or non-own properties differently than `deepEquals` does.

**Recommended fix:** Replace the canonical-JSON language with: "Parameter matching uses recursive deep structural equality over own properties: two objects are equal iff they have the same own property names and each corresponding value is deeply equal (primitives by `===`, arrays element-wise, objects recursively). Implementations MAY use canonical-JSON serialization as an alternative as long as semantics match for plain JSON-like inputs."

---

### 3. WRONG — `trackSchemaFromEvent` does not reject on network errors

**Spec claim** (Error Taxonomy table, lines 681-685):
| Network timeout | ... | `Promise.reject("Request timed out")` |
| Network error | ... | `Promise.reject("Request failed")` |

**Spec claim** (Error Taxonomy boundary, line 687):
> "The outer `trackSchemaFromEvent` method catches errors from all internal calls (including `extractSchema`) and rejects the returned promise with the error message string."

**Code** (`src/AvoInspector.ts:169-178` and `285-335`):

`trackSchemaFromEvent` calls `sendEventWithOptionalValidation` and chains `.then(() => eventSchema)`. `sendEventWithOptionalValidation` returns the promise from `doSendEventWithOptionalValidation`, which is an `async` function whose body is wrapped in `try { ... } catch (err) { console.error(...) }` (line 299, 332). The catch swallows the rejection and the async function resolves to `undefined`.

Therefore `await this.avoNetworkCallsHandler.callInspectorWithBatchBody([body])` rejecting with `"Request timed out"` or `"Request failed"` is CAUGHT and LOGGED — and `trackSchemaFromEvent` ultimately RESOLVES with `eventSchema` regardless. The outer try/catch in `trackSchemaFromEvent` (lines 185-193) rejects only on synchronous throws (e.g., `new AvoStreamId(streamId)` throwing), not on async network errors.

**Behavioral consequence:** Conformance fixtures asserting `expected_promise_outcome: "reject"` for timeout/network-error scenarios would FAIL against the reference node SDK.

**Recommended fix:** Update the Error Taxonomy table for the "Network timeout" and "Network error" rows to `Promise.resolve(eventSchema)` (node SDK swallows network errors and resolves). If the desired contract for generated SDKs is "reject on network failure", call out that the node SDK is intentionally diverging or that this is an aspirational change.

---

### 4. WRONG — `trackSchemaFromEvent` reject value is a fixed string, not the error message

**Spec claim** (Error Taxonomy, line 682):
> "`Promise.reject(errorMessageString)` — reject with the error message string, NOT the Error object"

**Code** (`src/AvoInspector.ts:186-192`):
```ts
console.error(
  "Avo Inspector: something went wrong. Please report to support@avo.app.",
  e
);
return Promise.reject(
  "Avo Inspector: something went wrong. Please report to support@avo.app."
);
```

The rejection value is the HARDCODED string `"Avo Inspector: something went wrong. Please report to support@avo.app."` — not `e.message` or any other dynamic value.

**Recommended fix:** Either change the spec to "reject with the fixed string `\"Avo Inspector: something went wrong. Please report to support@avo.app.\"`", or document that generated SDKs MAY use a more descriptive message (clarify that the node SDK's exact string is illustrative, not normative).

---

### 5. WRONG — `libVersion` wire format

**Spec claim** (HTTP Wire Protocol → base body, line 601):
> "Generated SDKs MUST set this to their own SDK version using the format `\"<sdk-version>+spec<spec-version>\"` (e.g., `\"1.0.0+spec1.0.0\"`)."

**Spec claim** (Wire Fixture 1, line 291): expected `libVersion: "<semver+spec>"`.

**Spec claim** (Format Validation Patterns, line 220): regex `/^\d+\.\d+\.\d+\+spec\d+\.\d+\.\d+$/`.

**Code** (`src/AvoInspector.ts:13` and `AvoNetworkCallsHandler.ts:323`):
```ts
const libVersion = require("../package.json").version;
```

The node SDK sends a plain SemVer string (e.g., `"1.2.0"`) — no `+spec...` suffix. The `+spec<version>` format is an aspirational generated-SDK convention not present in the reference implementation. Wire Fixture 1's `libVersion` placeholder + the regex in Format Validation Patterns would both REJECT actual node SDK output.

**Recommended fix:** Either (a) clearly mark the `+spec` format as a NEW REQUIREMENT for generated SDKs only (not extracted from node SDK), and exempt the node SDK from this rule with explicit prose, or (b) drop the `+spec` suffix from the wire-format regex and accept plain SemVer. Note that an upgrade to the node SDK to produce `+spec` would be a breaking wire change.

---

### 6. WRONG — Spec says `streamId` rule "MUST NOT contain `:`"

**Spec claim** (trackSchemaFromEvent, line 418):
> "MUST NOT contain `:` — if it does, MUST warn and still proceed with the value as-is."

**Code** (`src/AvoStreamId.ts:6-10`):
```ts
if (this._streamId.includes(":")) {
  console.warn("[Avo Inspector] Warning: streamId contains ':' which is not supported");
}
```

The wording "MUST NOT contain `:`" is RFC 2119 normative language meaning a non-conformant input. But the code's behavior is "warn, then pass through unchanged." The spec's own clause "MUST warn and still proceed" contradicts the "MUST NOT" — and the Edge Case #9 (line 109) clarifies "colon is not a fatal error." This is an internal inconsistency.

**Recommended fix:** Rephrase as: "If `streamId` contains `:`, the SDK MUST emit a console warning and MUST still use the value as `anonymousId` unchanged. The colon is not a hard error."

---

### 7. FABRICATED — `Math.random()`-based reject text in error taxonomy table for `extractSchema`

**Spec claim** (Error Taxonomy boundary, line 687):
> "The `extractSchema` method (`src/AvoSchemaParser.ts`) MUST return `[]` on internal error and MUST NOT throw — it is an internal helper."

Mostly correct, but the boundary clarification attributes the catch to `AvoSchemaParser.ts`. **Code:** `AvoSchemaParser.extractSchema` does NOT itself have a try/catch (verify `src/AvoSchemaParser.ts`); the try/catch returning `[]` is on the `AvoInspector.extractSchema` wrapper (`src/AvoInspector.ts:351-383`). The parser itself can throw on pathological input.

**Recommended fix:** Move the citation to `src/AvoInspector.ts:351-383`, and clarify that `AvoInspector.extractSchema` is the safe wrapper; `AvoSchemaParser.extractSchema` may throw.

---

### 8. FABRICATED — Recursion depth truncation rule

**Spec claim** (Schema Extraction Algorithm, line 765):
> "Generated SDKs in languages with fixed recursion limits ... SHOULD impose a maximum recursion depth of 10 levels. If the limit is reached, the property MUST be included with `propertyType: \"object\"` and `children: []` (depth truncation, not an error)."

**Code:** `AvoSchemaParser.mapping` has no depth limit and no truncation logic. The "10 levels" guidance and "truncate to `children: []`" behavior is invented by the spec; it is not extracted from the source.

This is acceptable as forward-looking guidance, but it should be flagged as NEW (not extracted) so SDK authors don't write conformance tests against node and expect this behavior to match.

**Recommended fix:** Add a note: "The node reference SDK has no recursion limit. The 10-level truncation rule is a spec recommendation for languages with fixed stack limits; it is NOT verified by conformance fixtures against node-avo-inspector."

---

### 9. FABRICATED — `flush()` method semantics

**Spec claim** (Public API Surface, lines 491-507): defines `flush(timeoutMs?: number): Promise<void>` as a "non-Node SDKs MUST implement" method with default `timeoutMs` 10,000 ms and a resolve-always semantic.

**Code:** No `flush()` exists on `AvoInspector` anywhere in `src/`. The spec invents this method as guidance for generated SDKs. This is intentional and acceptable, but the spec should be unambiguous that this method is NOT in the reference SDK.

**Recommended fix:** Prefix the `flush()` section with "**(New requirement, not extracted from node SDK.)** Non-Node SDKs MUST implement..."

---

## Important Issues (IMPRECISE — should fix)

### A. IMPRECISE — `anonymousId` fallback uses `generatedAnonymousId`

**Spec claim** (lines 110, 420, 607): "If absent/empty, `anonymousId` is `\"\"`."

**Code** (`src/AvoInspector.ts:26, 149, 210`):
```ts
private generatedAnonymousId: string = "";
...
const anonymousId = avoStreamId.streamId || this.generatedAnonymousId;
```

In practice `generatedAnonymousId` is always `""` (never assigned anywhere else in the codebase), so the observable behavior matches the spec. However, the spec misses an internal indirection. A future SDK change that populates `generatedAnonymousId` (e.g., from a persistent installation ID) would change behavior. SDK authors reading the spec won't know about this seam.

**Recommended fix:** Add a one-line note: "The node SDK has an internal `generatedAnonymousId` field reserved for future use; currently it is always `\"\"`, so the observed fallback is `\"\"`."

---

### B. IMPRECISE — Constructor `publicEncryptionKey` validation behavior

**Spec claim** (Constructor Options): defines `publicEncryptionKey` as optional with compressed (66 chars) or uncompressed (130 chars) hex format.

**Code** (`src/AvoInspector.ts:97-110`): The constructor checks the format and emits a `console.warn` if it does NOT look like a valid P-256 hex key, but it does NOT throw or reject the key. The validation is advisory only. Additionally, validation runs only when `env !== Prod`.

The spec's validation table (line 384) lists validation rules for `apiKey`, `version`, `env` but is silent on `publicEncryptionKey` advisory validation. This is a missing detail.

**Recommended fix:** Add a row: "`publicEncryptionKey` | If provided and `env != prod`, the SDK SHOULD emit a console warning if the value is not 66 or 130 hex chars. MUST NOT throw."

---

### C. IMPRECISE — Sampling drop semantics for `samplingRate = 1.0`

**Spec claim** (Sampling, line 701):
> "`samplingRate = 1.0` MUST send all events (since `random` from standard [0,1) range is never `> 1.0`)."

**Code** (`src/AvoNetworkCallsHandler.ts:92`): `if (Math.random() > this.samplingRate) { ... drop ... }`.

Spec is technically correct, but the language "standard [0,1) range" assumes `Math.random()` excludes 1.0 — which is true for JS, Python, Ruby, Go, Rust. The reasoning is sound; consider noting this is implementation-detail-dependent.

---

### D. IMPRECISE — `extractSchema` dedup warning side effect

**Spec claim** (extractSchema semantics, lines 433-440): describes `extractSchema` as a synchronous pure transformation.

**Code** (`src/AvoInspector.ts:351-360`): `extractSchema` calls `this.avoDeduplicator.hasSeenEventParams(eventProperties, true)` and emits a console warning if the params were recently reported by Codegen. This is a non-pure side effect tied to instance state.

**Recommended fix:** Add: "`extractSchema` MAY emit a console warning if recent Codegen-tracked params match (to detect double-reporting). The return value is unaffected."

---

### E. IMPRECISE — Wire body `appName` defaults

**Spec claim** (Constructor Options, line 536): `appName` default `""`.

**Code** (`src/AvoInspector.ts:121`): `options.appName || ""` — so `null`, `undefined`, and empty string all become `""`. Spec is correct on outcome but does not mention the `||` coercion (a `0`-valued appName would also become `""`, though this is non-meaningful).

---

### F. IMPRECISE — `enableLogging` is an instance method that sets a class-level field

**Spec claim** (line 447): `enableLogging(enable: boolean): void` — sets the class-level `shouldLog` flag.

**Code** (`src/AvoInspector.ts:337-339`): correct — `enableLogging` is on the instance but mutates `AvoInspector._shouldLog`. The spec describes this correctly but the cross-language guidance (lines 452-458) prescribes static/module-level storage; this conflicts with the node SDK's API shape (instance method). Worth a clarifying note that the *method* is per-instance but the *state* is process-wide.

---

### G. IMPRECISE — `bodyForValidatedEventSchemaCall` extra `streamId` field

**Spec claim** (line 622): "`streamId` Present only in validated event calls. Set to `anonymousId`."

**Code** (`src/AvoNetworkCallsHandler.ts:262`): correct — `body.streamId = anonymousId;` only in the validated path. Spec is right but could note that this `streamId` field is REDUNDANT with `anonymousId` (same value) — backend likely uses one or the other for routing. Worth flagging as a back-compat artifact.

---

### H. IMPRECISE — Fixture 7 `children` element ordering

**Spec claim** (Fixture 7, line 894): `children: ["float", "string", [{"propertyName": "three", "propertyType": "int"}]]`.

**Code:** `mapping([1.2, "two", {"three": 3}])` → `removeDuplicates(["float", "string", [{propertyName:"three", propertyType:"int"}]])`. The object element is dedup'd by reference (not value), so it survives. The output matches the spec. CORRECT in result — the IMPRECISE note is that the spec's "verified against `src/AvoSchemaParser.ts` lines 17–50" should also mention `removeDuplicates` (lines 57-72) since the dedup pass is what determines whether the third element survives.

---

### I. IMPRECISE — `_avoFunctionTrackSchemaFromEvent` streamId handling differs

**Spec claim** (line 514): `_avoFunctionTrackSchemaFromEvent` "behaves identically to `trackSchemaFromEvent`".

**Code:** `trackSchemaFromEvent` (line 148-149) wraps `streamId` in `new AvoStreamId(...)` which emits the colon warning. `_avoFunctionTrackSchemaFromEvent` (line 210) does NOT — it just checks `streamId && streamId.length > 0`. So a Codegen call with a colon-containing streamId silently passes through with NO warning, while a manual call warns. Minor inconsistency in the source; spec inherits it.

**Recommended fix:** Either note the asymmetry, or specify that generated SDKs should apply the streamId-colon-warning to BOTH paths uniformly.

---

## Unverifiable Claims (UNVERIFIABLE — flag for product/backend confirmation)

### U1. Backend response shape

**Spec claim** (line 663-670): 200 response body is `{ "samplingRate": 0.5 }`.

**Code** (`src/AvoNetworkCallsHandler.ts:144-147`): reads `data.samplingRate` from JSON-parsed response body. Only confirms the SDK reads this one field; the backend may return additional fields. Confirm with backend team that `samplingRate` is the only contract field.

### U2. Backend acceptance of `+spec<version>` libVersion

If the spec mandates the `+spec<version>` libVersion format for generated SDKs, confirm the Avo Inspector backend accepts/parses this format. May be silently dropped or break log/analytics queries that filter by libVersion.

### U3. `libPlatform` accepted values

Spec's Open Question #4 already flags this. Confirm whether backend has a closed registry of accepted `libPlatform` values or accepts arbitrary strings.

### U4. Backend behavior on missing required fields

Spec's expected_request_body fixtures imply backend requires all listed fields. Confirm: does the backend reject requests missing `trackingId`, `sessionId` (server SDKs always send `""`)? Or are they optional?

---

## Verified Correct (major claims that checked out)

- **AvoInspectorEnv values** `"dev"`, `"staging"`, `"prod"` — `src/AvoInspectorEnv.ts:1-5`.
- **Constructor required fields** (`apiKey`, `version`) with exact error message strings — `src/AvoInspector.ts:79-93`. Matches `__tests__/constants.ts:11-16`.
- **`env` invalid/empty falls back to `dev` + warning** — `src/AvoInspector.ts:65-77`.
- **`shouldLog` default**: `true` for dev, `false` otherwise — `src/AvoInspector.ts:112-116`.
- **Endpoint:** `POST https://api.avo.app:443/inspector/v1/track` — `src/AvoNetworkCallsHandler.ts:65, 117-127`.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, `Content-Length` — line 122-126.
- **Wire body shape:** all base fields (`apiKey`, `appName`, `appVersion`, `libVersion`, `env`, `libPlatform: "node"`, `messageId`, `trackingId: ""`, `sessionId: ""`, `anonymousId`, `createdAt`, `samplingRate`) — `src/AvoNetworkCallsHandler.ts:318-339`.
- **Event-specific fields** (`type: "event"`, `eventName`, `eventProperties`, `avoFunction`, `eventId`, `eventHash`) — lines 189-209.
- **`avoFunction: true` only when `eventId != null`** (line 200-208).
- **`publicEncryptionKey` included on wire only when non-empty** — line 334-336; verified by tests `TestAvoEncryption.ts:172-234`.
- **`samplingRate` default 1.0** — line 62.
- **`samplingRate` updated from response only when `>= 0 && <= 1` and `statusCode === 200`** — lines 141-147.
- **Request timeout 10s, drops on timeout, rejects internal promise with `"Request timed out"`** — lines 160, 167-173.
- **Network error rejects internal promise with `"Request failed"`** — lines 161-166.
- **No automatic retries** — confirmed; no retry loop in code.
- **`Math.random() > samplingRate` → drop, resolve immediately** — lines 92-99.
- **AvoGuid format** `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` with `Math.random()`-based entropy — `src/AvoGuid.ts:2-7`.
- **`createdAt` is `new Date().toISOString()`** — `src/AvoNetworkCallsHandler.ts:330`.
- **Schema extraction returns `[]` for `null` / `undefined` top-level input** — `src/AvoSchemaParser.ts:13-15`.
- **`0.0` → `"int"`** (`(0.0 + "").indexOf(".") >= 0` is false) — `src/AvoSchemaParser.ts:82-86`. Verified by `TestParsing.ts:114` (`prop3: 0.0` → INT).
- **`undefined` → `"null"`** — `src/AvoSchemaParser.ts:77-78` (`val == null` catches both). Verified by `TestParsing.ts:52` (`prop4: undefined` → NULL).
- **Empty array → `list(string)`** — `src/AvoSchemaParser.ts:103-105`. Verified by `TestParsing.ts:121-122`.
- **Array type from first element** — `src/AvoSchemaParser.ts:101-109`. Verified by `TestParsing.ts:149` (`[1.2, "two", {three:3}]` → FLOATLIST).
- **List dedup behavior (Fixture 10)** — `removeDuplicates` keeps first per primitive-type bucket — `src/AvoSchemaParser.ts:57-72`. Verified by `TestParsing.ts:81-92`.
- **Fixture 9 children structure** (mixed list with object + sublist) — exact `["string", [obj-children], ["string"], ["int"]]` shape verified by `TestParsing.ts:64-78`.
- **Nested object children** (`{ user: {name, age} }`) — `src/AvoSchemaParser.ts:38-39` adds `children` when `typeof val === "object" && val != null`. Verified.
- **Empty object `{}` → `{propertyType: "object", children: []}`** — verified by `TestParsing.ts:118-119`.
- **`children` field presence rule** — present iff `typeof val === "object" && val != null` (covers arrays and non-null objects). Matches spec line 637.
- **Dedup window 500ms** — `src/AvoDeduplicator.ts:6` (`msToConsiderOld = 500`). Verified by `TestDeduplicator.ts:168-189`.
- **Cross-bucket dedup (avo→manual and manual→avo)** — `src/AvoDeduplicator.ts:36-38`. Verified by `TestDeduplicator.ts:44-74`.
- **Same-bucket NOT suppressed** — verified by `TestDeduplicator.ts:128-166`.
- **One-shot dedup (both records cleared after suppression)** — `src/AvoDeduplicator.ts:60-63`. Verified by `TestDeduplicator.ts:76-126`.
- **Encryption shouldEncrypt truth table:** dev/staging+key → true; prod+key → false; *+empty → false — `src/AvoEncryption.ts:14-25`. Verified by `TestAvoEncryption.ts:35-53`.
- **Encryption algorithm:** ECIES with `prime256v1` (P-256) — `src/AvoEncryption.ts:50`.
- **Wire format byte layout:** `[0x00][65-byte ephemeral pubkey][16-byte IV][16-byte auth tag][ciphertext]` — `src/AvoEncryption.ts:74-80`. Verified by `TestAvoEncryption.ts:498-503`.
- **IV is 16 bytes (NOT 12)** — `src/AvoEncryption.ts:61` (`crypto.randomBytes(16)`). Spec's normative note correct.
- **KDF: `SHA-256(raw ECDH X-coordinate bytes)` not hex-encoded** — `src/AvoEncryption.ts:55-58`. Spec's normative note correct.
- **Plaintext is `JSON.stringify(rawValue) ?? "null"`** — `src/AvoNetworkCallsHandler.ts:295`. Verified by `TestAvoEncryption.ts:395-435`.
- **List-type properties OMITTED when encryption active** — `src/AvoNetworkCallsHandler.ts:290-292`. Verified by `TestAvoEncryption.ts:293-323`.
- **Encryption failure: property omitted with warning** — `src/AvoNetworkCallsHandler.ts:302-305`, `src/AvoEncryption.ts:83-88`. Verified by `TestAvoEncryption.ts:325-352`.
- **Encrypted property children preserved** — `src/AvoNetworkCallsHandler.ts:311`. Verified by `TestAvoEncryption.ts:437-470`.
- **Keepalive: 60s `setInterval` no-op timer** — `src/AvoInspector.ts:37` (`setInterval(() => {}, 60_000)`).
- **Keepalive starts on `pendingCount` 0→1** — `src/AvoInspector.ts:34-38`.
- **Keepalive cleared when `pendingCount` returns to 0** — `src/AvoInspector.ts:40-44`.
- **`destroy()` clears keepalive timer, sets `pendingCount = 0`, nulls `eventSpecFetcher`/`Cache`/`Validator`** — `src/AvoInspector.ts:482-497`.
- **`destroy()` does NOT reset `samplingRate`** — `samplingRate` lives on `avoNetworkCallsHandler` which is not nulled in destroy. Spec's destroy state table is correct.
- **Constructor `appName` default `""`** — `src/AvoInspector.ts:121` (`options.appName || ""`).
- **`isValueEmpty` rejects whitespace-only strings** — `src/utils.ts:1-3` (`value.trim().length == 0`). Matches spec Edge Case #13.
- **`streamId` with `:` warns and proceeds** — `src/AvoStreamId.ts:6-10`. Verified by `TestAvoStreamId.ts:24-32`.
- **Single-event-per-request (no batching) in v1.2.0** — `src/AvoInspector.ts:326` (`callInspectorWithBatchBody([body])` — array with single element).
- **`AvoInspectorEnv` is a `const` object (not a TS enum)** — `src/AvoInspectorEnv.ts:1-5`.
- **`index.ts` exports** `AvoInspector` and `AvoInspectorEnv` — `src/index.ts:1-2`.

---

*Source version: node-avo-inspector v1.2.0 (per `package.json` and spec line 357).*
