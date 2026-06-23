# validate-fixtures

## Short description

Validation script that checks every golden conformance fixture against the JSON Schemas in `schemas/`. It closes the gap left by `ajv compile`, which only proves the schema *documents* are well-formed but never checks that the fixtures actually conform to them. This is the regression guard against schema↔fixture drift (e.g. a `children` union that cannot represent object children passing silently).

## Tech stack

Node.js ES module (`.mjs`). Depends on `ajv` (draft 2020-12 build, imported from `ajv/dist/2020.js`) and the `node:fs` / `node:url` / `node:path` built-ins. Invoked via `node scripts/validate-fixtures.mjs` or `npm run validate:fixtures`.

## Functional requirements

- Registers every `*.json` under `schemas/` with Ajv keyed by its `$id`, so relative `$ref`s (e.g. `event-property-plain.json` → `schema-entry.json`) resolve.
- Resolves two validators: `SchemaEntry` (from `schema-entry.json`) and `EventPropertyPlain` (from `event-property-plain.json`).
- **schema-extraction suite** — validates that every element of each fixture's `expected[]` array is a valid `SchemaEntry`.
- **wire-protocol and error-handling suites** — validates that every `eventProperties[]` element inside each `expected_request_body[]` entry is a valid `EventPropertyPlain`. **Deliberately does NOT validate the full event body**, whose `messageId` / `createdAt` are placeholder values that would not satisfy the schemas.
- Absent arrays are coerced to empty via `?? []`, so a fixture lacking the relevant field is skipped, not failed.

## Non-functional requirements

- Ajv configured with `strict: false` and `allErrors: true` (collects all errors per element rather than failing fast).
- On any failure: emits one `[FAIL] <suite> / <fixture_id> — <where>: <ajv error text>` line to stderr per offending element, then a summary count, and exits with code 1.
- On full success: prints `All fixtures validate against schemas/ ✓` and exits 0.
- Pure read-only over the repo tree; no writes, no network.

## Examples

- A `schema-extraction` fixture whose `expected[i]` has a `children` shape the schema cannot represent → `[FAIL] schema-extraction / <id> — expected[i]: <error>`, exit 1.
- All fixtures conform → `All fixtures validate against schemas/ ✓`, exit 0.
