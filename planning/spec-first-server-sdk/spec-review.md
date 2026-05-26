# Spec Review: spec-first-server-sdk

**Reviewer:** Morticia (Spec QA)
**Spec:** planning/spec-first-server-sdk/spec.md
**Revision:** 4/5
**Date:** 2026-05-25

## Engineering Preferences Applied
- DRY: flagged aggressively
- Testing: non-negotiable, more > fewer
- Engineering level: "enough" — not fragile, not over-abstracted
- Edge cases: err on more, not fewer
- Style: explicit over clever

---

## Rev 3 Issue Resolution Summary

Before scoring, a tally of all six Rev 3 issues (2 Important + 4 Minor):

| Rev 3 Issue | Status |
|---|---|
| Issue 1 (Important): `precondition` missing from harness stdin envelope | RESOLVED — `precondition` added as optional field to input envelope with full semantics including suite-runner→harness communication chain |
| Issue 2 (Minor): `trackSchemaFromEvent` step 1 described incomplete dedup key | RESOLVED — step 1 now forward-references the complete key formula in the Deduplication section |
| Issue 3 (Important): Wire Fixture 1 `expected_request_body` missing `messageId`/`createdAt`/`libVersion` placeholders | RESOLVED — all three placeholder values added (`"<uuid-v4>"`, `"<iso8601>"`, `"<semver+spec>"`); Format Validation section updated with presence requirement |
| Issue 4 (Minor): AC 19 destroy()-reuse untestable by single-invocation harness | RESOLVED — explicit "manually verified" note added to AC 19 with justification |
| Issue 5 (Minor): Fixture 4b numbered anomalously | RESOLVED — renumbered as Fixture 13; moved to golden fixtures section; AC 16 and AGENTS.md checklist updated to reference 13 fixtures |
| Issue 6 (Minor): No dedup fixture format example | RESOLVED — dedup fixture format note with example JSON added to Deduplication Behavior section |

Rev 4 is a clean, thorough revision. All six Rev 3 issues are closed. The spec is now materially complete. The remaining gaps below are narrow and do not block AI agent SDK generation.

---

## Stage 1: Architecture Review — 23/25

### Issue 1: Dedup multi-step fixture protocol has no instance-sharing mechanism
**Severity:** Minor
**Location:** Deduplication Behavior → Deduplication fixture format (lines 1079–1090)

**Problem:** The dedup fixture format note states: "For cross-bucket suppression scenarios (e.g., `_avoFunctionTrackSchemaFromEvent` followed by `trackSchemaFromEvent`), two sequential fixtures share the same SDK instance state — the suite runner MUST invoke them in order and assert that only one total HTTP call was made across both."

The harness protocol is single-invocation: one line of JSON in, one line out, then exit. Each harness invocation creates a fresh SDK instance. There is no mechanism — no session ID field, no persistent process mode, no shared-state protocol — for two sequential fixtures to share the same SDK instance. The "suite runner MUST invoke them in order" requirement is specified but unimplementable with the current harness protocol.

This is less critical than the previous destroy() AC 19 issue (which was made manually-verified) because dedup is SHOULD/OPTIONAL throughout. An AI agent ignoring the multi-step dedup scenario entirely will still produce a conformant SDK. However, a conscientious AI agent implementing dedup will read this requirement and have no way to satisfy it via the harness.

**Recommendation:** Mirror the AC 19 treatment: add a note that cross-bucket dedup conformance fixtures require manual testing or a stateful harness extension, and that the current suite runner protocol only supports single-operation fixtures. The behavioral requirement is correct and normative; the conformance suite limitation should be made explicit.

---

## Stage 2: Completeness & Quality Review — 23/25

### Issue 2: Wire Fixture 3 notes contradict `expected_resolve_value`
**Severity:** Minor
**Location:** Wire-Protocol Conformance Fixtures → Wire Fixture 3 (lines 331–343)

**Problem:** Wire Fixture 3 sets `"expected_resolve_value": []` (expecting `[]` as the resolved value) but its `notes` field states: "The promise value may be `[]` or the extracted schema depending on timing."

The "or the extracted schema" clause is ambiguous. `extractSchema({})` for an empty `eventProperties` always returns `[]` synchronously. There is no timing dependency. The `trackSchemaFromEvent` call for an empty event should deterministically resolve to `[]`. An AI agent implementing the harness must compare the actual resolved value to `expected_resolve_value` — the fixture says `[]`, which is correct. But the notes introduce unnecessary doubt, creating a risk that an implementor treats the field as advisory rather than normative.

**Recommendation:** Simplify the notes: "SDK MUST resolve (not reject) on non-200. Resolved value is `[]` (empty event properties yield empty schema)." Remove the "or the extracted schema" clause.

---

## Stage 3: Test & Edge Case Review — 23/25

### Issue 3: `removeDuplicates` reference-identity semantics unimplemented in non-JS languages
**Severity:** Minor
**Location:** Schema Extraction Algorithm → `function removeDuplicates` pseudocode; Fixture 9

**Problem:** The `removeDuplicates` pseudocode states: "For non-primitive types, deduplicate by reference identity." In JavaScript, two distinct array literals (`["a", "list"]` and `[1, 2]`) have different object identities and will not be deduplicated. Fixture 9 relies on this — its `children` array contains two separate sub-arrays that must NOT be deduplicated.

In many target languages, array equality is value-based: Go (`reflect.DeepEqual` on slices), Python (list `==`), Ruby (array `==`). An implementation in these languages using a `seen` set will deduplicate `["string"]`-type children arrays that happen to have equal values, producing wrong output for Fixture 9. The spec gives no concrete cross-language guidance for implementing reference-identity deduplication.

This is a narrow but real hallucination risk: a Python AI agent that writes `if child not in seen` will value-compare arrays and deduplicate incorrectly. Fixture 9 will catch this failure — but the spec does not tell the agent how to fix it.

**Recommendation:** Add a guidance note after `removeDuplicates`: "In languages where arrays/lists are compared by value (Python, Go, Ruby), use an object-identity approach: assign a unique ID to each complex object at creation time, or track seen objects by `id()`/`object_id`/pointer, not by value equality. Value-equality deduplication MUST NOT be used for non-primitive elements."

---

### Issue 4: No conformance fixture for `_avoFunctionTrackSchemaFromEvent` (codegen path wire body)
**Severity:** Minor
**Location:** Wire-Protocol Conformance Fixtures; `_avoFunctionTrackSchemaFromEvent` Public API Surface

**Problem:** The `operation` field in the harness input envelope includes `"_avoFunctionTrackSchemaFromEvent"` but no conformance fixture shows what the wire body looks like when this operation fires. Specifically, the codegen wire body has `"avoFunction": true`, non-null `"eventId"`, non-null `"eventHash"` — but no fixture validates this.

An AI agent implementing `_avoFunctionTrackSchemaFromEvent` has no golden example of the correct wire body for this path. It must infer from the prose description. Since the method is marked as optional (MAY implement), this is low-risk — but the wire format difference (`avoFunction: true`, `eventId`, `eventHash`) is observable and testable.

**Recommendation:** Add a Wire Fixture 4 showing `_avoFunctionTrackSchemaFromEvent` call with non-null `eventId` and `eventHash`, asserting `"avoFunction": true` in the wire body. Mark it as OPTIONAL (matching the optional status of the method). This would complete the fixture coverage of all `operation` enum values.

---

## Stage 4: Performance & Feasibility Review — 24/25

### Carry-forward: flush()/request timeout simultaneous-fire (specification-compliant)
**Severity:** Minor (unchanged from Rev 3)
**Location:** `flush()` → default `timeoutMs`; HTTP Wire Protocol → Timeout

No new performance issues. The spec's `flush()` semantics are now unambiguous ("completion guarantee, not delivery guarantee"). The race between the request timeout and flush timeout is a low-level implementation concern that the spec handles correctly at the semantic level.

---

## Strengths

- **All six Rev 3 issues fully addressed.** The two Important issues (precondition in stdin envelope; Wire Fixture 1 placeholder fields) are cleanly resolved. All four Minor issues are closed.
- **Wire Fixture 1 is now a complete, self-documenting wire body.** All four format-validated fields (`libVersion`, `messageId`, `createdAt`, `libPlatform`) use placeholder values that signal format-validation intent without reading the notes field. The fixture can be consumed mechanically.
- **Precondition channel is now unambiguous.** The suite runner reads the `precondition` field from the fixture and includes it verbatim in the stdin envelope. The harness applies it before invoking the operation. Wire Fixture 2 (sampling drop) is now fully operable via the harness protocol.
- **AC 19 destroy()-reuse** is now honestly scoped — the "manually verified" annotation is the right engineering call. The behavioral requirement is correct and normative; the conformance limitation is transparent.
- **Fixture numbering** (1–13, sequential, all in the same section) is clean. No anomalous fixtures. AGENTS.md checklist updated.
- **Dedup fixture format note** (lines 1079–1090) with example JSON is a substantial improvement for AI agents implementing dedup. The example anchor prevents format fragmentation.
- **trackSchemaFromEvent step 1** forward-reference to the Dedup section's complete key formula eliminates the incomplete-key risk for agents reading only the method semantics.

---

## Summary

| Stage | Score | Top Issue |
|-------|-------|-----------|
| Architecture | 23/25 | Dedup multi-step fixture requires shared SDK instance state with no protocol mechanism |
| Completeness & Quality | 23/25 | Wire Fixture 3 notes introduce unnecessary timing ambiguity for the resolved value |
| Test & Edge Cases | 23/25 | `removeDuplicates` reference-identity semantics unspecified for non-JS languages |
| Performance & Feasibility | 24/25 | flush()/timeout race (implementation concern, spec-compliant) |
| **Total** | **93/100** | |

**Verdict:** PASS
**Critical issues:** 0
**Important issues:** 0
**Minor issues:** 4 (Issues 1–4 above)

## Recommendation

This spec PASSES at 93/100. All Rev 3 Important issues are resolved; no new Important issues were found. The four Minor issues above are improvement opportunities but do not block AI agent SDK generation:

1. **Dedup multi-step shared-state** (Issue 1) — add a "manually verified" note mirroring AC 19's treatment. Low effort.
2. **Wire Fixture 3 notes ambiguity** (Issue 2) — simplify the notes to remove the "or the extracted schema" hedge. Trivial.
3. **`removeDuplicates` value-vs-reference equality** (Issue 3) — add a cross-language implementation note for Python/Go/Ruby. Medium value, low effort.
4. **No `_avoFunctionTrackSchemaFromEvent` wire fixture** (Issue 4) — add Wire Fixture 4 marked OPTIONAL. Medium value, medium effort.

These may be addressed in a patch revision or deferred to spec v1.1.0. The spec is ready for AI agent consumption at its current quality level.
