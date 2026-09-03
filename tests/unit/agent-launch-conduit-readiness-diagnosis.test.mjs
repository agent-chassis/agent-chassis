import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import { __testing as conduitTesting } from
  "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";
import {
  deriveStdioMcpConduitLocalBacking,
  projectStdioMcpChannelLocalBacking
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs";
import {
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import {
  createStdioMcpConnectionAdmission,
  encodeStdioMcpAdmissionPrelude,
  STDIO_MCP_ADMISSION_ACKNOWLEDGEMENT_BYTES,
  STDIO_MCP_ADMISSION_PRELUDE_BYTES
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-connection-admission.mjs";

const ORDINARY_CLOSE_SCHEMA = "wiki-mcp-launcher-client-closed.v1";
const DISCOVERY_PROBE_CLOSE_SCHEMA =
  "wiki-mcp-launcher-client-closed.discovery-probe.v1";
const TOOL_NAMES = Object.freeze(["wiki_search"]);

function writeLifecycleEvent(stream, event) {
  stream.write(`${JSON.stringify(event)}\n`);
}

function registrationEvent(tools = TOOL_NAMES) {
  return {
    schema_version: "wiki-mcp-launcher-readiness.v2",
    lifecycle_protocol_generation: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
    ready: true,
    tool_profile: "worker",
    registered_tier: "test",
    tools: [...tools]
  };
}

function createMeasuredLifecycle({ spawnCostMs = 0, input = new PassThrough() } = {}) {
  const readyStream = new PassThrough();
  const output = new PassThrough();
  const { child, readinessMeasurements } =
    conduitTesting.spawnMeasuredServerGeneration(() => {
      const end = performance.now() + spawnCostMs;
      while (performance.now() < end) {

      }
      const spawned = new EventEmitter();
      spawned.stdin = input;
      spawned.stdout = output;
      spawned.stderr = new PassThrough();
      spawned.stdio = [input, output, spawned.stderr, readyStream];
      return spawned;
    });
  const lifecycle = conduitTesting.observeConduitLifecycle({
    child,
    role: "worker",
    serverStartupTimeoutMs: 2_000,
    clientReadinessTimeoutMs: 2_000,
    expectedToolNames: TOOL_NAMES,
    readinessMeasurements
  });
  lifecycle.serverReady.catch(() => {});
  lifecycle.clientReady.catch(() => {});
  return { child, input, output, readyStream, lifecycle, readinessMeasurements };
}

async function waitFor(predicate, message) {
  const deadline = performance.now() + 2_000;
  while (!predicate()) {
    if (performance.now() >= deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function openAuthenticatedAdmission({
  initialPayload = Buffer.alloc(0),
  inputFactory = () => new PassThrough()
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wk2182-diagnosis-"));
  const backing = deriveStdioMcpConduitLocalBacking(directory);
  const projection = projectStdioMcpChannelLocalBacking(backing);
  let generation = null;
  const admission = createStdioMcpConnectionAdmission({
    backing,
    createGeneration({ initialBytes }) {
      const measured = createMeasuredLifecycle({ input: inputFactory() });
      generation = {
        ...measured,
        initialBytes,
        ready: measured.lifecycle.serverReady,
        close: async () => {
          measured.input.destroy();
          measured.output.destroy();
        }
      };
      writeLifecycleEvent(measured.readyStream, registrationEvent());
      return generation;
    }
  });
  const listening = once(admission.server, "listening");
  admission.open();
  await listening;
  const client = net.createConnection(projection.endpointSource);
  await once(client, "connect");
  let acknowledgement = Buffer.alloc(0);
  const acknowledged = new Promise((resolve) => {
    client.on("data", (chunk) => {
      acknowledgement = Buffer.concat([acknowledgement, chunk]);
      if (acknowledgement.length >= STDIO_MCP_ADMISSION_ACKNOWLEDGEMENT_BYTES) resolve();
    });
  });
  client.write(Buffer.concat([
    encodeStdioMcpAdmissionPrelude(admission.token),
    initialPayload
  ]));
  await acknowledged;
  await waitFor(() => generation !== null, "authenticated generation was not created");
  const close = async () => {
    client.destroy();
    admission.close();
    await admission.settle();
    await rm(directory, { recursive: true, force: true });
    await rm(path.dirname(projection.endpointSource), { recursive: true, force: true });
  };
  return { admission, acknowledgement, client, close, generation };
}

test("claim-pre-spawn-timestamp-boundary / claim-registration-timing-boundaries: "
  + "accepted timing includes synchronous spawnServer cost and completes before serverReady", async () => {
  const measured = createMeasuredLifecycle({ spawnCostMs: 25 });
  assert.equal(measured.readinessMeasurements.spawn_to_registration_elapsed_ms, null);
  await new Promise((resolve) => setTimeout(resolve, 15));
  writeLifecycleEvent(measured.readyStream, registrationEvent());
  const elapsed = measured.readinessMeasurements.spawn_to_registration_elapsed_ms;
  assert.equal(Number.isFinite(elapsed), true);
  assert.equal(elapsed >= 35, true, `expected spawn and registration cost, observed ${elapsed}ms`);
  await measured.lifecycle.serverReady;
  assert.equal(measured.readinessMeasurements.spawn_to_registration_elapsed_ms, elapsed);
});

test("claim-registration-typed-absence: a close before accepted registration snapshots exact null", async () => {
  const measured = createMeasuredLifecycle();
  const closeEvent = { schema_version: ORDINARY_CLOSE_SCHEMA, closed: true };
  writeLifecycleEvent(measured.readyStream, closeEvent);
  const failure = await measured.lifecycle.failureSettlement;
  assert.equal(failure.detail.spawn_to_registration_elapsed_ms, null);
  assert.equal(failure.detail.authenticated_client_payload_bytes_before_close, 0);
  assert.equal(failure.detail.schema_version, ORDINARY_CLOSE_SCHEMA);
  assert.deepEqual(Object.keys(closeEvent).sort(), ["closed", "schema_version"]);
});

test("claim-authenticated-client-payload-bytes: zero-byte authenticated close records zero", async (t) => {
  const opened = await openAuthenticatedAdmission();
  t.after(opened.close);
  assert.equal(opened.acknowledgement.length, STDIO_MCP_ADMISSION_ACKNOWLEDGEMENT_BYTES);
  assert.equal(STDIO_MCP_ADMISSION_PRELUDE_BYTES, 82);
  writeLifecycleEvent(opened.generation.readyStream,
    { schema_version: ORDINARY_CLOSE_SCHEMA, closed: true });
  const failure = await opened.generation.lifecycle.failureSettlement;
  assert.equal(failure.detail.authenticated_client_payload_bytes_before_close, 0);
  assert.equal(Number.isFinite(failure.detail.spawn_to_registration_elapsed_ms), true);
});

test("claim-authenticated-client-payload-bytes / claim-close-discriminator-first-cause: "
  + "441 buffered-plus-live inbound bytes exclude authentication traffic and retain the first snapshot",
async (t) => {
  const buffered = Buffer.alloc(173, 0x61);
  const live = Buffer.alloc(268, 0x62);
  const opened = await openAuthenticatedAdmission({ initialPayload: buffered });
  t.after(opened.close);
  await waitFor(() =>
    opened.generation.readinessMeasurements.authenticated_client_payload_bytes_before_close ===
      buffered.length,
  "authenticated buffered bytes were not recorded");
  opened.client.write(live);
  await waitFor(() =>
    opened.generation.readinessMeasurements.authenticated_client_payload_bytes_before_close === 441,
  "authenticated live bytes were not recorded at admission");

  writeLifecycleEvent(opened.generation.readyStream,
    { schema_version: ORDINARY_CLOSE_SCHEMA, closed: true });
  const firstFailure = await opened.generation.lifecycle.failureSettlement;
  assert.equal(firstFailure.detail.authenticated_client_payload_bytes_before_close, 441);
  assert.equal(firstFailure.detail.schema_version, ORDINARY_CLOSE_SCHEMA);

  opened.client.write(Buffer.alloc(19));
  await waitFor(() =>
    opened.generation.readinessMeasurements.authenticated_client_payload_bytes_before_close === 460,
  "post-close admission observation did not reach the shared cell");
  writeLifecycleEvent(opened.generation.readyStream, {
    schema_version: DISCOVERY_PROBE_CLOSE_SCHEMA,
    closed: true,
    discovery_probe: true
  });
  assert.equal(opened.generation.lifecycle.currentFailure(), firstFailure);
  assert.equal(firstFailure.detail.authenticated_client_payload_bytes_before_close, 441);
  assert.equal(firstFailure.detail.schema_version, ORDINARY_CLOSE_SCHEMA);
});

test("claim-authenticated-client-payload-bytes: backpressured payload is observed before pipe drain or close handling",
async (t) => {
  let writeCallbackReleased = false;
  const input = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      this.once("release-test-write", () => {
        writeCallbackReleased = true;
        callback();
      });
    }
  });
  const initial = Buffer.alloc(7, 0x63);
  const live = Buffer.alloc(23, 0x64);
  const opened = await openAuthenticatedAdmission({
    initialPayload: initial,
    inputFactory: () => input
  });
  t.after(async () => {
    input.emit("release-test-write");
    await opened.close();
  });
  opened.client.write(live);
  await waitFor(() =>
    opened.generation.readinessMeasurements.authenticated_client_payload_bytes_before_close === 30,
  "backpressured live bytes were not observed before the pipe");
  assert.equal(writeCallbackReleased, false);
  writeLifecycleEvent(opened.generation.readyStream,
    { schema_version: ORDINARY_CLOSE_SCHEMA, closed: true });
  const failure = await opened.generation.lifecycle.failureSettlement;
  assert.equal(failure.detail.authenticated_client_payload_bytes_before_close, 30);
  assert.equal(writeCallbackReleased, false, "failure handling must not wait for stream drain");
});

test("claim-close-discriminator-first-cause: discovery-probe close keeps its schema discriminator", async () => {
  const measured = createMeasuredLifecycle();
  writeLifecycleEvent(measured.readyStream, registrationEvent());
  await measured.lifecycle.serverReady;
  writeLifecycleEvent(measured.readyStream, {
    schema_version: "wiki-mcp-launcher-client-initialized.v1",
    initialized: true
  });
  const closeEvent = {
    schema_version: DISCOVERY_PROBE_CLOSE_SCHEMA,
    closed: true,
    discovery_probe: true
  };
  writeLifecycleEvent(measured.readyStream, closeEvent);
  const failure = await measured.lifecycle.failureSettlement;
  assert.equal(failure.detail.schema_version, DISCOVERY_PROBE_CLOSE_SCHEMA);
  assert.equal(Number.isFinite(failure.detail.spawn_to_registration_elapsed_ms), true);
  assert.equal(failure.detail.authenticated_client_payload_bytes_before_close, 0);
  assert.deepEqual(Object.keys(closeEvent).sort(),
    ["closed", "discovery_probe", "schema_version"]);
});

test("claim-successful-readiness-unchanged: accepted initialize and exact tools/list still succeed", async () => {
  const measured = createMeasuredLifecycle();
  const registration = registrationEvent();
  writeLifecycleEvent(measured.readyStream, registration);
  await measured.lifecycle.serverReady;
  writeLifecycleEvent(measured.readyStream, {
    schema_version: "wiki-mcp-launcher-client-initialized.v1",
    initialized: true
  });
  writeLifecycleEvent(measured.readyStream, {
    schema_version: "wiki-mcp-launcher-tools-listed.v1",
    tools_listed: true,
    tools: [...TOOL_NAMES]
  });
  assert.deepEqual(await measured.lifecycle.clientReady, {
    initialized: true,
    toolsListed: true,
    tools: [...TOOL_NAMES]
  });
  assert.equal(measured.lifecycle.currentFailure(), null);
  assert.equal(Number.isFinite(
    measured.readinessMeasurements.spawn_to_registration_elapsed_ms), true);
  assert.equal(measured.readinessMeasurements.authenticated_client_payload_bytes_before_close, 0);
  assert.deepEqual(Object.keys(registration).sort(), [
    "lifecycle_protocol_generation", "ready", "registered_tier",
    "schema_version", "tool_profile", "tools"
  ]);
});
