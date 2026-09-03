# Changelog

All notable changes to this spec repository are documented here.

This changelog covers the `avohq/spec-first-inspector-server-sdk` specification repository —
not any generated SDK. The normative contract is defined in [`SPEC.md`](./SPEC.md).
Instructions for AI coding agents are in [`AGENTS.md`](./AGENTS.md).

## Tagging Convention

Each entry is tagged to signal the urgency for downstream SDK authors:

- **`[WIRE]`** — A wire-protocol change. Downstream SDKs **MUST** regenerate
  to remain conformant. This includes changes to the HTTP endpoint, required
  request body fields, field types, enum values, or observable behavior.
- **`[SPEC]`** — A documentation-only update (clarification, typo fix, new
  conformance fixture for existing behavior). Downstream SDKs **MAY** ignore
  these entries; regeneration is optional.

See [`VERSIONING.md`](./VERSIONING.md) for the full semver policy and per-language
spec version declaration patterns.

---

## [2.1.0] - 2026-09-03 `[WIRE]`

**Adds the OPTIONAL gateway coordinates `outputReference` / `originHint` and a per-event `appVersion`
override, via a new trailing `options` parameter on `trackSchemaFromEvent`.** This is the server-SDK
half of Avo's multi-gate model: one Inspector API key per *gateway* instead of one source per
destination, with each observation labeled by which gateway output it was bound for
(`outputReference`; absent = gateway checkpoint) and which source it came from (`originHint`;
low-cardinality, never a user identifier). The Inspector ingestion API already accepts both fields
as optional strings; this release specifies how a server SDK produces them.

Per [`VERSIONING.md`](./VERSIONING.md) this is an additive wire-protocol change (new OPTIONAL request
fields; a call without `options` is unchanged), so it is a **MINOR** release. **Downstream SDKs SHOULD
regenerate** to gain gateway support; an SDK generated from 2.0.0 remains conformant for non-gateway
use.

### Wire contract (normative summary — SPEC.md §4.2.1, §7.3.6)

- `trackSchemaFromEvent(eventName, eventProperties, streamId?, options?)` with
  `options = { outputReference?: string; originHint?: string; appVersion?: string }` (trailing and
  optional, or an overload in languages without optional parameters).
- `outputReference` / `originHint` are top-level siblings of `eventProperties`, never inside the
  schema. Each value is trimmed; absent / `null` / empty / whitespace-only (and, in dynamically-typed
  languages, non-string) values are treated as absent and the key is **omitted** — never sent as
  `null` or `""`.
- `appVersion` (always present) follows a four-cell rule: `options.appVersion` when provided; a
  literal JSON `null` when `originHint` is set and no usable `options.appVersion` was given (the
  event is source-scoped, so the instance's configured version never applies); otherwise the
  constructor `version`. SDKs SHOULD warn once per process when it resolves to `null`.
- `options` are per call; two calls for the same event with different `outputReference` values are
  two observations and are both sent (no deduplication).

### Backend compatibility note (informative)

As of 2026-09-03 the `/inspector/v1/track` ingestion path does **not** decode the two fields and
**drops** events whose `appVersion` is `null` (still HTTP 200); the other ingestion paths decode both
and tolerate `null`. Until the v1 parser is updated, pair `originHint` with a non-blank
`options.appVersion`. The spec's wire contract is unchanged by this; SPEC.md §7.1 carries the dated
note.

### Changed

| Artifact | Change |
|---|---|
| `SPEC.md` §4.2 / new §4.2.1 | `options?: TrackOptions` on `trackSchemaFromEvent`; option semantics, API requirements. |
| `SPEC.md` §7.1 | Dated backend-compatibility note for the gateway fields. |
| `SPEC.md` §7.3 / §7.3.1 | `appVersion` is now `string \| null` under the §7.3.6 rule; instance-level field list no longer lists `appVersion` unconditionally. |
| `SPEC.md` new §7.3.6 | Normative wire mapping: presence/omission, normalization, the four-cell `appVersion` table, one-time warning, example body. |
| `SPEC.md` §12.7 | A batch MAY mix elements with/without gateway fields and with different per-event `appVersion`. |
| `SPEC.md` Conformance Harness Reference | `"<absent>"` placeholder. |
| `openapi.yaml`, `schemas/event-body.json` | `appVersion` nullable; OPTIONAL `outputReference` / `originHint` (`minLength: 1`, no surrounding whitespace); new `gatewayEvent` example. |
| `conformance/runner-contract.md` (1.1.0) | `input.options` and `steps[].options` passed verbatim; `"<absent>"` placeholder; checklist item. |
| `conformance/wire-protocol/fixtures.json` | `wire-9` – `wire-13`: all-set, `originHint` without `appVersion` → `null`, override without `originHint`, whitespace-only → omitted + fallback, property-name collision. |
| `conformance/batching/fixtures.json` | `batch-7`: per-event `options` inside one batch, no deduplication. |
| `conformance/runner/suite-runner.mjs` | `"<absent>"` key-must-not-exist assertion in `matchBody`. |
| `conformance/runner/example-harness/{sdk,harness}.mjs` | Reference SDK implements §4.2.1 / §7.3.6; harness forwards `options`. **Also fixes a 2.0.0 regression:** the example SDK never sent `sessionId: ""`, so 10 of the 30 fixtures failed on `main` (`npm run conformance:run` was red); it is green again at 36/36. |
| `conformance/runner/coverage-map.json`, `conformance/**/README.md`, `AGENTS.md` | Fixture counts (36 total), new automated/manual entries, checklist items, AC-26 / AC-27 (27 ACs). |

## [2.0.0] - 2026-06-25 `[WIRE]`

**`sessionId` is now REQUIRED on the wire (empty string `""` for server SDKs); it was previously
forbidden.** Empirical bisection against the live Avo Inspector API showed that the backend
ingestion pipeline silently DROPS events whose wire body omits `sessionId`: the request still
returns `200 {"success":true}`, but the event never appears on the dashboard. Adding
`sessionId: ""` to an otherwise spec-shaped body is necessary and sufficient for ingestion
(`trackingId`, `visitorId`, `userId`, `eventId`, `eventHash`, and `avoFunction` are NOT required).
The canonical browser SDK `js-avo-inspector` always sends `sessionId: ""`.

Server SDKs do not model end-user sessions, so the value is always the empty string `""`, but the
field MUST be present on every event object.

Per [`VERSIONING.md`](./VERSIONING.md), adding a new required request field is a breaking
wire-protocol change, so this is a **MAJOR** release. **Downstream SDKs MUST regenerate** — any
SDK generated from v1.0.0 omits `sessionId` and therefore fails to deliver events.

### Changed

| Artifact | Change |
|---|---|
| `SPEC.md` §3.3 | Retitled and rewritten: `sessionId` is required-empty (not forbidden); `visitorId`/`userId` remain forbidden. |
| `SPEC.md` §7.3 / §7.3.1 | Base body example and Base Body Fields table add `sessionId`; "omitted fields" note now forbids only `trackingId`. |
| `SPEC.md` §8.2 | `sessionId` MUST be sent as `""`; `trackingId`/`visitorId`/`userId` MUST NOT be sent. |
| `AGENTS.md` | `sessionId` moved from the Forbidden to the Required wire-field lists (checklist + AC-9). |
| `schemas/event-body.json`, `openapi.yaml` | `sessionId` added to `required` and `properties` and constrained to `const: ""`; the forbidden `not.anyOf` covers `trackingId`, `visitorId`, and `userId`. |
| `conformance/runner/suite-runner.mjs` | `sessionId` removed from `FORBIDDEN_WIRE_FIELDS`. |
| `conformance/**/fixtures.json` | Every expected event object now includes `"sessionId": ""`. |

## [1.0.0] - 2026-06-24 `[WIRE]`

Initial publication of the `avohq/spec-first-inspector-server-sdk` spec.

All content in this release is wire-protocol normative. Downstream SDKs
generated from v1.0.0 need not regenerate until a `[WIRE]`-tagged release
appears.

### Normative Deliverables Shipped

| Artifact | Description |
|---|---|
| `SPEC.md` | Full normative prose specification (RFC 2119 language, 13 sections) |
| `AGENTS.md` | AI-agent SDK generation guide: checklist, reading order, conformance, definition of done (25 ACs) |
| `openapi.yaml` | OpenAPI 3.1 document for the Inspector HTTP API |
| `schemas/event-batch.json` | JSON Schema: top-level request array |
| `schemas/event-body.json` | JSON Schema: event body |
| `schemas/event-property-plain.json` | JSON Schema: property object |
| `schemas/schema-entry.json` | JSON Schema: schema extraction entry |
| `conformance/schema-extraction/fixtures.json` | 13 golden schema-extraction fixtures |
| `conformance/wire-protocol/fixtures.json` | 8 wire-protocol golden fixtures (wire-1 through wire-8) |
| `conformance/error-handling/fixtures.json` | 3 error-handling fixtures (samplingRate boundary, non-200, empty properties) |
| `conformance/batching/fixtures.json` | 6 batching golden fixtures (batch-1 through batch-6; `sequence` mode, including the `batch-6` `trackN` concurrency fan-out) |
| `conformance/runner-contract.md` | Normative stdin/stdout harness protocol |

### Wire-Protocol Normative Content

- **Endpoint:** `POST https://api.avo.app/inspector/v1/track`
- **Request body schema:** JSON array of event objects; required fields:
  `apiKey`, `appName`, `appVersion`, `libVersion`, `env`, `libPlatform`,
  `messageId`, `streamId`, `createdAt`, `samplingRate`, `type`,
  `eventName`, `eventProperties`
- **`env` enum values:** `"dev"`, `"staging"`, `"prod"` (exact wire strings)
- **`libVersion` format:** plain SemVer string (e.g., `"1.2.0"`) — no suffix
- **`messageId` format:** UUID v4 (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`)
- **`createdAt` format:** ISO 8601 UTC with milliseconds
  (e.g., `"2026-05-25T12:00:00.000Z"`)
- **Schema extraction algorithm:** `extractSchema` / `mapping` /
  `getPropValueType` / `getBasicPropType` / `removeDuplicates` pseudocode
  with 13 golden fixtures
- **Error behavior:** network timeout / network error → resolve; non-200
  response → resolve; SDK internal error → reject
- **Sampling:** default rate `1.0`; server-controlled update via 200 response
  body `samplingRate` field; drop when `random > samplingRate`
- **Constructor validation:** throw on missing/whitespace `apiKey` or `version`
  with exact error message strings
- **`enableLogging` scope:** process-wide (class-level), not per-instance
- **`destroy()` contract:** terminal — resets `pendingCount` to 0, clears the scheduled-flush
  timer, discards the pending batch unsent; a subsequent `trackSchemaFromEvent()`
  is a no-op returning `Promise.resolve([])`
- **gzip request compression (mandatory when feasible):** On any gzip-capable
  runtime, SDKs MUST gzip-compress (RFC 1952) request bodies whose serialized
  UTF-8 byte length is `>= 1024`, sending `Content-Encoding: gzip` with the
  compressed `Content-Length`. `Content-Type` stays `application/json` (the
  browser SDK uses `text/plain` to avoid a CORS preflight; server SDKs are not
  subject to CORS). Uncompressed fallback is permitted ONLY for sub-threshold
  bodies, a runtime with no gzip implementation, or a compression error — not by
  choice; a no-gzip runtime MUST document the limitation. Ported from the JS Inspector SDK
  ([avohq/js-avo-inspector#212](https://github.com/avohq/js-avo-inspector/pull/212)),
  adapted for server-side runtimes. See SPEC.md §7.2 and §7.3.5; conformance
  fixtures `wire-6` (large body, gzip transparent) and `wire-7` (small body MUST
  be uncompressed), asserted via the new `expected_request_headers` field.

### Batching

- **In-memory batching:** SDKs accumulate events in an in-memory pending batch buffer and send
  them as a JSON array. Flush triggers: buffer length reaches `batchSize` (MUST) or the oldest
  buffered event exceeds `batchFlushSeconds` (SHOULD, via a non-blocking scheduled flush). Defaults
  `batchSize` 30, `batchFlushSeconds` 30; **`env == "dev"` forces `batchSize = 1`** (immediate send).
  New OPTIONAL constructor options: `batchSize`, `batchFlushSeconds`, `maxQueueSize` (default 1000),
  `disableBatchTimer`. `EventBatch` `maxItems` cap removed (`minItems: 1` retained) — the body is now
  an array of one or more self-contained event objects that MAY mix `streamId`/`eventName`.
- **Server-nature divergences (not the browser behavior):** buffer is in-memory only and never
  persisted (at-most-once; lost on crash/exit-without-flush); the buffer is synchronized (atomic
  swap-and-clear, no HTTP send under the lock); sampling is per event at enqueue (not whole-batch);
  `maxQueueSize` FIFO-drops oldest and logs the drop count; transient failures re-queue at the front
  while a non-200 does not (and `messageId` is never mutated on re-queue); `trackSchemaFromEvent`
  resolves with the extracted schema at enqueue. `Content-Type` stays `application/json` and gzip
  applies to the assembled batch body. See SPEC.md §12, the `batching` suite (`batch-1`–`batch-6`,
  including the `batch-6` `trackN` concurrency fan-out that automates the §3.1/§12.4 atomic
  swap-and-clear MUST), conformance fixture `wire-8` (no-premature-flush), and the manual matrix in
  `conformance/README.md` for the two remaining SHOULD-level behaviors (time/idle flush §12.3,
  transient re-queue §12.5).

### Runtime Lifecycle Requirements

- **`flush()` requirement:** All SDKs MUST implement `flush()`, regardless of target runtime —
  there is no runtime-specific keepalive timer. The SDK MUST NOT rely on holding the host process
  open by itself to deliver events; callers MUST `flush()` (or `await` the returned promise) before
  process or function-handler exit. `flush()` MUST **force-flush the pending batch** (send all
  buffered events) and then await completion. Default timeout: 10,000 ms. `flush()` MUST resolve
  (not reject) in all cases. See SPEC.md §4.6, §11, and §12.6.

### Spec Design Intents

- **`0.0` → `"float"` (statically-typed languages only):** `getBasicPropType` classifies a
  float-zero value (`0.0`) as `"float"` **only** in statically-typed languages (Go, Java, Rust,
  C#, Scala), where the declared type is authoritative (`float64(0.0)` → `"float"`). In
  JavaScript/TypeScript, `0.0` and `0` are runtime-identical and the canonical reference parser
  (`node-avo-inspector`) emits `"int"` for any whole-valued float; JS/TS SDKs MAY emit `"int"`.
  Float-zero is intentionally **excluded** from the universal `schema-extraction` fixtures so the
  reference SDK stays conformant. See SPEC.md §9.3.1.
- **`propertyType` enum — no `list(null)`:** `list(null)` is **not** a valid `propertyType`. The
  reference parser can never emit it (a null-first or empty list defaults to `list(string)`), and
  the Inspector backend has no null list type (it degrades `list(null)` to `list(any)`).
  `list(object)` covers both arrays of objects and nested arrays. See SPEC.md §7.3.4 and §9.3.4.
- **Unknown wire fields are ignored, not rejected:** the event body forbids only `sessionId` and
  `trackingId`; other unknown top-level fields are permitted (the Inspector write API reads only
  the fields it needs and never rejects extras). `schemas/event-body.json` therefore no longer
  sets `additionalProperties: false` — it matches `openapi.yaml`. See SPEC.md §7.3.1.
