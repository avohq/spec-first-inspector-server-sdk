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

At minimum, the SDK README MUST include a badge or note stating:
`Implements avohq/spec-first-inspector-server-sdk v<X.Y.Z>`.

### Per-Language Declaration Patterns

| Language | Declaration location | Example |
|---|---|---|
| Node.js / npm | `avo-inspector-spec-version` field in `package.json` | `"avo-inspector-spec-version": "1.0.0"` |
| Python / PyPI | Module-level constant `__spec_version__` in the package `__init__.py` | `__spec_version__ = "1.0.0"` |
| Go | Package-level constant in `version.go` | `const SpecVersion = "1.0.0"` |
| Ruby / RubyGems | `spec.metadata["avo_inspector_spec_version"]` in the `.gemspec` | `"avo_inspector_spec_version" => "1.0.0"` |
| Java / Kotlin (Maven) | `<properties>` block in `pom.xml`, or a `SpecVersion` constant | `public static final String SPEC_VERSION = "1.0.0";` |
| Rust / Cargo | `[package.metadata]` in `Cargo.toml`, or a module constant | `pub const SPEC_VERSION: &str = "1.0.0";` |
| C# / .NET | Assembly attribute or a `SpecVersion` constant | `public const string SpecVersion = "1.0.0";` |
| Other | A `AVO_INSPECTOR_SPEC_VERSION` constant in a dedicated version file | any non-empty string constant |

The constant name SHOULD be `SpecVersion`, `SPEC_VERSION`, or `__spec_version__`
(language-idiomatic casing). The value MUST be the exact SemVer tag of the spec
release the SDK was generated from (e.g., `"1.0.0"`).

## Spec Version vs. SDK Version

The spec version and the generated SDK's own library version are independent:

- The **spec version** (`avohq/spec-first-inspector-server-sdk` tag) identifies
  which version of this contract the SDK implements.
- The **SDK library version** (`libVersion` in the wire body) identifies the
  version of the generated SDK itself, managed by the SDK author.

Both are SemVer strings but they are not the same number. An SDK at library
version `2.3.1` may implement spec version `1.0.0`.

## SDK Regeneration Decision Guide

When a new spec release appears, SDK authors SHOULD use this decision tree:

1. Is the release tagged `[WIRE]`? → Check the version bump.
   - MAJOR bump → **MUST regenerate** to remain conformant.
   - MINOR bump → **SHOULD regenerate** to gain the new optional feature.
2. Is the release tagged `[SPEC]` only? → Regeneration is **MAY** (optional).
   No behavioral change; the existing SDK remains fully conformant.
3. After regenerating, update the declared spec version constant and the README
   badge to the new release tag.

SDK authors SHOULD subscribe to GitHub release notifications for
`avohq/spec-first-inspector-server-sdk` to be alerted when a `[WIRE]` release
requires regeneration.
