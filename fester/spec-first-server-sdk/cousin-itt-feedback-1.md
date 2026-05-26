# Cousin Itt Iteration 1 — Feedback to Address

Scores: arch 81, sec 74, code 76, ux 78 → avg 77.25 (need ≥85).

Address ALL Critical + High issues below. Make minimal, surgical changes — do NOT rewrite documents from scratch.

## CRITICAL (must fix)

### C1. SPEC.md non-200 resolve-value ambiguity (Architect)
SPEC.md §4.2 step 4 says the promise "resolves to the extracted schema array"; §7.5 says non-200 resolves with `[]`. These conflict when eventProperties is non-empty AND response is non-200.

**Fix:** In SPEC.md §4.2 step 4, add an explicit cross-reference: "On non-200 HTTP response, the promise still resolves but with `[]` (see §7.5 / error taxonomy)." The fixture data (error-2: non-empty props + 400 → `[]`) is the source of truth. Make AGENTS.md AC-3 / Wire Protocol checklist match.

### C2. fixture-3 (0.0 vs 0) JSON parser ambiguity (Architect)
Most JSON parsers (Go encoding/json, Java Jackson default, JavaScript JSON.parse) cannot distinguish `0` and `0.0` from stdin JSON. SPEC.md §9.3.1 acknowledges this for JS only.

**Fix:** In SPEC.md §9.3.1 (and conformance/schema-extraction/README.md), add a "Parser configuration requirements" subsection. State explicitly:
- Languages with a dedicated decimal/float JSON token (Python json with parse_float, custom Go json.Number, Java with USE_BIG_DECIMAL_FOR_FLOATS) MUST use a parser configuration that preserves the literal-source `int` vs `float` distinction.
- For SDKs whose runtime language has a single numeric type (JavaScript), use `Number.isInteger()` per existing JS guidance.
- For SDKs whose host language treats `0` and `0.0` as the same JSON token by default, the conformance harness MUST configure the JSON parser to preserve the distinction (e.g., `decoder.UseNumber()` in Go, `DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS` in Jackson, etc.).
- Provide a small per-language hint table.

## HIGH (must fix)

### H1. conformance/README.md is stale (all reviewers)
Currently lists only schema-extraction/. Missing: wire-protocol/, deduplication/, error-handling/, runner-contract.md. Points runner-contract location to SPEC.md instead of conformance/runner-contract.md.

**Fix:** Rewrite conformance/README.md to:
- List all 4 suites with one-line descriptions and links
- Link to conformance/runner-contract.md as THE normative harness contract
- Remove or correct the "runner contract is in SPEC.md" sentence

### H2. AGENTS.md Section 2 reading order incomplete (Architect, UX)
Section 2 lists 7 items but omits conformance/error-handling/fixtures.json and conformance/deduplication/fixtures.json. Section 4 expects those suites to pass.

**Fix:** Append both files to Section 2 reading list (after wire-protocol/fixtures.json).

### H3. AGENTS.md AC-19 (destroy) not in Section 3 checklist (UX)
AC-19 exists in Section 5 (Definition of Done) but has no `- [ ]` checklist item in Section 3.

**Fix:** Add a binary checklist item to Section 3 under a "Lifecycle" or appropriate subsection:
`- [ ] destroy() is implemented and after destroy() trackSchemaFromEvent() is a no-op (returns Promise.resolve([])).`

### H4. AGENTS.md confusing field list with MUST NOT (Code Reviewer)
Section 3 Wire Protocol checklist starts "The event object MUST contain all of these fields" and then includes `sessionId (omit — MUST NOT be sent), trackingId (omit — MUST NOT be sent)` in the same comma-list. A skim reader treats them as required.

**Fix:** Split into two paragraphs/lists:
- "Required fields (MUST be in every wire body)": enumerate the 16 actually-required fields
- "Forbidden fields (MUST NOT appear in any wire body)": sessionId, trackingId
Do not mix them.

### H5. AGENTS.md split version error message (UX)
Lines 53–54: the version constructor validation error message is split across two backtick-quoted lines. Should be a single line so AI agents copy it as one string.

**Fix:** Join the message into a single backtick-quoted code span on one line. Use a long line if needed; the markdownlint config already permits long lines in code spans.

### H6. SPEC.md §11.8 broken reference to "Section 12" of runner-contract.md (Architect)
runner-contract.md uses named section headers, not numbers.

**Fix:** Replace "Section 12 of conformance/runner-contract.md" with the correct named section reference (likely the "Conformance Reporting" or "Implementation checklist" section). Or remove the section-number reference and just link to the file.

### H7. Wire fixture notes reference nonexistent "Edge Case 9/10" (Code Reviewer)
wire-4 and wire-5 notes reference "spec Edge Case 9" / "Edge Case 10". SPEC.md has no numbered edge-case list.

**Fix:** Update wire-4 and wire-5 notes to reference the actual SPEC.md section number (e.g., "see SPEC.md §X.Y on streamId handling"). Pick the correct SPEC.md section.

### H8. Security: AVO_INSPECTOR_MOCK_ENDPOINT prod guard (Security)
No requirement that this env var be ignored in production builds. SDKs may silently honor it and downgrade HTTPS to HTTP.

**Fix:** In SPEC.md (wire-protocol section near AVO_INSPECTOR_MOCK_ENDPOINT docs) AND in conformance/runner-contract.md (AVO_INSPECTOR_MOCK_ENDPOINT section), add a MUST-level requirement:
- "SDKs MUST gate AVO_INSPECTOR_MOCK_ENDPOINT behind a test-only build flag, debug build, or environment-restriction check. Production builds MUST NOT honor this variable."

### H9. Security: missing "MUST NOT log apiKey" (Security)
SPEC.md error handling says errors are logged with the error object appended — could leak apiKey if request body is in the error.

**Fix:** Add a MUST NOT requirement in SPEC.md (Logging section or Security Considerations): "SDKs MUST NOT log the apiKey value, the encryption private key, or full request bodies containing the apiKey. Error logs MUST redact these fields if present."

### H10. Security: missing TLS validation requirement (Security)
§7.1 says "HTTPS only" but doesn't say "MUST NOT disable cert validation".

**Fix:** In SPEC.md §7.1, add: "SDKs MUST use the host platform's default TLS certificate validation. SDKs MUST NOT provide any configuration option to disable certificate validation."

### H11. Security: precondition.samplingRate test hook backdoor (Security)
runner-contract.md says the harness applies `samplingRate` via "internal setter, test hook, or direct field assignment". This means SDKs may ship a public setter that lets callers force samplingRate=0 and disable telemetry.

**Fix:** In conformance/runner-contract.md (precondition section), add: "The internal setter / test hook used by the harness MUST be test-only (compiled out of production builds, package-private, marked `@internal`, or otherwise not exposed in the SDK's documented public API)."

## MEDIUM (fix opportunistically — do not block on these)
- M1. AGENTS.md UUID regex omits /i flag vs SPEC.md (cosmetic; spec says lowercase hex anyway)
- M2. Go-specific time format hint in wire-protocol/README.md — generalize to per-language guidance or move to AGENTS.md
- M3. publicEncryptionKey field description inconsistency between base-body.json and event-body.json (sync)
- M4. fester/ and planning/ markdown not excluded from project markdownlint config (add `ignores:` to .markdownlint-cli2.yaml so global lints pass)

## Files You Will Touch
- SPEC.md (C1, C2, H6, H8, H9, H10)
- AGENTS.md (H2, H3, H4, H5)
- conformance/README.md (H1)
- conformance/runner-contract.md (H8, H11)
- conformance/schema-extraction/README.md (C2 cross-ref)
- conformance/wire-protocol/fixtures.json (H7)
- .markdownlint-cli2.yaml (M4, optional)
- base-body.json / event-body.json (M3, optional)

## Workflow
1. Address Critical (C1, C2) first
2. Then High (H1–H11)
3. Then Medium if time permits
4. Run `npx markdownlint-cli2 SPEC.md AGENTS.md README.md CHANGELOG.md VERSIONING.md "conformance/**/*.md"` after edits
5. Run `python3 -m json.tool` on any JSON files you touch
6. Do NOT commit — orchestrator handles commits
