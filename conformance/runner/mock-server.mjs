// In-process mock Inspector HTTP server for the conformance suite-runner.
//
// Implements the mock-server API contract from conformance/runner-contract.md
// ("Mock server" section):
//
//   POST /          — records the incoming request (gunzip when Content-Encoding:
//                     gzip is present) and returns the configured response. The
//                     N-th POST gets mock_responses[N] (last entry reused when the
//                     array is shorter), or the single mock_response for every call.
//   GET  /requests  — returns every request captured since start / last reset.
//   POST /reset      — clears the captured request list and resets the response plan.
//
// Zero external dependencies — Node built-ins only (http, zlib). The server binds
// to 127.0.0.1 on an ephemeral port; the runner reads the chosen port from
// `server.port` after `start()`.
//
// Recorded request shape (per the contract):
//   { method, path, headers: { <lowercased> }, body: <parsed JSON | { __malformed }> }
//
// A Content-Encoding: gzip request whose bytes fail to gunzip is recorded with a
// `__malformed` marker so the runner can fail the fixture (it never throws here).

import http from "node:http";
import { gunzipSync } from "node:zlib";

/**
 * In-process mock Inspector HTTP server implementing the mock-server API contract
 * from conformance/runner-contract.md (POST /, GET /requests, POST /reset).
 */
export class MockServer {
  /**
   * Initialize an unstarted mock with an empty request log and no response plan.
   */
  constructor() {
    this._server = null;
    this.port = null;
    // Captured POST-/ requests since start / last reset.
    this._requests = [];
    // Response plan for POST /: either a single response object reused for every
    // call, or an array applied in receipt order (last entry reused when short).
    // null => respond 200 {} (and the fixture should assert zero requests).
    this._single = null;
    this._list = null;
  }

  /**
   * Configure the response(s) the mock returns for subsequent POSTs. Pass either
   * `single` (reused for every call) or `list` (applied in receipt order); the other MUST be null.
   * @param {Object} [opts] - Response plan.
   * @param {Object|null} [opts.single] - Single response object reused for every POST.
   * @param {Array|null} [opts.list] - Ordered responses; last entry reused when shorter than call count.
   * @returns {void}
   */
  // Configure the response(s) the mock returns for subsequent POSTs.
  // Pass `single` (object|null) OR `list` (array). The other MUST be null.
  setResponses({ single = null, list = null } = {}) {
    this._single = single;
    this._list = list;
  }

  /**
   * Start the HTTP server bound to 127.0.0.1 on an OS-assigned ephemeral port.
   * @returns {Promise<number>} Resolves with the chosen port (also stored on `this.port`).
   */
  start() {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => this._handle(req, res));
      this._server.on("error", reject);
      // Port 0 => OS assigns a free ephemeral port. Bind to loopback only.
      this._server.listen(0, "127.0.0.1", () => {
        this.port = this._server.address().port;
        resolve(this.port);
      });
    });
  }

  /**
   * Stop the HTTP server if running; a no-op (still resolves) when not started.
   * @returns {Promise<void>} Resolves once the server has closed.
   */
  stop() {
    return new Promise((resolve) => {
      if (!this._server) return resolve();
      this._server.close(() => resolve());
      this._server = null;
    });
  }

  /**
   * The loopback base URL the SDK is pointed at (no trailing path).
   * @returns {string} e.g. "http://127.0.0.1:<port>".
   */
  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Clear the captured request log and reset the response plan (POST /reset).
   * @returns {void}
   */
  reset() {
    this._requests = [];
    this._single = null;
    this._list = null;
  }

  /**
   * Return every request captured since start / last reset (equivalent to GET /requests).
   * @returns {Array<Object>} The recorded request objects.
   */
  capturedRequests() {
    return this._requests;
  }

  /**
   * Lowercase all header names into a new object (the recorded request shape).
   * @param {Object<string, string>} headers - Raw request headers.
   * @returns {Object<string, string>} Headers keyed by lowercased name.
   */
  _lowercaseHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
    return out;
  }

  /**
   * Select the configured response for the N-th POST: the list entry (last reused
   * when short), the single response, or a benign 200 {} when nothing is configured.
   * @param {number} callIndex - Zero-based index of the POST being answered.
   * @returns {{ status?: number, body?: * }} The response descriptor.
   */
  _responseFor(callIndex) {
    if (Array.isArray(this._list) && this._list.length > 0) {
      const idx = Math.min(callIndex, this._list.length - 1);
      return this._list[idx];
    }
    if (this._single != null) return this._single;
    // mock_response: null — never expected to be hit; respond benignly with 200.
    return { status: 200, body: {} };
  }

  /**
   * Top-level request router: GET /requests, POST /reset, POST / (recorded), else 404.
   * @param {http.IncomingMessage} req - The incoming request.
   * @param {http.ServerResponse} res - The response to write.
   * @returns {void}
   */
  _handle(req, res) {
    const method = req.method || "";
    const url = req.url || "/";

    if (method === "GET" && url === "/requests") {
      return this._json(res, 200, this._requests);
    }
    if (method === "POST" && url === "/reset") {
      this.reset();
      return this._json(res, 200, { ok: true });
    }
    // AVO_INSPECTOR_MOCK_ENDPOINT is used as-is with no path appending
    // (runner-contract), so a conformant SDK POSTs to "/". Any other POST path
    // is a contract violation and MUST NOT be recorded as valid traffic.
    if (method === "POST" && url === "/") {
      return this._handlePost(req, res);
    }
    return this._json(res, 404, { error: "not found" });
  }

  /**
   * Buffer a POST / body, gunzip it when Content-Encoding: gzip, parse JSON (or
   * record a `__malformed` marker), append to the request log, and reply.
   * @param {http.IncomingMessage} req - The incoming POST request.
   * @param {http.ServerResponse} res - The response to write.
   * @returns {void}
   */
  _handlePost(req, res) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const headers = this._lowercaseHeaders(req.headers);
      const record = { method: "POST", path: req.url || "/", headers };

      const contentEncoding = headers["content-encoding"];
      let bodyBytes = raw;
      if (contentEncoding === "gzip") {
        try {
          bodyBytes = gunzipSync(raw);
        } catch (err) {
          // A gzip-labeled body that fails to gunzip is a malformed request.
          record.body = { __malformed: `gunzip failed: ${err.message}` };
          this._requests.push(record);
          return this._respond(res, this._requests.length - 1);
        }
      }

      try {
        record.body = bodyBytes.length === 0 ? null : JSON.parse(bodyBytes.toString("utf8"));
      } catch (err) {
        record.body = { __malformed: `json parse failed: ${err.message}` };
      }

      const callIndex = this._requests.length;
      this._requests.push(record);
      return this._respond(res, callIndex);
    });
    req.on("error", () => {
      this._json(res, 400, { error: "request stream error" });
    });
  }

  /**
   * Write the configured response for a given POST index (defaults: status 200, body {}).
   * @param {http.ServerResponse} res - The response to write.
   * @param {number} callIndex - Zero-based index of the POST being answered.
   * @returns {void}
   */
  _respond(res, callIndex) {
    const resp = this._responseFor(callIndex);
    const status = typeof resp.status === "number" ? resp.status : 200;
    const body = resp.body === undefined ? {} : resp.body;
    return this._json(res, status, body);
  }

  /**
   * Serialize a JSON body and write it with the given status and Content-Length.
   * @param {http.ServerResponse} res - The response to write.
   * @param {number} status - HTTP status code.
   * @param {*} body - Value to JSON-serialize as the response body.
   * @returns {void}
   */
  _json(res, status, body) {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": String(payload.length),
    });
    res.end(payload);
  }
}
