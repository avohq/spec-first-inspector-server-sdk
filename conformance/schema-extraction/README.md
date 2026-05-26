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
  "propertyType": "string | int | float | boolean | null | object | list(string) | list(int) | list(float) | list(boolean) | list(null) | list(object) | unknown",
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
| fixture-3 | Empty and falsy values, including `0.0` -> `"float"` (not `"int"`) |
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

### `0.0` Must Be `"float"` (fixture-3)

`0.0` MUST be classified as `"float"`, not `"int"`. This is intentionally different from the
Node.js reference SDK, which uses `Number.isInteger` and returns `"int"` for `0.0`. Generated
SDKs in statically-typed languages (Go, Java, Rust, C#, Scala) MUST use the declared/runtime
type: `float32`/`float64`/`double` -> `"float"`; `int`/`int64`/`long` -> `"int"`. In dynamically
typed languages (Ruby, Python): `Float` -> `"float"`; `Integer` -> `"int"`.

### Null Input Returns `[]` (fixture-8)

`extractSchema(null)` MUST return `[]`, not throw.

### Children Structure in Heterogeneous Arrays (fixture-7)

For an array like `[1.2, "two", {"three": 3}]`, `children` contains the output of `mapping()`
applied to each element after `removeDuplicates`:

- `mapping(1.2)` -> `"float"` (primitive type string)
- `mapping("two")` -> `"string"` (primitive type string)
- `mapping({"three": 3})` -> `[{"propertyName": "three", "propertyType": "int"}]` (SchemaEntry array)

Result: `["float", "string", [{"propertyName": "three", "propertyType": "int"}]]`

## Running Against This Suite

Implement a conformance harness per the runner contract in `SPEC.md`. For schema-extraction
fixtures, invoke your SDK's `extractSchema` method with the `input` value and compare the
result against `expected` using deep structural equality.

```sh
# Validate fixture JSON is parseable
python3 -m json.tool conformance/schema-extraction/fixtures.json > /dev/null && echo valid

# Verify fixture count
python3 -c "import json; f=json.load(open('conformance/schema-extraction/fixtures.json')); assert len(f)==13"
```
