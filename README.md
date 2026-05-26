# spec-first-inspector-server-sdk

The single source of truth for Avo Inspector server-side SDK implementations.
This repository contains a canonical specification, machine-readable schemas,
and a language-agnostic conformance suite. AI coding agents (and engineers)
can use these artifacts to generate a conformant Inspector SDK in any
server-side language — without waiting for Avo to release one.

## What is this?

The Avo Inspector HTTP wire protocol is stable and well-understood. Rather than
maintaining N hand-written SDKs across language ecosystems, Avo distributes one
spec plus a conformance suite and lets customers (or their AI agents) generate
conformant SDKs on demand.

This repo is Avo's first **AI-native open source** artifact: optimized for AI
agent consumption, not hand-written maintenance.

## Quick Start

**Generate a conformant Inspector SDK in your language in three steps:**

1. **Clone this repo**

   ```sh
   git clone https://github.com/avohq/spec-first-inspector-server-sdk.git
   cd spec-first-inspector-server-sdk
   ```

2. **Read `AGENTS.md`**

   Point your AI agent (Claude, Cursor, Codex, Gemini, etc.) at [`AGENTS.md`](./AGENTS.md).
   It contains the complete SDK generation checklist, the ordered reading list,
   how to run the conformance suite, and the definition of done.

3. **Generate and verify**

   Let the agent generate the SDK, implement the conformance harness
   (`avo-inspector-conformance`), and run the fixture suite to verify
   correctness before shipping.

## Repository Layout

| File / Directory | Purpose |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | AI-agent guide: checklist, reading order, conformance, definition of done |
| [`SPEC.md`](./SPEC.md) | Full normative prose specification (RFC 2119 language throughout) |
| [`openapi.yaml`](./openapi.yaml) | OpenAPI 3.1 document for the Inspector HTTP API |
| [`schemas/`](./schemas/) | JSON Schema files for each data shape |
| [`conformance/`](./conformance/) | Language-agnostic conformance fixtures and runner contract |
| [`CHANGELOG.md`](./CHANGELOG.md) | Semver-tagged changelog distinguishing wire-protocol changes from clarifications |
| [`VERSIONING.md`](./VERSIONING.md) | Versioning policy and downstream SDK regeneration rules |
| [`LICENSE`](./LICENSE) | MIT license |

## Key Links

- **Normative spec:** [`SPEC.md`](./SPEC.md)
- **AI agent guide:** [`AGENTS.md`](./AGENTS.md)
- **Conformance suite:** [`conformance/`](./conformance/)
- **Changelog:** [`CHANGELOG.md`](./CHANGELOG.md)
- **Versioning policy:** [`VERSIONING.md`](./VERSIONING.md)

## Who is this for?

- **Customer engineers** who need an Inspector SDK in a language Avo does not
  officially publish (Ruby, Python, Rust, Go, Scala, C#, etc.).
- **AI coding agents** tasked with generating a conformant SDK — start with
  `AGENTS.md`.
- **Avo engineers** who want a single place to update when the wire protocol
  changes, so all downstream SDKs can be regenerated without per-language work.

## License

[MIT](./LICENSE) — generated SDKs may use any license the customer chooses.
