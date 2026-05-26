# Java SDK ↔ Spec Comparison (Rev 6)

**Date:** 2026-05-25
**Spec revision:** Rev 6 (Go comparison integration)
**Java SDK source:** `avohq/java-avo-inspector` (`src/main/java/is/avo/inspector/`)
**Reference SDK:** `avohq/node-avo-inspector` v1.2.0

---

## Summary

- **Spec → Java:** 18 implemented / 5 missing / 10 diverging / 2 N/A
- **Java → Spec:** 9 covered cleanly / 6 missing-from-spec / 2 ambiguous

**Headline finding:** The Java SDK is the closest-conforming of the three SDKs audited (node, go, java) on the wire-protocol fundamentals — it sends `Content-Type: application/json`, uses millisecond-precision ISO 8601 timestamps (`.SSS'Z'`), classifies `0.0` as `"float"` (matching Rev 6's revised rule), and has *already removed* `trackingId`/`sessionId` from the wire body. The `AnonymousIdSessionRemovalTests.java` file proves this removal was a deliberate STORY-05 decision, validating the spec's Rev 6 drop of those fields. However Java diverges sharply on **schema extraction output shape**: it emits `"list<string|null>"` (angle-bracket, pipe-separated heterogeneous union) instead of the spec's `"list(string)"` (parens, first-element-only) — none of the 13 golden fixtures would pass. Java also implements a full event-spec validation subsystem with a **different endpoint, different response schema, different cache parameters, and different validation algorithm than the go SDK** that Rev 6 documents — meaning the spec's optional-feature section is currently go-shaped and would mis-document java. Other gaps: no `flush()`, no `destroy()`, no `extractSchema()` public method, no `_avoFunctionTrackSchemaFromEvent`, per-instance instead of process-wide `enableLogging`, no deduplication, no whitespace-only validation on apiKey/version, and one notable encryption divergence — Java uses **AES-256-GCM**, identical to go but differing from the spec text which describes the wire format as AES-CBC-style (the spec actually specifies GCM correctly in the byte layout section, so Java is conformant on the wire; the user's question hint was slightly imprecise).

---

## Critical Findings (must address before publishing spec, or things that meaningfully shift the picture)

### 1. `AnonymousIdSessionRemovalTests.java` Confirms Rev 6's Field-Drop Decision

`AnonymousIdSessionRemovalTests.java` (10 tests) explicitly asserts that `sessionId` and `trackingId` MUST NOT appear in the wire body, that `bodyForSessionStartedCall` was deleted from `AvoNetworkCallsBodyFactory`, and that no `sessionStarted`-typed body is ever sent. The test docstring labels this "STORY-05: Anonymous ID / Session Removal (Model C)". This is independent corroboration that the Rev 6 spec decision to drop those fields was correct, and that at least one Avo team already shipped this change in production code. **The spec's "trackingId/sessionId omitted" note is now backed by two independent implementations (java + go), not just a unilateral spec call.**

### 2. Java's Event-Spec Validation Subsystem Differs Materially from Go's

The spec's Rev 6 "Event-Spec Validation (Optional Feature)" section is essentially a verbatim extraction from go. Java has a parallel subsystem with the **same intent but different contracts**. If the spec is to remain implementation-agnostic, this divergence must be reconciled:

| Aspect | Spec (from Go) | Java |
|---|---|---|
| Endpoint path | `/inspector/v1/api/event-spec` | `/inspector/v1/spec` (`AvoEventSpecFetcher.java:28`) |
| Response top-level shape | `{eventName, rules: {properties: [PropertyRule]}, passedEventIds, failedEventIds}` | `{metadata: EventSpecMetadata, propertyRules: [PropertyRule]}` (`AvoEventSpecFetcher.java:157-185`) |
| Property rule fields | `{propertyName, propertyType, nameRule: MatchRule, typeRule: MatchRule}` (separate exact-vs-regex modes) | `{propertyName, typePattern}` — typePattern is always a RE2J regex (`AvoEventSpecFetchTypes.java:36-44`) |
| Metadata fields | not present in spec response | `{schemaId, branchId, latestActionId, sourceId}` |
| Validated event report | spec doesn't define a `validatedEvent` wire body | Java POSTs a `type: "validatedEvent"` body to the track endpoint with `eventSpecMetadata`, `passedEventIds`/`failedEventIds`, and per-property validations (`AvoInspector.java:239-293`) |
| Bandwidth optimization | spec defines: `passedEventIds` only when strictly smaller; equal sizes use `failedEventIds` | Same rule, identically implemented (`EventValidator.java:80-90, 106-113`) |
| Cache: TTL/max/access-limit/sweep | 60s / 50 / 50 / every-50 | **Identical** (`EventSpecCache.java:21-24`) |
| Cache: branch-id flush | not in spec | `checkBranchId` flushes cache on branchId change (`EventSpecCache.java:107-112`) |
| In-flight dedup | spec defines via `sync.Map` (go-style) | Java uses `synchronized(inFlightRequests)` Map with queued callbacks (`AvoEventSpecFetcher.java:60-72`) — same semantics |
| Public API | spec suggests `EnableValidation()` opt-in | Java auto-enables in dev/staging (`AvoInspector.java:60, 176-178`) — no explicit method |

**This is the biggest single discrepancy in the audit.** Either (a) the spec needs to abstract the validation subsystem into language-agnostic semantics that cover both java and go shapes, or (b) the spec needs to pick one and explicitly mark the other as non-conformant. Option (a) is much more work and may not be possible if the two backends serve different endpoints.

### 3. Schema Extraction Output Format Will Fail All Spec Fixtures

Java's `AvoEventSchemaType.AvoList.getReportedName` returns `"list<" + pipe-joined subtypes + ">"` (e.g., `"list<string|null>"`, `"list<int>"`). Spec requires `"list(elementType)"` based on the **first** element only (e.g., `"list(string)"`). Differences:

- **Bracket style:** angle brackets `<>` vs parens `()`.
- **Element selection:** Java unions all distinct subtypes; spec uses only the first element.
- **Multi-type representation:** Java pipe-joins (`string|null`); spec has no concept of a union list type.
- **Array children format:** Java's `AvoObject.getReportedName` produces a stringified JSON inner — not a `SchemaEntry` array. (`AvoEventSchemaType.java:133-135`)
- **Empty array:** Java returns `"list<>"` (empty subtypes set); spec requires `"list(string)"` with `children: []`.

Despite all this, **Java's underlying extraction recursively builds the right structural tree** (objects with `children` map, lists with subtypes set, primitives) — only the *serialization to the wire `propertyType` string* diverges. If Java fixed `getReportedName` + the `children` JSON shape to match spec, it would pass.

One spec-aligned point: **`0.0` → `"float"`** in Java (`AvoSchemaExtractor.java:107` — `val instanceof Double` → `AvoFloat`). This matches Rev 6's revised rule and the go behaviour. Java agrees with go and spec, against node v1.2.0.

### 4. `enableLogging` is Process-Wide (Static) — Conformant

`AvoInspector.java:13` declares `private static boolean logsEnabled = false`. `enableLogging(boolean)` and `isLogging()` are `static`. This is **conformant** with the spec's normative requirement that `shouldLog` MUST be process-wide. Java is the only one of the three SDKs that gets this right out of the box (node uses class-level state correctly via TypeScript; go uses per-instance — non-conformant).

### 5. Missing `flush()` / `destroy()` / Public `extractSchema()` / `_avoFunctionTrackSchemaFromEvent`

- `flush()` — absent. Java's `AvoNetworkCallsHandler.reportInspectorWithBatchBody` spawns a `new Thread(...)` per call (`AvoNetworkCallsHandler.java:122-127`); without `flush()`, callers have no way to ensure those threads complete before JVM shutdown. The spec REQUIRES this for non-Node SDKs.
- `destroy()` — absent.
- `extractSchema(props)` — Java has this method (`AvoInspector.java:316-323`) and it IS public. ✅
- `_avoFunctionTrackSchemaFromEvent` — absent. `AvoNetworkCallsBodyFactory.bodyForEventSchemaCall` accepts `eventId`/`eventHash` parameters and sets `avoFunction: true` when they are non-null (`AvoNetworkCallsBodyFactory.java:48-54`), but no public API exposes this — only the internal call path sends `avoFunction: false` and skips eventId/eventHash entirely.

### 6. `eventId` / `eventHash` Treatment Diverges from Spec

When `eventId == null`, Java's factory **omits both fields entirely** from the body (`AvoNetworkCallsBodyFactory.java:48-54`, only sets them inside `if (eventId != null)`). The spec requires `eventId: null` and `eventHash: null` as explicit JSON nulls (Wire Fixture 1). Java sends neither — the keys are absent from the JSON. This is a minor but real wire-protocol divergence. Java differs from both node (which sends explicit `null`s) and go (which sends `""` empty strings).

### 7. Whitespace-Only `apiKey` / `version` Validation Missing

Java's constructor (`AvoInspector.java:34-61`) performs **no validation** of `apiKey` or `appVersion`. Spec requires throwing on empty or whitespace-only. Java silently accepts both. This is a quiet bug — events would send with a blank apiKey and presumably be rejected server-side.

### 8. Encryption Algorithm Note: AES-GCM, not AES-CBC

The user's prompt suggested the spec may say AES-CBC. The spec actually says **AES-256-GCM with a 16-byte IV** (correct, matches both java and go). Java uses `AES/GCM/NoPadding` with `GCMParameterSpec(128, iv)` and a 16-byte IV (`AvoEncryption.java:114-119`). Wire layout `[0x00][65B ephemeral pubkey][16B IV][16B auth tag][ciphertext]` matches spec exactly. **Encryption is conformant.** Java even has cross-SDK interop tests with explicit roundtrip-decrypt assertions (`AvoEncryptionTests.java:120-160`).

---

## Spec → Java: Requirements Java Doesn't Implement / Diverges On

| # | Spec Requirement | Status | Notes |
|---|---|---|---|
| 1 | `flush(timeoutMs?)` method | ❌ MISSING | No `flush()`. Background threads spawned per send are not joined. |
| 2 | `destroy()` method | ❌ MISSING | No `destroy()`. No cleanup of `eventSpecFetcher` / `eventSpecCache`. |
| 3 | Public `extractSchema(props)` standalone method | ✅ IMPLEMENTED | `AvoInspector.extractSchema` (line 316) is public. |
| 4 | `_avoFunctionTrackSchemaFromEvent` (Codegen path) | ❌ MISSING | Factory supports eventId/eventHash internally but no public API exposes them. |
| 5 | `enableLogging` as process-wide | ✅ IMPLEMENTED | Static field `logsEnabled` + `static` accessors. |
| 6 | List type strings: `"list(string)"`, `"list(int)"`, etc. | ⚠️ DIVERGES | Java emits `"list<...>"` with pipe-separated union. |
| 7 | Boolean type string `"boolean"` | ✅ IMPLEMENTED | `AvoBoolean.getReportedName` returns `"boolean"` (`AvoEventSchemaType.java:59`). |
| 8 | Array children format: heterogeneous union of type-strings / SchemaEntry arrays | ⚠️ DIVERGES | Java represents object children via stringified JSON `Util.remapProperties(...).toString().substring(...)` (`AvoEventSchemaType.java:134-135`); lists use a `Set<AvoEventSchemaType>`. Wire shape is not the spec's union. |
| 9 | Array type determined by first element only | ⚠️ DIVERGES | Java iterates all elements into a `HashSet<AvoEventSchemaType>` (`AvoSchemaExtractor.java:73-90`). |
| 10 | `removeDuplicates` in array children | ⚠️ DIVERGES | Java uses `HashSet`, which dedups by `hashCode()`/`equals()` (defined on `getReportedName()`). Effectively dedups, but produces a set-not-list and union typing, not the spec's first-element rule. |
| 11 | Empty array → `"list(string)"` with `children: []` | ⚠️ DIVERGES | Java emits `"list<>"` (empty subtypes set). |
| 12 | `0.0` → `"float"` (Rev 6 rule) | ✅ IMPLEMENTED | `val instanceof Double` → `AvoFloat` (`AvoSchemaExtractor.java:107`). |
| 13 | `trackingId` / `sessionId` absent (Rev 6 drop) | ✅ IMPLEMENTED | `AnonymousIdSessionRemovalTests` explicitly asserts absence. |
| 14 | `avoFunction: false/true` in wire body | ⚠️ DIVERGES | Sent as `false` for manual path ✅; `true` codegen path supported in factory but no public API to invoke it. |
| 15 | `eventId: null` and `eventHash: null` in wire body | ⚠️ DIVERGES | Java omits the keys entirely when eventId is null. Spec requires explicit JSON null. |
| 16 | Non-200 response resolves (does not reject/error) | ✅ IMPLEMENTED | `AvoNetworkCallsHandler:46-49` logs and continues; no exception propagates to caller. |
| 17 | Deduplication (SHOULD): 500ms window, two buckets | ❌ MISSING | No deduplication implemented. (SHOULD, not MUST — acceptable.) |
| 18 | `appName` defaults to `""` | ⚠️ DIVERGES | `appName` is a `@NotNull` required parameter in Java; no default applied. Caller MUST pass `""` explicitly. Spec says default `""`. |
| 19 | Whitespace-only `apiKey` or `version` MUST throw | ❌ MISSING | No validation at all. |
| 20 | 10-level recursion truncation (SHOULD, Spec-Level Addition) | ❌ MISSING | No depth limit. JVM stack overflow possible on pathological deep input. |
| 21 | `Content-Type: application/json` | ✅ IMPLEMENTED | `AvoNetworkCallsHandler:150`. |
| 22 | `Accept: application/json` | ✅ IMPLEMENTED | `AvoNetworkCallsHandler:149`. |
| 23 | Constructor env fallback: invalid env → `"dev"` with warning | 🚫 N/A | Java env is a typed enum `AvoInspectorEnv` (`Dev|Staging|Prod`); invalid values are a compile error, not a runtime concern. Stronger than spec. |
| 24 | `samplingRate` thread safety (lock or atomic) | ⚠️ DIVERGES | `samplingRate` is `volatile double` (`AvoNetworkCallsHandler.java:24`) — guarantees visibility but `Math.random() > samplingRate` and the assignment are not jointly atomic. Spec says "last-write-wins acceptable" — `volatile` is good enough by that bar. ✅ marginal. |
| 25 | `libVersion` plain SemVer | ⚠️ DIVERGES | Java reads from `ResourceBundle.getBundle("version")` (`AvoInspector.java:46`); falls back to `"-"` on failure. Tests assert `libVersion == "-"` (`AvoInspectorTests.java:191`). The actual production value depends on the bundled `version.properties` resource — could be SemVer if maintained correctly, could be `"-"` in test env. Not strictly non-conformant but fragile. |
| 26 | `createdAt` ISO 8601 with `.000Z` milliseconds | ✅ IMPLEMENTED | `SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)` with `TimeZone.getTimeZone("UTC")` (`Util.java:22-26`). Matches spec regex exactly. |
| 27 | Event spec validation initialized by default in dev/staging | ✅ IMPLEMENTED | `AvoInspector` constructor auto-initializes; `isValidationEnabled()` returns true in dev/staging (`AvoInspector.java:176-178`). No opt-in required. |
| 28 | `extractSchema(null)` → `[]` without throwing | ✅ IMPLEMENTED | `AvoSchemaExtractor.extractSchema:24-25` returns empty HashMap. |
| 29 | `streamId` containing `:` warns and still sends | ✅ IMPLEMENTED | `warnIfStreamIdContainsColon` logs to stdout (`AvoInspector.java:132-136`); event still sent. |
| 30 | Encryption: ECIES P-256, AES-256-GCM, 16-byte IV, SHA-256 KDF over raw bytes, wire format | ✅ IMPLEMENTED | All four conformant. Cross-SDK interop tests in `AvoEncryptionTests.java`. |
| 31 | Encryption inactive in prod even with key | ✅ IMPLEMENTED | `AvoEncryption.shouldEncrypt:49-52` returns false when env == "prod". |
| 32 | `publicEncryptionKey` in base body only when non-null and non-empty | ✅ IMPLEMENTED | `AvoNetworkCallsBodyFactory:148-150`. |
| 33 | List-type properties omitted from encrypted property array | ✅ IMPLEMENTED | `encryptPropertyValues:84-90`. Both `AvoList` schema-type and runtime `List`/`JSONArray` are filtered. |
| 34 | Encryption failure: log warning, omit property, continue | ✅ IMPLEMENTED | `AvoEncryption.encrypt:144-149` returns null on any exception; caller (`bodyForEventSchemaCall`) skips null entries. |
| 35 | UUID v4 format `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` | ✅ IMPLEMENTED | `java.util.UUID.randomUUID()` produces conformant v4 (`AvoNetworkCallsBodyFactory.java:143`, `AvoInspector.java:251`). |

---

## Java → Spec: Features Java Has That the Spec Doesn't Describe

| Feature | Java Location | Status |
|---|---|---|
| **Two input shapes** — `JSONObject` and `Map<String, ?>` overloads of `trackSchemaFromEvent` | `Inspector.java:14-29` | ⚠️ AMBIGUOUS — language-idiomatic; spec just says "object". MAY be omitted from spec. |
| **POJO field-reflection input** — `extractSchemaFromObject` reads any plain object's fields via reflection (`Field[]` from `getDeclaredFields`) walking up the class hierarchy | `AvoSchemaExtractor.java:41-67` | ❌ MISSING FROM SPEC — Java accepts any Java object as event properties and reflects on its fields. Spec assumes a plain map/dict. This is a Java-only convenience; no other SDK supports it. |
| **`AvoInspectorTarget` (per-call override)** — apiKey + appName + appVersion override per call | `AvoInspectorTarget.java`, `Inspector.java:17,26` | ❌ MISSING FROM SPEC — spec assumes single constructor target; Java allows overriding for multi-tenant scenarios. |
| **Event spec validation — different endpoint and contract** | `AvoEventSpecFetcher.java:28`, `AvoEventSpecFetchTypes.java` | ❌ MISSING FROM SPEC (the spec's optional section is go-shaped; java's is differently shaped) — see Critical Finding 2. |
| **`validatedEvent` wire body type** — Java sends a second POST with `type: "validatedEvent"`, `eventSpecMetadata`, `passedEventIds`/`failedEventIds`, `propertyValidations` | `AvoInspector.java:239-293` | ❌ MISSING FROM SPEC |
| **`branchId`-based cache flush** — when the server returns a different `branchId`, the entire event-spec cache is flushed | `EventSpecCache.java:107-112` | ❌ MISSING FROM SPEC |
| **`AvoEventSchemaType` typed hierarchy** — concrete subclasses (`AvoInt`, `AvoString`, `AvoBoolean`, `AvoFloat`, `AvoNull`, `AvoList`, `AvoObject`, `AvoUnknownType`) used as return type | `AvoEventSchemaType.java` | ⚠️ AMBIGUOUS — Java-idiomatic sealed hierarchy; spec uses strings. |
| **Default native arrays (`int[]`, `boolean[]`, `Float[]`, etc.) handled via class-name dispatch** | `AvoSchemaExtractor.java:117-169` | ❌ MISSING FROM SPEC — Java handles primitive arrays specially; emits `list<int>` for `int[]`, `list<int\|null>` for `Integer[]` (the `null` reflects that boxed arrays may contain null). |
| **`enableLogging` auto-enabled in Dev** | `AvoInspector.java:60` | ✅ IN SPEC (matches `env == "dev"` default-on logging rule). |
| **`samplingRate` injection into per-event body** | `AvoNetworkCallsHandler.java:101-103` | ✅ IN SPEC (samplingRate field documented). |
| **Per-call `streamId` overload** | `Inspector.java:20,29` | ✅ IN SPEC (`trackSchemaFromEvent(name, props, streamId)`). |

---

## Cross-SDK Picture (node vs go vs java)

### Wire-Protocol Divergences

| Issue | node v1.2.0 | go v1.0.0 | java | Majority / Spec |
|---|---|---|---|---|
| `Content-Type` header | `application/json` ✅ | `text/plain` ❌ | `application/json` ✅ | Spec correct; go needs fix. **2-to-1 for spec.** |
| `Accept: application/json` header | sent ✅ | not sent ❌ | sent ✅ | **2-to-1 for spec.** |
| `createdAt` format with `.000Z` millis | ✅ matches `.SSS'Z'` | ❌ uses `time.RFC3339` (no ms) | ✅ uses `.SSS'Z'` (`Util.java:23`) | **2-to-1 for spec.** |
| `trackingId` field present | sent as `""` (will be dropped) | absent | absent | **2-to-1 for "drop it"** → Rev 6 dropped it ✅ |
| `sessionId` field present | sent as `""` (will be dropped) | absent | absent (explicitly tested-absent) | **2-to-1 for "drop it"** → Rev 6 dropped it ✅ |
| `eventId` / `eventHash` when no codegen | explicit JSON `null` | `""` (empty string) | key omitted entirely | **3-way split.** Spec says `null`; matches node only. |
| `libPlatform` value | `"node"` | `"go"` | `"java-jvm"` | All different; all conformant (spec just requires non-empty). |
| `libVersion` source | from `package.json` | hardcoded `"1.0.0"` | from `ResourceBundle "version"` or `"-"` | Spec says SemVer; node closest, go hardcoded, java environment-dependent. |
| Codegen path (`_avoFunctionTrackSchemaFromEvent`) | implemented | not implemented | not implemented (factory supports it internally only) | **2-to-1 against** — spec MAY downgrade to optional. |

### Schema-Extraction Divergences

| Rule | node v1.2.0 | go v1.0.0 | java | Spec (Rev 6) |
|---|---|---|---|---|
| `0.0` → ? | `"int"` (string-repr trick) | `"float"` | `"float"` | **`"float"`** — node wrong; java+go right. Rev 6 already documents node must fix. |
| Boolean type string | `"boolean"` ✅ | `"bool"` ❌ | `"boolean"` ✅ | **2-to-1 for `"boolean"`.** |
| List type string | `"list(elementType)"` ✅ | `"list"` (bare) ❌ | `"list<elementType\|...>"` ❌ | Spec aligns with node only. **Java and go each diverge differently.** |
| List type determined by | first element only | iterates all (type switch) | iterates all into a Set | **Spec aligns with node only.** |
| Empty array | `"list(string)"` + `children: []` | `"list"` + `nil` | `"list<>"` + empty set | **Spec aligns with node only.** |
| List element dedup | yes (`removeDuplicates`) | no | yes (via HashSet) | java+node dedup; go doesn't. |
| Boolean and null sentinel | typeof-based | type-switch | `instanceof`-based | Java + go map nulls correctly; all three handle null primitives equivalently. |
| Recursion depth limit | none | none | none | Spec SHOULD-adds 10 levels (none implements). |

### Event-Spec Validation Subsystem

| Aspect | node v1.2.0 | go v1.0.0 | java | Spec (Rev 6) reflects |
|---|---|---|---|---|
| Implemented? | No | Yes | Yes | Documented as optional, go-shaped |
| Endpoint | — | `/inspector/v1/api/event-spec` | `/inspector/v1/spec` | go's endpoint |
| Response shape | — | `{eventName, rules, passedEventIds, failedEventIds}` | `{metadata, propertyRules}` | go's shape |
| Rule format | — | `MatchRule(type: exact\|regex, value)` for both name and type | `{propertyName, typePattern}` (regex always) | go's |
| Cache TTL/max/access/sweep | — | 60s / 50 / 50 / 50 | 60s / 50 / 50 / 50 | **identical** |
| Branch-id cache flush | — | not present | present | java-specific |
| Auto-enable in dev/staging | — | requires `EnableValidation()` opt-in | auto-enabled in constructor | java-only |
| Reports `validatedEvent` to track endpoint | — | not (server-side handling only) | yes (`type: "validatedEvent"`) | java-only |
| Bandwidth opt: passed only when strictly smaller | — | yes | yes | **identical** |
| In-flight dedup | — | `sync.Map` | `synchronized` Map + callback list | semantically equivalent |

---

## Verified Parity

The following behaviors match the spec cleanly:

1. **Endpoint URL** — `POST https://api.avo.app/inspector/v1/track` (`AvoNetworkCallsHandler.java:30`).
2. **Content-Type / Accept headers** — both `application/json`.
3. **`createdAt` ISO 8601 with millisecond precision** — `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` UTC.
4. **`enableLogging` is process-wide** — `static boolean logsEnabled` — only SDK to nail this cleanly.
5. **`trackingId` / `sessionId` removed from wire body** — explicit STORY-05 tests.
6. **`extractSchema(null)` returns empty without throwing.**
7. **`streamId` with `:` warns and still sends.**
8. **`0.0` → `"float"`** — matches Rev 6 rule and go behavior.
9. **Encryption fully conformant** — ECIES P-256, AES-256-GCM, 16-byte IV, SHA-256 over raw shared secret, wire layout exact; prod-disabled; key in base body only when non-empty; list properties omitted; failure-omit-and-continue. Cross-SDK interop tests roundtrip-verify with a reference decryptor.
10. **`messageId` UUID v4** — `java.util.UUID.randomUUID()` is cryptographically random and produces the correct format.
11. **`samplingRate` default 1.0, server-updated, drop on `random > rate`** — `Math.random() > samplingRate` logic at `AvoNetworkCallsHandler.java:94`. `volatile double` is acceptable concurrency control by the spec's "last-write-wins" allowance.
12. **Non-200 response does not propagate as exception** — logged, swallowed; caller's call returns normally.
13. **Single-event batch** — sends array with exactly one element.
14. **`publicEncryptionKey` in base body only when non-null/non-empty.**

---

## Recommendation

### Spec changes prompted by Java findings

1. **Add a `java` row to the SDK Conformance Status table.** Required updates for Java to conform:
   - Add `flush()` and `destroy()`.
   - Add `_avoFunctionTrackSchemaFromEvent` public API (factory already supports the underlying body).
   - Fix `eventId`/`eventHash` to send explicit JSON `null` (not omit the keys).
   - Validate apiKey/version are non-empty and non-whitespace at constructor time.
   - Default `appName` to `""` so it can be omitted.
   - Fix `AvoEventSchemaType.AvoList.getReportedName` to emit `"list(firstElementType)"` instead of `"list<union>"`.
   - Fix `AvoObject.getReportedName` / `Util.remapProperties` to produce spec-shape `children` arrays of `{propertyName, propertyType, children?}` rather than embedded JSON strings.
   - Use first-element-only typing for arrays, with deduplication of `children` entries.
   - Default empty array to `"list(string)"` with `children: []`.
   - Optional SHOULD: add 10-level recursion depth limit.
   - Optional SHOULD: implement deduplication (500ms window, two buckets).

2. **Confirm and strengthen the Rev 6 drop of `trackingId`/`sessionId`.** Java independently shipped this removal via explicit STORY-05 work. The spec note can now cite two independent implementations rather than just being a unilateral spec call.

3. **Reconsider the Event-Spec Validation section.** It is currently shaped around go. Java's implementation differs on endpoint, response shape, rule format, and the existence of a `validatedEvent` POST. Three options:
   - **(a) Generalize:** rewrite the optional section to define an *abstract* validation protocol that captures the shared semantics (per-event-name spec fetched async, LRU cache 60s/50/50, regex matching, bandwidth-opt passed/failed), with both wire shapes as language-specific concrete encodings. **Best for spec longevity.**
   - **(b) Pick java's shape (the newer one).** Update the spec to match java's `/spec` endpoint and `{metadata, propertyRules}` response, plus the `validatedEvent` POST body type. Mark go as needing to update. Requires backend-team confirmation.
   - **(c) Pick go's shape (the older one).** Mark java as needing to update.
   - Without backend input, **(a) is recommended**; otherwise prefer (b) since java's shape is more recent and more complete (it includes metadata and per-property validations).

4. **`enableLogging` cross-language guidance is strengthened.** Java's `static boolean` is a clean example to add to the spec's process-wide implementation table (currently lists Go, Python, Ruby, Rust).

5. **Schema-extraction algorithm cross-language note.** Both go and java struggle to produce spec-conformant `propertyType` strings because they have strong native types and natural inclination toward enums/sealed-classes. The spec could include a "Java translation" section similar to the recommended Go translation: map `Integer/Long/Short/Byte → "int"`, `Float/Double → "float"`, `Boolean → "boolean"`, native arrays via classname, `List`/`JSONArray` → take first non-null element → `"list(typeOfFirst)"` with deduplicated children, dedup via `equals()` on type strings (not `HashSet<AvoEventSchemaType>` which loses ordering).

### Java fixes needed if spec stays as-is

Per row #1 above. The most impactful single change is **schema extraction output format** — the underlying tree is correctly built; only the leaf serialization needs to change, which is a tightly scoped fix to `AvoEventSchemaType.AvoList.getReportedName`, `AvoEventSchemaType.AvoObject.getReportedName`, and `Util.remapProperties`.

### What's already right (no action needed)

`Content-Type`, `Accept`, `createdAt` precision, `0.0 → "float"`, no `trackingId`/`sessionId`, `static` logging, encryption end-to-end, UUID v4, `samplingRate` default + drop, non-200 swallow, `extractSchema(null)` safety, public `extractSchema`, `:`-warning, `streamId` passthrough, env enum exact strings (`"dev"/"staging"/"prod"`).

---

## Executive Summary

Java is the most spec-conformant of the three audited SDKs on **wire-protocol fundamentals** (`Content-Type: application/json`, ISO 8601 with `.SSS'Z'` millis, `trackingId`/`sessionId` already removed, `0.0 → "float"`, process-wide `enableLogging`, fully conformant ECIES P-256 / AES-256-GCM encryption with cross-SDK interop tests). The largest gaps are **schema-extraction output format** (Java emits `"list<string|null>"` heterogeneous unions instead of the spec's `"list(string)"` first-element-only encoding — every golden fixture would fail at serialization despite the underlying tree being structurally correct), the **absence of `flush()` / `destroy()` / `_avoFunctionTrackSchemaFromEvent`**, no whitespace validation on apiKey/version, `eventId`/`eventHash` omitted instead of sent as JSON null, and most consequentially a **fully-implemented event-spec validation subsystem with a different endpoint (`/inspector/v1/spec`), different response shape, and different rule format than the go-shaped section currently in Rev 6 of the spec** — meaning the optional-feature section needs to either generalize to cover both, pick the newer (java) shape, or explicitly mark one of the two as non-conformant. Counts: **Spec → Java: 18 implemented, 5 missing, 10 diverging, 2 N/A**; **Java → Spec: 9 covered cleanly, 6 missing from spec, 2 ambiguous**; **1 critical wire-protocol cross-check now backed by two independent implementations (trackingId/sessionId removal)**, validating the Rev 6 drop decision.
