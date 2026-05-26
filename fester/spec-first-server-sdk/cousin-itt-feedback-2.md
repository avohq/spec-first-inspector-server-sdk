# Cousin Itt Iteration 2 — Feedback to Address

Scores: arch 91, sec 88, code 72, ux 88 → avg 84.75 (need ≥85). Code reviewer dropped due to one unresolved structural issue plus a few unfixed mediums. Focus: close the runner-contract / fixture format mismatch so the spec is self-consistent.

## HIGH (must fix)

### H1. Runner-contract input envelope vs. fixture file format mismatch (Code Reviewer, iter-1 + iter-2)
**Problem:** `conformance/runner-contract.md` declares `suite`, `constructor`, and `operation` as REQUIRED in the input envelope. None of the 23 fixtures across the 4 fixture files contain `suite`. The 13 schema-extraction fixtures additionally lack `constructor` and `operation`. The runner-contract has no normative explanation for this.

**Fix (in conformance/runner-contract.md):** Update the "Input envelope" section to:
1. Document that `suite` is INJECTED by the suite runner from the parent directory name (e.g., `conformance/schema-extraction/fixtures.json` → `suite: "schema-extraction"`). Make this normative: "Suite runners MUST inject `suite` from the parent directory name before passing input to the harness."
2. Mark `constructor` and `operation` as REQUIRED only for the wire-protocol, error-handling, and deduplication suites. Add a sentence: "The `schema-extraction` suite has no constructor or operation — its input is a single property bag and the harness MUST treat the entire `input` field as the eventProperties argument to extractSchema()." Or alternatively: mark `constructor` and `operation` as "Required: YES — except for schema-extraction suite where they are absent."
3. Update the Required column of the input envelope table to reflect this.

DO NOT add `suite`/`constructor`/`operation` to the fixture files — that's the wrong direction. The fixture files are the source of truth; the runner-contract should describe how the suite runner constructs the envelope.

## MEDIUM (fix opportunistically)

### M1. Go-only time format hint in language-agnostic wire-protocol/README.md (Architect, UX, Code Reviewer)
The line `"Go implementations MUST use time.Now().UTC().Format('2006-01-02T15:04:05.000Z')"` appears in the format-validation table. Either:
- Move it into a separate per-language hints subsection that includes equivalents for Python (datetime.isoformat with timespec='milliseconds'), Ruby (strftime), Java (DateTimeFormatter.ISO_OFFSET_DATE_TIME with millis), etc.
- Or simply remove the Go-only line (the regex is the normative requirement; pick-your-language guidance is implementation detail).

Recommended: remove the Go-only line. Keep only the regex as the normative requirement.

### M2. publicEncryptionKey description divergence (Architect, Code Reviewer)
- `schemas/base-body.json` has the full description: "P-256 public key in hex (compressed 66 chars or uncompressed 130 chars)"
- `schemas/event-body.json` still has the short version: "P-256 public key in hex."

**Fix:** Update `schemas/event-body.json` to use the same long description as `schemas/base-body.json`. Verify both schemas remain valid draft 2020-12.

### M3. enableLogging cross-instance production hazard (Security)
SPEC.md §4.4 documents the process-wide flag but doesn't warn that calling `enableLogging(true)` in a dev-mode instance in a shared process (monorepo, test helpers, serverless warm container) silently enables logging for production instances too.

**Fix:** In SPEC.md §4.4 (after the existing process-wide explanation), add: "Callers MUST NOT call enableLogging(true) in production contexts. Because the flag is process-wide, enabling logging in a shared process affects all Inspector instances, including those operating in production environments."

## Workflow
1. Address H1 (the main score-mover).
2. Address M1, M2, M3 (cheap, push remaining reviewers higher).
3. Run `npx markdownlint-cli2 SPEC.md AGENTS.md README.md CHANGELOG.md VERSIONING.md "conformance/**/*.md" "schemas/**/*.md"` — must pass.
4. Run `python3 -m json.tool` on any JSON files touched.
5. Validate event-body.json with ajv (draft 2020-12) after M2 edit.
6. Do NOT commit — orchestrator handles commits.
