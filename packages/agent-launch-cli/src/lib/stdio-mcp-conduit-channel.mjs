

import {
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  failStdioMcpConduit as fail
} from "./stdio-mcp-conduit-errors.mjs";

export const STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION =
  "launcher-stdio-mcp-conduit-binding.v1";

export const STDIO_MCP_CONDUIT_TRANSPORT_FIFO = "fifo";
export const STDIO_MCP_CONDUIT_TRANSPORT_LOCAL = "local";

export const STDIO_MCP_CONDUIT_ROOT = "/run/agent-launch/wiki-mcp";
export const STDIO_MCP_CLIENT_TO_SERVER_PATH = `${STDIO_MCP_CONDUIT_ROOT}/client-to-server`;
export const STDIO_MCP_SERVER_TO_CLIENT_PATH = `${STDIO_MCP_CONDUIT_ROOT}/server-to-client`;

export const STDIO_MCP_LOCAL_ENDPOINT_PATH = "/run/agent-launch/mcp.sock";
export const STDIO_MCP_LOCAL_TOKEN_PATH = "/run/agent-launch/mcp.token";
export const STDIO_MCP_LOCAL_CONNECTOR_DESTINATION =
  "/run/agent-launch/stdio-mcp-unix-connector.mjs";
const STDIO_MCP_LOCAL_CONNECTOR_SOURCE = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "stdio-mcp-unix-connector.mjs");

const STDIO_MCP_CONDUIT_NAMESPACE_PARENT = path.dirname(STDIO_MCP_CONDUIT_ROOT);

const HOST_CLIENT_TO_SERVER_FIFO = "client-to-server.fifo";
const HOST_SERVER_TO_CLIENT_FIFO = "server-to-client.fifo";

export const STDIO_MCP_CONDUIT_INPUT_FD = 3;
export const STDIO_MCP_CONDUIT_OUTPUT_FD = 4;

export const STDIO_MCP_RELAY_COMMAND = "/usr/bin/sh";
export const STDIO_MCP_RELAY_ARGS = Object.freeze([
  "-c",
  `exec 3>${STDIO_MCP_CLIENT_TO_SERVER_PATH}; exec 4<${STDIO_MCP_SERVER_TO_CLIENT_PATH}; exec 5<&0; /usr/bin/cat <&4 3>&- 5<&- & relay_out=$!; /usr/bin/cat >&3 4<&- 0<&5 5<&- & relay_in=$!; exec 0<&- 1>&- 3>&- 4<&- 5<&-; wait "$relay_out"; kill "$relay_in" 2>/dev/null; wait "$relay_in" 2>/dev/null; exit 0`
]);

const LINUX_O_PATH = 0o10000000;

const TRUSTED_BINDINGS = new WeakSet();
const TRUSTED_BINDING_LIFECYCLE_CONTROLS = new WeakMap();
const TRUSTED_LOCAL_BACKINGS = new WeakMap();
const TRUSTED_LOCAL_BINDING_BACKINGS = new WeakMap();
const TRUSTED_FIFO_CHANNELS = new WeakMap();

function mintTrustedStdioMcpConduitBinding(binding) {
  TRUSTED_BINDINGS.add(binding);
  return binding;
}

export function createStdioMcpConduitLocalBinding(identifier, family, role,
  inputFd, outputFd) {
  if (typeof identifier !== "string" || identifier.length === 0 ||
      typeof family !== "string" || family.length === 0 ||
      typeof role !== "string" || role.length === 0 ||
      !Number.isInteger(inputFd) || inputFd < 0 ||
      !Number.isInteger(outputFd) || outputFd < 0) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "local stdio MCP conduit binding constructor requires primitive launcher inputs");
  }
  const binding = Object.freeze({
    schemaVersion: STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
    runId: identifier,
    family,
    role,
    transport: STDIO_MCP_CONDUIT_TRANSPORT_LOCAL,
    endpointPath: STDIO_MCP_LOCAL_ENDPOINT_PATH,
    tokenPath: STDIO_MCP_LOCAL_TOKEN_PATH,
    childFds: Object.freeze([inputFd, outputFd])
  });
  return mintTrustedStdioMcpConduitBinding(binding);
}

export function createStdioMcpConduitLocalBacking(privateRoot) {
  if (typeof privateRoot !== "string" || privateRoot.length === 0 ||
      !path.isAbsolute(privateRoot) || privateRoot.includes("\0")) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "local stdio MCP conduit backing requires one absolute private root");
  }
  const backing = Object.freeze({});
  TRUSTED_LOCAL_BACKINGS.set(backing, Object.freeze({
    privateRoot,
    endpointSource: path.join(privateRoot, "mcp.sock"),
    tokenSource: path.join(privateRoot, "mcp.token")
  }));
  return backing;
}

export function deriveStdioMcpConduitLocalBacking(directory) {
  if (typeof directory !== "string" || directory.length === 0 ||
      !path.isAbsolute(directory) || directory.includes("\0")) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "local stdio MCP conduit backing requires one absolute conduit directory");
  }
  const parent = path.dirname(directory);
  const name = path.basename(directory);
  if (name.length === 0 || name === "." || name === "..") {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "local stdio MCP conduit backing requires a named conduit directory");
  }
  return createStdioMcpConduitLocalBacking(path.join(parent, `${name}-local`));
}

function localBackingState(backing) {
  const state = TRUSTED_LOCAL_BACKINGS.get(backing);
  if (!state) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP local channel requires a channel-minted local backing");
  }
  return state;
}

function requireLifecycleCapability(lifecycleCapability) {
  if (!lifecycleCapability || typeof lifecycleCapability !== "object" ||
      !lifecycleCapability.bindingState ||
      typeof lifecycleCapability.bindingState !== "object" ||
      Reflect.ownKeys(lifecycleCapability.bindingState).length === 0 ||
      typeof lifecycleCapability.markClientProcessTerminal !== "function") {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit local channel requires an explicit lifecycle capability");
  }
  return lifecycleCapability;
}

const CHANNEL_OWNED_BINDING_FIELDS = new Set([
  "schemaVersion", "runId", "family", "role", "transport", "endpointPath",
  "tokenPath", "childFds", "markClientProcessTerminal"
]);

export function createStdioMcpConduitLocalChannel(options) {
  if (!options || typeof options !== "object") {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "local stdio MCP conduit channel requires an options object");
  }
  const {
    identifier, family, role, backing, lifecycleCapability
  } = options;
  if (typeof identifier !== "string" || identifier.length === 0 ||
      typeof family !== "string" || family.length === 0 ||
      typeof role !== "string" || role.length === 0) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "local stdio MCP conduit channel requires primitive launcher inputs");
  }
  localBackingState(backing);
  const capability = requireLifecycleCapability(lifecycleCapability);
  const bindingState = capability.bindingState;
  for (const key of Reflect.ownKeys(bindingState)) {
    if (typeof key === "string" && CHANNEL_OWNED_BINDING_FIELDS.has(key)) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
        "stdio MCP conduit lifecycle state collides with channel-owned fields");
    }
  }
  const binding = {
    schemaVersion: STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
    runId: identifier,
    family,
    role,
    transport: STDIO_MCP_CONDUIT_TRANSPORT_LOCAL,
    endpointPath: STDIO_MCP_LOCAL_ENDPOINT_PATH,
    tokenPath: STDIO_MCP_LOCAL_TOKEN_PATH,
    childFds: Object.freeze([
      STDIO_MCP_CONDUIT_INPUT_FD, STDIO_MCP_CONDUIT_OUTPUT_FD
    ])
  };
  Object.defineProperties(binding, Object.getOwnPropertyDescriptors(bindingState));
  Object.freeze(binding);
  TRUSTED_LOCAL_BINDING_BACKINGS.set(binding, backing);
  TRUSTED_BINDING_LIFECYCLE_CONTROLS.set(
    binding, capability.markClientProcessTerminal);
  return mintTrustedStdioMcpConduitBinding(binding);
}

export function finalizeStdioMcpConduitBinding(options) {
  if (!options || typeof options !== "object" ||
      !TRUSTED_FIFO_CHANNELS.has(options.channel) ||
      typeof options.identifier !== "string" || options.identifier.length === 0 ||
      typeof options.family !== "string" || options.family.length === 0 ||
      typeof options.role !== "string" || options.role.length === 0) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit binding finalizer requires a channel-owned FIFO and primitive launcher inputs");
  }
  const channelRecord = TRUSTED_FIFO_CHANNELS.get(options.channel);
  if (!channelRecord || channelRecord.consumed ||
      options.lifecycleCapability !== channelRecord.capability) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit binding finalizer requires the channel's opaque lifecycle capability");
  }
  const capability = channelRecord.lifecycle;
  const bindingState = capability.bindingState;
  for (const key of Reflect.ownKeys(bindingState)) {
    if (typeof key === "string" && CHANNEL_OWNED_BINDING_FIELDS.has(key)) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
        "stdio MCP conduit lifecycle state collides with channel-owned fields");
    }
  }
  channelRecord.consumed = true;
  const binding = {
    schemaVersion: STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
    runId: options.identifier,
    family: options.family,
    role: options.role,
    ...options.channel.bindingFields
  };
  Object.defineProperties(binding, Object.getOwnPropertyDescriptors(bindingState));
  Object.freeze(binding);
  TRUSTED_BINDING_LIFECYCLE_CONTROLS.set(
    binding, capability.markClientProcessTerminal);
  return mintTrustedStdioMcpConduitBinding(binding);
}

export function isRegisteredTrustedStdioMcpConduitBinding(binding) {
  return Boolean(binding) && typeof binding === "object" && TRUSTED_BINDINGS.has(binding);
}

export function recordLauncherObservedStdioMcpClientTerminal(binding) {
  if (!isRegisteredTrustedStdioMcpConduitBinding(binding)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "client terminal observation requires a launcher-minted stdio MCP conduit binding");
  }
  const markTerminal = TRUSTED_BINDING_LIFECYCLE_CONTROLS.get(binding);
  if (typeof markTerminal !== "function") {

    return false;
  }
  markTerminal();
  return true;
}

const FIFO_ONLY_BINDING_FIELDS = Object.freeze([
  "fifoCount", "pathFds", "bindTargets", "fifoIdentities", "anchorFds", "relay"
]);

function hasMeaningfulBindingField(binding, name) {
  const value = binding?.[name];
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length !== 0;
  return true;
}

function bindingDescriptorFds(binding) {
  const transport = binding?.transport ?? STDIO_MCP_CONDUIT_TRANSPORT_FIFO;
  return transport === STDIO_MCP_CONDUIT_TRANSPORT_LOCAL
    ? binding?.childFds
    : binding?.pathFds;
}

export function assertStdioMcpConduitChannelBinding(binding) {
  const provenanceValid = isRegisteredTrustedStdioMcpConduitBinding(binding) &&
    binding.schemaVersion === STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION &&
    Object.isFrozen(binding);
  const transport = binding?.transport ?? STDIO_MCP_CONDUIT_TRANSPORT_FIFO;
  let shapeValid = false;
  if (provenanceValid && transport === STDIO_MCP_CONDUIT_TRANSPORT_FIFO) {
    const descriptorFds = bindingDescriptorFds(binding);
    shapeValid = binding.fifoCount === 2 && Array.isArray(descriptorFds) &&
      descriptorFds.length === 2 &&
      JSON.stringify(binding.bindTargets) === JSON.stringify([
        STDIO_MCP_CLIENT_TO_SERVER_PATH, STDIO_MCP_SERVER_TO_CLIENT_PATH
      ]) && binding.relay?.command === STDIO_MCP_RELAY_COMMAND &&
      JSON.stringify(binding.relay?.args) === JSON.stringify(STDIO_MCP_RELAY_ARGS);
  } else if (provenanceValid && transport === STDIO_MCP_CONDUIT_TRANSPORT_LOCAL) {
    const descriptorFds = bindingDescriptorFds(binding);
    shapeValid = binding.endpointPath === STDIO_MCP_LOCAL_ENDPOINT_PATH &&
      binding.tokenPath === STDIO_MCP_LOCAL_TOKEN_PATH &&
      Array.isArray(descriptorFds) && descriptorFds.length === 2 &&
      descriptorFds.every((fd) => Number.isInteger(fd) && fd >= 0) &&
      !FIFO_ONLY_BINDING_FIELDS.some((name) => hasMeaningfulBindingField(binding, name));
  }
  if (!shapeValid) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "launch plan requires one exact launcher-minted stdio MCP conduit binding");
  }
  return binding;
}

export function assertStdioMcpConduitChannelAvailable(binding) {

  if (binding.namespaceReady === true || binding.cleaned === true) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.BINDING_CONSUMED,
      "stdio MCP conduit binding was already projected into a namespace",
      { run_id: binding.runId ?? null });
  }
  const transport = binding?.transport ?? STDIO_MCP_CONDUIT_TRANSPORT_FIFO;
  const descriptorFds = bindingDescriptorFds(binding);

  if (transport === STDIO_MCP_CONDUIT_TRANSPORT_LOCAL) return binding;
  for (const fd of descriptorFds) {
    let stats;
    try {
      stats = fstatSync(fd);
    } catch (error) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
        "stdio MCP conduit O_PATH binding is no longer open",
        { code: error?.code ?? null });
    }
    if (!stats.isFIFO()) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
        "stdio MCP conduit O_PATH binding no longer identifies a FIFO");
    }
  }
  return binding;
}

function safeUnlink(file) {
  try { unlinkSync(file); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertFifo(file, expected = null) {
  const stats = lstatSync(file);
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (!stats.isFIFO() || stats.uid !== expectedUid || (stats.mode & 0o777) !== 0o600) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
      "stdio MCP conduit object must be a launcher-owned mode 0600 FIFO",
      { file, uid: stats.uid, mode: stats.mode & 0o777, fifo: stats.isFIFO() });
  }
  if (expected && (stats.dev !== expected.dev || stats.ino !== expected.ino)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_IDENTITY_MISMATCH,
      "stdio MCP conduit FIFO identity changed during launch",
      { file, expected, actual: { dev: stats.dev, ino: stats.ino } });
  }
  return Object.freeze({ dev: stats.dev, ino: stats.ino, uid: stats.uid, mode: stats.mode & 0o777 });
}

export function createStdioMcpConduitChannel({
  scope, directory, createFifos, lifecycleCapability = null
}) {
  const clientToServer = path.join(directory, HOST_CLIENT_TO_SERVER_FIFO);
  const serverToClient = path.join(directory, HOST_SERVER_TO_CLIENT_FIFO);

  scope.adopt("fifo-client-to-server", () => safeUnlink(clientToServer));
  scope.adopt("fifo-server-to-client", () => safeUnlink(serverToClient));
  const made = createFifos({ clientToServer, serverToClient });
  if (made?.error || made?.status !== 0) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_CREATE_FAILED,
      "launcher could not create the stdio MCP FIFO pair",
      { code: made?.error?.code ?? made?.status ?? null,
        stderr: made?.stderr?.slice(0, 512) ?? "" });
  }
  if (readdirSync(directory).sort().join("\0") !==
      [HOST_CLIENT_TO_SERVER_FIFO, HOST_SERVER_TO_CLIENT_FIFO].sort().join("\0")) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
      "stdio MCP conduit directory must contain exactly the two launcher-created FIFOs");
  }
  const identities = Object.freeze({
    clientToServer: assertFifo(clientToServer),
    serverToClient: assertFifo(serverToClient)
  });

  const c2sPathFd = scope.openFd("c2s-o-path",
    () => openSync(clientToServer, LINUX_O_PATH | fsConstants.O_NOFOLLOW));
  const s2cPathFd = scope.openFd("s2c-o-path",
    () => openSync(serverToClient, LINUX_O_PATH | fsConstants.O_NOFOLLOW));
  const c2sPathStats = fstatSync(c2sPathFd);
  const s2cPathStats = fstatSync(s2cPathFd);
  if (!c2sPathStats.isFIFO() || !s2cPathStats.isFIFO() ||
      c2sPathStats.ino !== identities.clientToServer.ino ||
      s2cPathStats.ino !== identities.serverToClient.ino) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_IDENTITY_MISMATCH,
      "O_PATH conduit references do not identify the created FIFO pair");
  }

  const c2sAnchor = scope.openFd("c2s-anchor",
    () => openSync(clientToServer, fsConstants.O_RDWR | fsConstants.O_NONBLOCK));
  const s2cAnchor = scope.openFd("s2c-anchor",
    () => openSync(serverToClient, fsConstants.O_RDWR | fsConstants.O_NONBLOCK));

  const serverInputFd = scope.openFd("server-stdin",
    () => openSync(clientToServer, fsConstants.O_RDONLY));
  const serverOutputFd = scope.openFd("server-stdout",
    () => openSync(serverToClient, fsConstants.O_WRONLY));

  const lifecycle = lifecycleCapability === null
    ? null
    : requireLifecycleCapability(lifecycleCapability);
  const channel = Object.freeze({

    serverInputFd,
    serverOutputFd,

    releaseServerEndpoints() {
      scope.release("server-stdin");
      scope.release("server-stdout");
    },

    retireNames() {
      assertFifo(clientToServer, identities.clientToServer);
      assertFifo(serverToClient, identities.serverToClient);
      scope.release("c2s-o-path");
      scope.release("s2c-o-path");
      scope.release("fifo-client-to-server");
      scope.release("fifo-server-to-client");

      scope.release("c2s-anchor");
      scope.release("s2c-anchor");
    },

    bindingFields: Object.freeze({
      fifoCount: 2,
      fifoIdentities: identities,
      pathFds: Object.freeze([c2sPathFd, s2cPathFd]),
      anchorFds: Object.freeze([c2sAnchor, s2cAnchor]),
      childFds: Object.freeze([STDIO_MCP_CONDUIT_INPUT_FD, STDIO_MCP_CONDUIT_OUTPUT_FD]),
      bindTargets: Object.freeze([
        STDIO_MCP_CLIENT_TO_SERVER_PATH, STDIO_MCP_SERVER_TO_CLIENT_PATH
      ]),
      relay: createStdioMcpChannelRelayRegistration()
    }),
    ...(lifecycle === null ? {} : {
      lifecycleCapability: Object.freeze({})
    })
  });
  TRUSTED_FIFO_CHANNELS.set(channel, {
    capability: channel.lifecycleCapability,
    lifecycle,
    consumed: false
  });
  return channel;
}

export function createStdioMcpChannelRelayRegistration() {
  return Object.freeze({
    command: STDIO_MCP_RELAY_COMMAND,
    args: STDIO_MCP_RELAY_ARGS,
    env: Object.freeze({})
  });
}

export function projectStdioMcpChannelClientRegistration(binding) {
  assertStdioMcpConduitChannelBinding(binding);
  if (binding?.transport === STDIO_MCP_CONDUIT_TRANSPORT_LOCAL) {
    localBackingState(TRUSTED_LOCAL_BINDING_BACKINGS.get(binding));
    return Object.freeze({
      command: "/usr/bin/node",
      args: Object.freeze([STDIO_MCP_LOCAL_CONNECTOR_DESTINATION]),
      env: Object.freeze({})
    });
  }
  return createStdioMcpChannelRelayRegistration();
}

export function projectStdioMcpChannelLocalBacking(backing) {
  const state = localBackingState(backing);
  return Object.freeze({
    endpointSource: state.endpointSource,
    tokenSource: state.tokenSource
  });
}

export function projectStdioMcpChannelNamespaceArgs(binding) {
  assertStdioMcpConduitChannelBinding(binding);
  if (binding?.transport === STDIO_MCP_CONDUIT_TRANSPORT_LOCAL) {
    const backing = projectStdioMcpChannelLocalBacking(
      TRUSTED_LOCAL_BINDING_BACKINGS.get(binding));
    return Object.freeze([
      "--dir", path.dirname(STDIO_MCP_LOCAL_ENDPOINT_PATH),
      "--ro-bind", STDIO_MCP_LOCAL_CONNECTOR_SOURCE,
      STDIO_MCP_LOCAL_CONNECTOR_DESTINATION,
      "--ro-bind", backing.endpointSource, STDIO_MCP_LOCAL_ENDPOINT_PATH,
      "--ro-bind", backing.tokenSource, STDIO_MCP_LOCAL_TOKEN_PATH
    ]);
  }
  return Object.freeze([
    "--dir", STDIO_MCP_CONDUIT_NAMESPACE_PARENT,
    "--dir", STDIO_MCP_CONDUIT_ROOT,
    "--ro-bind-fd", String(STDIO_MCP_CONDUIT_INPUT_FD), binding.bindTargets[0],
    "--ro-bind-fd", String(STDIO_MCP_CONDUIT_OUTPUT_FD), binding.bindTargets[1]
  ]);
}

const SUPPORTED_STDIO_SHORTHANDS = Object.freeze(new Set(["ignore", "inherit", "pipe", "overlapped"]));
const SUPPORTED_STDIO_SLOT_STRINGS = Object.freeze(
  new Set(["ignore", "inherit", "pipe", "overlapped", "ipc"])
);

export function resolveConduitChildStdio(binding, requested) {

  const transport = binding?.transport ?? STDIO_MCP_CONDUIT_TRANSPORT_FIFO;
  if (transport !== STDIO_MCP_CONDUIT_TRANSPORT_FIFO &&
      transport !== STDIO_MCP_CONDUIT_TRANSPORT_LOCAL) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
      "stdio MCP conduit launch received an unsupported transport shape",
      { transport });
  }
  const descriptorFds = bindingDescriptorFds(binding);
  if (transport === STDIO_MCP_CONDUIT_TRANSPORT_LOCAL &&
      (binding.endpointPath !== STDIO_MCP_LOCAL_ENDPOINT_PATH ||
       binding.tokenPath !== STDIO_MCP_LOCAL_TOKEN_PATH ||
       !Array.isArray(binding.childFds) || binding.childFds.length !== 2 ||
       FIFO_ONLY_BINDING_FIELDS.some((name) => hasMeaningfulBindingField(binding, name)))) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
      "stdio MCP conduit launch received a mixed or incomplete local transport shape");
  }
  if (!Array.isArray(descriptorFds) || descriptorFds.length !== 2) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
      "stdio MCP conduit launch requires exactly two conduit descriptors");
  }
  let base;
  if (requested === undefined || requested === null) {
    base = ["inherit", "inherit", "inherit"];
  } else if (typeof requested === "string") {
    if (!SUPPORTED_STDIO_SHORTHANDS.has(requested)) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
        "stdio MCP conduit launch received an unsupported stdio shorthand",
        { requested, supported: [...SUPPORTED_STDIO_SHORTHANDS].sort() });
    }
    base = [requested, requested, requested];
  } else if (Array.isArray(requested)) {
    if (requested.length < 3) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
        "stdio MCP conduit launch requires stdin, stdout, and stderr slots",
        { length: requested.length });
    }
    if (requested.length > 5) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
        "stdio MCP conduit launch cannot extend a child stdio array beyond slot 4",
        { length: requested.length });
    }
    for (let index = 3; index < requested.length; index += 1) {

      if (requested[index] !== "ignore" && requested[index] !== undefined &&
          requested[index] !== null) {
        fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
          "stdio MCP conduit reserves child descriptors 3 and 4",
          { slot: index, requested: String(requested[index]) });
      }
    }
    for (let index = 0; index < 3; index += 1) {
      const slot = requested[index];
      const acceptable = Number.isInteger(slot) ||
        (typeof slot === "string" && SUPPORTED_STDIO_SLOT_STRINGS.has(slot)) ||
        (slot !== null && typeof slot === "object");
      if (!acceptable) {
        fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
          "stdio MCP conduit launch received an unsupported stdio slot",
          { slot: index, requested: slot === null ? "null" : String(slot) });
      }
    }
    base = [...requested];
  } else {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
      "stdio MCP conduit launch received an unsupported stdio option",
      { type: typeof requested });
  }
  while (base.length <= STDIO_MCP_CONDUIT_OUTPUT_FD) base.push("ignore");

  if (transport === STDIO_MCP_CONDUIT_TRANSPORT_LOCAL) return base.slice(0, 3);
  base[STDIO_MCP_CONDUIT_INPUT_FD] = descriptorFds[0];
  base[STDIO_MCP_CONDUIT_OUTPUT_FD] = descriptorFds[1];
  return base;
}
