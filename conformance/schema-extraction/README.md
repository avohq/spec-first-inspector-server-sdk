# Schema Extraction Conformance Suite

This suite verifies the `extractSchema` / `AvoSchemaParser.extractSchema` function.

## Fixture File

`fixtures.json` — 13 golden fixtures (IDs `fixture-1` through `fixture-13`).

## Fixture Schema

Each fixture is a JSON object with four fields:

```json
{
  "fixture_id": "fixture-N",
  "description": "Human-readable description of what this fixture tests",
  "input": {},
  "expected": []
}
```

| Field | Type | Description |
|---|---|---|
| `fixture_id` | string | Unique identifier (`fixture-1` through `fixture-13`). |
| `description` | string | Human-readable description of the scenario. |
| `input` | object or null | The event properties object passed to `extractSchema`. May be `null` (fixture-8). |
| `expected` | array | The exact `Array<SchemaEntry>` the implementation must return. |

A `SchemaEntry` is:

```json
{
  "propertyName": "string",
  "propertyType": "string | int | float | boolean | null | object | list(string) | list(int) | list(float) | list(boolean) | list(object) | unknown",
  "children": []
}
```

`children` is present when `propertyType` is `"object"` or any list type. It is absent for
primitive scalar types (`string`, `int`, `float`, `boolean`, `null`, `unknown`).

## Fixture Summary

| Fixture | What it tests |
|---|---|
| fixture-1 | Basic primitives: boolean, int, string, float |
| fixture-2 | Null values |
| fixture-3 | Empty and falsy values (float-zero `0.0` excluded — typed-language-only, see §9.3.1) |
| fixture-4 | Nested object with children |
| fixture-5 | Simple list of strings; children deduplication |
| fixture-6 | Empty array defaults to `list(string)` |
| fixture-7 | Heterogeneous array; type from first element; children structure |
| fixture-8 | Null top-level input returns `[]` |
| fixture-9 | Complex array with nested objects and nested arrays |
| fixture-10 | List deduplication of repeated primitive values |
| fixture-11 | Object with a nested list property |
| fixture-12 | All property types in one event |
| fixture-13 | 3-level nesting (recursion conformance) |

## Critical Notes

### `0.0` → `"float"` is a statically-typed-language invariant (NOT tested by fixture-3)

Float-zero is intentionally **excluded** from the universal fixtures. `0.0 → "float"` is a **MUST**
only for statically-typed languages (Go, Java, Rust, C#, Scala), where the declared type is
authoritative: `float32`/`float64`/`double` -> `"float"`; `int`/`int64`/`long` -> `"int"`. It is
**RECOMMENDED** in dynamically-typed languages with a distinct float type (Ruby, Python: `Float` ->
`"float"`). In **JavaScript/TypeScript**, `0.0` and `0` are the same runtime value and the canonical
reference parser (`node-avo-inspector`) emits `"int"` for any whole-valued float — so JS/TS SDKs are
**not required** to emit `"float"` for `0.0`, and matching the reference (`"int"`) is conformant.
See SPEC.md §9.3.1.

### List Edge Cases (empty list, `list(object)`, null elements)

Empty `[]` → `"list(string)"` with `children: []`. An array of objects **or** an array of arrays →
`"list(object)"`. `"list(null)"` is **not** a valid `propertyType`. A `null`/`undefined` element
inside a list is a JS-reference quirk (its child maps to `[]` / `"null"` respectively) and is not a
conformance gate. See SPEC.md §9.3.4.

### Null Input Returns `[]` (fixture-8)

`extractSchema(null)` MUST return `[]`, not throw.

### Children Structure in Heterogeneous Arrays (fixture-7)

For an array like `[1.2, "two", {"three": 3}]`, `children` contains the output of `mapping()`
applied to each element after `removeDuplicates`:

- `mapping(1.2)` -> `"float"` (primitive type string)
- `mapping("two")` -> `"string"` (primitive type string)
- `mapping({"three": 3})` -> `[{"propertyName": "three", "propertyType": "int"}]` (SchemaEntry array)

Result: `["float", "string", [{"propertyName": "three", "propertyType": "int"}]]`

## Parser Configuration for Fixture Input

When a statically-typed SDK materializes JSON fixture numbers into declared types, it SHOULD
preserve the `int` vs. `float` distinction from the literal source (a JSON `3` -> integer, a JSON
`3.14` -> float). The universal fixtures avoid the only ambiguous case (whole-valued floats such as
`0.0`; see §9.3.1), so no special parser handling is required to pass this suite.

See **SPEC.md §9.3.1.1** for the per-language parser configuration guidance.

## Running Against This Suite

Implement a conformance harness per the runner contract in `conformance/runner-contract.md`.
For schema-extraction fixtures, invoke your SDK's `extractSchema` method with the `input`
value and compare the result against `expected` using deep structural equality.

```sh
# Validate fixture JSON is parseable
python3 -m json.tool conformance/schema-extraction/fixtures.json > /dev/null && echo valid

# Verify fixture count
python3 -c "import json; f=json.load(open('conformance/schema-extraction/fixtures.json')); assert len(f)==13"
```
