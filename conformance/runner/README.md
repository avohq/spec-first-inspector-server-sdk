# Conformance Suite Runner

A reusable, language-agnostic **suite-runner** + **mock Inspector server** for the Avo Inspector
Server SDK conformance suite. SDK authors point this at their own harness binary and get a
PASS/FAIL report across all 30 fixtures — no need to re-derive the ~300 LOC of runner + mock for
every language.

The runner implements the normative protocol in
[`../runner-contract.md`](../runner-contract.md). Read that first; this README is the operational
how-to.

## Quick start (your own SDK)

Implement a thin CLI harness for your SDK per [`../runner-contract.md`](../runner-contract.md)
(read one JSON line from stdin, construct an `AvoInspector`, run the operation, write one JSON line
to stdout). Then point the runner at it:

```sh
node conformance/runner/suite-runner.mjs --harness "<command to launch your harness>"
```

Examples:

```sh
# Ruby
node conformance/runner/suite-runner.mjs --harness "ruby bin/conformance"

# Python
node conformance/runner/suite-runner.mjs --harness "python conformance.py"

# Go / Rust / Java (compiled binary on PATH or a wrapper script)
node conformance/runner/suite-runner.mjs --harness "./conformance"
```

The runner:

1. Loads all four fixture suites (`schema-extraction`, `wire-protocol`, `error-handling`,
   `batching`) and injects the `suite` field per the contract.
2. Starts one in-process mock HTTP server (Node `http`) and exports
   `AVO_INSPECTOR_MOCK_ENDPOINT` to the harness for **every** fixture — so an errant send is
   always captured locally and never escapes to a real endpoint (including `mock_response: null`
   fixtures, which then assert zero requests).
3. Spawns your harness once per fixture, pipes one input JSON line to stdin, reads one output JSON
   line from stdout.
4. Asserts everything the contract specifies: promise outcome, resolved value, exact
   `extractSchema` output, request count, request bodies (with `<uuid-v4>` / `<iso8601>` /
   `<semver>` / `<sdk-platform>` placeholder format-validation), `expected_request_bodies` as an
   **unordered multiset**, `expected_event_union_count`, `expected_unique_message_ids`, and
   `expected_request_headers` (including `content-encoding: null` for "no gzip").
5. Prints a per-fixture `[PASS]` / `[FAIL]` line and a `N/30 PASS` summary. Exit code `0` only when
   every fixture passes; non-zero otherwise.

A green run requires all 30 fixtures to pass. The default (no `--harness`) runs the bundled
non-normative example harness (see below).

## Files

| File | Purpose |
|---|---|
| `suite-runner.mjs` | The runner. Loads fixtures, drives the harness, asserts captured mock traffic. |
| `mock-server.mjs` | In-process mock Inspector server (`POST /`, `GET /requests`, `POST /reset`); gunzips gzipped bodies. |
| `example-harness/sdk.mjs` | **Non-normative** reference SDK (full §9 extraction, batching, gzip, sampling). |
| `example-harness/harness.mjs` | **Non-normative** thin CLI harness wiring the example SDK to the protocol. |
| `coverage-map.json` | Machine-readable map of SPEC behaviors → gating fixtures (and which remain manual). |

## The `example-harness/` is a non-normative worked example

`example-harness/sdk.mjs` and `example-harness/harness.mjs` are a **non-normative** worked example:
a minimal zero-dependency Node SDK plus its thin harness, used to self-test the runner and
demonstrate the protocol end to end. They are **not** a maintained product SDK. The normative
source of truth is [`../../SPEC.md`](../../SPEC.md) and [`../runner-contract.md`](../runner-contract.md);
where the example and the spec ever disagree, the spec wins. Do not copy the example SDK into
production — generate your SDK from the spec and prove it with this runner.

## Requirements

- Node.js ≥ 18 (uses `fetch`, `AbortController`, `structuredClone`-free built-ins only).
- **Zero runtime dependencies.** The runner and mock use only Node built-ins (`http`, `zlib`,
  `child_process`, `fs`, `crypto`, `path`, `url`).

## Run via npm

```sh
npm run conformance:run                       # default example harness
npm run conformance:run -- --harness "ruby bin/conformance"
```

## Honest limitations

- **Concurrency (`trackN`, `batch-6`):** on single-threaded async runtimes (Node, single-threaded
  Python asyncio) the harness exercises concurrent *scheduling*, not true parallelism. The union
  assertion (`expected_event_union_count` + `expected_unique_message_ids`) is interleaving-invariant,
  so a conformant SDK passes regardless — but true-parallelism stress is a runtime property the SDK
  should additionally cover in its own tests. See `../README.md`.
- **Not automated here** (need a controllable clock or a connection-drop mock): the time/idle
  scheduled flush (§12.3) and transient send-failure drop (§12.5). These remain in the manual
  matrix in [`../README.md`](../README.md) and are listed under `manual` in `coverage-map.json`.
- **Harness command tokenization:** `--harness` is split on whitespace (no shell). This covers
  `node path/to/harness.mjs`, `ruby bin/conformance`, `./conformance`, etc. If your launch command
  needs shell features, wrap it in a script and pass the script path.
