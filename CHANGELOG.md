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

## [3.0.0] - 2026-09-04 `[WIRE]`

**Every request moves from `POST https://api.avo.app/inspector/v1/track` to
`POST https://api.avo.app/inspector/v2/track`, and three request headers become REQUIRED:
`api-key`, `env` and `X-Avo-Client`.** v2 is the one Inspector ingestion endpoint shared by every
Inspector sender; each sender identifies itself with `X-Avo-Client` so traffic can be attributed
without decoding a request body. For a generated server SDK the value of that header is the SDK's
own `libPlatform` (`node`, `ruby`, `csharp`, `go`, …).

Per [`VERSIONING.md`](./VERSIONING.md) a changed HTTP endpoint is a breaking wire-protocol change,
so this is a **MAJOR** release. **Downstream SDKs MUST regenerate**: an SDK generated from 2.0.0
posts to the old path and sends none of the three headers, so it is no longer conformant.

> **2.1.0 was never released.** The OPTIONAL gateway coordinates (`outputReference` / `originHint`)
> and the per-event `appVersion` override were prepared as a 2.1.0 minor and are folded into this
> release instead, because they ship together with the endpoint move. Everything a 2.1.0 entry
> would have carried is below, minus the backend caveats that v2 makes obsolete.

### The wire change (normative summary — SPEC.md §7.1, §7.2)

- **Endpoint:** `POST https://api.avo.app/inspector/v2/track` (HTTPS, port 443). Unchanged:
  `AVO_INSPECTOR_MOCK_ENDPOINT` still overrides the URL for conformance runs, still fail-closed for
  `env: "prod"`, and the override replaces the URL **only** — the headers below are still sent.
- **Required headers:**

  | Header | Value |
  |---|---|
  | `api-key` | The `apiKey` constructor option, verbatim |
  | `env` | Exactly `dev` / `staging` / `prod` |
  | `X-Avo-Client` | The SDK's `libPlatform`, identical on every request, never per-call input |
  | `Content-Type` | `application/json` — `text/plain` MUST NOT be used |
  | `Content-Length` | The byte length of the body **actually sent** — the compressed length when `Content-Encoding: gzip` is present, never the length of the uncompressed JSON. An SDK MUST NOT switch to chunked transfer-encoding to avoid supplying it. |

- **Authentication moved out of the body.** v2 reads the API key and the environment from the
  headers, never from the JSON body. A missing or empty `api-key`, or a missing/out-of-enum `env`,
  is answered **`400 {"ok":false,"error":"..."}`** and none of the request's events are ingested.
  For the SDK a `400` is an ordinary non-200: resolve, do not retry, drop the batch after logging.
- **The endpoint move by itself changes nothing in the request body.** It still carries its own
  `apiKey` and `env` fields; v2 ignores those copies. Keeping them keeps one body shape and one
  JSON Schema across ingestion paths.

  Read that as a statement about the *endpoint move only*, not about the release. Two other changes
  folded into 3.0.0 do alter the body: the gateway work adds OPTIONAL `outputReference` /
  `originHint` and makes `appVersion` nullable (with `appVersion: null` requiring `originHint`),
  and **`sessionId` is removed outright**. So the 3.0.0 body is NOT the 2.0.0 body, and no call —
  with or without the gateway coordinates — reproduces one.

  What does still hold is the compatibility direction that matters during the ingestion
  transition: a 2.0.0-shaped body, `sessionId: ""` included, remains **valid** against the 3.0.0
  schemas. `sessionId` was removed from `required` and `properties` but deliberately not added to
  the forbidden set, and unknown extra fields are permitted, so the schemas accept every body
  2.0.0 accepted.
- **`X-Avo-Client` MUST equal `libPlatform`.** The header identifies the sender, the body field
  identifies the same sender; a request where the two disagree is a conformance failure.

### What v2 changes behaviorally

- **It decodes the gateway coordinate fields.** `outputReference` and `originHint` are read and
  stored, which is the whole reason for the move.
- **It tolerates a `null` `appVersion`,** recording the observation as `unversioned` rather than
  dropping the event.
- **It does not sample server-side.** The `samplingRate` it returns is pinned to `1.0` and stored
  counts are exact rather than extrapolated. No SDK obligation changes: an SDK still reads
  `samplingRate` from a `200` that carries a numeric value in `[0.0, 1.0]`, still leaves the rate
  unchanged on a `200` that carries none (the event-limit drop shape `{"success": false}` is one),
  still evaluates sampling per event at enqueue, and still honors whatever value it is given
  (SPEC.md §7.4, §7.7).
- **Response shapes:** `200 {"samplingRate":1.0,"success":true}` on success; `200 {"success":false}`
  when the workspace event limit dropped the event (not a transport failure, never retried);
  `400 {"ok":false,"error":"..."}` for a bad `api-key` / `env` header.
- *Informative, and not a server-SDK concern:* a browser-based sender additionally needs the
  ingestion endpoint's CORS allowlist to accept these headers before it can reach v2 from a
  browser. Server-side SDKs are not subject to CORS and are unaffected.

### Removed: the v1 backend-compatibility caveats

The 2.1.0 work documented, correctly at the time, that the `/inspector/v1/track` ingestion path
discarded `outputReference` / `originHint` and dropped events whose `appVersion` was `null`. **That
is a property of v1 and is obsolete for any sender on v2.** Every occurrence is deleted in the same
change that moves the endpoint, because leaving one in place would actively mislead:

| Where | What was removed |
|---|---|
| `SPEC.md` §7.1 | The dated "Backend compatibility note for the gateway fields" blockquote, replaced by a short description of what v2 is. |
| `SPEC.md` §7.3.6 | The SHOULD-level "warn once per process when `appVersion` resolves to `null`" rule. Its only rationale was that the v1 parser silently dropped those events; v2 accepts them and records `unversioned`, so the warning would now flag a correct, documented outcome as a problem. The rule is deleted rather than reworded, and the spec now states positively that a `null` `appVersion` needs no special handling and MUST NOT cause the SDK to suppress, substitute, or drop the event. |
| `AGENTS.md` | The matching checklist item and the warning clause of AC-27. |
| `openapi.yaml`, `schemas/event-body.json` | The `appVersion` backend-compat prose and the `if`/`then` `$comment` repeating it. The `appVersion: null` ⇒ `originHint` required rule itself is unchanged — it is a wire rule, not a backend workaround. |
| `conformance/wire-protocol/fixtures.json` | The `wire-10` note instructing the SDK to emit that warning. |
| `conformance/runner/coverage-map.json` | The `manual` entry that tracked the warning as an unautomated SHOULD. |
| `conformance/runner/example-harness/sdk.mjs` | The one-shot warning latch in the reference SDK. |

### Gateway coordinates and the per-event `appVersion` (SPEC.md §4.2.1, §7.3.6)

Prepared as 2.1.0, shipping here. This is the server-SDK half of Avo's multi-gate model: one
Inspector API key per *gateway* instead of one source per destination, with each observation
labeled by which gateway output it was bound for (`outputReference`; absent = gateway checkpoint)
and which source it came from (`originHint`; low-cardinality, never a user identifier).

- The three coordinates are `outputReference`, `originHint` and `originAppVersion`, trailing and
  optional, or an overload where appending a parameter would change an existing method's compiled
  signature.
- **The call-site shape is decided by the target language, and both shapes are conformant.** A
  language with named or keyword arguments (Python, Ruby, Kotlin, Swift, C#, …) takes the three as
  top-level optional parameters on the track method, where an IDE surfaces the names at the call
  site. A language without them (JavaScript/TypeScript, Go, Java, …) groups them in one optional
  options object, because positional parameters would force callers to pass placeholders to reach
  the last one. The wire body is byte-identical either way, so no fixture, JSON Schema, OpenAPI
  property or wire assertion distinguishes them, and a generated SDK MUST NOT be judged
  non-conformant for using the shape its own language calls for. The reference harness and example
  SDK here are JavaScript, so the examples in this repository show the object shape — that is one
  conformant shape, not the required one.
- `outputReference` / `originHint` are top-level siblings of `eventProperties`, never inside the
  schema. Each value is trimmed; absent / `null` / empty / whitespace-only (and, in dynamically-typed
  languages, non-string) values are treated as absent and the key is **omitted** — never sent as
  `null` or `""`.
- **The option is named `originAppVersion`; the wire field is still `appVersion`.** Next to
  `originHint` nothing said whose version the option carried, and the whole reason it exists is
  that the event came from a different source than the app this instance was configured for:
  `originHint` says which source, `originAppVersion` says that source's version. The rename is
  scoped to the call-site option. The top-level `appVersion` **wire** field keeps its name — it is
  not gateway-specific, it has carried the constructor `version` on ordinary events since 1.0.0,
  and renaming it would be a breaking change to a general-purpose field for no gain. So:
  **`options.originAppVersion` sets the event's `appVersion` on the wire.**
- Wire `appVersion` (always present) follows a four-cell rule: `options.originAppVersion` when
  provided; a literal JSON `null` when `originHint` is set and no usable `options.originAppVersion`
  was given (the event is source-scoped, so the instance's configured version never applies);
  otherwise the constructor `version`.
- The options are per call; two calls for the same event with different `outputReference` values
  are two observations and are both sent (no deduplication).
- A call that supplies none of the three adds no keys: the body is exactly what this release
  defines without them. That is **not** the 2.0.0 body — 3.0.0 also moves the endpoint and removes
  `sessionId`, so the comparison that held while these coordinates were a 2.1.0 minor no longer
  does.

### Removed: `sessionId` on the wire (SPEC.md §3.3, §7.3.1, §8.2)

**`sessionId` is no longer part of the request body.** 2.0.0 had made it REQUIRED with the constant
value `""`; 3.0.0 removes it from the base body, the JSON Schema, the OpenAPI document, and every
fixture. `streamId` — already present, already OPTIONAL, already caller-supplied — is the field
that carries correlation between events. A server SDK has no session to report, so it was padding a
constant into every event to satisfy a parser.

**Why it was ever required, so nobody reinstates it.** 2.0.0 added it after empirical bisection:
the ingestion pipeline silently DROPPED events whose body omitted `sessionId`, answering
`200 {"success":true}` while the event never reached the dashboard. Adding `sessionId: ""` was
found to be necessary and sufficient for delivery. That is a parser requirement, not a modeling
one, and it now belongs where it always should have — the endpoint supplies the value, and senders
stop carrying it.

> **Sequencing — this one can lose data.** Both ingestion parsers still REQUIRE the field as of
> 2026-09-04. The v1 fast path guards on its presence and drops the event; the public parser used
> by v2 decodes it as a required field, which throws and discards the event when it is absent.
> Both answer `200`. **A sender that drops `sessionId` before ingestion accepts its absence loses
> every event, silently** — the exact failure that made the field required in the first place. The
> ingestion change that defaults it is in flight and **MUST** ship first. Confirming that it has is
> a release gate: it belongs to whoever owns the backend change, and nothing in this repository can
> verify it. Until it is confirmed, a sender already running in production should keep sending
> `sessionId: ""`. This release deliberately does **not** add the field to the forbidden list, so a
> body that still carries it validates as an unknown extra field and passes conformance — that
> tolerance is what makes the spec safe to land ahead of the backend. SPEC.md §7.1 carries the same
> warning as a dated note, to be removed when the ingestion change ships.

### Changed

| Artifact | Change |
|---|---|
| `SPEC.md` §7.1 | Endpoint is `/inspector/v2/track`; the v1 backend-compatibility note is replaced by a description of what v2 is (decodes the gateway fields, tolerates `appVersion: null`, does not sample); the mock-endpoint override explicitly replaces the URL only. |
| `SPEC.md` §7.2 | Request-header table gains `api-key`, `env` and `X-Avo-Client` as REQUIRED with a Presence column; new normative prose for authentication-by-header, the exact `400` rejection behavior, and the `X-Avo-Client` = `libPlatform` rule; the `Content-Type` callout now also forbids `text/plain` on v2. |
| `SPEC.md` §5, §7.3.1 | `apiKey` / `env` are documented as header-carried (body copies retained but ignored); `libPlatform` MUST equal `X-Avo-Client`. |
| `SPEC.md` §7.3.6 | The SHOULD-warn rule is replaced by a positive statement that a `null` `appVersion` is accepted and recorded as `unversioned`. |
| `SPEC.md` §7.4 | Both `200` shapes (`success: true` / `success: false`) and the `400` error shape; a `200` without `samplingRate` leaves the rate unchanged. |
| `SPEC.md` §7.7 | New bullet: v2 does not sample server-side; the SDK's own sampling obligations are unchanged. |
| `SPEC.md` §7.2 | New normative requirement: **no header value may contain CR (`U+000D`), LF (`U+000A`) or NUL (`U+0000`)**. Those characters delimit header fields, so a value carrying one can append attacker-chosen headers or split the request. `apiKey` is the only caller-supplied value that reaches a header (`env` is one of three literals, `X-Avo-Client` a compiled-in constant), so it is where the check belongs. The SDK MUST perform the check itself rather than rely on the HTTP client, whose behavior varies by runtime, and MUST fail the send — dropping the batch and logging per §7.5 — rather than strip, escape or substitute the characters, since silently rewriting an API key sends a *different* key than the caller configured. **This class of bug is created by this release:** before the v2 move the key travelled only inside the JSON body, where the encoder escapes control characters and request framing is unaffected. |
| `SPEC.md` §4.1 | The constructor MUST also throw on an `apiKey` containing CR / LF / NUL, with a new exact error message. Deliberately redundant with the §7.2 send-time check: the §7.2 rule is the guard that protects the wire, but on its own it turns a configuration mistake into an application that starts cleanly and silently delivers nothing. `version` is not control-character checked — it travels in the JSON body. |
| `SPEC.md` §7.2 | New normative paragraph for `Content-Length`: the value MUST be the length of the body **actually sent** (compressed length when gzipped, never the uncompressed JSON length), the requirement is unconditional because §7.3.5 already obliges the SDK to measure the serialized body to decide on compression, and an SDK MUST NOT switch to chunked transfer-encoding to avoid supplying it. |
| `SPEC.md` §4.2.1, §7.3.6, §12.7 | Gateway `options`: semantics, normalization, wire mapping, the four-cell `appVersion` table, per-event options inside a batch. |
| `AGENTS.md` | Endpoint in section 1; new required-headers checklist item covering all five §7.2 REQUIRED headers including `Content-Length`; AC-8 becomes "Wire endpoint, HTTPS, and required headers"; AC-26 / AC-27 for the gateway options (27 ACs). |
| `openapi.yaml` (3.0.0) | Path `/inspector/v2/track`; `ApiKeyHeader` security scheme (`api-key`, in header) replacing `security: []` and the "auth is in the body" prose; REQUIRED `env` and `X-Avo-Client` header parameters; `400` documented as the missing/invalid-header response with an `{ok,error}` example; both `200` shapes as examples; `TrackResponse` gains `success` and no longer requires `samplingRate` (the drop shape omits it); `ErrorResponse` gains `ok` (pinned `const: false`, so a generated validator rejects a success-marked error body) and stays permissive for the unspecified `429` / `500` bodies; the `400` gets its own strict `BadRequestResponse` schema requiring both `ok` and `error`, because §7.2 / §7.4 specify that body exactly and the permissive schema accepted `{}`. The `401` response is **removed**: v2 answers a missing, empty or otherwise unacceptable `api-key` header with `400`, so documenting `401` for the same cause contradicted the `400` block above it and SPEC.md §7.2 / §7.4. |
| `schemas/event-body.json`, `schemas/event-batch.json` | v2 in the titles/descriptions; `apiKey` / `env` noted as header-carried; the OPTIONAL `outputReference` / `originHint` and nullable `appVersion` (with the `appVersion: null` ⇒ `originHint` rule) unchanged from the 2.1.0 draft, minus the v1 caveats. |
| `conformance/runner-contract.md` (1.1.0) | `AVO_INSPECTOR_MOCK_ENDPOINT` points at v2 and replaces the URL only; new normative "Required request headers" section (asserted on every captured request); placeholders are accepted as `expected_request_headers` values; recorded-headers example and the implementation checklist updated. `expected_request_headers` is documented as available in **every** fixture mode rather than only the wire-protocol suite, and the sequence-mode assertion table now lists it — `batch-1` is a sequence fixture that uses it, so the field could not stay documented as wire-protocol-only. The Versioning section now separates the two halves of the 1.1.0 additions: the placeholder and header assertions are runner-side and need no harness edit, but `options` (`input.options` / `step.options`) is a new input-envelope field that a `1.0.0` harness must forward or it cannot pass `wire-9` – `wire-13` and `batch-7`. The previous blanket "an existing harness needs no edit" contradicted the document's own implementation checklist. |
| `conformance/runner/suite-runner.mjs` | **Each harness process now has a wall-clock budget** (60 s; `AVO_CONFORMANCE_HARNESS_TIMEOUT_MS` overrides). A harness that has not exited is terminated and its fixture fails with `harness timed out`. The mock records a request only when the request stream ends, so an SDK that sends a `Content-Length` larger than its body previously hung the entire run instead of failing one fixture. Asserts all five SPEC.md §7.2 REQUIRED headers on every captured request: non-empty `api-key`, valid `env`, non-empty `x-avo-client`, and a `content-type` whose media type is exactly `application/json` (which rejects the `text/plain` browser-SDK workaround §7.2 forbids on v2). The first three must also equal the `apiKey` / `env` / `libPlatform` of every event in the same request, so a well-formed header set describing a *different* instance than the body does now fails. Those three comparisons are unconditional rather than type-guarded, so an event **missing** one of the fields fails too — otherwise a count-only fixture (`batch-6`) could certify a body that violates §7.3.1. `content-length` is asserted for presence and integer shape; its *value* is left to HTTP framing, which already enforces it (the server reads exactly `Content-Length` bytes, so a too-large value stalls the request and a too-small one truncates the body). Placeholder values in `expected_request_headers` are supported. |
| `conformance/wire-protocol/fixtures.json` | `wire-1` gains `expected_request_headers` pinning `api-key: "test-key"`, `env: "dev"` and `x-avo-client: "<sdk-platform>"`. `wire-9` – `wire-13` cover the gateway options (all-set, `originHint` without `appVersion` → `null`, override without `originHint`, whitespace-only → omitted + fallback, property-name collision). |
| `conformance/batching/fixtures.json` | `batch-1` pins the same headers with `env: "staging"`, so a hardcoded `env` fails either it or `wire-1`. `batch-7` covers per-event `options` inside one batch. |
| `conformance/runner/example-harness/{sdk,harness}.mjs` | The reference SDK posts to v2 and sends all five §7.2 REQUIRED headers on every request — `api-key`, `env`, `X-Avo-Client`, `Content-Type: application/json` and `Content-Length` (set from the payload actually sent, so a gzipped body carries the compressed length) — including when the body is gzipped and when the mock endpoint overrides the URL; it implements §4.2.1 / §7.3.6, reads the renamed `options.originAppVersion`, and no longer sends `sessionId`. `npm run conformance:run` is green at 36/36. |
| `SPEC.md` §3.3, §7.3.1, §8.2 | `sessionId` removed from the base body example, the Base Body Fields table and the identifier rules. §3.3 is retitled and now leads with `streamId` as the only correlation identifier a server SDK sends; the "omitted fields" note covers `trackingId` / `visitorId` / `userId` and explains that the endpoint supplies `sessionId`. |
| `SPEC.md` §7.1 | New dated ingestion note, in the same shape as the v1 gateway-field note this release removed: both parsers still require `sessionId` today, a sender that drops it early loses every event at `200`, and the note is removed when the ingestion change ships. |
| `SPEC.md` §4.2, §4.2.1 | §4.2 shows both call-site shapes; §4.2.1 states the language criterion, that both shapes are conformant, and that this repository's JavaScript examples are one conformant shape rather than the required one. The option is renamed `originAppVersion` throughout, with the wire mapping stated where a reader meets it. |
| `AGENTS.md` | `sessionId` removed from the required-field checklist and AC-9 and moved to a "not part of the wire body" note carrying the sequencing warning. AC-26/AC-27 and the gateway checklist items take the renamed option. |
| `openapi.yaml`, `schemas/event-body.json` | `sessionId` removed from `required`, from `properties`, and from both request-body examples. It is deliberately **not** added to the forbidden `not.anyOf`, so a sender still emitting it during the ingestion transition validates as an unknown extra field; both documents say so. Description strings take the renamed option; no property name, required entry or validation keyword changes for the rename. |
| `conformance/**/fixtures.json` | The 26 expected event objects that carried `"sessionId": ""` no longer do. The `options` key in `wire-9` / `wire-11` / `batch-7` carries `originAppVersion`. |
| `conformance/runner-contract.md` | Passing the options follows the SDK's own call-site shape: the object as the fourth argument for a grouped SDK, each key as its matching top-level parameter for a flattened one. The envelope key stays `options` in both cases. |
| `conformance/runner/coverage-map.json`, `conformance/**/README.md` | Spec version 3.0.0; new automated coverage entry for the required headers; fixture counts (36 total) and the gateway/`<absent>` entries. |

### Fixed

Pre-existing artifact defects found while preparing this release. None of them changes the 3.0.0
wire contract; each corrected an artifact that contradicted SPEC.md.

| Artifact | Fix |
|---|---|
| `conformance/batching/README.md` | The manual matrix instructed SDK authors to **re-queue** a batch after a transient network error or timeout, and labelled it SHOULD. SPEC.md §12.5 requires the opposite: on any send failure the batch MUST NOT be re-queued and its events are dropped, because the backend does not deduplicate on `messageId` and a retry would double-count. The parent `conformance/README.md` already stated this correctly. |
| `openapi.yaml`, `schemas/event-body.json` | The `outputReference` / `originHint` pattern was `^\S(.*\S)?$`, which rejects internal line terminators because ECMA-262 `.` does not match them. §7.3.6 normalization is trim-only and preserves internal whitespace, so the schemas rejected output a conformant SDK would send. Now `^(?!\s)(?![\s\S]*\s$)[\s\S]+$`, which mirrors trim-only exactly. |
| `conformance/runner-contract.md` | The document header still declared `Version: 1.0.0` while its own Versioning section declared the contract at 1.1.0. |
| `conformance/wire-protocol/fixtures.json` | The `wire-6` / `wire-7` notes cited the gzip rule as SPEC.md §7.3.7; it is §7.3.5. |
| `SPEC.md` §7.3.1, §12.5 | Two sentences said "in v1" / "the deliberate v1 contract" meaning *spec* v1, which now reads as the v1 ingestion path. Both are stated without a version. |
| `conformance/wire-protocol/README.md` | The batching-coverage note called the manual transient-failure item "transient re-queue" and classified it SHOULD-level. SPEC.md §12.5 makes it a MUST *not* to re-queue, and the manual matrix in `conformance/README.md`, `conformance/batching/README.md` and `coverage-map.json` all already said so. The note now names it the transient send-failure drop and labels the two manual items MUST-level and SHOULD-level respectively. |

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
