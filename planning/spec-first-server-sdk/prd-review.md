# PRD Review: spec-first-server-sdk

**Reviewer:** Thing (PRD QA)
**PRD:** planning/spec-first-server-sdk/prd.md
**Spec:** planning/spec-first-server-sdk/spec.md
**Revision:** 2/5
**Date:** 2026-05-26

## Engineering Preferences Applied
- DRY: flagged aggressively
- Testing: non-negotiable, more > fewer
- Engineering level: "enough" — not fragile, not over-abstracted
- Edge cases: err on more, not fewer
- Style: explicit over clever

---

## Rev 1 Issue Resolution Summary

Before scoring, a tally of all Rev 1 issues addressed in this revision:

| Rev 1 Issue | Status |
|---|---|
| Issue 1 (Important): Story 1 `estimatedFiles` mismatch (JSON=4, MD=3) | RESOLVED — prd.md now shows "Estimated files: 4" |
| Issue 2 (Minor): Dep graph missing Story 5→6 branch | RESOLVED — graph now shows both branches from Story 5 |
| Issue 5/10 (Critical): SPEC.md completeness not verified programmatically | RESOLVED — added `grep -c "^##" >= 10` section-count check and 4 critical-section grep assertions |
| Issue 6 (Minor): AGENTS.md checklist count not verified | RESOLVED — added `grep -c '\[ \]' >= 12` quality check |
| Issue 9 (Important): JSON Schema validation only checked JSON syntax | RESOLVED — added `npx ajv-cli compile` quality check |
| Issue 11 (Important): `0.0=float` check was manual-only | RESOLVED — added Python assertion as required quality check |
| Issue 13 (Important): streamId edge cases 9 and 10 had no conformance coverage | RESOLVED — Story 5 expanded to 5 fixtures (wire-1 through wire-5) with wire-4 and wire-5 covering Edge Cases 9 and 10 |
| Issue 14 (Minor): libVersion pattern not programmatically checked | RESOLVED — added Python assertion for libVersion pattern in event-body.json |
| Issue 15 (Important): `maxIterations: 18` at minimum, zero buffer | RESOLVED — increased to 27 (3×) |
| Issue 17 (Important): runner-contract.md section presence not verified | RESOLVED — added `grep -q` checks for all 9 critical section keywords |
| Issues 3, 7, 8, 12, 16, 18 (Minor): Various minor issues | All correctly assessed as do-nothing or already correct |

Rev 2 is a clean, thorough revision. All Critical and Important Rev 1 issues are closed. The remaining gaps below are narrow.

---

## Structural Validation

- [x] Valid JSON (parseable)
- [x] All required fields present (`featureName`, `branchName`, `baseBranch`, `createdAt`, `specPath`, `reviewPath`, `maxIterations`, `stories`)
- [x] Every story has all required fields (`id`, `title`, `description`, `approach`, `acceptanceCriteria`, `priority`, `dependsOn`, `estimatedFiles`, `qualityChecks`, `status`, `testPattern`)
- [x] All story IDs are unique (`story-1` through `story-9`)
- [x] All `dependsOn` references point to existing story IDs
- [x] No circular dependencies (walk confirmed: 1→2→{3,4,5}→{5→{6,7}}→7→8→9)
- [x] All `approach` values are `"general-purpose"` — acceptable, no `.claude/agents/` directory exists
- [x] All `priority` values are valid (`critical`, `high`, `medium`, `low`)
- [x] All `status` values are `"pending"`
- [x] `maxIterations` = 27, stories = 9; 27 >= 2×9 = 18 — PASSES with 3× buffer
- [x] `branchName` = `"fester/spec-first-server-sdk"` — follows convention

**Structural validation: PASS**

---

## Stage 1: Architecture Review — 22/25

### Issue 1: dedup-2 fixture specifies two operations but the harness protocol is single-invocation
**Severity:** Important
**Location:** story-6 description; `conformance/deduplication/fixtures.json` approach; spec Conformance Runner Contract
**Problem:** Story 6 defines `dedup-2` as: "Two `trackSchemaFromEvent` calls with the same event name and properties from the same stream (manual→manual same bucket) — expect 2 HTTP calls (same bucket NOT suppressed)." The harness protocol (specified in Story 7 and the spec's Conformance Runner Contract section) is single-invocation: one JSON line in, one JSON line out, exit. The harness input envelope has exactly one `operation` field and one `input` field — there is no `operations` array or multi-step mechanism. `dedup-2` as specified requires two SDK calls per fixture invocation, which the protocol cannot support. An AI agent implementing the conformance harness and reading `dedup-2` will have no defined way to execute it.

The parallel issue for cross-bucket dedup is correctly acknowledged (both in prd.md and Story 6's README AC) but same-bucket non-suppression (`dedup-2`) is treated as if it is testable via single invocation — it is not.

| Option | Effort | Risk | Impact | Maintenance |
|--------|--------|------|--------|-------------|
| A) Redefine `dedup-2` as single-call baseline (one call → 1 HTTP call, verifies no premature suppression) and add a README note that multi-call same-bucket scenarios require manual testing or a stateful harness extension | Low | Low | Removes the unimplementable fixture spec; dedup-1 and dedup-2 become complementary single-call fixtures | Low |
| B) Define an `operations` array field in the harness input envelope to support multi-step fixtures (requires updating Story 7 runner-contract.md as well) | High | Medium | Enables dedup-2 and future multi-step fixtures; significant protocol change | High |
| C) Do nothing | None | Medium | Agent authors will implement a fixture they cannot execute, causing confusion and wasted effort | — |

**Recommendation:** Option A — redefine `dedup-2` as a single-operation fixture (e.g., one `trackSchemaFromEvent` call for a unique event+stream → expect 1 HTTP call) and add a README note mirroring the cross-bucket treatment: "Multi-call same-bucket non-suppression (sending the same event twice and verifying both sends are NOT deduplicated) requires a stateful harness or manual testing." This is consistent with how cross-bucket dedup is handled and avoids a protocol redesign.

---

### Issue 2: Story 9 dependency on Story 8 forces sequential execution for low-value content — not blocking, but topology could enable parallelism
**Severity:** Minor
**Location:** story-9 `dependsOn: ["story-8"]`
**Problem:** This issue was assessed as "do nothing" in Rev 1 and remains minor. Story 9 rewrites CHANGELOG.md and VERSIONING.md — content that does not depend on AGENTS.md or runner-contract.md. The dependency exists to have "full spec scope known" but no content from Story 8 influences CHANGELOG or VERSIONING content. This is not a blocking issue; Story 9 is `priority: low` and will run last regardless. Carrying forward for documentation purposes only.

**Recommendation:** Do nothing — unchanged from Rev 1 assessment. Story 9 runs last by priority; the dependency is defensible.

---

## Stage 2: Story Quality Review — 22/25

### Issue 3: `removeDuplicates` cross-language guidance is in the risk table but enforced by no story acceptance criterion
**Severity:** Important
**Location:** Risk Assessment table (`removeDuplicates cross-language value-vs-reference equality`); story-2 `acceptanceCriteria`; spec Morticia Issue 3
**Problem:** The risk table correctly identifies that Morticia Issue 3 (cross-language reference-identity semantics for `removeDuplicates`) requires "Add cross-language guidance note in SPEC.md schema extraction section (per spec review Issue 3 recommendation)." However, no story acceptance criterion requires this. Story 2's 9 ACs list the 9 specific binary checks for SPEC.md content — none of them include the `removeDuplicates` cross-language guidance. The risk mitigation is stated but unenforced.

In autonomous execution, Fester runs quality checks, not prose ACs. Since the quality checks for Story 2 are `markdownlint`, `wc -w`, `grep -c "^##"`, and 4 critical-section grep checks (none of which test for `removeDuplicates` guidance), an agent can produce a SPEC.md that passes all quality checks while omitting the guidance. Fixture 9 will catch implementations that get it wrong, but the spec will not have told the agent how to fix it — exactly the risk Morticia identified.

| Option | Effort | Risk | Impact | Maintenance |
|--------|--------|------|--------|-------------|
| A) Add an AC to story-2: "`removeDuplicates` section includes cross-language guidance: in Python/Go/Ruby, use `id()`/`object_id`/pointer identity, not value equality, for non-primitive elements" | Trivial | Low | Closes the spec→story enforcement gap; the risk table mitigation becomes a binding AC | Low |
| B) Add a quality check: `grep -q "reference identity\|id().*object_id\|by reference" SPEC.md || (echo "FAIL: removeDuplicates cross-language guidance missing" && exit 1)` | Low | Low | Programmatic enforcement of the guidance | Low |
| C) Do nothing — accept that an agent missing this will fail Fixture 9 and be told to fix it | None | Low | Fixture 9 catches the failure; the agent must infer the fix from the fixture | — |

**Recommendation:** Option A — add the AC to story-2. This is a one-line addition that closes the gap between the risk table mitigation and actual enforced AC. The fix from Morticia's Issue 3 is known and specific: "use `id()`/`object_id`/pointer identity for non-primitive elements." Making it an AC means an autonomous agent has a concrete, verifiable target.

---

### Issue 4: Story 5 wire-4 and wire-5 content is not programmatically verified — only JSON syntax
**Severity:** Important
**Location:** story-5 `qualityChecks`; wire-4 AC; wire-5 AC
**Problem:** The only quality check for Story 5 is `python3 -m json.tool conformance/wire-protocol/fixtures.json > /dev/null && echo valid`. This validates JSON syntax but nothing more. Wire-4 and wire-5 are the new fixtures added in Rev 2 to address the highest-risk edge cases (colon-containing streamId and empty streamId). Their acceptance criteria are prose-only: "wire-4 `expected_request_body` includes `anonymousId: "stream:with:colons"`" and "wire-5 `expected_request_body` includes `anonymousId: ""`."

An autonomous agent could write wire-4 with `anonymousId: "stream-with-colons"` (hyphen, not colon) — the AC says colon, but the quality check only validates parseable JSON. The fixture would pass quality checks while being substantively wrong, and no future quality check in any downstream story would catch it.

| Option | Effort | Risk | Impact | Maintenance |
|--------|--------|------|--------|-------------|
| A) Add Python assertion quality checks for wire-4 and wire-5 `anonymousId` values (mirroring the `0.0=float` check pattern in Story 4) | Low | Low | Programmatic verification of the two highest-risk new fixtures | Low |
| B) Add an `npx ajv-cli validate` check against a fixture schema | Medium | Low | More general; catches structural deviations too | Medium |
| C) Do nothing — rely on prose ACs | None | Medium | The most likely failure mode (colon vs. hyphen in wire-4) is undetected by quality checks | — |

**Recommendation:** Option A — add these checks:
```bash
python3 -c "import json; f=json.load(open('conformance/wire-protocol/fixtures.json')); w4=next(x for x in f if x['fixture_id']=='wire-4'); body=w4['expected_request_body'][0]; assert body.get('anonymousId')=='stream:with:colons', f'FAIL: wire-4 anonymousId is {body.get(\"anonymousId\")}'; print('OK: wire-4 anonymousId has colon')"
python3 -c "import json; f=json.load(open('conformance/wire-protocol/fixtures.json')); w5=next(x for x in f if x['fixture_id']=='wire-5'); body=w5['expected_request_body'][0]; assert body.get('anonymousId')=='', f'FAIL: wire-5 anonymousId is {repr(body.get(\"anonymousId\"))}'; print('OK: wire-5 anonymousId is empty string')"
```
These directly mirror the Story 4 `0.0=float` assertion pattern and add meaningful coverage for the two new edge-case fixtures.

---

## Stage 3: Test & Acceptance Review — 21/25

### Issue 5: Story 3 `ajv-cli compile` quality check uses invalid multi-schema syntax
**Severity:** Important
**Location:** story-3 `qualityChecks[2]`; prd.json story-3
**Problem:** The quality check is:
```
npx ajv-cli compile -s schemas/event-body.json schemas/event-batch.json schemas/event-body-encrypted.json schemas/base-body.json schemas/event-property-plain.json schemas/event-property-encrypted.json schemas/schema-entry.json
```
The `ajv-cli compile` command accepts `-s <schema>` for one schema at a time. In `ajv-cli` v4/v5 (the npm package `ajv-cli`), passing multiple positional arguments after a schema name is not a recognized pattern — the extra arguments are treated as data files to validate against the first schema, not as additional schemas to compile. This means only `event-body.json` would be compiled/validated; the other 6 schemas would be passed as data (which would fail on their own schema structure, or be silently ignored depending on the CLI version). An agent could write syntactically invalid `$ref` paths in `event-property-plain.json` and the quality check would pass.

The fix is simple: use a loop (same pattern as the existing JSON syntax check) or use glob syntax if the installed CLI supports it.

| Option | Effort | Risk | Impact | Maintenance |
|--------|--------|------|--------|-------------|
| A) Replace with a `for` loop: `for f in schemas/*.json; do npx ajv-cli compile -s "$f" || exit 1; done` | Low | Low | Correctly compiles each schema file independently | Low |
| B) Use `npx ajv compile 'schemas/*.json'` if `ajv` (not `ajv-cli`) v8+ CLI is available | Low | Medium | Simpler but depends on `ajv` CLI being available (different package from `ajv-cli`) | Low |
| C) Do nothing — rely on the libVersion pattern assertion and OpenAPI linter to catch schema issues | None | High | 5 of 7 schema files get zero JSON Schema validation; invalid `$ref` paths pass undetected | — |

**Recommendation:** Option A — replace the multi-schema compile command with a `for` loop. This is a direct fix to a CLI syntax error that would silently under-validate 6 of 7 schema files. The `python3 -m json.tool` loop already uses this pattern for JSON syntax checks; the AJV loop follows the same idiom.

---

### Issue 6: Story 2 section-count quality check threshold (≥10) is lower than the required 15 sections
**Severity:** Minor
**Location:** story-2 `qualityChecks[2]`; story-2 acceptance criteria ("SPEC.md contains all 15 required sections")
**Problem:** The AC requires 15 sections. The quality check verifies `grep -c "^##" SPEC.md >= 10`. An agent that writes a 10-to-14 section SPEC.md passes the quality check while failing the "all 15 sections" AC. The 4 critical-section grep checks (`MUST/SHOULD/MAY`, `extractSchema`, `ECIES`, `500ms/dedup`) catch 4 critical topics but leave 11 others unchecked.

This is a narrowing of the gap from Rev 1 (where there was no section-count check at all), but the threshold mismatch remains.

| Option | Effort | Risk | Impact | Maintenance |
|--------|--------|------|--------|-------------|
| A) Raise the threshold to `>= 13` (conservative; accounts for different heading organization while being closer to 15) | Trivial | Low | Reduces the pass/fail gap | Low |
| B) Add 3-4 more targeted `grep -q` checks for the remaining critical sections not covered by the current 4 (e.g., constructor options table, ID generation, keepalive/flush) | Low | Low | More section coverage without requiring exact count | Low |
| C) Do nothing — the 4 content-specific grep checks catch the highest-impact omissions | None | Low | An agent can still produce a 10-section SPEC.md that passes | — |

**Recommendation:** Option B — add 2-3 additional `grep -q` checks for sections not covered by the current 4. Suggested additions: `grep -q "keepalive\|flush" SPEC.md` (keepalive section), `grep -q "apiKey\|constructor" SPEC.md` (constructor options table). Raising the `^##` count threshold alone is fragile because the agent might use `###` for sections instead of `##`. Content checks are more reliable than heading-count checks.

---

### Issue 7: No quality check verifies that `conformance/batching/` was NOT created
**Severity:** Minor
**Location:** story-4 AC: "conformance/batching/ directory MUST NOT be created"; story-4 quality checks
**Problem:** Story 4 (Rev 2) correctly adds an AC prohibiting `conformance/batching/` creation. However, no quality check enforces this — the quality checks only validate that `fixtures.json` parses and has 13 fixtures. An agent could create `conformance/batching/` as a side effect of reading the spec's proposed repo layout (which includes `conformance/batching/`), pass all quality checks, and the exclusion AC would be violated silently.

| Option | Effort | Risk | Impact | Maintenance |
|--------|--------|------|--------|-------------|
| A) Add a quality check: `[ ! -d conformance/batching ] && echo "OK: batching/ not created" \|\| (echo "FAIL: conformance/batching/ must not exist in v1"; exit 1)` | Trivial | Low | Programmatically enforces the out-of-scope exclusion | Low |
| B) Keep as prose-only AC — well-scoped agents follow story instructions | None | Low | Low risk; agents that read the story description are unlikely to stray | — |
| C) Do nothing | None | Low | Minor scope-creep risk | — |

**Recommendation:** Option A — the check is trivial (one-liner) and prevents a known gold-plating risk that originated from the spec's own repo layout. It closes the gap between the AC requirement and quality check enforcement.

---

## Stage 4: Execution & Performance Review — 22/25

### Issue 8: Dedup-2 fixture protocol ambiguity propagates to runner-contract.md (cascading effect of Issue 1)
**Severity:** Minor
**Location:** story-7 (runner-contract.md); story-6 (dedup-2 fixture)
**Problem:** If dedup-2 is implemented as specified (two calls per fixture), Story 7's runner-contract.md must document the multi-operation protocol. Currently, Story 7 specifies a single-invocation harness with no multi-step support. An agent writing runner-contract.md based on Story 7's specification will produce a conformant single-invocation protocol. When the same agent then reads the dedup fixture suite, the two-operation fixture will be undocumented and unimplementable. The inconsistency will surface during SDK author adoption.

This is a cascading effect of Issue 1 and will be resolved if Issue 1 is addressed (redefining dedup-2 as single-operation).

**Recommendation:** Contingent on Issue 1 resolution. If dedup-2 is redefined per Issue 1 Option A recommendation, this issue self-resolves with no additional work.

---

### Issue 9: Risk table mitigation for `removeDuplicates` cross-language is disconnected from enforcement
**Severity:** Minor
**Location:** Risk Assessment table; story-2 ACs
**Problem:** Same root cause as Issue 3. The risk table is informational; Fester executes quality checks, not risk tables. A risk mitigation stated as "add cross-language guidance note in SPEC.md" without a corresponding AC or quality check is effectively aspirational, not executable. This pattern (risk with mitigation but no story enforcement) could lead to the mitigation being silently skipped.

**Recommendation:** Resolved by Issue 3's recommendation (add AC to story-2). No additional action needed here.

---

## Spec Coverage Analysis

| Spec Item | Covered By | Status |
|-----------|-----------|--------|
| AC 1: Spec repo structure defined | Story 1 | Covered |
| AC 2: Public API surface inventoried | Story 2 | Covered |
| AC 3: Constructor options documented | Story 2 | Covered |
| AC 4: Env enum with exact wire values | Story 2, Story 3 | Covered |
| AC 5: HTTP wire protocol fully specified | Story 2, Story 3, Story 5 | Covered |
| AC 6: Batching/sampling documented | Story 2 | Covered |
| AC 7: Schema extraction with 13 golden fixtures | Story 4 | Covered |
| AC 8: Dedup behavior OPTIONAL | Story 2, Story 6 | Covered |
| AC 9: Server-side requirements with RFC 2119 | Story 2 | Covered |
| AC 10: AGENTS.md with 5 required sections | Story 8 | Covered |
| AC 11: Conformance suite shape defined | Story 4, Story 5, Story 6, Story 7 | Covered |
| AC 12: Versioning/CHANGELOG conventions | Story 9 | Covered |
| AC 13: Source-of-truth strategy | Story 2 | Covered |
| AC 14: Encryption documented | Story 2 | Covered |
| AC 15: Open questions tracked | Story 2 | Covered |
| AC 16: 13 schema-extraction fixtures in fixtures.json | Story 4 | Covered |
| AC 17: Runner contract complete (no TBD) | Story 7 | Covered |
| AC 18: flush() requirement for non-Node SDKs | Story 2, Story 8 | Covered |
| AC 19: destroy() behavior manually verified | Story 8 | Covered |
| Edge Case 9: streamId with colon | Story 5 (wire-4) | Covered |
| Edge Case 10: empty streamId → anonymousId: "" | Story 5 (wire-5) | Covered |
| Spec Morticia Issue 1: dedup multi-step shared state | Story 6 README AC | Covered (with note) |
| Spec Morticia Issue 2: wire-3 notes ambiguity | Story 5 AC 5 | Covered |
| Spec Morticia Issue 3: removeDuplicates cross-language | Risk table only — no story AC | **GAP** |
| Spec Morticia Issue 4: _avoFunctionTrackSchemaFromEvent fixture | No story (accepted as v1.1.0) | Accepted gap |

---

## Strengths

- **All 10 Rev 1 Critical/Important issues resolved.** The execution structure is materially improved: `maxIterations: 27`, SPEC.md has 4 automated section-presence checks, `0.0=float` has an automated Python assertion, wire-4/wire-5 cover the two streamId edge cases, and runner-contract.md section presence is verified.
- **Story 4 `conformance/batching/` exclusion is explicit.** The addition of the "MUST NOT be created" AC and scope note directly prevents the most obvious spec-motivated gold-plating risk.
- **Story 3 has three complementary layers of schema validation**: OpenAPI lint, JSON syntax loop, and AJV schema compile. The architecture is right — only the compile syntax needs fixing (Issue 5).
- **Dependency graph is now visually correct**: Story 5's two parallel branches (→6 and →7) are both shown, eliminating the graph ambiguity from Rev 1.
- **maxIterations = 27**: The 3× buffer is the right call for a pipeline with two high-complexity prose stories (SPEC.md and AGENTS.md) that are likely to require at least one rework iteration.
- **Story 2 quality checks are substantially improved**: The combination of word count, section count, and 4 topic-specific grep checks makes SPEC.md completeness materially harder to fake than in Rev 1.

---

## Summary

| Stage | Score | Top Issue |
|-------|-------|-----------|
| Architecture | 22/25 | dedup-2 fixture requires 2 operations; single-invocation harness supports only 1 |
| Story Quality | 22/25 | removeDuplicates cross-language guidance in risk table but not in any story AC; wire-4/wire-5 content not programmatically verified |
| Test & Acceptance | 21/25 | ajv-cli compile multi-schema syntax is invalid; only event-body.json gets compiled |
| Execution & Performance | 22/25 | Cascading dedup protocol inconsistency; risk table mitigation unenforceable without AC |
| **Total** | **87/100** | |

**Verdict:** PASS
**Critical issues:** 0
**Important issues:** 4 (Issues 1, 3, 4, 5)
**Minor issues:** 5 (Issues 2, 6, 7, 8, 9)

---

## Recommendation

This PRD PASSES at 87/100. The Critical and Important Rev 1 issues are all resolved. The pipeline has adequate iteration budget (27), the SPEC.md completeness checks are meaningfully improved, and the two new streamId edge case fixtures close the most material coverage gap.

Address the 4 Important issues before running Fester, in priority order:

1. **Issue 1 — dedup-2 multi-operation protocol** — redefine `dedup-2` as single-operation (one call, expect 1 HTTP call) and add a README note for multi-call same-bucket testing (mirrors cross-bucket treatment). Resolves Issue 8 as a cascade.
2. **Issue 5 — ajv-cli compile syntax** — replace the multi-schema compile command with a `for f in schemas/*.json; do npx ajv-cli compile -s "$f" || exit 1; done` loop. 6 of 7 schema files are currently unvalidated.
3. **Issue 4 — wire-4/wire-5 content assertions** — add Python assertion quality checks for `anonymousId` values (colon and empty string). Mirrors the `0.0=float` check pattern already in Story 4.
4. **Issue 3 — removeDuplicates AC** — add one AC to story-2 requiring cross-language guidance for `removeDuplicates` (Python/Go/Ruby must use reference identity, not value equality, for non-primitive elements). Closes the risk-table-to-AC gap.

The 5 Minor issues (section-count threshold, batching exclusion check, dep order notes) are low-risk and can be deferred to a patch or addressed in this revision if time allows.

This PRD is ready for Fester execution once the 4 Important issues above are addressed. Re-run `/thing spec-first-server-sdk` after addressing them to confirm score ≥ 90.
