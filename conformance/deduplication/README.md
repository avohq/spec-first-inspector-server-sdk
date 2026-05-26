# Deduplication Conformance Suite

> **OPTIONAL** — Deduplication conformance is **OPTIONAL**. SDKs that do not implement the
> deduplication optimization still conform to the spec and pass all required conformance suites.
> See SPEC.md Section 11.1 for the rationale.

This suite verifies that an SDK's deduplication subsystem does not suppress events it should send.
The fixtures are single-invocation baselines — they confirm the non-suppressed path only.

## Fixtures

| Fixture ID | Description |
|---|---|
| `dedup-1` | Single `trackSchemaFromEvent` call — 1 HTTP call expected (manual path, no suppression) |
| `dedup-2` | Single `_avoFunctionTrackSchemaFromEvent` call — 1 HTTP call expected, `avoFunction=true` in wire body |

## Single-Invocation Limitation

The conformance harness uses a **single-invocation protocol**: the suite runner starts a fresh
harness process for each fixture, passes one fixture as JSON via stdin, and reads one result from
stdout. The harness process exits after each fixture.

Because deduplication state is in-memory and ephemeral (SPEC.md Section 3.2), it does not survive
process restarts. This means **cross-bucket suppression scenarios — where one invocation sets up
bucket state that suppresses a second invocation — cannot be represented as conformance fixtures**.

The following cross-bucket scenarios MUST be tested manually by the SDK author:

### Manual Test: Cross-Bucket Suppression (avoFunctions → manual)

1. In a single running process, call `_avoFunctionTrackSchemaFromEvent("Order Placed", props, id, hash)`.
2. Within 500 ms, call `trackSchemaFromEvent("Order Placed", props)` with the same properties.
3. Expected: the second call is suppressed (no HTTP request sent for it). The first call sends normally.

### Manual Test: Cross-Bucket Suppression (manual → avoFunctions)

1. In a single running process, call `trackSchemaFromEvent("Order Placed", props)`.
2. Within 500 ms, call `_avoFunctionTrackSchemaFromEvent("Order Placed", props, id, hash)` with the same properties.
3. Expected: the second call is suppressed. The first call sends normally.

### Manual Test: Same-Bucket Non-Suppression

1. In a single running process, call `trackSchemaFromEvent("Order Placed", props)`.
2. Immediately call `trackSchemaFromEvent("Order Placed", props)` again.
3. Expected: **both** calls send HTTP requests. Same-bucket duplicate calls are NOT suppressed
   (SPEC.md Section 11.6).

### Manual Test: Cross-Stream Non-Deduplication

1. Call `trackSchemaFromEvent("Order Placed", props, "stream-A")`.
2. Call `trackSchemaFromEvent("Order Placed", props, "stream-B")` — different streamId.
3. Expected: both calls send HTTP requests. Different stream IDs produce different dedup keys
   (SPEC.md Section 11.7).

### Manual Test: 500 ms Window Eviction

1. Call `_avoFunctionTrackSchemaFromEvent("Order Placed", props, id, hash)`.
2. Wait more than 500 ms.
3. Call `trackSchemaFromEvent("Order Placed", props)`.
4. Expected: the second call sends an HTTP request (the first call's dedup entry has been evicted).

## Dedup Algorithm Reference

See SPEC.md Section 11 for the full deduplication specification:

- **Two buckets:** `avoFunctions` (Codegen path) and `manual` (manual instrumentation path).
- **Dedup key:** `streamId + "\0" + eventName` (null-byte separator).
- **Parameter matching:** deep structural equality on `eventProperties`.
- **Window:** 500 ms. Events older than 500 ms are evicted; a subsequent duplicate is re-registered and sent.
- **Cross-bucket suppression:** A record in `avoFunctions` suppresses a matching record in `manual`
  (and vice versa) within 500 ms. Both records are deleted on suppression (one-shot deletion).
- **Same-bucket:** Two calls in the same bucket for the same event are NOT suppressed.

## Conformance Definition

An SDK **passes** the deduplication suite (when deduplication is implemented) when:

- `dedup-1`: The harness exits with code `0` and exactly 1 HTTP request is recorded.
- `dedup-2`: The harness exits with code `0` and exactly 1 HTTP request is recorded with
  `avoFunction: true`, `eventId: "evt-123"`, and `eventHash: "abc456"` in the wire body.

SDKs that do not implement deduplication MUST still pass `dedup-1` and `dedup-2` (both fixtures
test the non-suppressed path, which all conformant SDKs send regardless of dedup implementation).

## Running the Suite

See [`conformance/runner-contract.md`](../runner-contract.md) for the full harness protocol.
The deduplication suite uses the same mock server protocol as the wire-protocol suite
(`AVO_INSPECTOR_MOCK_ENDPOINT`).
