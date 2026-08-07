

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  LAUNCHER_READINESS_EVENT_WRITE_FAILED_CODE,
  LAUNCHER_READINESS_PROTOCOL_GENERATION,
  LAUNCHER_READINESS_SCHEMA_VERSIONS,
  LauncherReadinessEventWriteError,
  LauncherReadinessObservationError,
  createLauncherObservingTransport,
  createLauncherReadinessEventWriter
} from "../packages/wiki-mcp/src/lib/launcher-readiness-observer.mjs";
import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import {
  __testing as conduitCoreTesting
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";

test("WK-1780: readiness producer exposes the shared immutable lifecycle generation", () => {
  assert.equal(LAUNCHER_READINESS_PROTOCOL_GENERATION,
    STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION);
  assert.equal(LAUNCHER_READINESS_SCHEMA_VERSIONS.SERVER_READY,
    "wiki-mcp-launcher-readiness.v2");
  assert.equal(LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
    "wiki-mcp-launcher-client-closed.v1");
  assert.equal(Object.isFrozen(LAUNCHER_READINESS_SCHEMA_VERSIONS), true);
});

function createFakeInnerTransport() {
  const sent = [];
  return {
    sent,
    started: 0,
    closed: 0,
    async start() { this.started += 1; },
    async send(message) { sent.push(message); },
    async close() { this.closed += 1; },

    deliver(message) { this.onmessage?.(message, { some: "extra" }); }
  };
}

function attach(inner) {
  const events = [];
  const transport = createLauncherObservingTransport(inner, { emit: (event) => events.push(event) });

  const received = [];
  transport.onmessage = (message, extra) => received.push({ message, extra });
  return { transport, events, received };
}

const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

function toolsResult(id, names) {
  return { jsonrpc: "2.0", id, result: { tools: names.map((name) => ({ name, description: "" })) } };
}

test("WK-1678: the observer forwards every message and call unchanged", async () => {
  const inner = createFakeInnerTransport();
  const { transport, received } = attach(inner);

  await transport.start();
  assert.equal(inner.started, 1);
  await transport.send({ jsonrpc: "2.0", id: 9, result: {} });
  assert.deepEqual(inner.sent, [{ jsonrpc: "2.0", id: 9, result: {} }]);
  inner.deliver(INITIALIZE);
  assert.deepEqual(received[0].message, INITIALIZE);
  assert.deepEqual(received[0].extra, { some: "extra" });
  await transport.close();
  assert.equal(inner.closed, 1);

  let closed = 0;
  let errored = null;
  transport.onclose = () => { closed += 1; };
  transport.onerror = (error) => { errored = error; };
  inner.onclose();
  inner.onerror(new Error("boom"));
  assert.equal(closed, 1);
  assert.equal(errored.message, "boom");
});

test("WK-1745 SLICE-006: transport close emits launcher-owned client-first evidence", () => {
  const inner = createFakeInnerTransport();
  const { transport, events } = attach(inner);
  let forwarded = 0;
  transport.onclose = () => { forwarded += 1; };
  inner.onclose();
  assert.equal(forwarded, 1);
  assert.deepEqual(events, [{
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
    closed: true
  }]);
});

test("WK-1678: readiness events reflect the REAL exchange, not the server's own list",
  async () => {
    const inner = createFakeInnerTransport();
    const { transport, events } = attach(inner);

    inner.deliver(INITIALIZE);
    assert.deepEqual(events, [], "an initialize request alone is not readiness");
    await transport.send({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } });
    assert.deepEqual(events, [], "the initialize response alone is not readiness");

    inner.deliver(INITIALIZED);
    assert.equal(events.length, 1);
    assert.equal(events[0].schema_version, LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_INITIALIZED);

    inner.deliver(TOOLS_LIST);
    assert.equal(events.length, 1, "the request alone does not complete tools/list");

    await transport.send(toolsResult(2, ["commit"]));
    assert.equal(events.length, 2);
    assert.equal(events[1].schema_version, LAUNCHER_READINESS_SCHEMA_VERSIONS.TOOLS_LISTED);
    assert.deepEqual(events[1].tools, ["commit"]);
  });

test("WK-1678: the observed tool names track the response payload exactly", async () => {
  for (const names of [[], ["commit"], ["a", "b", "c"], ["dup", "dup"]]) {
    const inner = createFakeInnerTransport();
    const { transport, events } = attach(inner);
    inner.deliver(INITIALIZE);
    await transport.send({ jsonrpc: "2.0", id: 1, result: {} });
    inner.deliver(INITIALIZED);
    inner.deliver(TOOLS_LIST);
    await transport.send(toolsResult(2, names));
    const listed = events.find(
      (event) => event.schema_version === LAUNCHER_READINESS_SCHEMA_VERSIONS.TOOLS_LISTED);
    assert.deepEqual(listed.tools, names,
      "duplicates and extras reach the launcher verbatim so the comparison can reject them");
  }
});

test("WK-1678: an unsolicited initialized notification cannot fake readiness", async () => {
  const inner = createFakeInnerTransport();
  const { events } = attach(inner);
  inner.deliver(INITIALIZED);
  assert.deepEqual(events, [], "no initialize request was ever made");
});

test("WK-1678: a second initialize is reported as a client relay restart", async () => {
  const inner = createFakeInnerTransport();
  const { transport, events } = attach(inner);
  inner.deliver(INITIALIZE);
  await transport.send({ jsonrpc: "2.0", id: 1, result: {} });
  inner.deliver(INITIALIZED);

  inner.deliver({ ...INITIALIZE, id: 42 });
  const restart = events.find(
    (event) => event.schema_version === LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_RESTARTED);
  assert.equal(restart.restarted, true);
  assert.equal(restart.restart_count, 1);

  inner.deliver({ ...INITIALIZE, id: 43 });
  const restarts = events.filter(
    (event) => event.schema_version === LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_RESTARTED);
  assert.equal(restarts.length, 2);
  assert.equal(restarts[1].restart_count, 2);
});

test("WK-1780: duplicate initialize before the initialized notification fails readiness", async () => {
  const child = new EventEmitter();
  const ready = new PassThrough();
  child.stdio = [null, null, null, ready];
  const lifecycle = conduitCoreTesting.observeConduitLifecycle({
    child,
    role: "worker",
    serverStartupTimeoutMs: 5_000,
    clientReadinessTimeoutMs: 5_000,
    expectedToolNames: ["commit"]
  });
  lifecycle.serverReady.catch(() => {});
  lifecycle.clientReady.catch(() => {});
  ready.write(`${JSON.stringify({
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.SERVER_READY,
    lifecycle_protocol_generation: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
    ready: true,
    tools: ["commit"]
  })}\n`);
  await lifecycle.serverReady;
  lifecycle.beginClientReadiness();

  const inner = createFakeInnerTransport();
  const events = [];
  const transport = createLauncherObservingTransport(inner, {
    emit(event) {
      events.push(event);
      ready.write(`${JSON.stringify(event)}\n`);
    }
  });
  transport.onmessage = () => {};
  inner.deliver(INITIALIZE);
  inner.deliver({ ...INITIALIZE, id: 42 });
  inner.deliver(INITIALIZED);
  inner.deliver(TOOLS_LIST);
  await transport.send({ jsonrpc: "2.0", id: 1, result: {} });
  await transport.send(toolsResult(2, ["commit"]));

  assert.deepEqual(events, [{
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_RESTARTED,
    restarted: true,
    restart_count: 1
  }], "no ordinary initialized or tools-listed success follows restart evidence");
  const failure = await lifecycle.failureSettlement;
  assert.equal(failure.code, STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_RELAY_RESTARTED);
  await assert.rejects(lifecycle.clientReady, (error) => error === failure);
  assert.equal(lifecycle.isClientReady(), false,
    "the real consumer never authenticates delivery after duplicate initialize");
  ready.destroy();
});

test("WK-1678: observation installation fails closed instead of degrading", () => {

  for (const broken of [null, undefined, {}, { start: 1, send: 2, close: 3 },
    { start() {}, send() {} }, { send() {}, close() {} }]) {
    assert.throws(() => createLauncherObservingTransport(broken, { emit: () => {} }),
      (error) => error instanceof LauncherReadinessObservationError &&
        error.code === "wiki_mcp_launcher_readiness_observation_unavailable",
      `broken transport ${JSON.stringify(broken) ?? String(broken)} must be refused`);
  }

  const inner = createFakeInnerTransport();
  const transport = createLauncherObservingTransport(inner, { emit: () => {} });
  assert.throws(() => transport.assertObservationInstalled(),
    (error) => error instanceof LauncherReadinessObservationError);
  transport.onmessage = () => {};
  assert.equal(transport.assertObservationInstalled(), transport);
});

test("WK-1678: the server entrypoint installs observation unconditionally", () => {

  const source = readServerSource();
  assert.equal(source.includes("_requestHandlers"), false,
    "the server must not reach into private MCP SDK internals");
  assert.match(source, /createLauncherObservingTransport\(/u);
  assert.match(source, /transport\.assertObservationInstalled\(\)/u);
  assert.doesNotMatch(source, /if \(typeof listToolsHandler === "function"\)/u);
});

function readServerSource() {
  return readFileSync(new URL("../packages/wiki-mcp/src/server.mjs", import.meta.url), "utf8");
}

function brokenPipeError() {
  return Object.assign(new Error("write EPIPE"), { code: "EPIPE", errno: -32, syscall: "write" });
}

test("WK-1678: a broken readiness pipe becomes a typed failure instead of escaping", async () => {

  const cleanups = [];
  const writer = createLauncherReadinessEventWriter({
    write: () => { throw brokenPipeError(); },
    onFailure: (failure) => { cleanups.push(failure); }
  });
  const failure = writer.emit({ schema_version: "wiki-mcp-launcher-readiness.v1", ready: true });
  assert.ok(failure instanceof LauncherReadinessEventWriteError);
  assert.equal(failure.code, LAUNCHER_READINESS_EVENT_WRITE_FAILED_CODE);

  assert.equal(failure.cause.code, "EPIPE");
  assert.equal(failure.detail.cause_code, "EPIPE");
  assert.equal(failure.detail.schema_version, "wiki-mcp-launcher-readiness.v1");

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanups.length, 1);
  assert.equal(cleanups[0], failure);
});

test("WK-1678: a closed reader never escapes through the observing transport", async () => {

  const inner = createFakeInnerTransport();
  let closedReaderWrites = 0;
  const writer = createLauncherReadinessEventWriter({
    write: () => {
      closedReaderWrites += 1;
      throw Object.assign(new Error("bad file descriptor"), { code: "EBADF" });
    }
  });
  const transport = createLauncherObservingTransport(inner, { emit: writer.emit });
  const received = [];
  transport.onmessage = (message) => received.push(message);

  inner.deliver(INITIALIZE);
  await transport.send({ jsonrpc: "2.0", id: 1, result: {} });

  assert.doesNotThrow(() => inner.deliver(INITIALIZED));
  assert.equal(writer.failure?.code, LAUNCHER_READINESS_EVENT_WRITE_FAILED_CODE);
  assert.equal(writer.failure.cause.code, "EBADF");

  assert.deepEqual(received[received.length - 1], INITIALIZED);

  inner.deliver(TOOLS_LIST);
  await assert.doesNotReject(transport.send(toolsResult(2, ["commit"])));
  assert.equal(closedReaderWrites, 1);
});

test("WK-1678: readiness cleanup that hangs is bounded rather than left pending", async () => {
  let timedOut = 0;
  const writer = createLauncherReadinessEventWriter({
    write: () => { throw brokenPipeError(); },
    onFailure: () => new Promise(() => {}),
    onCleanupTimeout: () => { timedOut += 1; },
    cleanupTimeoutMs: 20
  });
  writer.emit({ schema_version: "wiki-mcp-launcher-tools-listed.v1", tools_listed: true });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(timedOut, 1, "a cleanup that never settles must still hit its bound");
});

test("WK-1678: a cleanup handler that itself throws does not lose the typed failure", async () => {
  const writer = createLauncherReadinessEventWriter({
    write: () => { throw brokenPipeError(); },
    onFailure: () => { throw new Error("cleanup exploded"); }
  });
  assert.doesNotThrow(() => writer.emit({ schema_version: "x" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writer.failure.code, LAUNCHER_READINESS_EVENT_WRITE_FAILED_CODE);
  assert.equal(writer.failure.cause.code, "EPIPE");
});

test("WK-1678: a healthy readiness channel writes every event and reports no failure", () => {
  const written = [];
  const writer = createLauncherReadinessEventWriter({ write: (event) => written.push(event) });
  assert.equal(writer.emit({ schema_version: "a" }), null);
  assert.equal(writer.emit({ schema_version: "b" }), null);
  assert.deepEqual(written.map((event) => event.schema_version), ["a", "b"]);
  assert.equal(writer.failure, null);

  assert.throws(() => createLauncherReadinessEventWriter({}),
    (error) => error instanceof LauncherReadinessObservationError);
});

test("WK-1678: the server entrypoint routes readiness writes through the typed writer", () => {
  const source = readServerSource();
  assert.match(source, /createLauncherReadinessEventWriter\(/u,
    "the raw writeFileSync must not be the emit callback the SDK transport calls");
  assert.match(source, /emit: writeLauncherEvent/u);
  assert.match(source, /onCleanupTimeout/u, "cleanup after a readiness failure is bounded");
});
