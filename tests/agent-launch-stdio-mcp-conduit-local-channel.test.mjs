import assert from "node:assert/strict";
import { chmodSync, closeSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as channelLeaf from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs";
import * as contract from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import * as connector from "../packages/agent-launch-cli/src/lib/stdio-mcp-unix-connector.mjs";

const INPUT_INVALID = (error) =>
  error?.code === contract.STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID;
const STDIO_UNSUPPORTED = (error) =>
  error?.code === contract.STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED;

function localBinding(overrides = {}) {
  return Object.freeze({
    schemaVersion: contract.STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
    runId: "local", family: "codex", role: "reviewer",
    transport: channelLeaf.STDIO_MCP_CONDUIT_TRANSPORT_LOCAL,
    endpointPath: channelLeaf.STDIO_MCP_LOCAL_ENDPOINT_PATH,
    tokenPath: channelLeaf.STDIO_MCP_LOCAL_TOKEN_PATH,
    childFds: Object.freeze([
      channelLeaf.STDIO_MCP_CONDUIT_INPUT_FD, channelLeaf.STDIO_MCP_CONDUIT_OUTPUT_FD
    ]),
    ...overrides
  });
}

function forgedBinding(overrides = {}) {
  return Object.freeze({
    schemaVersion: contract.STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
    runId: "forged", family: "codex", role: "reviewer", fifoCount: 2,
    pathFds: Object.freeze([0, 1]),
    bindTargets: Object.freeze([
      contract.STDIO_MCP_CLIENT_TO_SERVER_PATH,
      contract.STDIO_MCP_SERVER_TO_CLIENT_PATH
    ]),
    relay: Object.freeze({
      command: contract.STDIO_MCP_RELAY_COMMAND,
      args: contract.STDIO_MCP_RELAY_ARGS
    }),
    ...overrides
  });
}

function producedLocalBinding(root = "/private/launcher/run", state = {}, overrides = {}) {
  const backing = channelLeaf.createStdioMcpConduitLocalBacking(root);
  const lifecycle = {
    bindingState: { namespaceReady: false, ...state },
    markClientProcessTerminal() {}
  };
  return {
    backing,
    lifecycle,
    binding: channelLeaf.createStdioMcpConduitLocalChannel({
      identifier: "produced-local",
      family: "codex",
      role: "reviewer",
      ...overrides,
      backing,
      lifecycleCapability: lifecycle
    })
  };
}

function producedFifoChannel(lifecycleCapability) {
  const directory = mkdtempSync(join(tmpdir(), "wk-1924-fifo-"));
  const fds = new Map();
  const scope = {
    adopt() {},
    openFd(label, open) {
      const fd = open();
      fds.set(label, fd);
      return fd;
    },
    release(label) {
      const fd = fds.get(label);
      if (fd !== undefined) closeSync(fd);
      fds.delete(label);
    }
  };
  try {
    const channel = channelLeaf.createStdioMcpConduitChannel({
      scope, directory, lifecycleCapability,
      createFifos({ clientToServer, serverToClient }) {
        execFileSync("/usr/bin/mkfifo", [clientToServer, serverToClient]);
        chmodSync(clientToServer, 0o600);
        chmodSync(serverToClient, 0o600);
        return { status: 0 };
      }
    });
    return { channel, directory, fds };
  } catch (error) {
    for (const fd of fds.values()) closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test("WK-1821: the local shape is admitted only with the exact paths and two integer childFds",
  () => {
    const { binding: valid } = producedLocalBinding();
    assert.equal(channelLeaf.assertStdioMcpConduitChannelBinding(valid), valid);

    assert.throws(() => channelLeaf.assertStdioMcpConduitChannelBinding(localBinding()),
      INPUT_INVALID);

    for (const override of [
      { endpointPath: "/tmp/mcp.sock" },
      { endpointPath: undefined },
      { tokenPath: "/tmp/mcp.token" },
      { tokenPath: undefined },
      { childFds: Object.freeze([3]) },
      { childFds: Object.freeze([3, 4, 5]) },
      { childFds: Object.freeze(["3", "4"]) },
      { childFds: Object.freeze([3.5, 4]) },
      { childFds: Object.freeze([-1, 4]) },
      { childFds: undefined },
      { schemaVersion: "launcher-stdio-mcp-conduit-binding.v2" }
    ]) {
      assert.throws(() => producedLocalBinding("/private/invalid-local", override),
        INPUT_INVALID, `local binding override ${JSON.stringify(Object.keys(override))}`);
    }
  });

test("WK-1821: a local binding that also carries a FIFO field is refused as mixed", () => {

  for (const override of [
    { fifoCount: 2 },
    { pathFds: Object.freeze([0, 1]) },
    { bindTargets: Object.freeze([
      contract.STDIO_MCP_CLIENT_TO_SERVER_PATH, contract.STDIO_MCP_SERVER_TO_CLIENT_PATH]) },
    { fifoIdentities: Object.freeze({ clientToServer: { dev: 1, ino: 2 } }) },
    { anchorFds: Object.freeze([5, 6]) },
    { relay: Object.freeze({
      command: contract.STDIO_MCP_RELAY_COMMAND, args: contract.STDIO_MCP_RELAY_ARGS }) }
  ]) {
    const { binding: mixed } = producedLocalBinding("/private/mixed-local", override);
    assert.throws(() => channelLeaf.assertStdioMcpConduitChannelBinding(mixed),
      INPUT_INVALID, `mixed field ${Object.keys(override)[0]}`);
    assert.throws(() => channelLeaf.resolveConduitChildStdio(mixed, "pipe"), STDIO_UNSUPPORTED);
  }

  for (const override of [
    { pathFds: Object.freeze([]) },
    { anchorFds: Object.freeze([]) },
    { relay: null },
    { fifoCount: undefined }
  ]) {
    const { binding: benign } = producedLocalBinding("/private/benign-local", override);
    assert.equal(channelLeaf.assertStdioMcpConduitChannelBinding(benign), benign,
      `benign field ${Object.keys(override)[0]}`);
  }
});

test("WK-1821: family and role stay the CONTRACT's half for a local binding too", () => {

  const { binding: foreignFamily } = producedLocalBinding(
    "/private/launcher/foreign-family", {}, { family: "agy" });
  assert.equal(channelLeaf.assertStdioMcpConduitChannelBinding(foreignFamily), foreignFamily);
  assert.throws(() => contract.assertTrustedStdioMcpConduitBinding(foreignFamily), INPUT_INVALID);
  const { binding: foreignRole } = producedLocalBinding(
    "/private/launcher/foreign-role", {}, { role: "operator" });
  assert.equal(channelLeaf.assertStdioMcpConduitChannelBinding(foreignRole), foreignRole);
  assert.throws(() => contract.assertTrustedStdioMcpConduitBinding(foreignRole), INPUT_INVALID);
});

test("WK-1821: a local binding is exempt from the FIFO liveness probe but not from single-use",
  () => {

    const notOpen = Object.freeze([9997, 9998]);
  const fifoChannel = producedFifoChannel({
    bindingState: { live: 1 }, markClientProcessTerminal() {}
  });
  try {
    const fifo = channelLeaf.finalizeStdioMcpConduitBinding({
      channel: fifoChannel.channel,
      lifecycleCapability: fifoChannel.channel.lifecycleCapability,
      identifier: "not-open-fifo", family: "codex", role: "reviewer"
    });
    for (const label of ["c2s-o-path", "s2c-o-path"]) {
      closeSync(fifoChannel.fds.get(label));
      fifoChannel.fds.delete(label);
    }
    assert.throws(() => channelLeaf.assertStdioMcpConduitChannelAvailable(fifo),
        (error) => error?.code === contract.STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID);
  } finally {
    for (const fd of fifoChannel.fds.values()) closeSync(fd);
    rmSync(fifoChannel.directory, { recursive: true, force: true });
  }

    const { binding: local } = producedLocalBinding(
      "/private/launcher/not-open", {}, { inputFd: notOpen[0], outputFd: notOpen[1] });
    assert.deepEqual(local.childFds, [
      channelLeaf.STDIO_MCP_CONDUIT_INPUT_FD,
      channelLeaf.STDIO_MCP_CONDUIT_OUTPUT_FD
    ]);
    assert.equal(channelLeaf.assertStdioMcpConduitChannelAvailable(local), local);
    assert.equal(contract.assertTrustedStdioMcpConduitBinding(local), local);

    for (const state of [{ namespaceReady: true }, { cleaned: true }]) {
      const { binding: consumed } = producedLocalBinding("/private/consumed-local", state);
      assert.throws(() => channelLeaf.assertStdioMcpConduitChannelAvailable(consumed),
        (error) => error?.code === contract.STDIO_MCP_CONDUIT_ERROR_CODES.BINDING_CONSUMED);
      assert.throws(() => contract.assertTrustedStdioMcpConduitBinding(consumed),
        (error) => error?.code === contract.STDIO_MCP_CONDUIT_ERROR_CODES.BINDING_CONSUMED);
    }
  });

test("WK-1924: primitive local constructor produces trusted local binding", () => {
  const binding = channelLeaf.createStdioMcpConduitLocalBinding(
    "constructed-local", "codex", "reviewer", 3, 4);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(contract.assertTrustedStdioMcpConduitBinding(binding), binding);
});

test("WK-1924: local projections require channel-owned backing provenance", () => {
  const binding = channelLeaf.createStdioMcpConduitLocalBinding(
    "primitive-without-backing", "codex", "reviewer", 3, 4);
  assert.equal(contract.assertTrustedStdioMcpConduitBinding(binding), binding);
  assert.throws(() => channelLeaf.projectStdioMcpChannelClientRegistration(binding),
    INPUT_INVALID);
  assert.throws(() => channelLeaf.projectStdioMcpChannelNamespaceArgs(binding),
    INPUT_INVALID);
});

test("WK-1924: lifecycle state cannot collide with channel-owned binding fields", () => {
  const reservedKeys = [
    "schemaVersion", "runId", "family", "role", "transport", "endpointPath",
    "tokenPath", "childFds", "markClientProcessTerminal"
  ];
  for (const key of reservedKeys) {
    const backing = channelLeaf.createStdioMcpConduitLocalBacking(
      `/private/collision-${key}`);
    assert.throws(() => channelLeaf.createStdioMcpConduitLocalChannel({
      identifier: "collision", family: "codex", role: "reviewer", backing,
      lifecycleCapability: {
        bindingState: { [key]: key === "markClientProcessTerminal"
          ? () => {} : "collision" },
        markClientProcessTerminal() {}
      }
    }), INPUT_INVALID, key);
  }
  const { binding } = producedLocalBinding();
  assert.equal(Object.hasOwn(binding, "markClientProcessTerminal"), false);
});

test("WK-1924: omitted local channel options use typed input refusal", () => {
  for (const options of [undefined, null]) {
    assert.throws(() => channelLeaf.createStdioMcpConduitLocalChannel(options),
      INPUT_INVALID);
  }
});

test("WK-1821: child stdio takes childFds for a local binding and pathFds for a FIFO one", () => {

  const { binding: produced } = producedLocalBinding();
  assert.deepEqual(channelLeaf.resolveConduitChildStdio(produced, "pipe"),
    ["pipe", "pipe", "pipe"]);
  assert.deepEqual(
    channelLeaf.resolveConduitChildStdio(localBinding({ childFds: Object.freeze([7, 8]) }),
      ["ignore", "pipe", "pipe"]),
    ["ignore", "pipe", "pipe"]);

  assert.deepEqual(
    channelLeaf.resolveConduitChildStdio(
      { transport: channelLeaf.STDIO_MCP_CONDUIT_TRANSPORT_FIFO,
        pathFds: [41, 42], childFds: [3, 4] }, "pipe"),
    ["pipe", "pipe", "pipe", 41, 42]);

  assert.throws(
    () => channelLeaf.resolveConduitChildStdio(localBinding(),
      ["pipe", "pipe", "pipe", "pipe"]), STDIO_UNSUPPORTED);
});

test("WK-1924: the real local producer owns backing, registration, and namespace order", () => {
  const { binding } = producedLocalBinding("/launcher-private/one");
  assert.equal(binding.runId, "produced-local");
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.childFds), true);
  assert.equal(channelLeaf.assertStdioMcpConduitChannelBinding(binding), binding);
  assert.deepEqual(channelLeaf.projectStdioMcpChannelClientRegistration(binding), {
    command: "/usr/bin/node",
    args: [channelLeaf.STDIO_MCP_LOCAL_CONNECTOR_DESTINATION],
    env: {}
  });
  assert.deepEqual(channelLeaf.projectStdioMcpChannelNamespaceArgs(binding), [
    "--dir", "/run/agent-launch",
    "--ro-bind", fileURLToPath(new URL("../packages/agent-launch-cli/src/lib/stdio-mcp-unix-connector.mjs", import.meta.url)),
    channelLeaf.STDIO_MCP_LOCAL_CONNECTOR_DESTINATION,
    "--ro-bind", "/launcher-private/one/mcp.sock", connector.PROJECTED_ENDPOINT,
    "--ro-bind", "/launcher-private/one/mcp.token", connector.PROJECTED_TOKEN_FILE
  ]);
  assert.equal(channelLeaf.STDIO_MCP_LOCAL_ENDPOINT_PATH, connector.PROJECTED_ENDPOINT);
  assert.equal(channelLeaf.STDIO_MCP_LOCAL_TOKEN_PATH, connector.PROJECTED_TOKEN_FILE);
  assert.deepEqual(channelLeaf.resolveConduitChildStdio(binding, "pipe"),
    ["pipe", "pipe", "pipe"]);
});

test("WK-1924: local backing projection is opaque and derives a sibling root", () => {
  const backing = channelLeaf.deriveStdioMcpConduitLocalBacking(
    "/launcher-private/conduit-123");
  assert.deepEqual(channelLeaf.projectStdioMcpChannelLocalBacking(backing), {
    endpointSource: "/launcher-private/conduit-123-local/mcp.sock",
    tokenSource: "/launcher-private/conduit-123-local/mcp.token"
  });
  assert.notEqual(
    channelLeaf.projectStdioMcpChannelLocalBacking(backing).endpointSource,
    "/launcher-private/conduit-123/mcp.sock");
  assert.throws(() => channelLeaf.projectStdioMcpChannelLocalBacking({}), INPUT_INVALID);
  assert.throws(() => channelLeaf.deriveStdioMcpConduitLocalBacking("relative"), INPUT_INVALID);
});

test("WK-1924: local backing and lifecycle capabilities are typed and opaque", () => {
  const { backing, binding } = producedLocalBinding();
  assert.deepEqual(Object.keys(backing), []);
  assert.equal(Object.isFrozen(backing), true);
  for (const bad of [undefined, null, Object.freeze({}), "/relative/root"]) {
    assert.throws(() => channelLeaf.createStdioMcpConduitLocalChannel({
      identifier: "bad", family: "codex", role: "reviewer", backing: bad,
      lifecycleCapability: { bindingState: { live: 1 }, markClientProcessTerminal() {} }
    }), INPUT_INVALID);
  }
  for (const lifecycleCapability of [undefined, null,
    { bindingState: {}, markClientProcessTerminal() {} },
    { bindingState: { live: 1 } },
    { bindingState: { transport: "fifo" }, markClientProcessTerminal() {} }]) {
    assert.throws(() => channelLeaf.createStdioMcpConduitLocalChannel({
      identifier: "bad", family: "codex", role: "reviewer", backing, lifecycleCapability
    }), INPUT_INVALID);
  }
  const fixed = channelLeaf.createStdioMcpConduitLocalChannel({
    identifier: "fixed", family: "codex", role: "reviewer", backing,
    inputFd: -1, outputFd: "caller-selected",
    lifecycleCapability: { bindingState: { live: 1 }, markClientProcessTerminal() {} }
  });
  assert.deepEqual(fixed.childFds, [
    channelLeaf.STDIO_MCP_CONDUIT_INPUT_FD,
    channelLeaf.STDIO_MCP_CONDUIT_OUTPUT_FD
  ]);
  assert.equal("markClientProcessTerminal" in binding, false);
  assert.equal(channelLeaf.recordLauncherObservedStdioMcpClientTerminal(binding), true);
});

test("WK-1924: lifecycle accessors stay live and caller objects are not branded", () => {
  const backing = channelLeaf.createStdioMcpConduitLocalBacking("/private/live");
  let value = 1;
  const bindingState = {};
  Object.defineProperty(bindingState, "live", {
    enumerable: true, configurable: true, get: () => value
  });
  const lifecycleCapability = { bindingState, markClientProcessTerminal() {} };
  const binding = channelLeaf.createStdioMcpConduitLocalChannel({
    identifier: "live", family: "codex", role: "reviewer", backing, lifecycleCapability
  });
  value = 2;
  assert.equal(binding.live, 2);
  assert.equal(channelLeaf.isRegisteredTrustedStdioMcpConduitBinding(bindingState), false);
  assert.equal(channelLeaf.isRegisteredTrustedStdioMcpConduitBinding(backing), false);
  assert.throws(() => channelLeaf.projectStdioMcpChannelNamespaceArgs(
    Object.freeze({ ...binding, transport: "local" })), INPUT_INVALID);
});

test("WK-1924: FIFO finalization requires the channel-minted one-shot capability", () => {
  let terminal = false;
  const lifecycle = {
    bindingState: { live: 1 },
    markClientProcessTerminal() { terminal = true; }
  };
  const first = producedFifoChannel(lifecycle);
  const second = producedFifoChannel({
    bindingState: { other: 2 }, markClientProcessTerminal() {}
  });
  const finish = (channel, capability) => channelLeaf.finalizeStdioMcpConduitBinding({
    channel, lifecycleCapability: capability,
    identifier: "fifo-finalized", family: "codex", role: "reviewer"
  });
  try {
    const binding = finish(first.channel, first.channel.lifecycleCapability);
    assert.equal(binding.pathFds.length, 2);
    assert.equal(binding.fifoIdentities.clientToServer.ino > 0, true);
    assert.equal(binding.live, 1);
    assert.equal(Object.getOwnPropertyDescriptor(binding, "live").get, undefined);
    assert.equal(channelLeaf.recordLauncherObservedStdioMcpClientTerminal(binding), true);
    assert.equal(terminal, true);

    for (const [label, channel, capability] of [
      ["ordinary", first.channel, lifecycle],
      ["cross-channel", first.channel, second.channel.lifecycleCapability],
      ["copied", first.channel, { ...first.channel.lifecycleCapability }],
      ["replayed", first.channel, first.channel.lifecycleCapability],
      ["forged-channel", {}, first.channel.lifecycleCapability]
    ]) {
      assert.throws(() => finish(channel, capability), INPUT_INVALID, label);
    }
  } finally {
    for (const fd of first.fds.values()) closeSync(fd);
    for (const fd of second.fds.values()) closeSync(fd);
    rmSync(first.directory, { recursive: true, force: true });
    rmSync(second.directory, { recursive: true, force: true });
  }
});
