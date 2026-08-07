import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as channel from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs";
import * as contract from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANNEL_PATH = path.join(
  REPO_ROOT, "packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs");
const CONTRACT_PATH = path.join(
  REPO_ROOT, "packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs");

const INPUT_INVALID = (error) =>
  error?.code === contract.STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID;

function ordinaryBinding() {
  return Object.freeze({
    schemaVersion: channel.STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
    runId: "ordinary",
    family: "codex",
    role: "reviewer",
    transport: channel.STDIO_MCP_CONDUIT_TRANSPORT_LOCAL,
    endpointPath: channel.STDIO_MCP_LOCAL_ENDPOINT_PATH,
    tokenPath: channel.STDIO_MCP_LOCAL_TOKEN_PATH,
    childFds: Object.freeze([
      channel.STDIO_MCP_CONDUIT_INPUT_FD,
      channel.STDIO_MCP_CONDUIT_OUTPUT_FD
    ])
  });
}

test("the retired registrar is absent from channel and contract exports", () => {
  const retired = "registerTrustedStdioMcpConduitBinding";
  assert.equal(retired in channel, false);
  assert.equal(retired in contract, false);
  assert.doesNotMatch(readFileSync(CHANNEL_PATH, "utf8"),
    new RegExp(`export\\s+function\\s+${retired}`));
  assert.doesNotMatch(readFileSync(CONTRACT_PATH, "utf8"),
    new RegExp(`export\\s+[^\\n]*${retired}`));
});

test("the binding mint surface is exactly the three channel producers", () => {
  const channelExportNames = [
    "STDIO_MCP_CLIENT_TO_SERVER_PATH",
    "STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION",
    "STDIO_MCP_CONDUIT_INPUT_FD",
    "STDIO_MCP_CONDUIT_OUTPUT_FD",
    "STDIO_MCP_CONDUIT_ROOT",
    "STDIO_MCP_CONDUIT_TRANSPORT_FIFO",
    "STDIO_MCP_CONDUIT_TRANSPORT_LOCAL",
    "STDIO_MCP_LOCAL_CONNECTOR_DESTINATION",
    "STDIO_MCP_LOCAL_ENDPOINT_PATH",
    "STDIO_MCP_LOCAL_TOKEN_PATH",
    "STDIO_MCP_RELAY_ARGS",
    "STDIO_MCP_RELAY_COMMAND",
    "STDIO_MCP_SERVER_TO_CLIENT_PATH",
    "assertStdioMcpConduitChannelAvailable",
    "assertStdioMcpConduitChannelBinding",
    "createStdioMcpChannelRelayRegistration",
    "createStdioMcpConduitChannel",
    "createStdioMcpConduitLocalBacking",
    "createStdioMcpConduitLocalBinding",
    "createStdioMcpConduitLocalChannel",
    "deriveStdioMcpConduitLocalBacking",
    "finalizeStdioMcpConduitBinding",
    "isRegisteredTrustedStdioMcpConduitBinding",
    "projectStdioMcpChannelClientRegistration",
    "projectStdioMcpChannelLocalBacking",
    "projectStdioMcpChannelNamespaceArgs",
    "recordLauncherObservedStdioMcpClientTerminal",
    "resolveConduitChildStdio"
  ];
  assert.deepEqual(Object.keys(channel).sort(), channelExportNames);

  const mintNames = [
    "createStdioMcpConduitLocalBinding",
    "createStdioMcpConduitLocalChannel",
    "finalizeStdioMcpConduitBinding"
  ];
  const exportedBindingMints = Object.keys(channel).filter((name) =>
    /^(?:create|finalize).*Binding$/.test(name) ||
    name === "createStdioMcpConduitLocalChannel");
  assert.deepEqual(exportedBindingMints.sort(), mintNames.sort());
  for (const name of mintNames) assert.equal(typeof channel[name], "function");
});

test("a real channel producer has provenance accepted by the contract", () => {
  const binding = channel.createStdioMcpConduitLocalChannel({
    identifier: "provenance",
    family: "codex",
    role: "reviewer",
    backing: channel.createStdioMcpConduitLocalBacking("/private/provenance"),
    lifecycleCapability: {
      bindingState: { permitted: true },
      markClientProcessTerminal() {}
    }
  });
  assert.equal(contract.assertTrustedStdioMcpConduitBinding(binding), binding);
  assert.equal(channel.isRegisteredTrustedStdioMcpConduitBinding(binding), true);
});

test("exported calls cannot brand an ordinary binding object", () => {
  const supplied = ordinaryBinding();
  assert.equal(channel.isRegisteredTrustedStdioMcpConduitBinding(supplied), false);
  assert.throws(() => channel.assertStdioMcpConduitChannelBinding(supplied), INPUT_INVALID);
  assert.throws(() => contract.assertTrustedStdioMcpConduitBinding(supplied), INPUT_INVALID);
  assert.throws(() => channel.recordLauncherObservedStdioMcpClientTerminal(supplied), INPUT_INVALID);
  assert.throws(() => channel.projectStdioMcpChannelClientRegistration(supplied), INPUT_INVALID);
  assert.throws(() => channel.projectStdioMcpChannelNamespaceArgs(supplied), INPUT_INVALID);
});
