# PRD: spec-first-server-sdk

**Status:** Draft — Rev 2 (Thing Rev 1 fixes)
**Feature Name:** spec-first-server-sdk
**Branch:** fester/spec-first-server-sdk
**Base Branch:** main
**Created:** 2026-05-25
**Spec:** planning/spec-first-server-sdk/spec.md
**Review:** planning/spec-first-server-sdk/spec-review.md

---

## Overview

This PRD delivers the content of the `avohq/spec-first-inspector-server-sdk` public repository — Avo's first "AI-native open source" artifact. The repo is a single canonical specification plus a conformance suite that lets AI coding agents (or engineers) generate conformant Inspector SDKs in any server-side language without Avo staff involvement.

The repo is greenfield: only a `LICENSE` file exists. Every file must be created. Delivery is pure documentation and data artifacts (Markdown, YAML, JSON). There is no application code to build or test in the traditional sense; quality checks are linting/validation of JSON and YAML files.

---

## Dependency Graph

```
Story 1 (Repo skeleton + README + LICENSE)
  └─ Story 2 (SPEC.md — normative prose)
       ├─ Story 3 (openapi.yaml + schemas/)
       ├─ Story 4 (conformance/schema-extraction/fixtures.json)
       └─ Story 5 (conformance/wire-protocol/fixtures.json)
            ├─ Story 6 (conformance/deduplication + error-handling fixtures)
            └─ Story 7 (conformance/runner-contract.md + conformance/README.md)
                 └─ Story 8 (AGENTS.md)
                      └─ Story 9 (CHANGELOG.md + VERSIONING.md)
```

---

## Stories

---

### Story 1 — Repo Skeleton: README.md, AGENTS.md stub, and top-level structure

**Priority:** critical
**Depends on:** none
**Estimated files:** 4

**Description:**
Create the top-level repo layout established in the spec. The repo already has `LICENSE`. This story creates `README.md` (human-oriented overview: what the repo is, how to generate an SDK, quick-start steps), `CHANGELOG.md` (initial v1.0.0 entry), and `VERSIONING.md` (semver policy). `AGENTS.md` at this stage is a stub with a placeholder; it gets fully written in Story 8 after the spec and conformance are complete.

**Approach:**
- Create `README.md` with: problem statement, what the repo contains, 3-step quick start ("clone → read AGENTS.md → generate"), links to SPEC.md and conformance/.
- Create `CHANGELOG.md` with a single v1.0.0 entry tagged `[WIRE]` — initial spec publication.
- Create `VERSIONING.md` with the semver policy table (MAJOR/MINOR/PATCH definitions, downstream SDK regeneration rules, spec version declaration requirement).
- Create `AGENTS.md` as a stub with all required section headings (sections to be filled in Story 8).

**Acceptance Criteria:**
- [ ] `README.md` exists and contains: repo purpose, 3-step quick start, links to SPEC.md, AGENTS.md, and conformance/.
- [ ] `CHANGELOG.md` exists with a v1.0.0 `[WIRE]` entry.
- [ ] `VERSIONING.md` exists with MAJOR/MINOR/PATCH definitions and a note that downstream SDKs MUST declare the spec version they implement.
- [ ] `AGENTS.md` exists with all 5 required section headings (stub content acceptable at this stage).
- [ ] All Markdown files are valid (no broken link anchors, no unclosed fences).

**Quality Checks:**
- No build system in this repo; validate Markdown syntax with `npx markdownlint-cli2 README.md CHANGELOG.md VERSIONING.md AGENTS.md` (or equivalent linter if available).

---

### Story 2 — SPEC.md: Full Normative Prose Specification

**Priority:** critical
**Depends on:** Story 1
**Estimated files:** 1

**Description:**
Write the full normative `SPEC.md` file — the single most important artifact in the repo. This is the human-readable, RFC 2119-compliant contract that AI agents read to generate a conformant SDK. It consolidates all normative content from the feature spec into a self-contained document.

**Approach:**
Write `SPEC.md` covering all sections in this order:
1. **Problem statement and repo purpose** — one paragraph, linking to AGENTS.md.
2. **Source-of-truth strategy** — wire protocol is the source of truth; this spec describes how SDKs implement it.
3. **Server-side requirements** — thread/async safety, no persistent storage, no sessionId/visitorId, keepalive/flush requirement (RFC 2119 language throughout).
4. **Public API surface** — all methods with normative signatures: `constructor`, `trackSchemaFromEvent`, `extractSchema`, `enableLogging`, `destroy`, `flush`, `_avoFunctionTrackSchemaFromEvent`.
5. **Constructor options table** — types, required/optional, defaults, validation rules, exact error message strings for `apiKey` and `version` failures.
6. **Env enum** — exact wire values (`"dev"`, `"staging"`, `"prod"`), behavioral implications table (logging default, encryption active, event spec validation).
7. **HTTP wire protocol** — endpoint (`POST https://api.avo.app/inspector/v1/track`), headers, complete request body JSON schema, response schema, timeout (10 s), error taxonomy table (4 categories: SDK internal error, network timeout, network error, non-200 response — with promise outcomes, logging, retry), sampling behavior.
8. **ID generation format** — UUID v4 pattern, `messageId` uniqueness requirement, `streamId`/`anonymousId` passthrough rule.
9. **Schema extraction algorithm** — pseudocode for `extractSchema`/`mapping`/`getPropValueType`/`getBasicPropType`/`removeDuplicates`, key invariants, `children` applicability rule, recursion depth guidance.
10. **Schema extraction golden fixtures** — all 13 fixtures inline (same content as conformance/schema-extraction/fixtures.json, presented as readable blocks).
11. **Deduplication behavior** — marked OPTIONAL/SHOULD; two-bucket algorithm, 500 ms window, dedup key formula (`streamId + "\0" + eventName`), parameter matching via deep structural equality, cross-bucket suppression, same-bucket NOT suppressed, one-shot deletion. Note that cross-bucket dedup conformance requires manual testing (per spec review Issue 1).
12. **Encryption** — ECIES P-256, applicability rules (dev/staging only), wire format byte layout (version byte + 65-byte ephemeral pubkey + 16-byte IV + 16-byte auth tag + ciphertext), KDF (SHA-256 of raw ECDH X-coordinate), plaintext encoding, list-type omission, failure behavior.
13. **Keepalive timer and flush** — Node.js keepalive (60 s no-op setInterval, pendingCount gating), non-Node.js flush() requirement, serverless guidance.
14. **Open questions** — all 6 from the spec.
15. **Out of scope** — v1 exclusions.

Use RFC 2119 MUST/SHOULD/MAY language throughout. All edge cases from the spec MUST be covered.

**Acceptance Criteria:**
- [ ] `SPEC.md` exists and contains all 15 sections listed above.
- [ ] All normative requirements use RFC 2119 MUST/SHOULD/MAY language (no informal "should" or "must").
- [ ] Constructor validation table is present with exact error message strings for `apiKey` and `version`.
- [ ] Error taxonomy table is present with all 4 categories and correct promise outcomes (network timeout/error → `resolve(eventSchema)`; SDK internal error → `reject("Avo Inspector: something went wrong...")`; non-200 → `resolve([])`).
- [ ] Schema extraction algorithm pseudocode matches the 13 golden fixtures.
- [ ] `libVersion` wire format is specified as plain SemVer string (no `+spec` suffix per reverse-check finding).
- [ ] Dedup section notes that cross-bucket multi-step conformance requires manual testing.
- [ ] `flush()` section is prefixed with a note that it is a new requirement not present in the node reference SDK.
- [ ] `0.0` classification is documented: `"float"` in statically-typed languages; JS-specific guidance for `Number.isInteger` edge case.

**Quality Checks:**
- Validate Markdown: `npx markdownlint-cli2 SPEC.md`
- Word count > 3000 (spec is comprehensive by design; a thin SPEC.md is a failure).
- Section count: `grep -c "^##" SPEC.md | awk '{if($1 < 10) {print "FAIL: too few sections in SPEC.md (found " $1 ")"; exit 1} else print "OK: " $1 " sections"}'`
- Critical section presence:
  - `grep -q "MUST\|SHOULD\|MAY" SPEC.md || (echo "FAIL: No RFC 2119 language found" && exit 1)`
  - `grep -q "extractSchema\|trackSchemaFromEvent" SPEC.md || (echo "FAIL: API methods not found" && exit 1)`
  - `grep -q "ECIES\|encryption" SPEC.md || (echo "FAIL: Encryption section missing" && exit 1)`
  - `grep -q "500.*ms\|dedup" SPEC.md || (echo "FAIL: Dedup section missing" && exit 1)`

---

### Story 3 — openapi.yaml and schemas/ Directory

**Priority:** high
**Depends on:** Story 2
**Estimated files:** 8

**Description:**
Write the OpenAPI 3.1 document for the Inspector HTTP API and the 7 JSON Schema files under `schemas/`. These are the machine-readable contracts that AI agents use alongside the prose spec to generate wire-compatible serialization code.

**Approach:**

`openapi.yaml`:
- OpenAPI 3.1 document.
- Server: `https://api.avo.app`.
- Single path: `POST /inspector/v1/track`.
- Request body: `$ref: '#/components/schemas/EventBatch'`.
- Response 200: `$ref: '#/components/schemas/TrackResponse'`.
- Response 4xx/5xx: generic error description (SDK resolves, does not reject).
- Reference all schemas from `schemas/` using `$ref`.

`schemas/event-batch.json`:
- JSON Schema for the top-level request body (array of event objects).
- `items`: `$ref: event-body.json`.

`schemas/event-body.json`:
- JSON Schema for a single plain (non-encrypted) event object.
- All base fields as required: `apiKey`, `appName`, `appVersion`, `libVersion`, `env`, `libPlatform`, `messageId`, `anonymousId`, `createdAt`, `samplingRate`, `type`, `eventName`, `eventProperties`, `avoFunction`, `eventId`, `eventHash`.
- `env` enum: `["dev", "staging", "prod"]`.
- `type` const: `"event"`.
- `eventProperties` items: `$ref: event-property-plain.json`.
- `libVersion` pattern: `^\d+\.\d+\.\d+$` (plain SemVer, no suffix).
- `messageId` pattern: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
- `createdAt` format: `date-time`.

`schemas/event-body-encrypted.json`:
- Like `event-body.json` but `eventProperties` items: `$ref: event-property-encrypted.json`.

`schemas/base-body.json`:
- JSON Schema for fields common to all event types (extracted for reuse).

`schemas/event-property-plain.json`:
- JSON Schema for a plain property entry.
- `propertyName` string, `propertyType` enum of all valid types, optional `children` array.

`schemas/event-property-encrypted.json`:
- JSON Schema for an encrypted property entry.
- `propertyName` string, `propertyType` string, `encryptedPropertyValue` string (base64), optional `children`.

`schemas/schema-entry.json`:
- JSON Schema for a schema entry as returned by `extractSchema()`.
- `propertyName` string, `propertyType` string, optional `children`.

**Acceptance Criteria:**
- [ ] `openapi.yaml` is valid OpenAPI 3.1 (validate with `npx @redocly/cli lint openapi.yaml` or `npx swagger-cli validate openapi.yaml`).
- [ ] All 7 schema files exist under `schemas/`.
- [ ] All JSON Schema files are valid JSON Schema draft 2020-12 (validate with `npx ajv-cli validate` or equivalent).
- [ ] `env` enum in `event-body.json` contains exactly `["dev", "staging", "prod"]` — no other values.
- [ ] `libVersion` pattern in `event-body.json` matches plain SemVer (no `+spec` suffix).
- [ ] `eventProperties` in `event-body.json` references `event-property-plain.json`.
- [ ] `eventProperties` in `event-body-encrypted.json` references `event-property-encrypted.json`.

**Quality Checks:**
- `npx @redocly/cli lint openapi.yaml` (required)
- `for f in schemas/*.json; do python3 -m json.tool $f > /dev/null && echo "valid: $f" || echo "INVALID: $f"; done` — JSON syntax check for each schema file (required)
- `npx @hyperjump/json-schema validate --schema schemas/event-body.json` or equivalent `npx ajv-cli compile -s schemas/event-body.json` — validate JSON Schema draft 2020-12 compliance (required; `python3 -m json.tool` only checks JSON syntax, not schema validity)
- libVersion pattern assertion: `python3 -c "import json; s=json.load(open('schemas/event-body.json')); pat=s.get('properties',{}).get('libVersion',{}).get('pattern',''); assert pat==r'^\d+\.\d+\.\d+$', f'FAIL: libVersion pattern is {pat}'; print('OK: libVersion pattern matches plain SemVer')"` (required)

---

### Story 4 — conformance/schema-extraction/fixtures.json (Fixtures 1–13)

**Priority:** critical
**Depends on:** Story 2
**Estimated files:** 3

**Description:**
Write the schema extraction conformance fixtures. These are the 13 golden input/output pairs that any conformant SDK implementation must produce exactly. This is the most directly testable artifact in the repo.

**Approach:**

Create `conformance/schema-extraction/fixtures.json` with all 13 fixtures from the spec. Each fixture has the shape:
```json
{ "fixture_id": "fixture-N", "description": "...", "input": ..., "expected": [...] }
```

The 13 fixtures to implement (inputs and expected outputs taken verbatim from SPEC.md):
- fixture-1: Basic primitives (`true`, `1`, `"hello"`, `3.14`)
- fixture-2: Null and undefined (`null`)
- fixture-3: Empty and falsy values (`false`, `0`, `""`, `0.0`, `null`, `{}`, `[]`)
- fixture-4: Nested object (`{ user: { name, age } }`)
- fixture-5: Simple list of strings (`["a","b","c"]`)
- fixture-6: Empty array defaults to `list(string)`
- fixture-7: Heterogeneous array (type from first element)
- fixture-8: Null top-level input → `[]`
- fixture-9: Complex mixed-type array with nested structures
- fixture-10: List deduplication
- fixture-11: Object with a nested list property
- fixture-12: All property types in one event
- fixture-13: 3-level nesting (recursion conformance)

Create `conformance/schema-extraction/README.md` explaining: fixture format, how to run (using the harness protocol from runner-contract.md), what conformance means, OPTIONAL vs. required.

Create `conformance/README.md` explaining the conformance suite as a whole: suites available, what an SDK author must implement, how to run all suites, definition of "passing".

**Acceptance Criteria:**
- [ ] `conformance/schema-extraction/fixtures.json` contains exactly 13 fixtures with IDs `fixture-1` through `fixture-13`.
- [ ] Each fixture has `fixture_id`, `description`, `input`, and `expected` fields.
- [ ] fixture-3: `0.0` expected type is `"float"`, `{}` expected is `{ propertyType: "object", children: [] }`, `[]` expected is `{ propertyType: "list(string)", children: [] }`.
- [ ] fixture-7: `children` array is `["float", "string", [{"propertyName": "three", "propertyType": "int"}]]`.
- [ ] fixture-8: `input` is `null`, `expected` is `[]`.
- [ ] fixture-13: `input` is `{ "a": { "b": { "c": 42 } } }` with 3-level nested `children`.
- [ ] All fixture JSON is valid (parseable).
- [ ] `conformance/README.md` and `conformance/schema-extraction/README.md` exist.

**Quality Checks:**
- `python3 -m json.tool conformance/schema-extraction/fixtures.json > /dev/null && echo valid` (required)
- `python3 -c "import json; f=json.load(open('conformance/schema-extraction/fixtures.json')); assert len(f)==13, f'Expected 13 fixtures, got {len(f)}'; print('OK: 13 fixtures found')"` (required)
- Automated `0.0=float` check (critical — reverse-check confirmed node SDK produces `"int"` for `0.0` but the spec requires `"float"`): `python3 -c "import json; f=json.load(open('conformance/schema-extraction/fixtures.json')); f3=next(x for x in f if x['fixture_id']=='fixture-3'); d_prop=next(x for x in f3['expected'] if x['propertyName']=='d'); assert d_prop['propertyType']=='float', f'FAIL: 0.0 classified as {d_prop[\"propertyType\"]} not float'; print('OK: 0.0 correctly classified as float')"` (required)

> **Scope note:** `conformance/batching/` is explicitly OUT OF V1 SCOPE. Do NOT create any `conformance/batching/` directory or fixtures. Batching is marked OPTIONAL in the spec and deferred to v1.1.0.

---

### Story 5 — conformance/wire-protocol/fixtures.json (Fixtures wire-1 through wire-3)

**Priority:** high
**Depends on:** Story 2
**Estimated files:** 2

**Description:**
Write the wire-protocol conformance fixtures. These are the 5 required fixtures (wire-1 through wire-5) that verify the SDK sends correct HTTP requests, handles responses correctly, and correctly handles streamId edge cases (colon-containing and empty string). The mock server protocol requires a runner; fixtures define expected request bodies and response behaviors.

**Approach:**

Create `conformance/wire-protocol/fixtures.json` with 5 fixtures:

**wire-1** — Basic event send with correct wire body:
- `constructor`: `{ apiKey: "test-key", env: "dev", version: "1.0.0", appName: "TestApp" }`
- `operation`: `trackSchemaFromEvent`
- `input`: `{ eventName: "User Signed Up", eventProperties: { plan: "pro", seats: 3 }, streamId: "stream-abc" }`
- `mock_response`: `{ status: 200, body: { samplingRate: 1.0 } }`
- `expected_request_body`: array with one object containing all required wire body fields with placeholders for `libVersion` (`"<semver>"`), `messageId` (`"<uuid-v4>"`), `createdAt` (`"<iso8601>"`), `libPlatform` (`"<sdk-platform>"`).
- `expected_promise_outcome`: `"resolve"`

**wire-2** — Sampling drop (no HTTP call):
- `precondition`: `{ samplingRate: 0.0 }`
- No `mock_response` (null)
- `expected_request_count`: `0`
- `expected_promise_outcome`: `"resolve"`

**wire-3** — Non-200 response resolves:
- `mock_response`: `{ status: 500, body: {} }`
- `expected_promise_outcome`: `"resolve"`
- `expected_resolve_value`: `[]`
- Notes: simplified to "SDK MUST resolve (not reject) on non-200. Resolved value is [] (empty event properties yield empty schema)." (per spec review Issue 2 recommendation)

**wire-4** — `streamId` containing colon characters:
- `input`: `{ eventName: "Page Viewed", eventProperties: {}, streamId: "stream:with:colons" }`
- `mock_response`: `{ status: 200, body: { samplingRate: 1.0 } }`
- `expected_request_body`: includes `anonymousId: "stream:with:colons"` (verbatim passthrough — colon is preserved)
- `expected_promise_outcome`: `"resolve"`
- Notes: SDK MUST warn about colon-containing streamId per spec Edge Case 9, but MUST still send the event with the verbatim value.

**wire-5** — Empty string `streamId` treated as "no stream ID":
- `input`: `{ eventName: "Page Viewed", eventProperties: {}, streamId: "" }`
- `mock_response`: `{ status: 200, body: { samplingRate: 1.0 } }`
- `expected_request_body`: includes `anonymousId: ""` (empty string passthrough per spec Edge Case 10)
- `expected_promise_outcome`: `"resolve"`
- Notes: Empty streamId MUST be treated as "no stream ID"; anonymousId becomes "".

Create `conformance/wire-protocol/README.md` explaining: how the mock server works (`AVO_INSPECTOR_MOCK_ENDPOINT` env var), format validation for placeholder fields (UUID v4 regex, ISO 8601 regex, SemVer regex), how the suite runner compares actual vs. expected request bodies.

**Acceptance Criteria:**
- [ ] `conformance/wire-protocol/fixtures.json` contains fixtures `wire-1`, `wire-2`, `wire-3`, `wire-4`, `wire-5`.
- [ ] wire-1 `expected_request_body` contains `"<uuid-v4>"`, `"<iso8601>"`, `"<semver>"`, `"<sdk-platform>"` placeholders for the 4 format-validated fields.
- [ ] wire-1 `expected_request_body` includes `avoFunction: false`, `eventId: null`, `eventHash: null`.
- [ ] wire-2 has `expected_request_count: 0` and `mock_response: null`.
- [ ] wire-3 notes field does NOT contain the ambiguous "or the extracted schema" clause (per spec review Issue 2).
- [ ] wire-4 `expected_request_body` includes `anonymousId: "stream:with:colons"` (verbatim colon passthrough, spec Edge Case 9).
- [ ] wire-5 `expected_request_body` includes `anonymousId: ""` (empty string passthrough, spec Edge Case 10).
- [ ] `conformance/wire-protocol/README.md` documents the `AVO_INSPECTOR_MOCK_ENDPOINT` environment variable and format validation patterns with their regex strings.
- [ ] All JSON is valid.

**Quality Checks:**
- `python3 -m json.tool conformance/wire-protocol/fixtures.json > /dev/null && echo valid` (required)

---

### Story 6 — conformance/deduplication and conformance/error-handling Fixtures

**Priority:** medium
**Depends on:** Story 5
**Estimated files:** 4

**Description:**
Write the deduplication and error-handling conformance fixture files. Dedup fixtures are marked OPTIONAL (SHOULD). Error-handling fixtures include timeout, network error, and additional sampling-drop scenarios.

**Approach:**

`conformance/deduplication/fixtures.json`:
- `dedup-1`: Single `trackSchemaFromEvent` call — expect 1 HTTP call (baseline).
- `dedup-2`: Two `trackSchemaFromEvent` calls with the same event name and properties from the same stream (manual→manual same bucket) — expect 2 HTTP calls (same bucket NOT suppressed).
- Note in README: cross-bucket dedup (avo→manual suppression) requires a stateful harness that the single-invocation protocol cannot support; those scenarios MUST be tested manually by the SDK author.

`conformance/error-handling/fixtures.json`:
- `error-1`: `samplingRate` set to `1.0` (default) → 1 HTTP call expected (boundary: always send).
- `error-2`: Non-200 (400) response → `expected_promise_outcome: "resolve"` (resolves, does not reject).
- `error-3`: Event with empty `eventProperties` → `expected_resolve_value: []` (empty schema extraction).

`conformance/deduplication/README.md`: explain dedup is OPTIONAL/SHOULD; describe single-invocation limitation; instruct SDK authors to manually test cross-bucket suppression.

`conformance/error-handling/README.md`: explain error handling fixtures; reference error taxonomy table in SPEC.md.

**Acceptance Criteria:**
- [ ] `conformance/deduplication/fixtures.json` exists with at least 2 fixtures.
- [ ] `conformance/deduplication/README.md` explicitly states dedup conformance is OPTIONAL and notes the single-invocation limitation for cross-bucket scenarios.
- [ ] `conformance/error-handling/fixtures.json` exists with at least 3 fixtures.
- [ ] error-2 fixture has `expected_promise_outcome: "resolve"` (non-200 must not reject).
- [ ] All JSON files are valid.

**Quality Checks:**
- `python3 -m json.tool conformance/deduplication/fixtures.json > /dev/null && echo valid` (required)
- `python3 -m json.tool conformance/error-handling/fixtures.json > /dev/null && echo valid` (required)

---

### Story 7 — conformance/runner-contract.md (Normative Harness Protocol)

**Priority:** critical
**Depends on:** Story 5
**Estimated files:** 1

**Description:**
Write `conformance/runner-contract.md` — the normative harness protocol document. This is the document an SDK author reads to understand how to implement the `avo-inspector-conformance` CLI binary that the suite runner drives. No TBD sections are allowed; every field must be defined.

**Approach:**

Write `conformance/runner-contract.md` with these sections:

1. **Overview** — one paragraph; the harness is a thin CLI binary; the suite runner drives it once per fixture; no persistent state between invocations.

2. **Entry point** — Binary name: `avo-inspector-conformance` (language-idiomatic equivalents accepted: `bin/conformance`, `conformance.rb`, `conformance.py`). Invoked once per fixture.

3. **Invocation protocol** — `echo '<fixture-json>' | avo-inspector-conformance`. Reads one JSON line from stdin, executes operation, writes one JSON line to stdout, exits.

4. **Input envelope schema** (complete, no TBD):
   - `suite`: one of `"schema-extraction" | "wire-protocol" | "deduplication" | "error-handling"`
   - `fixture_id`: string
   - `constructor`: `{ apiKey, env, version, appName?, publicEncryptionKey? }`
   - `operation`: one of `"extractSchema" | "trackSchemaFromEvent" | "_avoFunctionTrackSchemaFromEvent"`
   - `input`: operation-specific object
   - `precondition` (optional): `{ samplingRate?: number }` — harness MUST apply before invoking operation

5. **Output envelope schema**:
   - `fixture_id`: string
   - `passed`: boolean
   - `actual`: raw output
   - `error`: null or error message string

6. **Exit codes**: `0` pass, `1` fail, `2` harness config error.

7. **Environment variables**: `AVO_INSPECTOR_MOCK_ENDPOINT` — when set, SDK MUST send HTTP calls to this URL instead of `https://api.avo.app`.

8. **Format validation patterns** — the 4 placeholder-to-regex mappings table (UUID v4, ISO 8601, SemVer, sdk-platform rules).

9. **Mock server protocol** — how the suite runner starts the mock server, how it passes the URL via env var, `GET /requests` endpoint, response body format.

10. **Implementation checklist** — 8-item binary pass/fail checklist for SDK authors implementing the harness.

**Acceptance Criteria:**
- [ ] `conformance/runner-contract.md` exists.
- [ ] All 10 sections above are present with no TBD placeholders.
- [ ] Input envelope schema documents all fields including `precondition`.
- [ ] Format validation patterns table includes all 4 rows with regex strings.
- [ ] `AVO_INSPECTOR_MOCK_ENDPOINT` is documented.
- [ ] Exit codes 0/1/2 are defined.
- [ ] No TBD sections anywhere in the file.

**Quality Checks:**
- `npx markdownlint-cli2 conformance/runner-contract.md` (required)
- `grep -i 'tbd\|to be defined\|todo' conformance/runner-contract.md && echo 'FAIL: TBD sections found' && exit 1 || echo 'OK: no TBD sections'` (required)
- Critical section presence check: `for section in "Entry point" "Invocation protocol" "Input envelope" "Output envelope" "Exit codes" "AVO_INSPECTOR_MOCK_ENDPOINT" "Format validation" "Mock server" "Implementation checklist"; do grep -q "$section" conformance/runner-contract.md || (echo "FAIL: Missing section: $section" && exit 1); done && echo "OK: all required sections present"` (required)

---

### Story 8 — AGENTS.md: Complete AI Agent SDK Generation Guide

**Priority:** critical
**Depends on:** Story 7 (requires runner-contract.md to be complete)
**Estimated files:** 1

**Description:**
Write the complete `AGENTS.md` — the primary entry point for an AI coding agent tasked with generating an Inspector SDK. This file is optimized for AI agent consumption: structured, explicit, no ambiguity. It must contain all 5 required sections defined in the spec.

**Approach:**

Replace the stub `AGENTS.md` from Story 1 with the complete version containing these 5 required sections:

**Section 1 — What to build:**
One paragraph: generate a `<language>` Inspector SDK class named `AvoInspector` (or language-idiomatic equivalent) that conforms to this spec. The SDK sends analytics event schemas to the Avo Inspector HTTP API. It is server-side only; no browser/client-side concerns.

**Section 2 — Files to read, in order:**
Ordered list with purpose for each file:
1. `AGENTS.md` (this file) — read first; contains the checklist and definition of done.
2. `SPEC.md` — the normative prose contract; read in full.
3. `openapi.yaml` — machine-readable HTTP API contract; use for wire format.
4. `schemas/` — JSON Schema definitions for request/response shapes.
5. `conformance/runner-contract.md` — how to implement the conformance harness.
6. `conformance/schema-extraction/fixtures.json` — 13 golden schema extraction fixtures.
7. `conformance/wire-protocol/fixtures.json` — wire protocol golden fixtures.
8. `conformance/error-handling/fixtures.json` — error handling fixtures.
9. `conformance/deduplication/fixtures.json` — optional dedup fixtures.

**Section 3 — SDK generation checklist (minimum 12 binary pass/fail items):**
- [ ] Constructor throws with exact message on missing/whitespace `apiKey`.
- [ ] Constructor throws with exact message on missing/whitespace `version`.
- [ ] Invalid/absent `env` falls back to `"dev"` with a console warning (does NOT throw).
- [ ] `extractSchema` returns `[]` for `null` input (does not throw).
- [ ] All 13 schema-extraction fixtures pass (fixture-1 through fixture-13).
- [ ] `trackSchemaFromEvent` POSTs to `https://api.avo.app/inspector/v1/track` (unless `AVO_INSPECTOR_MOCK_ENDPOINT` is set).
- [ ] Wire body includes all required fields: `apiKey`, `appName`, `appVersion`, `libVersion` (plain SemVer), `env`, `libPlatform`, `messageId` (UUID v4), `anonymousId`, `createdAt` (ISO 8601 UTC), `samplingRate`, `type`, `eventName`, `eventProperties`, `avoFunction`, `eventId`, `eventHash`.
- [ ] `libVersion` is a plain SemVer string (e.g., `"1.2.0"`) — no suffix.
- [ ] `enableLogging` is process-wide (changing it on one instance affects all instances).
- [ ] Non-200 HTTP responses resolve the promise (do not reject).
- [ ] Network timeout (10 s) is swallowed inside the send handler; `trackSchemaFromEvent` resolves with the extracted schema.
- [ ] `samplingRate = 0.0` precondition produces zero HTTP calls.
- [ ] `destroy()` resets `pendingCount` to 0 and clears the keepalive timer; a subsequent `trackSchemaFromEvent` call succeeds.
- [ ] Non-Node SDKs: `flush()` is implemented, resolves (not rejects), and is documented in the SDK README as required before process/function exit.

**Section 4 — How to run conformance:**
Exact invocation: `echo '<fixture-json>' | avo-inspector-conformance`. Link to `conformance/runner-contract.md` for harness implementation details. Note that `AVO_INSPECTOR_MOCK_ENDPOINT` must be set for wire-protocol fixtures.

**Section 5 — Definition of done:**
All 19 acceptance criteria in `SPEC.md` pass. All non-OPTIONAL conformance fixtures pass. SDK README documents `flush()`/`destroy()` shutdown requirement. `libVersion` constant is in a dedicated version file and the README instructs maintainers to update it on each release.

**Acceptance Criteria:**
- [ ] `AGENTS.md` contains all 5 required sections.
- [ ] Section 2 lists files in the correct reading order (AGENTS.md → SPEC.md → openapi.yaml → schemas/ → conformance/).
- [ ] Section 3 contains at least 12 binary pass/fail checklist items.
- [ ] Section 3 includes the `flush()` requirement for non-Node SDKs.
- [ ] Section 3 includes the `enableLogging` process-wide requirement.
- [ ] Section 4 contains the exact `echo '<fixture-json>' | avo-inspector-conformance` invocation string.
- [ ] Section 5 references all 19 acceptance criteria in SPEC.md.
- [ ] No ambiguous language ("should", "might", "probably") — only MUST/SHOULD/MAY (RFC 2119) or concrete imperatives.

**Quality Checks:**
- `npx markdownlint-cli2 AGENTS.md` (required)
- `grep -c '\[ \]' AGENTS.md | awk '{if($1 < 12) {print "FAIL: too few checklist items in AGENTS.md (found " $1 ")"; exit 1} else print "OK: " $1 " checklist items"}'` — verify Section 3 has at least 12 binary checklist items (required)

---

### Story 9 — CHANGELOG.md and VERSIONING.md Final Pass

**Priority:** low
**Depends on:** Story 8
**Estimated files:** 2

**Description:**
Write the final versions of `CHANGELOG.md` and `VERSIONING.md`. Story 1 creates stubs; this story rewrites them with complete content now that the full spec scope is known.

**Approach:**

`CHANGELOG.md`:
- Header explaining the changelog format and the `[WIRE]`/`[SPEC]` tagging convention.
- `## [1.0.0] - 2026-05-25` entry tagged `[WIRE]` (initial publication — all content is wire protocol).
- List all sections of the spec that are wire-protocol normative (endpoint, request body, response, schema extraction algorithm, env enum values, error behavior).
- Note: downstream SDKs generating from v1.0.0 need not regenerate until a `[WIRE]`-tagged release appears.

`VERSIONING.md`:
- Complete semver policy:
  - **MAJOR**: breaking wire-protocol change (new required request field, changed endpoint, changed type contract). Downstream SDKs MUST regenerate.
  - **MINOR**: additive wire-protocol change or new optional feature. Downstream SDKs SHOULD regenerate to gain the feature.
  - **PATCH**: clarification, typo fix, new conformance fixture for existing behavior. Downstream SDKs MAY ignore.
- How generated SDKs declare the spec version they implement (README badge, package metadata, etc.).
- CHANGELOG tag convention: `[WIRE]` = SDK regeneration needed; `[SPEC]` = documentation update only.

**Acceptance Criteria:**
- [ ] `CHANGELOG.md` has a complete v1.0.0 entry tagged `[WIRE]`.
- [ ] `CHANGELOG.md` header explains the `[WIRE]`/`[SPEC]` distinction.
- [ ] `VERSIONING.md` defines MAJOR/MINOR/PATCH with downstream SDK regeneration requirements.
- [ ] `VERSIONING.md` explains how generated SDKs should declare the spec version.
- [ ] Both files are valid Markdown.

**Quality Checks:**
- `npx markdownlint-cli2 CHANGELOG.md VERSIONING.md` (required)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| fixture-3 `0.0` classified as `"int"` (matches node SDK behavior, contradicts spec) | High | High | Explicitly note in Story 4 AC and schema-extraction README that `0.0` must be `"float"` per spec design intent, even though node SDK produces `"int"`. This is a known spec deviation from the reference implementation. |
| Wire Fixture 3 notes ambiguity ("or the extracted schema") | Medium | Low | Story 5 AC explicitly requires removing this hedge (per spec review Issue 2). |
| `removeDuplicates` cross-language value-vs-reference equality | Medium | Medium | Add cross-language guidance note in SPEC.md schema extraction section (per spec review Issue 3 recommendation). |
| Missing `_avoFunctionTrackSchemaFromEvent` wire fixture | Low | Low | Optional method; no fixture required for minimal conformance. A Wire Fixture 4 can be added in a v1.1.0 patch. |
| Dedup multi-step shared-state limitation | Low | Low | Note in deduplication README and SPEC.md that cross-bucket dedup conformance requires manual testing (per spec review Issue 1). |

---

## File Layout After All Stories Complete

```
avohq/spec-first-inspector-server-sdk/
├── README.md                              (Story 1)
├── AGENTS.md                              (Story 1 stub → Story 8 complete)
├── SPEC.md                                (Story 2)
├── CHANGELOG.md                           (Story 1 stub → Story 9 complete)
├── VERSIONING.md                          (Story 1 stub → Story 9 complete)
├── LICENSE                                (already exists)
├── openapi.yaml                           (Story 3)
├── schemas/
│   ├── event-batch.json                   (Story 3)
│   ├── event-body.json                    (Story 3)
│   ├── event-body-encrypted.json          (Story 3)
│   ├── base-body.json                     (Story 3)
│   ├── event-property-plain.json          (Story 3)
│   ├── event-property-encrypted.json      (Story 3)
│   └── schema-entry.json                  (Story 3)
└── conformance/
    ├── README.md                          (Story 4)
    ├── runner-contract.md                 (Story 7)
    ├── schema-extraction/
    │   ├── README.md                      (Story 4)
    │   └── fixtures.json                  (Story 4)
    ├── wire-protocol/
    │   ├── README.md                      (Story 5)
    │   └── fixtures.json                  (Story 5)
    ├── deduplication/
    │   ├── README.md                      (Story 6)
    │   └── fixtures.json                  (Story 6)
    └── error-handling/
        ├── README.md                      (Story 6)
        └── fixtures.json                  (Story 6)
```

Total: ~25 files created across 9 stories.

---

## Revision History

| Rev | Date | Author | Changes |
|-----|------|--------|---------|
| 1 | 2026-05-25 | Pugsley | Initial PRD — 9 stories, 18 maxIterations |
| 2 | 2026-05-25 | Pugsley (Thing Rev 1 fixes) | Fixed Story 1 estimatedFiles (3→4); fixed dependency graph (Story 5→6 branch made explicit); increased maxIterations 18→27; added Story 2 grep-based section completeness checks (Issues 5, 10); added Story 3 JSON Schema draft 2020-12 validation and libVersion pattern check (Issues 9, 14); added Story 4 automated `0.0=float` Python assertion and `conformance/batching/` out-of-scope note (Issues 11, 18); expanded Story 5 to 5 fixtures adding wire-4 (streamId with colon) and wire-5 (empty streamId) for spec Edge Cases 9–10 coverage (Issue 13); added Story 7 section presence grep checks (Issue 17); added Story 8 checklist count quality check (Issue 6) |
