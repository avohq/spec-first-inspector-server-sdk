// Validate every golden fixture against the JSON Schemas in schemas/.
//
// The existing `ajv compile` check only proves the schema *documents* are
// well-formed. It never checks that the fixtures actually conform to them — so
// schema<->fixture drift (e.g. a `children` union that can't represent object
// children) passes silently. This script closes that gap and is the regression
// guard for that class of bug.
//
// Run: node scripts/validate-fixtures.mjs   (or: npm run validate:fixtures)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(root, "schemas");

const ajv = new Ajv({ strict: false, allErrors: true });

// Register every schema by its $id so relative $refs (e.g.
// event-property-plain.json -> schema-entry.json) resolve.
const idByFile = {};
const schemaByFile = {};
for (const file of readdirSync(schemasDir)) {
  if (!file.endsWith(".json")) continue;
  const schema = JSON.parse(readFileSync(join(schemasDir, file), "utf8"));
  ajv.addSchema(schema);
  idByFile[file] = schema.$id;
  schemaByFile[file] = schema;
}

// Read the forbidden wire fields out of the schema rather than restating them, so
// this list cannot drift from schemas/event-body.json. They are encoded there as
// not.anyOf[{ required: [name] }] (SPEC.md §3.3, §7.3.1).
const forbiddenClauses = schemaByFile["event-body.json"]?.not?.anyOf;
const FORBIDDEN_WIRE_FIELDS = (Array.isArray(forbiddenClauses) ? forbiddenClauses : [])
  .flatMap((clause) => (Array.isArray(clause?.required) ? clause.required : []));

const validateEntry = ajv.getSchema(idByFile["schema-entry.json"]);
const validateProp = ajv.getSchema(idByFile["event-property-plain.json"]);
const validateBody = ajv.getSchema(idByFile["event-body.json"]);

// Fixture event bodies carry placeholder strings where a real SDK emits a value
// the fixture cannot predict. The suite runner checks those values at run time
// with predicates (see PLACEHOLDERS in conformance/runner/suite-runner.mjs); this
// script cannot, because it never runs an SDK. So it substitutes the weakest
// value that satisfies each placeholder's predicate AND the schema, and validates
// the body around them.
//
// What that means for coverage, stated plainly so nobody assumes more:
//   - CHECKED here: which keys are present, that no required key is missing, that
//     no forbidden key appears, and the type/format/enum of every NON-placeholder
//     value. This is what catches a fixture sweep that drops or mistypes a base
//     field.
//   - NOT checked here: whether the four placeholder VALUES are well-formed. They
//     are literal markers, not data; the suite runner asserts their real values
//     against the captured request.
const PLACEHOLDER_STANDINS = {
  "<uuid-v4>": "550e8400-e29b-41d4-a716-446655440000",
  "<iso8601>": "2026-05-25T12:00:00.000Z",
  "<semver>": "1.2.0",
  "<sdk-platform>": "node",
};

// "<absent>" is not a value: it asserts the key MUST NOT appear on the wire
// (SPEC.md §7.3.6, used for the omitted gateway fields). The body a conformant
// SDK sends therefore has no such key, so drop it before validating rather than
// substituting anything.
const ABSENT = "<absent>";

const concretizeBody = (body) => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === ABSENT) continue;
    out[key] = Object.hasOwn(PLACEHOLDER_STANDINS, value) ? PLACEHOLDER_STANDINS[value] : value;
  }
  return out;
};

// Validate one fixture event object against schemas/event-body.json. Reports its
// own failures rather than routing through fail(), because both branches append
// context fail() cannot express: what was found instead of an object, and which
// forbidden field tripped the schema. Both increment `failures`, so the exit code
// reflects them either way.
const checkBody = (suite, fixtureId, body, where) => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    failures += 1;
    console.error(`[FAIL] ${suite} / ${fixtureId} — ${where}: expected an event object, got ${Array.isArray(body) ? "an array" : body === null ? "null" : typeof body}`);
    return;
  }
  const concrete = concretizeBody(body);
  if (validateBody(concrete)) return;
  // ajv reports a failed `not` as the unhelpful "data must NOT be valid", which
  // does not say which field caused it. Name it, since a reintroduced forbidden
  // field is a likely fixture-edit mistake and the bare message wastes a round.
  const offending = FORBIDDEN_WIRE_FIELDS.filter((name) => Object.hasOwn(concrete, name));
  const hint = offending.length
    ? ` (forbidden field${offending.length > 1 ? "s" : ""} present: ${offending.join(", ")})`
    : "";
  failures += 1;
  console.error(`[FAIL] ${suite} / ${fixtureId} — ${where}: ${ajv.errorsText(validateBody.errors)}${hint}`);
};

let failures = 0;
const fail = (suite, fixtureId, where, validator) => {
  failures += 1;
  console.error(
    `[FAIL] ${suite} / ${fixtureId} — ${where}: ${ajv.errorsText(validator.errors)}`,
  );
};

// Guard against a malformed fixture silently passing with zero checks: when a
// fixture array is required (or present but the wrong type), fail fast instead
// of defaulting to []. Returns the array, or null on failure.
const requireArray = (suite, fixtureId, value, key) => {
  if (!Array.isArray(value)) {
    failures += 1;
    console.error(
      `[FAIL] ${suite} / ${fixtureId} — ${key}: expected an array, got ${value === undefined ? "missing key" : value === null ? "null" : typeof value}`,
    );
    return null;
  }
  return value;
};

// schema-extraction: every fixture MUST carry an expected[] (the asserted
// Load one fixtures file. Every failure mode here is a fixture-authoring mistake,
// so each is reported in the [FAIL] format and the run continues to the next
// suite. Throwing instead — which an unguarded JSON.parse or `for...of` does —
// aborts before the summary prints and loses every later suite, which is the
// opposite of what a validator should do with bad input.
const loadFixtures = (suite, rel) => {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch (err) {
    failures += 1;
    console.error(`[FAIL] ${suite} / — ${rel}: not readable as JSON (${err.message})`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    failures += 1;
    console.error(
      `[FAIL] ${suite} / — ${rel}: expected the file to be an array of fixtures, got ${parsed === null ? "null" : typeof parsed}`,
    );
    return [];
  }
  // Each element must be an object before anything reads f.fixture_id or uses
  // `in` on it. A null, number or string entry throws on both, which would abort
  // the run — the same failure the file-level checks above exist to prevent, one
  // level further in. Report and drop the bad entry; keep the good ones.
  return parsed.filter((entry, i) => {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) return true;
    failures += 1;
    const found = entry === null ? "null" : Array.isArray(entry) ? "an array" : typeof entry;
    console.error(`[FAIL] ${suite} / — ${rel}[${i}]: expected a fixture object, got ${found}`);
    return false;
  });
};

// output); each element is a SchemaEntry.
const schemaExtraction = loadFixtures("schema-extraction", "conformance/schema-extraction/fixtures.json");
for (const f of schemaExtraction) {
  const expected = requireArray("schema-extraction", f.fixture_id, f.expected, "expected");
  if (!expected) continue;
  expected.forEach((entry, i) => {
    if (!validateEntry(entry)) fail("schema-extraction", f.fixture_id, `expected[${i}]`, validateEntry);
  });
}

// eventProperties is OPTIONAL on a fixture body — an event with no properties
// omits it — so absence is skipped, not failed. A PRESENT but non-array value is
// already reported by checkBody() against the EventBody schema; iterating it would
// throw a TypeError and abort the run before the summary printed, losing every
// later fixture. Returning [] lets validation continue while the exit status still
// reflects the failure checkBody recorded.
const propertiesOf = (body) => {
  const props = body?.eventProperties;
  return Array.isArray(props) ? props : [];
};

// wire-protocol + error-handling: every event object is an EventBody, and every
// eventProperties[] element is an EventPropertyPlain. The body check is what
// guards the required-field list — without it a fixture that drops or mistypes a
// base field validates clean, which is exactly the error a broad fixture sweep
// introduces.
for (const rel of [
  "conformance/wire-protocol/fixtures.json",
  "conformance/error-handling/fixtures.json",
]) {
  const suite = rel.split("/")[1];
  const fixtures = loadFixtures(suite, rel);
  for (const f of fixtures) {
    // expected_request_body is legitimately absent when no request is expected
    // (e.g. wire-8, error-2). When present it MUST be an array — a present-but-
    // malformed value (null/object) is a fixture error, not a "skip".
    if (!("expected_request_body" in f)) continue;
    const expectedBody = requireArray(suite, f.fixture_id, f.expected_request_body, "expected_request_body");
    if (!expectedBody) continue;
    expectedBody.forEach((body, b) => {
      checkBody(suite, f.fixture_id, body, `expected_request_body[${b}]`);
      propertiesOf(body).forEach((prop, i) => {
        if (!validateProp(prop)) {
          fail(suite, f.fixture_id, `expected_request_body[${b}].eventProperties[${i}]`, validateProp);
        }
      });
    });
  }
}

// batching: expected_request_bodies is an array of batches; each batch is an array
// of event bodies. Every event is an EventBody and every eventProperties[] element
// of every event is an EventPropertyPlain.
const batching = loadFixtures("batching", "conformance/batching/fixtures.json");
for (const f of batching) {
  // expected_request_bodies is absent for fixtures that send nothing (batch-3)
  // or assert via a different mechanism (batch-6). When present it MUST be an
  // array of batches.
  if (!("expected_request_bodies" in f)) continue;
  const expectedBatches = requireArray("batching", f.fixture_id, f.expected_request_bodies, "expected_request_bodies");
  if (!expectedBatches) continue;
  expectedBatches.forEach((batch, b) => {
    // Each element is itself a batch (an array of event objects) per the runner
    // contract. Validate before iterating: a fixture carrying an object, a string
    // or a number here used to throw a TypeError and abort the whole run, which
    // loses every later fixture and reports nothing in the [FAIL] format.
    const events = requireArray("batching", f.fixture_id, batch, `expected_request_bodies[${b}]`);
    if (!events) return;
    events.forEach((body, e) => {
      checkBody("batching", f.fixture_id, body, `expected_request_bodies[${b}][${e}]`);
      propertiesOf(body).forEach((prop, i) => {
        if (!validateProp(prop)) {
          fail("batching", f.fixture_id, `expected_request_bodies[${b}][${e}].eventProperties[${i}]`, validateProp);
        }
      });
    });
  });
}

if (failures > 0) {
  console.error(`\n${failures} fixture element(s) failed schema validation.`);
  process.exit(1);
}
console.log("All fixtures validate against schemas/ ✓");
