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

## [1.0.0] - 2026-05-25 `[WIRE]`

Initial publication of the `avohq/spec-first-inspector-server-sdk` spec.

All content in this release is wire-protocol normative. Downstream SDKs
generated from v1.0.0 need not regenerate until a `[WIRE]`-tagged release
appears.

### Normative Deliverables Shipped

| Artifact | Description |
|---|---|
| `SPEC.md` | Full normative prose specification (RFC 2119 language, 15 sections) |
| `AGENTS.md` | AI-agent SDK generation guide: checklist, reading order, conformance, definition of done (19 ACs) |
| `openapi.yaml` | OpenAPI 3.1 document for the Inspector HTTP API |
| `schemas/base-body.json` | JSON Schema: base request body fields |
| `schemas/event-batch.json` | JSON Schema: top-level request array |
| `schemas/event-body.json` | JSON Schema: plain event body |
| `schemas/event-body-encrypted.json` | JSON Schema: encrypted event body |
| `schemas/event-property-plain.json` | JSON Schema: plain property object |
| `schemas/event-property-encrypted.json` | JSON Schema: encrypted property object |
| `schemas/schema-entry.json` | JSON Schema: schema extraction entry |
| `conformance/schema-extraction/fixtures.json` | 13 golden schema-extraction fixtures |
| `conformance/wire-protocol/fixtures.json` | 7 wire-protocol golden fixtures (wire-1 through wire-7) |
| `conformance/error-handling/fixtures.json` | 3 error-handling fixtures (network timeout, network error, non-200) |
| `conformance/runner-contract.md` | Normative stdin/stdout harness protocol |

### Wire-Protocol Normative Content

- **Endpoint:** `POST https://api.avo.app/inspector/v1/track`
- **Request body schema:** JSON array of event objects; required fields:
  `apiKey`, `appName`, `appVersion`, `libVersion`, `env`, `libPlatform`,
  `messageId`, `anonymousId`, `createdAt`, `samplingRate`, `type`,
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
- **`destroy()` contract:** resets `pendingCount` to 0, clears keepalive timer
- **gzip request compression (mandatory when feasible):** On any gzip-capable
  runtime, SDKs MUST gzip-compress (RFC 1952) request bodies whose serialized
  UTF-8 byte length is `>= 1024`, sending `Content-Encoding: gzip` with the
  compressed `Content-Length`. `Content-Type` stays `application/json` (the
  browser SDK uses `text/plain` to avoid a CORS preflight; server SDKs are not
  subject to CORS). Uncompressed fallback is permitted ONLY for sub-threshold
  bodies, a runtime with no gzip implementation, or a compression error — not by
  choice; a no-gzip runtime MUST document the limitation. Ported from the JS Inspector SDK
  ([avohq/js-avo-inspector#212](https://github.com/avohq/js-avo-inspector/pull/212)),
  adapted for server-side runtimes. See SPEC.md §7.2 and §7.3.7; conformance
  fixtures `wire-6` (large body, gzip transparent) and `wire-7` (small body MUST
  be uncompressed), asserted via the new `expected_request_headers` field.

### Runtime Lifecycle Requirements

- **`flush()` requirement:** Non-Node.js SDKs MUST implement `flush()`. Node.js SDKs
  use a 60-second keepalive timer instead; non-Node.js runtimes MUST NOT use the
  keepalive-timer approach (it causes hangs) — they MUST expose `flush()` and
  document it as required before process or function-handler exit. Default timeout:
  10,000 ms. `flush()` MUST resolve (not reject) in all cases. See SPEC.md §4.6 and §12.

### Spec Design Intents

- **`0.0` → `"float"` (design intent):** The `getBasicPropType` classification
  MUST return `"float"` for a float-zero value (`0.0`). In statically-typed
  languages (Go, Java, Rust, C#), the declared type is authoritative: `float64(0.0)`
  → `"float"`. In JavaScript, `0.0` and `0` are runtime-identical; the spec
  intentionally requires `"float"` here. This is a forward-looking requirement for
  generated SDKs in languages where `0.0` and `0` are genuinely distinct types.
  See SPEC.md §9.3.1.

### Optional Features

- **Encryption:** opt-in; ECIES P-256; applies in dev/staging only.
