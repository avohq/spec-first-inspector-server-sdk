# Interview Brief: spec-first-server-sdk

**Feature name:** `spec-first-server-sdk`
**Date:** 2026-05-25
**Target repo:** `git@github.com:avohq/spec-first-inspector-server-sdk.git`
**Source-of-truth implementation for extraction:** this repo (`node-avo-inspector`, v1.2.0)

## Problem & Motivation

A customer just asked for a Ruby Avo Inspector SDK. Avo does not want to build and maintain per-language server SDKs (Ruby, Python, Rust, Scala, C#, Go, etc.) — the cost of maintaining N implementations across language ecosystems is prohibitive.

Instead, Avo wants to ship a **spec-first repo** that any customer (or their AI coding agent — Claude, Cursor, Codex, Gemini, etc.) can use to materialize an Inspector SDK in their language of choice. The spec is canonical; SDKs are derivable artifacts.

This is the first "prompt-source / AI-native open source" repo in Avo's portfolio. The pattern: instead of distributing N hand-written SDKs, distribute one well-specified contract + conformance suite, and let AI agents produce the rest.

## Goals

1. Customer with the Ruby ask can generate a working Ruby Inspector SDK in <1 hour by pointing their AI agent at this repo.
2. Avo eliminates the need to staff/maintain Ruby/Python/Rust/Scala/C#/Go SDKs.
3. Same spec produces functionally equivalent SDKs across languages (verified by a shared conformance suite).
4. The spec is durable: when the Inspector wire protocol evolves, a single spec update + regenerate updates all downstream SDKs.

## Scope

### In scope (v1)
- Specification repo at `avohq/spec-first-inspector-server-sdk`.
- Spec format: **prose markdown + machine-readable schemas** (OpenAPI for wire protocol, JSON Schema for event/data shapes). Hybrid.
- **Language-agnostic conformance test suite** that any generated SDK must pass:
  - Schema extraction golden tests (input value → expected extracted schema, as JSON fixtures).
  - HTTP wire fixtures (recorded request/response pairs against the Inspector API).
  - Batching / session behavior scenarios (time-based: N events in T seconds → expected batch boundaries).
  - Error / retry semantics (network failure, 4xx/5xx → expected retry/drop behavior).
- "Generate your own SDK" guide for AI agents (an `AGENTS.md` / instructions for AI consumption).
- Versioned spec releases (semver) with a CHANGELOG that explicitly calls out **wire-protocol changes** vs. **spec clarifications** — critical for SDK regen decisions.
- Inventory of the public API surface extracted from the node SDK (class names, methods, options, defaults).

### Out of scope (v1)
- Building a Ruby (or any other) reference SDK ourselves.
- Hosting / packaging generated SDKs (RubyGems, PyPI, etc.) — that is the customer's problem.
- Migrating `node-avo-inspector` to be generated from the spec (future possibility; not v1).
- Browser/client-side SDK concerns. This spec is **server-side only**.
- Telemetry / usage reporting from generated SDKs (open question — see below).

## Audience

**Both, AI-first.** Primarily written for AI coding agents to consume and produce SDKs from, but readable by humans (engineers reviewing or hand-writing an SDK) as a fallback. Implication: heavy use of examples, structured contracts, and explicit invariants — minimize ambiguity that an LLM would have to guess at.

## Source-of-Truth Strategy

**The Inspector HTTP wire protocol is the true source of truth.** Both the node SDK and the spec describe how to talk to it. The spec does NOT try to mirror node SDK internals — it captures the contract (what the API expects, what events look like, what the public SDK surface should be).

**Practical implication for extraction:** when reading the node SDK to write the spec, distinguish:
- Behaviors that come from the wire protocol (MUST be in the spec).
- Behaviors that are node-idiomatic choices (MAY be adapted by other languages).
- Behaviors that are node-specific quirks (should NOT propagate — flag them).

## Public API Surface (preserve as-is, idiomatically renamed per language)

All of the following must map across languages, with idiomatic naming (e.g. `trackSchemaFromEvent` → `track_schema_from_event` in Ruby/Python, `TrackSchemaFromEvent` in Go/C#):

- **Class:** `AvoInspector` (top-level entry point).
- **Methods:** `trackSchemaFromEvent`, `extractSchema`, and any other public methods on `AvoInspector` (to be enumerated by the spec-writer agent from `src/AvoInspector.ts`).
- **Constructor options shape:** `apiKey`, `env`, `version`, `appName`, `suffix` — same names and semantics across all SDKs.
- **Env enum values:** the strings `"dev"`, `"staging"`, `"prod"` MUST match exactly — the wire protocol depends on these literal values.
- **Batching defaults:** same default batch size, flush interval, and retry behavior across all generated SDKs (extract concrete numbers from `AvoInspector.ts` / `AvoNetworkCallsHandler.ts`).

## Server-Side Requirements (codify these in the spec)

Based on inspection of the node SDK, which is already pure-server:

- **Mandate thread/async safety.** Stronger than the node SDK today, but required for Ruby/Python/Go/JVM servers that are concurrent by default. Spec must call this out as a generation requirement.
- **No persistent storage.** In-memory only; explicit flush; no disk writes. (Codifies what node already does.)
- **Drop sessionId / visitorId / userId entirely.** Server SDKs do not model end-user sessions. The node SDK already does this (sessionId is `""`, no visitorId). Spec should make this explicit so AI agents don't "helpfully" add browser-style session tracking.
- **Make keepalive timer optional.** The node SDK uses `setInterval` for a keepalive; this prevents process exit. The spec must either make this opt-in or document it as a gotcha so generated SDKs don't hang server shutdowns (Ruby/Python long-running workers, serverless function lifecycles).

## Conformance Suite Requirements

Language-agnostic test artifacts that any generated SDK must validate against:

1. **Schema extraction golden tests** — JSON fixtures: `{ input: <value>, expected: <extractedSchema> }`. Extracted from `AvoSchemaParser.ts` test cases.
2. **HTTP wire fixtures** — recorded request/response pairs. Generated SDK replays the scenario; emitted requests must match (modulo field ordering / whitespace).
3. **Batching / session behavior** — time-based scenarios: N events submitted across T seconds → expected number of batches and their contents.
4. **Error / retry semantics** — simulated 4xx, 5xx, network failure → expected retry count, backoff, and drop behavior.

The suite must be runnable in a language-agnostic way (likely: SDK exposes a thin CLI / test harness; tests are JSON/YAML data + a runner that the SDK author wires up). Spec should propose a concrete shape, not just hand-wave.

## Versioning & Distribution

- **Versioned spec releases (semver).**
- **CHANGELOG distinguishes wire-protocol changes from spec clarifications.** Wire-protocol changes force regen / version bump in all downstream SDKs; clarifications do not.
- Generated SDKs are expected to declare which spec version they implement (e.g. in a README, gemspec, etc.).

## Existing Patterns to Reuse from node-avo-inspector

The spec-writer agent should read and extract from:
- `src/AvoInspector.ts` — public API surface, constructor options, batching defaults, keepalive behavior.
- `src/AvoInspectorEnv.ts` — env enum.
- `src/AvoSchemaParser.ts` + `src/__tests__/` — schema extraction logic and test cases (these become golden fixtures).
- `src/AvoNetworkCallsHandler.ts` — HTTP wire protocol, request/response shape, retry/error handling.
- `src/AvoDeduplicator.ts` — event deduplication logic (decide: is this wire-protocol or node-specific?).
- `src/AvoEncryption.ts` — flag for review (is encryption part of the contract, or node-specific?).
- `src/AvoGuid.ts`, `src/AvoStreamId.ts` — ID generation; decide if format is part of the contract.

## Acceptance Criteria

- [ ] Spec repo structure is defined (file layout, what lives where).
- [ ] Public API surface is fully inventoried from `src/AvoInspector.ts` with method signatures, semantics, and per-language naming conventions.
- [ ] Constructor options are documented with types, defaults, and validation rules.
- [ ] Env enum is documented with exact string values and wire-protocol implications.
- [ ] Batching defaults (size, interval, retry policy) are documented with extracted concrete numbers.
- [ ] HTTP wire protocol is specified (endpoint, headers, request/response JSON shapes) — OpenAPI document.
- [ ] Schema extraction algorithm is specified with at least 10 golden test fixtures covering primitives, nested objects, arrays, nulls, and edge cases.
- [ ] Conformance suite shape is defined (file layout, runner contract, how an SDK author wires it up).
- [ ] Server-side requirements (thread safety, no persistence, no session/visitor IDs, optional keepalive) are explicitly stated.
- [ ] An `AGENTS.md` / "how to generate an SDK from this spec" guide is included, written for AI agent consumption.
- [ ] Versioning + CHANGELOG conventions are documented (wire-protocol changes vs. clarifications).
- [ ] Source-of-truth strategy is documented (wire protocol is SoT; this spec and node SDK both implement it).
- [ ] Open questions (API docs availability, auth/API key handling, SDK license) are tracked in the spec.

## Open Questions (to flag in the spec, not necessarily resolve in v1)

1. **Inspector API docs availability.** Do public/internal API docs exist that the spec should reference, or is the spec being reverse-engineered from `AvoNetworkCallsHandler.ts`? If docs exist, the spec should link them as authoritative; if not, the spec extraction process should be documented so it can be re-validated when docs do exist.
2. **Auth & API key handling.** How API keys flow (header name, format), any rotation behavior, error response on invalid key. May need product/backend input — flag for review.
3. **License of generated SDKs.** What license customers' AI-generated SDKs inherit, and what the spec repo itself is licensed under (MIT, like the node SDK?). Generated SDKs are derivative works of the spec; spec license should be permissive.

## Notes for the Spec Writer

- This is an **extraction + design** task, not a greenfield design. Start by reading the node SDK source comprehensively.
- When in doubt about whether a behavior is wire-protocol or node-idiomatic, flag it as an open question rather than guessing.
- Optimize the spec for AI consumption: heavy use of examples, structured tables, explicit MUST/SHOULD/MAY language (RFC 2119 style), and machine-readable contracts where possible.
- The spec repo doesn't exist yet — this spec is the design for what should go into it.
