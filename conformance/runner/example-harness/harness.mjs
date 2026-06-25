// =============================================================================
// NON-NORMATIVE worked-example conformance harness.
// =============================================================================
//
// Thin CLI harness for the example reference SDK (./sdk.mjs), implementing the
// stdin/stdout JSON protocol from conformance/runner-contract.md. It contains NO
// assertion logic (the suite-runner asserts) — it only parses the input envelope,
// constructs an AvoInspector, runs the requested operation, and writes one output
// envelope line to stdout. Diagnostics go to stderr only.
//
// This file demonstrates the harness contract for SDK authors; it is not a
// maintained product. SDK authors write the equivalent thin harness for their own
// SDK and point the suite-runner at it via `--harness "<command>"`.
//
// HARNESS_CONTRACT_VERSION: 1.0.0
// =============================================================================

import { AvoInspector } from "./sdk.mjs";

const HARNESS_CONTRACT_VERSION = "1.0.0";

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function writeEnvelope(env) {
  process.stdout.write(JSON.stringify(env) + "\n");
}

// Exit code 2 — harness configuration error (malformed envelope, missing field,
// unsupported operation, or precondition could not be applied).
function configError(fixtureId, message) {
  writeEnvelope({
    fixture_id: fixtureId ?? null,
    passed: false,
    actual: null,
    outcome: "resolve",
    error: message,
  });
  process.exit(2);
}

function applyPrecondition(inspector, precondition, fixtureId) {
  if (!precondition || typeof precondition !== "object") return;
  for (const key of Object.keys(precondition)) {
    if (key === "samplingRate") {
      if (typeof inspector._setSamplingRateForTesting !== "function") {
        configError(fixtureId, "precondition.samplingRate not supported by harness");
      }
      inspector._setSamplingRateForTesting(precondition.samplingRate);
    } else {
      configError(fixtureId, `unsupported precondition field: ${key}`);
    }
  }
}

async function runSequence(inspector, steps, fixtureId) {
  if (!Array.isArray(steps)) configError(fixtureId, "sequence operation requires a steps array");
  const actual = [];
  for (const step of steps) {
    const action = step && step.action;
    if (action === "track") {
      const value = await inspector.trackSchemaFromEvent(
        step.eventName,
        step.eventProperties,
        step.streamId,
      );
      actual.push({ action: "track", outcome: "resolve", value });
    } else if (action === "trackN") {
      const count = step.count;
      if (!Number.isInteger(count) || count < 1) {
        configError(fixtureId, "trackN requires an integer count >= 1");
      }
      const prefix = step.eventNamePrefix ?? "";
      const streamId = step.streamId ?? "";
      // Fire `count` concurrently-scheduled tracks; join all before resolving.
      // Single-threaded Node: concurrent scheduling, not true parallelism
      // (documented limitation, conformance/README.md).
      const tasks = [];
      for (let i = 0; i < count; i += 1) {
        tasks.push(inspector.trackSchemaFromEvent(`${prefix}${i}`, {}, streamId));
      }
      await Promise.all(tasks);
      actual.push({ action: "trackN", outcome: "resolve", value: count });
    } else if (action === "flush") {
      await inspector.flush(step.timeoutMs);
      actual.push({ action: "flush", outcome: "resolve", value: null });
    } else if (action === "destroy") {
      inspector.destroy();
      actual.push({ action: "destroy", outcome: "resolve", value: null });
    } else {
      configError(fixtureId, `unsupported sequence action: ${action}`);
    }
  }
  return actual;
}

async function main() {
  let raw;
  try {
    raw = await readStdin();
  } catch (err) {
    configError(null, `stdin read failed: ${err.message}`);
    return;
  }

  let envelope;
  try {
    envelope = JSON.parse(raw.trim());
  } catch (err) {
    configError(null, `input JSON parse failed: ${err.message}`);
    return;
  }

  const fixtureId = envelope.fixture_id;
  if (typeof fixtureId !== "string") configError(fixtureId, "missing fixture_id");

  const suite = envelope.suite;
  // schema-extraction has no `operation`; harness calls extractSchema (contract step 5).
  const operation = envelope.operation ?? (suite === "schema-extraction" ? "extractSchema" : undefined);

  // Construct the AvoInspector (contract step 3). A constructor throw is a
  // harness-level failure (passed:false) with exit code 1 — NOT a config error,
  // because the envelope itself was well-formed (e.g. error-handling validation).
  let inspector;
  try {
    inspector = new AvoInspector(envelope.constructor);
  } catch (err) {
    writeEnvelope({
      fixture_id: fixtureId,
      passed: false,
      actual: null,
      outcome: "resolve",
      error: `Constructor threw: ${err.message}`,
    });
    process.exit(1);
  }

  try {
    applyPrecondition(inspector, envelope.precondition, fixtureId);

    if (operation === "extractSchema") {
      // §4.3 — the entire `input` field IS the eventProperties argument; pass
      // null through unchanged (fixture-8).
      const actual = inspector.extractSchema(envelope.input);
      writeEnvelope({ fixture_id: fixtureId, passed: true, actual, outcome: "resolve", error: null });
      process.exit(0);
    }

    if (operation === "trackSchemaFromEvent") {
      const input = envelope.input || {};
      let outcome = "resolve";
      let actual;
      try {
        actual = await inspector.trackSchemaFromEvent(input.eventName, input.eventProperties, input.streamId);
      } catch (reason) {
        outcome = "reject";
        actual = reason;
      }
      writeEnvelope({ fixture_id: fixtureId, passed: true, actual, outcome, error: null });
      process.exit(0);
    }

    if (operation === "sequence") {
      const actual = await runSequence(inspector, envelope.steps, fixtureId);
      writeEnvelope({ fixture_id: fixtureId, passed: true, actual, outcome: "resolve", error: null });
      process.exit(0);
    }

    configError(fixtureId, `unsupported operation: ${operation}`);
  } catch (err) {
    // Unhandled runtime error after the envelope was parsed — exit code 1.
    writeEnvelope({
      fixture_id: fixtureId,
      passed: false,
      actual: null,
      outcome: "resolve",
      error: `harness runtime error: ${err.message}`,
    });
    process.exit(1);
  }
}

main();

export { HARNESS_CONTRACT_VERSION };
