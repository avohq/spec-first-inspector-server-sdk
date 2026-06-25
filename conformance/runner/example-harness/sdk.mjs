// =============================================================================
// NON-NORMATIVE REFERENCE SDK — NOT A MAINTAINED PRODUCT.
// =============================================================================
//
// This is a minimal, zero-dependency Node implementation of the Avo Inspector
// server SDK. It exists ONLY to (a) self-test the conformance suite-runner and
// (b) demonstrate the harness protocol (conformance/runner-contract.md) end to
// end. It is deliberately not packaged, not published, and not maintained as a
// product. The normative source of truth is SPEC.md; where this file and SPEC.md
// ever disagree, SPEC.md wins. Do NOT copy this verbatim into a production SDK —
// generate your SDK from SPEC.md and prove it with the suite-runner.
//
// Implemented per SPEC.md: §4 (public API), §7 (wire protocol incl. §7.3.5 gzip,
// §7.5 error taxonomy + at-most-once), §8 (UUID v4 / ISO-8601), §9 (schema
// extraction), §12 (batching / flush / destroy / maxQueueSize FIFO).
// =============================================================================

import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

const HARNESS_CONTRACT_VERSION = "1.0.0";
const LIB_VERSION = "1.0.0"; // plain SemVer, no suffix (SPEC §7.3.3)
const LIB_PLATFORM = "node"; // <sdk-platform> (SPEC §7.3.1)
const PROD_ENDPOINT = "https://api.avo.app/inspector/v1/track";
const VALID_ENVS = new Set(["dev", "staging", "prod"]);
const GZIP_THRESHOLD_BYTES = 1024; // SPEC §7.3.5
const REQUEST_TIMEOUT_MS = 10_000; // SPEC §7.6
const DEFAULT_FLUSH_TIMEOUT_MS = 10_000; // SPEC §4.6

// Process-wide logging flag (SPEC §4.4).
let _shouldLog = false;

// ---------------------------------------------------------------------------
// §9 Schema extraction (AvoSchemaParser). The parser itself has no try/catch;
// the safe wrapper lives in AvoInspector.extractSchema (§4.3).
// ---------------------------------------------------------------------------

/**
 * Classify a scalar value into its basic Inspector property type (SPEC §9.3.1).
 * Whole-valued numbers classify as "int", non-whole as "float"; null/undefined => "null".
 * @param {*} val - The scalar value to classify.
 * @returns {string} One of "null" | "string" | "int" | "float" | "boolean" | "object" | "unknown".
 */
function getBasicPropType(val) {
  if (val === null || val === undefined) return "null";
  const t = typeof val;
  if (t === "string") return "string";
  if (t === "number" || t === "bigint") {
    // JS/TS reference behavior (§9.3.1): whole-valued floats classify as "int"
    // because they have no decimal point; non-whole numbers are "float".
    return Number.isInteger(val) ? "int" : "float";
  }
  if (t === "boolean") return "boolean";
  if (t === "object") return "object";
  return "unknown";
}

/**
 * Resolve the property-value type, returning a `list(<elemType>)` wrapper for
 * arrays (element type from the first item; empty/null-first => "list(string)").
 * @param {*} val - The property value.
 * @returns {string} The basic type, or a `list(...)` type string for arrays.
 */
function getPropValueType(val) {
  if (Array.isArray(val)) {
    const first = val[0];
    if (first === null || first === undefined) return "list(string)";
    return `list(${getBasicPropType(first)})`;
  }
  return getBasicPropType(val);
}

/**
 * Deduplicate mapping() output by deep structural equality, preserving first-seen
 * order (SPEC §9.3.3).
 * @param {Array} arr - The mapped entries (objects or type strings).
 * @returns {Array} A new array with structural duplicates removed.
 */
// Deduplicate mapping() output: primitives by value, arrays/objects by deep
// structural equality (§9.3.3 — observably identical to reference-identity for
// the conformance fixtures, whose elements are distinct by construction).
function removeDuplicates(arr) {
  const out = [];
  for (const item of arr) {
    const dup = out.some((seen) => deepEqual(seen, item));
    if (!dup) out.push(item);
  }
  return out;
}

/**
 * Recursive structural deep-equality used by removeDuplicates (SPEC §9.3.3).
 * @param {*} a - First value.
 * @param {*} b - Second value.
 * @returns {boolean} True when a and b are structurally equal.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Recursively map a value to the Inspector schema shape (SPEC §9.3): objects map
 * to `{ propertyName, propertyType, children? }` entries; arrays map to a deduped
 * list of mapped elements; scalars map to their value-type string.
 * @param {*} object - The value (object, array, or scalar) to map.
 * @returns {Array|string} An array of schema entries, or a type string for scalars.
 */
function mapping(object) {
  if (Array.isArray(object)) {
    return removeDuplicates(object.map((x) => mapping(x)));
  }
  if (object !== null && typeof object === "object") {
    const result = [];
    for (const key of Object.keys(object)) {
      const val = object[key];
      const entry = { propertyName: key, propertyType: getPropValueType(val) };
      if (val !== null && typeof val === "object") {
        // Includes arrays (Array is an object).
        entry.children = mapping(val);
      }
      result.push(entry);
    }
    return result;
  }
  // Scalar case (used inside array mapping).
  return getPropValueType(object);
}

/**
 * Top-level schema parser (AvoSchemaParser, SPEC §9): null/undefined input yields
 * an empty schema; otherwise delegates to mapping(). Has no try/catch — the safe
 * wrapper is AvoInspector.extractSchema (§4.3).
 * @param {*} eventProperties - The raw event properties to parse.
 * @returns {Array} The extracted schema (array of property entries).
 */
function parseSchema(eventProperties) {
  if (eventProperties === null || eventProperties === undefined) return [];
  return mapping(eventProperties);
}

// ---------------------------------------------------------------------------
// AvoInspector (§4)
// ---------------------------------------------------------------------------

/**
 * Reference Avo Inspector server SDK (non-normative). Implements the public API
 * (SPEC §4), wire protocol (§7), UUID/timestamp generation (§8), schema extraction
 * (§9), and batching/flush/destroy (§12).
 */
export class AvoInspector {
  /**
   * The harness contract version this SDK targets (runner-contract).
   * @returns {string} SemVer of the implemented harness contract.
   */
  static get HARNESS_CONTRACT_VERSION() {
    return HARNESS_CONTRACT_VERSION;
  }

  /**
   * Construct and validate an inspector instance (SPEC §4.1). Throws synchronously
   * on a missing/empty apiKey or version; falls back to "dev" for an invalid env
   * (§6.3); clamps batching config to defaults; and starts the best-effort flush
   * timer when batching is enabled (§12.3).
   * @param {Object} [options] - Construction options.
   * @param {string} options.apiKey - Required non-empty API key.
   * @param {string} [options.env] - One of "dev" | "staging" | "prod" (invalid => "dev").
   * @param {string} options.version - Required non-empty app version string.
   * @param {string} [options.appName] - Optional app name (non-string => "").
   * @param {number} [options.batchSize] - Batch size >= 1 (default 30; forced to 1 in dev).
   * @param {number} [options.batchFlushSeconds] - Flush interval > 0 (default 30).
   * @param {number} [options.maxQueueSize] - Max pending events >= 1 (default 1000).
   * @param {boolean} [options.disableBatchTimer] - When true, suppress the scheduled flush timer.
   */
  constructor(options = {}) {
    const { apiKey, env, version, appName, batchSize, batchFlushSeconds, maxQueueSize, disableBatchTimer } =
      options || {};

    // §4.1 constructor validation (throws synchronously).
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      throw new Error("[Avo Inspector] No API key provided. Inspector can't operate without API key.");
    }
    if (typeof version !== "string" || version.trim() === "") {
      throw new Error(
        "[Avo Inspector] No version provided. Many features of Inspector rely on versioning. Please provide comparable string version, i.e. integer or semantic.",
      );
    }

    // §4.1 / §6.3 env fallback (never throws).
    let resolvedEnv = env;
    if (typeof resolvedEnv !== "string" || !VALID_ENVS.has(resolvedEnv)) {
      console.warn(`[Avo Inspector] Invalid env "${env}", falling back to "dev".`);
      resolvedEnv = "dev";
    }

    this.apiKey = apiKey;
    this.env = resolvedEnv;
    this.appVersion = version;
    this.appName = typeof appName === "string" ? appName : "";

    // §4.1 logging defaults (process-wide flag, §4.4).
    _shouldLog = this.env === "dev";

    // §7.7 sampling.
    this.samplingRate = 1.0;

    // §12 batching config.
    let resolvedBatchSize = 30;
    if (batchSize !== undefined) {
      if (Number.isInteger(batchSize) && batchSize >= 1) resolvedBatchSize = batchSize;
      else console.warn(`[Avo Inspector] Invalid batchSize ${batchSize}; using default 30.`);
    }
    // §12.2 dev forces batchSize = 1 (MUST), overriding the configured value.
    this.batchSize = this.env === "dev" ? 1 : resolvedBatchSize;

    this.batchFlushSeconds = 30;
    if (batchFlushSeconds !== undefined) {
      if (typeof batchFlushSeconds === "number" && batchFlushSeconds > 0) this.batchFlushSeconds = batchFlushSeconds;
      else console.warn(`[Avo Inspector] Invalid batchFlushSeconds ${batchFlushSeconds}; using default 30.`);
    }

    this.maxQueueSize = 1000;
    if (maxQueueSize !== undefined) {
      if (Number.isInteger(maxQueueSize) && maxQueueSize >= 1) this.maxQueueSize = maxQueueSize;
      else console.warn(`[Avo Inspector] Invalid maxQueueSize ${maxQueueSize}; using default 1000.`);
    }

    this.disableBatchTimer = disableBatchTimer === true;

    // §12 in-memory pending batch buffer (single-threaded Node: the "lock" is
    // the run-to-completion semantics of synchronous enqueue/swap-and-clear).
    this._pendingBatch = [];
    this._pendingSends = new Set(); // in-flight send promises (§4.2.6, §4.6)
    this._destroyed = false;
    this._flushTimer = null;

    // Best-effort scheduled flush (§12.3 SHOULD). Unref'd so it never holds the
    // process open (§11.4). Disabled by disableBatchTimer or in dev (batchSize 1).
    if (!this.disableBatchTimer && this.batchSize > 1) {
      this._flushTimer = setInterval(() => {
        if (this._pendingBatch.length > 0) this._dispatchSwap();
      }, this.batchFlushSeconds * 1000);
      if (typeof this._flushTimer.unref === "function") this._flushTimer.unref();
    }
  }

  /**
   * Toggle the process-wide logging flag (SPEC §4.4).
   * @param {boolean} enable - True to enable diagnostic logging.
   * @returns {void}
   */
  // §4.4
  enableLogging(enable) {
    _shouldLog = enable === true;
  }

  /**
   * Safe wrapper around the schema parser (SPEC §4.3); never throws, returns [] on error.
   * @param {*} eventProperties - The event properties to extract a schema from.
   * @returns {Array} The extracted schema, or [] if parsing threw.
   */
  // §4.3 — safe wrapper around the parser; never throws, returns [] on error.
  extractSchema(eventProperties) {
    try {
      return parseSchema(eventProperties);
    } catch (err) {
      if (_shouldLog) console.error("[Avo Inspector] extractSchema error", err);
      return [];
    }
  }

  // Test-only hook (runner-contract "precondition.samplingRate"). NOT part of the
  // documented public API — prefixed `_` and named `*ForTesting` so it is not a
  // public `setSamplingRate` (which would let callers disable telemetry, §precondition
  // security requirement).
  /**
   * Test-only hook to set the sampling rate (runner-contract precondition).
   * Intentionally not part of the public API. See note above.
   * @param {number} rate - Sampling rate in [0, 1].
   * @returns {void}
   */
  _setSamplingRateForTesting(rate) {
    this.samplingRate = rate;
  }

  /**
   * Extract the event schema and enqueue a wire body for sending (SPEC §4.2).
   * Returns [] immediately after destroy() (§4.5); applies per-event sampling at
   * enqueue (§7.7); when batchSize == 1 the send is awaited so the HTTP outcome is
   * observable (§4.2.4/§7.5); otherwise resolves at enqueue. Rejects on a
   * synchronous internal error (§4.2.5).
   * @param {string} eventName - The tracked event name.
   * @param {*} eventProperties - The event properties to extract a schema from.
   * @param {string} [streamId] - Optional stream identifier (§4.2/§8.2).
   * @returns {Promise<Array>} Resolves with the extracted schema (or [] on a non-200 immediate send).
   */
  // §4.2
  async trackSchemaFromEvent(eventName, eventProperties, streamId) {
    // §4.5 — after destroy(), resolve([]) without enqueue or HTTP.
    if (this._destroyed) return [];

    let eventSchema;
    try {
      eventSchema = this.extractSchema(eventProperties);

      // §4.2 streamId rules / §8.2.
      let resolvedStreamId = "";
      if (typeof streamId === "string" && streamId.length > 0) {
        resolvedStreamId = streamId;
        if (streamId.includes(":")) {
          console.warn(`[Avo Inspector] streamId contains ':' — using verbatim: ${streamId}`);
        }
      }

      // §7.7 per-event sampling at enqueue, BEFORE buffering.
      // Math.random() is in [0.0, 1.0); drop when random >= samplingRate so that
      // samplingRate 0.0 ALWAYS drops (an exact-zero draw must not slip through).
      if (Math.random() >= this.samplingRate) {
        return eventSchema; // dropped silently; not buffered, no network call.
      }

      // Build the self-contained wire body (§7.3) with the sampling-rate snapshot
      // in effect at enqueue time (§7.7).
      const body = {
        apiKey: this.apiKey,
        appName: this.appName,
        appVersion: this.appVersion,
        libVersion: LIB_VERSION,
        env: this.env,
        libPlatform: LIB_PLATFORM,
        messageId: randomUUID(),
        streamId: resolvedStreamId,
        createdAt: new Date().toISOString(),
        samplingRate: this.samplingRate,
        type: "event",
        eventName,
        eventProperties: eventSchema,
      };

      const triggered = this._enqueue(body);
      // §4.2.4 / §7.5: when batchSize == 1 the send is synchronous to the call,
      // so the per-call HTTP outcome is observable. The size trigger fired this
      // call's own send; await it and reflect §7.5 (non-200 -> resolve([]);
      // network error/timeout -> resolve(eventSchema); 200 -> resolve(eventSchema)).
      // When batchSize > 1 the send is decoupled; resolve at enqueue (§7.5.2).
      if (this.batchSize === 1 && triggered) {
        const result = await triggered;
        return result.status === "non200" ? [] : eventSchema;
      }
      return eventSchema;
    } catch (err) {
      // §4.2.5 / §7.5 — synchronous internal error before enqueue.
      if (_shouldLog) console.error("[Avo Inspector] internal error", err);
      return Promise.reject("Avo Inspector: something went wrong. Please report to support@avo.app.");
    }
  }

  /**
   * Append a wire body to the pending batch, enforcing the maxQueueSize FIFO cap
   * (oldest-dropped on overflow, §12.5), then fire the size trigger (§12.3).
   * @param {Object} body - The self-contained wire body to enqueue.
   * @returns {Promise<{ status: string }>|null} The dispatched send promise, or null if no send fired.
   */
  // §12.4/§12.5 enqueue with maxQueueSize FIFO cap, then evaluate size trigger.
  _enqueue(body) {
    this._pendingBatch.push(body);
    // §12.5 FIFO-oldest drop on overflow.
    let dropped = 0;
    while (this._pendingBatch.length > this.maxQueueSize) {
      this._pendingBatch.shift();
      dropped += 1;
    }
    if (dropped > 0 && _shouldLog) {
      console.error(`[Avo Inspector] maxQueueSize exceeded; dropped ${dropped} oldest event(s).`);
    }
    // §12.3 size trigger (MUST). Fire-and-forget: the triggering call does NOT
    // await the send when batchSize > 1 (§4.2.4). Returns the dispatched send
    // promise (or null) so the batchSize==1 immediate-send path can await it.
    if (this._pendingBatch.length >= this.batchSize) {
      return this._dispatchSwap();
    }
    return null;
  }

  /**
   * Atomically swap out and clear the pending batch, then send it outside the
   * "lock" and track the in-flight promise (SPEC §3.1/§12.4).
   * @returns {Promise<{ status: string }>|null} The tracked send promise, or null if the batch was empty.
   */
  // §3.1/§12.4 atomic swap-and-clear, then send OUTSIDE the lock. In Node the
  // synchronous swap below is the "lock"; the async send runs after. Returns the
  // tracked send promise (resolving to an outcome object), or null if empty.
  _dispatchSwap() {
    if (this._pendingBatch.length === 0) return null;
    const batch = this._pendingBatch;
    this._pendingBatch = [];
    const sendPromise = this._send(batch).finally(() => {
      this._pendingSends.delete(sendPromise);
    });
    this._pendingSends.add(sendPromise);
    return sendPromise;
  }

  /**
   * POST a batch to the resolved endpoint (SPEC §7): serialize, gzip when >= 1024
   * bytes (§7.3.5), apply a 10s timeout (§7.6), update samplingRate on 200 (§7.4),
   * and swallow non-200/network/timeout errors without re-queueing (§7.5.2, at-most-once).
   * @param {Object[]} batch - The events to send as a single JSON array body.
   * @returns {Promise<{ status: "ok" | "non200" | "error" }>} The send outcome; never throws.
   */
  // §7 HTTP send. Resolves on completion with an outcome object
  // ({ status: "ok" | "non200" | "error" }); never throws (network errors /
  // non-200 swallowed). At-most-once: failures are NOT re-queued (§7.5.2, §12.5).
  async _send(batch) {
    const endpoint = this._resolveEndpoint();
    const json = JSON.stringify(batch);
    const rawBytes = Buffer.from(json, "utf8");

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // §7.3.5 gzip when serialized body >= 1024 bytes (UTF-8 byte length).
    let payload = rawBytes;
    if (rawBytes.length >= GZIP_THRESHOLD_BYTES) {
      try {
        payload = gzipSync(rawBytes);
        headers["Content-Encoding"] = "gzip";
      } catch {
        payload = rawBytes; // fallback to uncompressed (§7.3.5)
      }
    }
    headers["Content-Length"] = String(payload.length);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: payload,
        signal: controller.signal,
      });
      if (res.status === 200) {
        // §7.4 update samplingRate only on 200 with a numeric value in [0,1].
        try {
          const data = await res.json();
          if (data && typeof data.samplingRate === "number" && data.samplingRate >= 0 && data.samplingRate <= 1) {
            this.samplingRate = data.samplingRate;
          }
        } catch {
          /* ignore body parse errors */
        }
        return { status: "ok" };
      }
      // §7.4/§7.5 non-200: log (dev/staging), resolve, do not re-queue.
      if (_shouldLog) console.error(`[Avo Inspector] Inspector API returned status ${res.status}`);
      return { status: "non200" };
    } catch (err) {
      // §7.5/§7.6 network error or timeout — swallow; do not re-queue.
      if (_shouldLog) console.error("[Avo Inspector] send failed", err && err.name);
      return { status: "error" };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve the send endpoint (SPEC §7.1) with a fail-closed mock gate: a `prod`
   * instance NEVER honors AVO_INSPECTOR_MOCK_ENDPOINT; non-prod uses it verbatim.
   * @returns {string} The mock endpoint (non-prod, when set) or the production endpoint.
   */
  // §7.1 endpoint resolution with fail-closed (default-deny) mock gate: a `prod`
  // instance NEVER honors AVO_INSPECTOR_MOCK_ENDPOINT regardless of environment.
  _resolveEndpoint() {
    const override = process.env.AVO_INSPECTOR_MOCK_ENDPOINT;
    if (this.env !== "prod" && typeof override === "string" && override.length > 0) {
      return override; // used as-is, no path appending (runner-contract).
    }
    return PROD_ENDPOINT;
  }

  /**
   * Force-flush the pending batch and await all in-flight sends, bounded by a
   * timeout (SPEC §4.6/§12.6). Always resolves (completion, not delivery, guarantee);
   * a no-op after destroy().
   * @param {number} [timeoutMs] - Max time to wait for in-flight sends (default 10000).
   * @returns {Promise<void>} Resolves when sends settle or the timeout elapses.
   */
  // §4.6/§12.6 — force-flush the pending batch, then await all in-flight sends.
  async flush(timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS) {
    if (this._destroyed) return;
    // Force-flush: atomically swap out and dispatch buffered events.
    this._dispatchSwap();
    if (this._pendingSends.size === 0) return;
    const all = Promise.allSettled([...this._pendingSends]);
    let timer;
    const guard = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });
    // flush() always resolves (completion guarantee, not delivery guarantee).
    await Promise.race([all, guard]);
    clearTimeout(timer);
  }

  /**
   * Tear down the instance (SPEC §4.5/§12.6): mark destroyed, discard the pending
   * batch unsent, abandon in-flight sends, and clear the flush timer. Config
   * (samplingRate, apiKey, env, version, appName) and process-wide logging persist.
   * @returns {void}
   */
  // §4.5/§12.6 — cancel and clean up; discard pending batch unsent.
  destroy() {
    this._destroyed = true;
    this._pendingBatch = [];
    this._pendingSends.clear(); // abandon in-flight (pendingCount -> 0)
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    // samplingRate, apiKey, env, version, appName, and process-wide shouldLog persist.
  }
}

export default AvoInspector;
