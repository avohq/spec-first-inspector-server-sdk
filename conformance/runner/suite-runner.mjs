// Language-agnostic conformance suite-runner.
//
// Drives a harness subprocess once per fixture across all four suites
// (schema-extraction, wire-protocol, error-handling, batching) per the normative
// protocol in conformance/runner-contract.md, and performs ALL assertions itself
// (the harness contains none). For every fixture it:
//
//   1. injects the `suite` field (derived from the fixtures.json parent dir),
//   2. starts/reuses an in-process mock server and exports AVO_INSPECTOR_MOCK_ENDPOINT,
//   3. configures the mock from mock_response / mock_responses,
//   4. spawns the harness, writes one input JSON line to stdin, reads one output line,
//   5. asserts outcome / value (with placeholder-regex format validation),
//      request count, request bodies (unordered multiset), union count, unique
//      messageIds, headers, and mock_response:null => zero requests.
//
// Prints a per-fixture PASS/FAIL line and a summary; exits non-zero if any fail.
//
// Usage:
//   node conformance/runner/suite-runner.mjs [--harness "<command>"]
// Default harness: the bundled non-normative example harness.
//
// Zero external dependencies — Node >= 18 built-ins only.

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MockServer } from "./mock-server.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const DEFAULT_HARNESS = `node ${join(__dirname, "example-harness", "harness.mjs")}`;

// Suites in fixed order; suite name == parent dir name (runner-contract).
const SUITES = ["schema-extraction", "wire-protocol", "error-handling", "batching"];

// --- placeholder -> validator (runner-contract "Format validation") ----------
const PLACEHOLDERS = {
  "<uuid-v4>": (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v),
  "<iso8601>": (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v),
  "<semver>": (v) => typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v),
  "<sdk-platform>": (v) => typeof v === "string" && v.length > 0,
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  let harness = DEFAULT_HARNESS;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--harness") {
      harness = argv[i + 1];
      i += 1;
    } else if (argv[i].startsWith("--harness=")) {
      harness = argv[i].slice("--harness=".length);
    }
  }
  if (!harness) {
    console.error("error: --harness requires a command string");
    process.exit(2);
  }
  return { harness };
}

// ---------------------------------------------------------------------------
// Harness invocation: write one JSON line to stdin, read one JSON line of stdout.
// ---------------------------------------------------------------------------
function runHarness(harnessCmd, envelope, extraEnv) {
  return new Promise((resolve) => {
    // Split the harness command on whitespace (simple shell-free tokenization;
    // sufficient for `node path/to/harness.mjs` and most SDK invocations).
    const tokens = harnessCmd.trim().split(/\s+/);
    const [cmd, ...args] = tokens;
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      resolve({ exitCode: -1, stdout, stderr, spawnError: err.message });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });

    child.stdin.write(JSON.stringify(envelope) + "\n");
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

// Deep equality for the resolved `value` / `actual` assertions (extractSchema etc).
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

// Fields that MUST NOT appear in any wire body (SPEC §3.3, §7.3.1). Enforced by
// the runner so an SDK that emits them fails conformance even though no fixture
// "expects" them.
const FORBIDDEN_WIRE_FIELDS = new Set(["sessionId", "trackingId", "visitorId", "userId"]);

// Match one captured event body against an expected body, applying placeholder
// format-validation for any placeholder-valued expected field.
function matchBody(expected, actual) {
  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    return deepEqual(expected, actual);
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;

  // A wire body carrying any forbidden identifier field is a hard failure.
  for (const key of Object.keys(actual)) {
    if (FORBIDDEN_WIRE_FIELDS.has(key)) return false;
  }

  // Every expected key must be present and match. Extra actual keys are tolerated
  // (the Inspector backend ignores unknown fields; schemas/event-body.json permits
  // them). messageId/createdAt/libVersion/libPlatform use placeholder validators.
  for (const key of Object.keys(expected)) {
    const exp = expected[key];
    const act = actual[key];
    if (typeof exp === "string" && PLACEHOLDERS[exp]) {
      if (!PLACEHOLDERS[exp](act)) return false;
    } else if (!deepEqual(exp, act)) {
      return false;
    }
  }
  return true;
}

// Match a set of expected batches against captured batches as an UNORDERED
// MULTISET: each expected batch must match exactly one distinct captured batch by
// contents; arrival order is NOT asserted (runner-contract).
function matchBatchesUnordered(expectedBatches, capturedBatches) {
  if (expectedBatches.length !== capturedBatches.length) {
    return { ok: false, reason: `expected ${expectedBatches.length} batches, captured ${capturedBatches.length}` };
  }
  const used = new Array(capturedBatches.length).fill(false);
  for (let e = 0; e < expectedBatches.length; e += 1) {
    const expBatch = expectedBatches[e];
    let foundIdx = -1;
    for (let c = 0; c < capturedBatches.length; c += 1) {
      if (used[c]) continue;
      if (batchEquals(expBatch, capturedBatches[c])) {
        foundIdx = c;
        break;
      }
    }
    if (foundIdx === -1) {
      return { ok: false, reason: `no captured batch matched expected batch #${e}` };
    }
    used[foundIdx] = true;
  }
  return { ok: true };
}

// A batch matches when it is an array of the same length and each expected event
// matches exactly one distinct captured event (events within a batch are matched
// as an unordered multiset too — events in a batch are self-contained).
function batchEquals(expBatch, capBatch) {
  if (!Array.isArray(expBatch) || !Array.isArray(capBatch)) return false;
  if (expBatch.length !== capBatch.length) return false;
  const used = new Array(capBatch.length).fill(false);
  for (const expEvent of expBatch) {
    let found = -1;
    for (let i = 0; i < capBatch.length; i += 1) {
      if (used[i]) continue;
      if (matchBody(expEvent, capBatch[i])) {
        found = i;
        break;
      }
    }
    if (found === -1) return false;
    used[found] = true;
  }
  return true;
}

// Captured request bodies: each POST body is a JSON array (one batch). Returns the
// list of batches, or an error if any body is malformed (gunzip/parse failure).
function extractBatches(requests) {
  const batches = [];
  for (const req of requests) {
    const body = req.body;
    if (body && typeof body === "object" && body.__malformed) {
      return { error: `malformed request body: ${body.__malformed}` };
    }
    if (!Array.isArray(body)) {
      return { error: `request body is not a JSON array (got ${body === null ? "null" : typeof body})` };
    }
    batches.push(body);
  }
  return { batches };
}

function assertHeaders(expectedHeaders, requests) {
  for (const req of requests) {
    for (const name of Object.keys(expectedHeaders)) {
      const key = name.toLowerCase();
      const expected = expectedHeaders[name];
      const actual = req.headers ? req.headers[key] : undefined;
      if (expected === null) {
        if (actual !== undefined) return { ok: false, reason: `header ${key} expected absent, got "${actual}"` };
      } else {
        if (actual !== expected) return { ok: false, reason: `header ${key} expected "${expected}", got "${actual ?? "absent"}"` };
      }
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-fixture execution + assertion
// ---------------------------------------------------------------------------
async function runFixture(suite, fixture, harnessCmd, mock) {
  const fixtureId = fixture.fixture_id;
  const failures = [];

  // 1. Build the input envelope: the fixture verbatim + injected `suite`. We
  //    strip runner-only assertion fields so the harness sees only what the
  //    contract specifies (harmless either way, but keeps the envelope clean).
  const envelope = { ...fixture, suite };
  delete envelope.description;
  delete envelope.notes;
  delete envelope.expected;
  delete envelope.expected_request_body;
  delete envelope.expected_request_bodies;
  delete envelope.expected_request_count;
  delete envelope.expected_resolve_value;
  delete envelope.expected_promise_outcome;
  delete envelope.expected_request_headers;
  delete envelope.expected_event_union_count;
  delete envelope.expected_unique_message_ids;
  delete envelope.mock_response;
  delete envelope.mock_responses;

  // 2. Configure the mock for this fixture. Always start with a clean log.
  mock.reset();
  const expectsHttp = "mock_response" in fixture || "mock_responses" in fixture;
  if (Array.isArray(fixture.mock_responses)) {
    mock.setResponses({ list: fixture.mock_responses });
  } else if (fixture.mock_response != null) {
    mock.setResponses({ single: fixture.mock_response });
  } else {
    // mock_response: null OR no mock field — keep the server up; default 200 {}.
    mock.setResponses({});
  }

  // 3. Always point the SDK at the mock so an errant send is captured locally,
  //    never escaping to a real endpoint (runner-contract, mock_response:null).
  const extraEnv = { AVO_INSPECTOR_MOCK_ENDPOINT: mock.baseUrl };

  // 4. Drive the harness.
  const res = await runHarness(harnessCmd, envelope, extraEnv);

  if (res.spawnError) {
    failures.push(`harness spawn failed: ${res.spawnError}`);
    return { fixtureId, failures };
  }
  // Exit codes other than 0/1 are unexpected errors (runner-contract); 1 may be a
  // legitimate harness-level failure surfaced via passed:false in the envelope.
  if (res.exitCode !== 0 && res.exitCode !== 1) {
    failures.push(`harness exited with unexpected code ${res.exitCode}; stderr: ${res.stderr.trim().slice(0, 200)}`);
    return { fixtureId, failures };
  }

  // 5. Parse the single output envelope. The contract reserves stdout for
  // exactly one JSON line; diagnostics belong on stderr. Reject any other count.
  const lines = res.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 1) {
    failures.push(`stdout must contain exactly one JSON line, got ${lines.length}; stderr: ${res.stderr.trim().slice(0, 200)}`);
    return { fixtureId, failures };
  }
  let output;
  try {
    output = JSON.parse(lines[0]);
  } catch (err) {
    failures.push(`output envelope parse failed: ${err.message}`);
    return { fixtureId, failures };
  }

  if (output.fixture_id !== fixtureId) {
    failures.push(`output fixture_id "${output.fixture_id}" != "${fixtureId}"`);
  }

  // --- schema-extraction: assert exact extractSchema output ------------------
  if (suite === "schema-extraction") {
    if (output.passed !== true) {
      failures.push(`harness reported passed:false (error: ${output.error})`);
    } else if (!deepEqual(fixture.expected, output.actual)) {
      failures.push(`extractSchema mismatch:\n    expected ${JSON.stringify(fixture.expected)}\n    actual   ${JSON.stringify(output.actual)}`);
    }
    return { fixtureId, failures };
  }

  // For the HTTP suites, retrieve captured requests directly from the in-process
  // mock (equivalent to GET /requests).
  const requests = mock.capturedRequests();

  // --- promise outcome (wire-protocol / error-handling single-event) ---------
  if ("expected_promise_outcome" in fixture) {
    if (output.outcome !== fixture.expected_promise_outcome) {
      failures.push(`outcome "${output.outcome}" != expected "${fixture.expected_promise_outcome}"`);
    }
  }
  if (output.passed !== true && suite !== "schema-extraction") {
    failures.push(`harness reported passed:false (error: ${output.error})`);
  }

  // --- resolved value --------------------------------------------------------
  if ("expected_resolve_value" in fixture) {
    if (!deepEqual(fixture.expected_resolve_value, output.actual)) {
      failures.push(`resolve value mismatch: expected ${JSON.stringify(fixture.expected_resolve_value)}, actual ${JSON.stringify(output.actual)}`);
    }
  }

  // --- request count ---------------------------------------------------------
  if ("expected_request_count" in fixture) {
    if (requests.length !== fixture.expected_request_count) {
      failures.push(`request count ${requests.length} != expected ${fixture.expected_request_count}`);
    }
  }

  // --- mock_response: null => zero requests (fail-closed) --------------------
  if (expectsHttp && fixture.mock_response === null && !("mock_responses" in fixture)) {
    if (requests.length !== 0) {
      failures.push(`mock_response:null expects zero requests, captured ${requests.length}`);
    }
  }

  // Extract & validate request bodies (fails on malformed/gzip-broken bodies).
  let batches = null;
  if (requests.length > 0 || "expected_request_body" in fixture || "expected_request_bodies" in fixture || "expected_event_union_count" in fixture) {
    const ext = extractBatches(requests);
    if (ext.error) {
      failures.push(ext.error);
    } else {
      batches = ext.batches;
    }
  }

  // --- single expected_request_body (wire-protocol / error-handling) ---------
  // The wire suites send one batch containing the events; expected_request_body
  // is an array of expected events. Treat it as a single expected batch.
  if ("expected_request_body" in fixture && batches) {
    const result = matchBatchesUnordered([fixture.expected_request_body], batches);
    if (!result.ok) failures.push(`expected_request_body: ${result.reason}`);
  }

  // --- expected_request_bodies (batching, unordered multiset) ----------------
  if ("expected_request_bodies" in fixture && batches) {
    const result = matchBatchesUnordered(fixture.expected_request_bodies, batches);
    if (!result.ok) failures.push(`expected_request_bodies: ${result.reason}`);
  }

  // --- expected_request_headers ----------------------------------------------
  if ("expected_request_headers" in fixture && requests.length > 0) {
    const result = assertHeaders(fixture.expected_request_headers, requests);
    if (!result.ok) failures.push(`expected_request_headers: ${result.reason}`);
  }

  // --- concurrency union assertions (batch-6) --------------------------------
  if ("expected_event_union_count" in fixture && batches) {
    const allEvents = batches.flat();
    if (allEvents.length !== fixture.expected_event_union_count) {
      failures.push(`event union count ${allEvents.length} != expected ${fixture.expected_event_union_count}`);
    }
    if (fixture.expected_unique_message_ids === true) {
      const ids = allEvents.map((e) => e && e.messageId);
      if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
        failures.push(`expected_unique_message_ids: some events missing messageId`);
      }
      const unique = new Set(ids);
      if (unique.size !== ids.length) {
        failures.push(`expected_unique_message_ids: ${ids.length} events but only ${unique.size} unique messageIds (duplicate detected)`);
      }
      if (unique.size !== fixture.expected_event_union_count) {
        failures.push(`expected_unique_message_ids: ${unique.size} unique != union count ${fixture.expected_event_union_count}`);
      }
      // Validate each messageId matches the UUID v4 format.
      for (const id of ids) {
        if (typeof id === "string" && !PLACEHOLDERS["<uuid-v4>"](id)) {
          failures.push(`expected_unique_message_ids: invalid UUID v4 "${id}"`);
          break;
        }
      }
    }
  }

  return { fixtureId, failures };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { harness } = parseArgs(process.argv.slice(2));

  console.log(`Avo Inspector conformance suite-runner`);
  console.log(`harness: ${harness}\n`);

  const mock = new MockServer();
  await mock.start();

  let total = 0;
  let passed = 0;
  const results = [];

  for (const suite of SUITES) {
    const path = join(repoRoot, "conformance", suite, "fixtures.json");
    let fixtures;
    try {
      fixtures = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      console.error(`error: failed to load ${path}: ${err.message}`);
      await mock.stop();
      process.exit(2);
    }

    console.log(`── ${suite} (${fixtures.length}) ──`);
    for (const fixture of fixtures) {
      total += 1;
      const { fixtureId, failures } = await runFixture(suite, fixture, harness, mock);
      const desc = fixture.description ? ` — ${truncate(fixture.description, 70)}` : "";
      if (failures.length === 0) {
        passed += 1;
        console.log(`[PASS] ${fixtureId}${desc}`);
      } else {
        console.log(`[FAIL] ${fixtureId}${desc}`);
        for (const f of failures) console.log(`         ${f}`);
      }
      results.push({ suite, fixtureId, failures });
    }
    console.log("");
  }

  await mock.stop();

  console.log(`────────────────────────────────────────`);
  console.log(`Conformance summary: ${passed}/${total} PASS`);
  if (passed !== total) {
    console.log(`\nFailed fixtures:`);
    for (const r of results) {
      if (r.failures.length > 0) console.log(`  [${r.suite}] ${r.fixtureId}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

main().catch((err) => {
  console.error("suite-runner fatal error:", err);
  process.exit(1);
});
