# validate-fixtures

## Short description

Validation script that checks every golden conformance fixture against the JSON Schemas in `schemas/`. It closes the gap left by `ajv compile`, which only proves the schema *documents* are well-formed but never checks that the fixtures actually conform to them. This is the regression guard against schema↔fixture drift (e.g. a `children` union that cannot represent object children passing silently).

## Tech stack

Node.js ES module (`.mjs`). Depends on `ajv` (draft 2020-12 build, imported from `ajv/dist/2020.js`) and the `node:fs` / `node:url` / `node:path` built-ins. Invoked via `node scripts/validate-fixtures.mjs` or `npm run validate:fixtures`.

## Functional requirements

- Registers every `*.json` under `schemas/` with Ajv keyed by its `$id`, so relative `$ref`s (e.g. `event-property-plain.json` → `schema-entry.json`) resolve.
- Resolves three validators: `SchemaEntry` (from `schema-entry.json`), `EventPropertyPlain`
  (from `event-property-plain.json`) and `EventBody` (from `event-body.json`).
- Derives the forbidden wire fields from `event-body.json`'s own `not.anyOf` clauses rather than
  restating them, so that list cannot drift from the schema.
- **schema-extraction suite** — validates that every element of each fixture's `expected[]` array
  is a valid `SchemaEntry`.
- **wire-protocol and error-handling suites** — validates that every `expected_request_body[]`
  entry is a valid `EventBody`, and that every `eventProperties[]` element inside it is a valid
  `EventPropertyPlain`.
- **batching suite** — validates that every event in every batch of `expected_request_bodies[]`
  is a valid `EventBody`, and that every `eventProperties[]` element of every such event is a
  valid `EventPropertyPlain`.
- **Placeholder handling for the body check.** Fixture bodies carry marker strings where a real
  SDK emits a value the fixture cannot predict. Before validating, the script substitutes the
  weakest value satisfying both the marker's runtime predicate and the schema — `<uuid-v4>`,
  `<iso8601>`, `<semver>` and `<sdk-platform>` — and DROPS any key whose value is `<absent>`,
  since that marker asserts the key must not appear on the wire (SPEC.md §7.3.6).
- **What the body check therefore does and does not cover**, stated so no reader assumes more:
  it checks which keys are present, that no required key is missing, that no forbidden key
  appears, and the type / format / enum of every non-placeholder value. It does NOT check the
  four placeholder values themselves — those are literal markers, and the suite runner asserts
  their real values against the captured request at run time.
- A fixture that omits an optional container entirely is skipped, not failed: `expected_request_body`
  and `expected_request_bodies` are absent for fixtures that expect no request, and the suite checks
  for the key before reading it.
- Every failure mode is REPORTED rather than thrown, so one bad suite cannot hide the others. A
  fixtures file that is unreadable as JSON, or that parses to something other than an array of
  fixtures, is reported in the `[FAIL]` format and the run continues to the next suite. An
  unguarded `JSON.parse` or `for...of` would abort before the summary printed and lose every later
  suite, which is the opposite of what a validator should do with bad input.
- A container that is PRESENT but not an array is a fixture error, not a skip. `requireArray()` reports
  it in the `[FAIL]` format and sets the exit status, rather than defaulting to `[]` and certifying a
  malformed fixture with zero checks. This applies to each inner batch of `expected_request_bodies`
  as well as to the outer array.
- Only `eventProperties` is coerced with `?? []`, since an event with no properties legitimately omits
  it.

## Non-functional requirements

- Ajv configured with `strict: false` and `allErrors: true` (collects all errors per element rather than failing fast).
- On any failure: emits one `[FAIL] <suite> / <fixture_id> — <where>: <ajv error text>` line to
  stderr per offending element, then a summary count, and exits with code 1. An `EventBody`
  failure caused by a forbidden field appends `(forbidden field present: <name>)`, because Ajv
  reports a failed `not` only as "data must NOT be valid", which does not say which field
  caused it.
- On full success: prints `All fixtures validate against schemas/ ✓` and exits 0.
- Pure read-only over the repo tree; no writes, no network.

## Examples

- A `schema-extraction` fixture whose `expected[i]` has a `children` shape the schema cannot represent → `[FAIL] schema-extraction / <id> — expected[i]: <error>`, exit 1.
- All fixtures conform → `All fixtures validate against schemas/ ✓`, exit 0.
