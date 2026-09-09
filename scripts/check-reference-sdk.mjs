// Assert the reference SDK obeys the rules the fixture suite structurally cannot
// gate. Run: node scripts/check-reference-sdk.mjs  (or: npm run check:reference-sdk)
//
// WHY THIS EXISTS, since a conformance fixture would be the obvious home for it.
// The fixture suite drives an SDK through the harness and asserts the requests a
// mock server captured. For SPEC.md §7.2 and §4.1 that is not enough:
//
//   - A fixture asserting "zero requests captured" passes for three different
//     SDKs: one that validates and refuses the send (the required behavior), one
//     that never validates and whose HTTP client happens to reject the value, and
//     one that threw at construction. Verified rather than assumed: on Node both
//     fetch/undici and node:http reject a CR/LF header value before any bytes
//     leave the process. A fixture that passes for three reasons gates none.
//   - A constructor throw surfaces to the runner as exit code 1, which the runner
//     contract defines as a harness invocation failure rather than an assertion
//     result, so a fixture cannot tell "threw correctly" from "harness is broken".
//
// This script can discriminate because it runs IN PROCESS: it replaces fetch with
// a probe, so "the SDK refused" and "the HTTP client rejected" are distinguishable
// — the first never reaches the probe, the second does. That distinction is the
// whole content of §7.2, which requires the SDK to perform the check itself and
// not delegate it to a runtime whose behavior varies.
//
// Scope: this gates THIS repository's reference SDK. It cannot gate a generated
// SDK in another language; for those the rule remains a documented MUST plus the
// manual entries in conformance/runner/coverage-map.json.

import { AvoInspector } from "../conformance/runner/example-harness/sdk.mjs";

// SPEC.md §4.1 states this message as an exact-match requirement.
const SPEC_4_1_MESSAGE =
  "[Avo Inspector] API key contains a control character. The API key is sent as a request header and cannot contain CR, LF, or NUL.";

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

let passed = 0;
let failed = 0;
const check = (ok, name, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
};

const OPTS = { env: "dev", version: "1.0.0", appName: "check", disableBatchTimer: true };

// --- §4.1: the constructor rejects a control-character apiKey -----------------
console.log("§4.1 constructor rejects CR / LF / NUL in apiKey, with the exact message");
for (const [label, key] of [
  ["CR", "k" + CR + "x"],
  ["LF", "k" + LF + "x"],
  ["CRLF header injection", "k" + CR + LF + "X-Injected: 1"],
  ["NUL", "k" + NUL + "x"],
]) {
  let message = null;
  try {
    new AvoInspector({ apiKey: key, ...OPTS });
  } catch (err) {
    message = err.message;
  }
  if (message === null) check(false, `${label} rejected`, "constructor did not throw");
  else check(message === SPEC_4_1_MESSAGE, `${label} rejected with the §4.1 message`,
             message === SPEC_4_1_MESSAGE ? "" : `message was ${JSON.stringify(message)}`);
}
// Control: without this, a constructor that threw on EVERY key would pass above.
let constructed = true;
try {
  new AvoInspector({ apiKey: "clean-key", ...OPTS });
} catch {
  constructed = false;
}
check(constructed, "control: a clean apiKey still constructs");

// --- §7.2: the send is refused by the SDK, not by the HTTP client -------------
console.log("§7.2 the SDK refuses the send itself when a header value carries CR / LF / NUL");
const realFetch = globalThis.fetch;
let reachedFetch = false;
let lastCall = null;
globalThis.fetch = async (url, init) => {
  reachedFetch = true;
  // Capture the request so the controls can assert what was actually transmitted,
  // not merely that something was. Recording only "fetch happened" would let the
  // gzip claims below pass with compression removed or its threshold raised.
  lastCall = { url, headers: init?.headers ?? {}, body: init?.body };
  // If the SDK delegated the check to its HTTP client, execution arrives here.
  throw new Error("fetch was reached: the SDK did not perform its own §7.2 check");
};

// Header lookup is case-insensitive per RFC 9110; the SDK's casing is its own choice.
const headerOf = (call, name) => {
  const entries = Object.entries(call?.headers ?? {});
  const hit = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
  return hit ? hit[1] : undefined;
};
// gzip streams begin 0x1f 0x8b (RFC 1952). Checking the bytes, not just the header,
// means a body that merely CLAIMS to be gzipped cannot satisfy this.
const isGzipBytes = (body) =>
  body != null && body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;

try {
  // Simulate a bad value arriving past the constructor, which is how this would
  // occur in a real SDK: a field reassigned, a config reloaded, a subclass.
  const unsafe = new AvoInspector({ apiKey: "clean-key", ...OPTS });
  unsafe.enableLogging(false);
  unsafe.apiKey = "clean" + CR + LF + "X-Injected: yes";
  reachedFetch = false;
  const schema = await unsafe.trackSchemaFromEvent("evt", { a: 1 }, "s1");
  await unsafe.flush();
  check(!reachedFetch, "fetch is never reached — refused before the wire");
  check(Array.isArray(schema) && schema.length > 0,
        "trackSchemaFromEvent still resolves with the schema (§7.5)",
        `resolved with ${JSON.stringify(schema)}`);

  // Control: a guard that refused EVERY send would pass every check above.
  const clean = new AvoInspector({ apiKey: "clean-key", ...OPTS });
  clean.enableLogging(false);
  reachedFetch = false;
  lastCall = null;
  await clean.trackSchemaFromEvent("evt", { a: 1 }, "s1").catch(() => {});
  await clean.flush().catch(() => {});
  check(reachedFetch, "control: a clean apiKey DOES reach the wire — the guard discriminates");
  check(headerOf(lastCall, "Content-Encoding") === undefined,
        "a small body carries no Content-Encoding — the gzip threshold is pinned from both sides",
        `header was ${JSON.stringify(headerOf(lastCall, "Content-Encoding"))}`);

  // The guard sits after gzip and Content-Length are applied, so cover that path
  // too: it is the one the placement of the check actually affects.
  console.log("§7.2 the same holds on the gzipped path (body >= 1024 bytes)");
  const bigProps = {};
  for (let i = 0; i < 300; i += 1) bigProps[`property_number_${i}`] = `value-${i}`;

  const bigClean = new AvoInspector({ apiKey: "clean-key", ...OPTS });
  bigClean.enableLogging(false);
  reachedFetch = false;
  lastCall = null;
  await bigClean.trackSchemaFromEvent("big", bigProps, "s1").catch(() => {});
  await bigClean.flush().catch(() => {});
  check(reachedFetch, "control: a gzipped body with a clean key reaches the wire");
  // These three make the gzip claim a real regression check rather than a label.
  // Without them, removing compression or raising the threshold would still pass,
  // and the guard's position relative to gzip is exactly what could regress.
  check(headerOf(lastCall, "Content-Encoding") === "gzip",
        "the large body really is sent with Content-Encoding: gzip",
        `header was ${JSON.stringify(headerOf(lastCall, "Content-Encoding"))}`);
  check(isGzipBytes(lastCall?.body),
        "the transmitted payload really is gzip data, not just labelled as such");
  check(headerOf(lastCall, "Content-Length") === String(lastCall?.body?.length),
        "Content-Length matches the COMPRESSED payload, so it was set before the guard ran",
        `header ${JSON.stringify(headerOf(lastCall, "Content-Length"))} vs body ${lastCall?.body?.length}`);

  const bigUnsafe = new AvoInspector({ apiKey: "clean-key", ...OPTS });
  bigUnsafe.enableLogging(false);
  bigUnsafe.apiKey = "clean" + CR + LF + "X-Injected: yes";
  reachedFetch = false;
  await bigUnsafe.trackSchemaFromEvent("big", bigProps, "s1");
  await bigUnsafe.flush();
  check(!reachedFetch, "a gzipped body is refused too — the guard covers the final header set");
} finally {
  globalThis.fetch = realFetch;
}

console.log("");
if (failed > 0) {
  console.error(`${failed} check(s) failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`Reference SDK obeys §4.1 and §7.2 — ${passed} checks passed ✓`);
