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
for (const file of readdirSync(schemasDir)) {
  if (!file.endsWith(".json")) continue;
  const schema = JSON.parse(readFileSync(join(schemasDir, file), "utf8"));
  ajv.addSchema(schema);
  idByFile[file] = schema.$id;
}

const validateEntry = ajv.getSchema(idByFile["schema-entry.json"]);
const validateProp = ajv.getSchema(idByFile["event-property-plain.json"]);

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
      `[FAIL] ${suite} / ${fixtureId} — ${key}: expected an array, got ${value === undefined ? "missing key" : typeof value}`,
    );
    return null;
  }
  return value;
};

// schema-extraction: every fixture MUST carry an expected[] (the asserted
// output); each element is a SchemaEntry.
const schemaExtraction = JSON.parse(
  readFileSync(join(root, "conformance/schema-extraction/fixtures.json"), "utf8"),
);
for (const f of schemaExtraction) {
  const expected = requireArray("schema-extraction", f.fixture_id, f.expected, "expected");
  if (!expected) continue;
  expected.forEach((entry, i) => {
    if (!validateEntry(entry)) fail("schema-extraction", f.fixture_id, `expected[${i}]`, validateEntry);
  });
}

// wire-protocol + error-handling: every eventProperties[] element is an
// EventPropertyPlain. These bodies are concrete (no <placeholder> values), so
// they validate cleanly. We deliberately do NOT validate the full event body,
// whose messageId/createdAt are placeholders.
for (const rel of [
  "conformance/wire-protocol/fixtures.json",
  "conformance/error-handling/fixtures.json",
]) {
  const suite = rel.split("/")[1];
  const fixtures = JSON.parse(readFileSync(join(root, rel), "utf8"));
  for (const f of fixtures) {
    // expected_request_body is legitimately absent when no request is expected
    // (e.g. wire-8, error-2). When present it MUST be an array — a present-but-
    // malformed value (null/object) is a fixture error, not a "skip".
    if (!("expected_request_body" in f)) continue;
    const expectedBody = requireArray(suite, f.fixture_id, f.expected_request_body, "expected_request_body");
    if (!expectedBody) continue;
    expectedBody.forEach((body, b) => {
      (body.eventProperties ?? []).forEach((prop, i) => {
        if (!validateProp(prop)) {
          fail(suite, f.fixture_id, `expected_request_body[${b}].eventProperties[${i}]`, validateProp);
        }
      });
    });
  }
}

// batching: expected_request_bodies is an array of batches; each batch is an array of
// event bodies. Every eventProperties[] element of every event is an EventPropertyPlain.
const batching = JSON.parse(
  readFileSync(join(root, "conformance/batching/fixtures.json"), "utf8"),
);
for (const f of batching) {
  // expected_request_bodies is absent for fixtures that send nothing (batch-3)
  // or assert via a different mechanism (batch-6). When present it MUST be an
  // array of batches.
  if (!("expected_request_bodies" in f)) continue;
  const expectedBatches = requireArray("batching", f.fixture_id, f.expected_request_bodies, "expected_request_bodies");
  if (!expectedBatches) continue;
  expectedBatches.forEach((batch, b) => {
    (batch ?? []).forEach((body, e) => {
      (body.eventProperties ?? []).forEach((prop, i) => {
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
