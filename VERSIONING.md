# Versioning Policy

This repository follows [Semantic Versioning 2.0.0](https://semver.org/) for
the spec itself. The version number signals to downstream SDK authors whether
they need to regenerate their SDK.

## Version Increment Rules

| Version Component | When it changes | Downstream SDK action |
|---|---|---|
| **MAJOR** (`X.0.0`) | Breaking wire-protocol change: new required request field, changed HTTP endpoint, changed enum values, changed field type contract, or any change that would make a previously conformant SDK non-conformant | **MUST regenerate** |
| **MINOR** (`1.X.0`) | Additive wire-protocol change or new optional feature: new optional request field, new OPTIONAL conformance suite, new conformance fixtures for existing behavior | **SHOULD regenerate** to gain the new feature or coverage |
| **PATCH** (`1.0.X`) | Documentation clarification, typo fix, prose rewrite with no normative change, new conformance fixture for already-specified behavior | **MAY ignore** — no behavioral change |

## Changelog Tags

Each `CHANGELOG.md` entry is tagged to make the urgency explicit:

- **`[WIRE]`** — Wire-protocol normative change. Treat as MAJOR or MINOR
  depending on the version bump. Downstream SDKs MUST (MAJOR) or SHOULD
  (MINOR) regenerate.
- **`[SPEC]`** — Documentation-only update. Corresponds to a PATCH release.
  Downstream SDKs MAY ignore.

## Downstream SDK Spec Version Declaration

Downstream SDKs MUST declare the spec version they were generated from.
This makes it easy for maintainers and users to know whether a regeneration
is needed when a new spec release appears.

### Recommended approaches by language

| Language | How to declare |
|---|---|
| Node.js / npm | `avo-inspector-spec-version` field in `package.json`, or a comment in the generated README |
| Ruby / RubyGems | `spec.metadata["avo_inspector_spec_version"]` in the `.gemspec` |
| Python / PyPI | `[project.urls] "Spec-Version"` in `pyproject.toml`, or a module-level constant |
| Go | `const AvoInspectorSpecVersion = "1.0.0"` in `version.go` |
| Rust / Cargo | `[package.metadata] avo_inspector_spec_version = "1.0.0"` in `Cargo.toml` |
| Other | A `AVO_INSPECTOR_SPEC_VERSION` constant in a dedicated version file |

At minimum, the SDK README MUST include a badge or note stating:
`Implements avohq/spec-first-inspector-server-sdk v<X.Y.Z>`.

## Spec Version vs. SDK Version

The spec version and the generated SDK's own library version are independent:

- The **spec version** (`avohq/spec-first-inspector-server-sdk` tag) identifies
  which version of this contract the SDK implements.
- The **SDK library version** (`libVersion` in the wire body) identifies the
  version of the generated SDK itself, managed by the SDK author.

Both are SemVer strings but they are not the same number. An SDK at library
version `2.3.1` may implement spec version `1.0.0`.
