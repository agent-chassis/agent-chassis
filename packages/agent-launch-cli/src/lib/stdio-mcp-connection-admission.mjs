import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname } from "node:path";

import {
  projectStdioMcpChannelLocalBacking
} from "./stdio-mcp-conduit-channel.mjs";
import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  failStdioMcpConduit
} from "./stdio-mcp-conduit-errors.mjs";
import { registerProcessLocalStdioMcpConduit } from "./stdio-mcp-conduit-process-registry.mjs";

export const STDIO_MCP_ADMISSION_TOKEN_BYTES = 32;
export const STDIO_MCP_ADMISSION_TOKEN_FILE_BYTES = 65;
export const STDIO_MCP_ADMISSION_PRELUDE_BYTES = 82;
export const STDIO_MCP_ADMISSION_ACKNOWLEDGEMENT_BYTES = 20;

export const STDIO_MCP_ADMISSION_AUTHENTICATION_DEADLINE_MS = 5_000;
export const STDIO_MCP_ADMISSION_MAX_PENDING = 16;
export const STDIO_MCP_ADMISSION_MAX_GENERATIONS = 8;
export const STDIO_MCP_ADMISSION_MAX_SESSIONS = 64;

export const STDIO_MCP_ADMISSION_REASONS = Object.freeze({
  CLOSED: "admission_closed",
  OVER_LIMIT: "admission_over_limit",
  AUTHENTICATION_TIMEOUT: "authentication_timeout",
  MALFORMED_PRELUDE: "malformed_prelude",
  AUTHENTICATION_FAILED: "authentication_failed",
  GENERATION_FAILED: "generation_failed"
});

const TOKEN_PREFIX = Buffer.from("agent-chassis-v1 ");
const ACKNOWLEDGEMENT = Buffer.from("agent-chassis-v1 OK\n");
const HEX = /^[0-9a-f]{64}$/;
const ADMISSION_CLOSED_DURING_READINESS = Object.freeze(
  new Error("stdio MCP admission closed while generation was becoming ready")
);
const CLAIMED_BACKING_PAIRS = new Map();

if (TOKEN_PREFIX.length !== 17 || ACKNOWLEDGEMENT.length !== 20) {
  throw new Error("stdio MCP admission protocol constants have invalid lengths");
}

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) return undefined;
    called = true;
    return fn(...args);
  };
}

function closeSocket(socket) {
  if (!socket || socket.destroyed) return;
  socket.destroy();
}

function safeUnlink(path) {
  try { unlinkSync(path); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function createStdioMcpAdmissionToken() {
  return randomBytes(STDIO_MCP_ADMISSION_TOKEN_BYTES);
}

export function encodeStdioMcpAdmissionTokenFile(token) {
  if (!Buffer.isBuffer(token) || token.length !== STDIO_MCP_ADMISSION_TOKEN_BYTES) {
    throw new TypeError("stdio MCP admission token must be 32 bytes");
  }
  return Buffer.from(`${token.toString("hex")}\n`);
}

export function encodeStdioMcpAdmissionPrelude(token) {
  if (!Buffer.isBuffer(token) || token.length !== STDIO_MCP_ADMISSION_TOKEN_BYTES) {
    throw new TypeError("stdio MCP admission token must be 32 bytes");
  }
  return Buffer.concat([TOKEN_PREFIX, Buffer.from(token.toString("hex")), Buffer.from("\n")]);
}

export function encodeStdioMcpAdmissionAcknowledgement() {
  return Buffer.from(ACKNOWLEDGEMENT);
}

function parsePrelude(prelude) {
  if (!Buffer.isBuffer(prelude) || prelude.length !== STDIO_MCP_ADMISSION_PRELUDE_BYTES ||
      !prelude.subarray(0, TOKEN_PREFIX.length).equals(TOKEN_PREFIX) ||
      prelude[prelude.length - 1] !== 0x0a) return null;
  const encoded = prelude.subarray(TOKEN_PREFIX.length, -1).toString("ascii");
  if (!HEX.test(encoded)) return null;
  return Buffer.from(encoded, "hex");
}

function compareToken(expected, received) {
  if (!Buffer.isBuffer(expected) || expected.length !== 32 ||
      !Buffer.isBuffer(received) || received.length !== 32) return false;
  return timingSafeEqual(expected, received);
}

function boundedReason(reason) {
  return Object.values(STDIO_MCP_ADMISSION_REASONS).includes(reason)
    ? reason : STDIO_MCP_ADMISSION_REASONS.GENERATION_FAILED;
}

function reject(socket, reason) {

  socket.__stdioMcpAdmissionReason = boundedReason(reason);
  closeSocket(socket);
}

function makeGenerationInput(generation) {
  return generation?.input ?? generation?.clientInput ?? generation?.stdin ?? null;
}

function makeGenerationOutput(generation) {
  return generation?.output ?? generation?.serverOutput ?? generation?.stdout ?? null;
}

function claimBackingPair(endpointSource, tokenSource) {
  let tokenSources = CLAIMED_BACKING_PAIRS.get(endpointSource);
  if (tokenSources?.has(tokenSource)) {
    failStdioMcpConduit(
      STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP local admission backing has already been admitted"
    );
  }
  if (!tokenSources) {
    tokenSources = new Set();
    CLAIMED_BACKING_PAIRS.set(endpointSource, tokenSources);
  }
  tokenSources.add(tokenSource);
}

function awaitReadiness(generation) {
  if (generation?.ready === true) return Promise.resolve();
  if (generation?.ready && typeof generation.ready.then === "function") return generation.ready;
  if (generation?.readiness && typeof generation.readiness.then === "function") return generation.readiness;
  if (typeof generation?.waitUntilReady === "function") return generation.waitUntilReady();
  return Promise.resolve();
}

function awaitReadinessBounded(generation, admissionClosed) {
  return Promise.race([
    Promise.resolve().then(() => awaitReadiness(generation)),
    admissionClosed.then(() => {
      throw ADMISSION_CLOSED_DURING_READINESS;
    })
  ]);
}

function forwardBufferedBytes(generation, bytes) {
  if (bytes.length === 0) return;
  const input = makeGenerationInput(generation);
  if (!input || typeof input.write !== "function") {
    throw new Error("ready MCP generation has no input stream");
  }
  input.write(bytes);
}

function createStdioMcpConnectionAdmissionInternal({
  createGeneration,
  backing,
  settleConnection = async () => {},
  onRejection = () => {}
} = {}, registerProcessLocal) {
  if (typeof createGeneration !== "function") throw new TypeError("generation factory is required");
  const { endpointSource: backingEndpointPath, tokenSource: backingTokenPath } =
    projectStdioMcpChannelLocalBacking(backing);
  claimBackingPair(backingEndpointPath, backingTokenPath);
  const server = net.createServer({ pauseOnConnect: true });
  const token = createStdioMcpAdmissionToken();
  const pending = new Set();
  const generations = new Set();
  const reservations = new Set();
  const established = new Set();
  const factories = new Set();
  const resources = new Set();
  const inFlight = new Set();
  let resolveAdmissionClosed;
  const admissionClosed = new Promise((resolve) => { resolveAdmissionClosed = resolve; });
  let sessions = 0;
  let nextSessionNumber = 0;
  let open = false;
  let closed = false;
  let tokenFilePublished = false;
  let deregister = () => {};
  let cleanupFailure = null;
  let settlement = null;

  const closeAdmission = once((cause = STDIO_MCP_ADMISSION_REASONS.CLOSED) => {
    closed = true;
    open = false;
    resolveAdmissionClosed(cause);
    for (const connection of [...pending]) connection.finish(cause);
    for (const connection of [...reservations]) connection.finish(cause);
    for (const connection of [...established]) connection.finish(cause);
    for (const generation of [...generations]) {
      try { generation.cancel?.(); } catch {   }
    }
    return cause;
  });

  const track = (promise) => {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise)).catch((error) => {
      cleanupFailure ??= error;
    });
    return promise;
  };

  const settle = (cause = null) => {
    if (settlement !== null) return settlement;
    settlement = (async () => {
      closeAdmission(cause ?? STDIO_MCP_ADMISSION_REASONS.CLOSED);
      if (server.listening) {
        try {
          await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } catch (error) {
          cleanupFailure ??= error;
        }
      }
      try {
        while (factories.size > 0 || inFlight.size > 0) {
          await Promise.allSettled([...factories, ...inFlight]);
        }
        while (established.size > 0) {
          await Promise.allSettled([...established].map((connection) => connection.finish(
            STDIO_MCP_ADMISSION_REASONS.CLOSED
          )));
        }
        for (const resource of [...resources]) {
          try { await resource(); } catch (error) { cleanupFailure ??= error; }
        }
        resources.clear();
        if (tokenFilePublished) {
          try { safeUnlink(backingTokenPath); } catch (error) { cleanupFailure ??= error; }
          tokenFilePublished = false;
        }
      } catch (error) {
        cleanupFailure ??= error;
      } finally {
        deregister();
      }
      return cleanupFailure;
    })();
    return settlement;
  };

  if (registerProcessLocal) {
    deregister = registerProcessLocalStdioMcpConduit(settle);
  }

  function failConnection(socket, reason, cause = reason) {
    onRejection(boundedReason(reason));
    reject(socket, reason);
    track(Promise.resolve().then(() => settleConnection(socket, cause)).catch((error) => {
      cleanupFailure ??= error;
    }));
  }

  function handleConnection(socket) {
    if (closed || !open || pending.size >= STDIO_MCP_ADMISSION_MAX_PENDING ||
        sessions >= STDIO_MCP_ADMISSION_MAX_SESSIONS) {
      failConnection(socket, closed ? STDIO_MCP_ADMISSION_REASONS.CLOSED : STDIO_MCP_ADMISSION_REASONS.OVER_LIMIT);
      return;
    }
    const state = { socket, bytes: Buffer.alloc(0), finished: false, timer: null, rejectionPublished: false,
      closeGeneration: null };
    let finishPromise = null;
    const finish = (reason = null) => {
      if (finishPromise !== null) return finishPromise;
      finishPromise = (async () => {
      state.finished = true;
      if (state.timer !== null) clearTimeout(state.timer);
      pending.delete(state);
      reservations.delete(state);
      if ([STDIO_MCP_ADMISSION_REASONS.AUTHENTICATION_TIMEOUT,
        STDIO_MCP_ADMISSION_REASONS.MALFORMED_PRELUDE,
        STDIO_MCP_ADMISSION_REASONS.AUTHENTICATION_FAILED].includes(reason) &&
          !state.rejectionPublished) {
        state.rejectionPublished = true;
        onRejection(boundedReason(reason));
      }
      closeSocket(socket);
      try { await state.closeGeneration?.(); } catch (error) { cleanupFailure ??= error; }
      try { await settleConnection(socket, reason); } catch (error) { cleanupFailure ??= error; }
      established.delete(state);
      })();
      track(finishPromise);
      return finishPromise;
    };
    state.finish = finish;
    pending.add(state);
    const acceptedAt = Date.now();
    state.timer = setTimeout(() => finish(STDIO_MCP_ADMISSION_REASONS.AUTHENTICATION_TIMEOUT),
      Math.max(1, STDIO_MCP_ADMISSION_AUTHENTICATION_DEADLINE_MS - (Date.now() - acceptedAt)));
    const onData = (chunk) => {
      if (state.finished) return;
      state.bytes = Buffer.concat([state.bytes, chunk]);
      if (state.bytes.length < STDIO_MCP_ADMISSION_PRELUDE_BYTES) return;
      socket.pause();
      const prelude = state.bytes.subarray(0, STDIO_MCP_ADMISSION_PRELUDE_BYTES);
      const received = parsePrelude(prelude);
      if (!received) {
        void finish(STDIO_MCP_ADMISSION_REASONS.MALFORMED_PRELUDE);
        return;
      }
      if (!compareToken(token, received)) {
        void finish(STDIO_MCP_ADMISSION_REASONS.AUTHENTICATION_FAILED);
        return;
      }
      if (generations.size + reservations.size >= STDIO_MCP_ADMISSION_MAX_GENERATIONS || sessions >= STDIO_MCP_ADMISSION_MAX_SESSIONS) {
        void finish(STDIO_MCP_ADMISSION_REASONS.OVER_LIMIT);
        return;
      }
      socket.removeListener("data", onData);
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
      pending.delete(state);
      reservations.add(state);
      sessions += 1;
      const initialBytes = state.bytes.subarray(STDIO_MCP_ADMISSION_PRELUDE_BYTES);
      state.bytes = Buffer.alloc(0);
      let closeGeneration = null;
      const factory = Promise.resolve().then(() => createGeneration(Object.freeze({
        initialBytes, sessionNumber: ++nextSessionNumber
      })))
        .then(async (generation) => {
          generations.add(generation);
          let closePromise = null;
          closeGeneration = () => {
            if (closePromise !== null) return closePromise;
            closePromise = Promise.resolve().then(() => generation.close?.())
              .finally(() => generations.delete(generation));
            return closePromise;
          };
          state.closeGeneration = closeGeneration;
          resources.add(closeGeneration);
          if (closed || state.finished) {
            reservations.delete(state);
            await closeGeneration();
            return;
          }
          await awaitReadinessBounded(generation, admissionClosed);
          if (closed || state.finished) {
            reservations.delete(state);
            await closeGeneration();
            return;
          }
          const input = makeGenerationInput(generation);
          const output = makeGenerationOutput(generation);
          if (!input || typeof input.write !== "function" || !output || typeof output.pipe !== "function") {
            throw new Error("ready MCP generation lacks bidirectional streams");
          }
          reservations.delete(state);
          established.add(state);
          if (!socket.destroyed) socket.write(encodeStdioMcpAdmissionAcknowledgement());
          forwardBufferedBytes(generation, initialBytes);
          socket.pipe(input, { end: false });
          output.pipe(socket, { end: false });
          socket.resume();
          socket.on("close", () => {
            void closeGeneration().catch((error) => { cleanupFailure ??= error; });
            void finish(null);
          });
        }).catch((error) => {
          reservations.delete(state);
          if (closeGeneration) {
            void closeGeneration().catch((closeError) => { cleanupFailure ??= closeError; });
          }
          const reason = closed || state.finished
            ? STDIO_MCP_ADMISSION_REASONS.CLOSED
            : STDIO_MCP_ADMISSION_REASONS.GENERATION_FAILED;
          if (reason === STDIO_MCP_ADMISSION_REASONS.GENERATION_FAILED) {
            onRejection(reason);
          }
          void finish(reason);
          if (error !== ADMISSION_CLOSED_DURING_READINESS) cleanupFailure ??= error;
        }).finally(() => {
          factories.delete(factory);
        });
      factories.add(factory);
    };
    socket.on("error", () => finish(STDIO_MCP_ADMISSION_REASONS.AUTHENTICATION_FAILED));
    socket.on("data", onData);
    socket.resume();
  }

  server.on("connection", handleConnection);

  return Object.freeze({
    server,
    token,
    tokenFile: encodeStdioMcpAdmissionTokenFile(token),
    open: () => {
      if (closed) return false;
      mkdirSync(dirname(backingEndpointPath), {
        recursive: true, mode: 0o700
      });
      safeUnlink(backingEndpointPath);
      writeFileSync(backingTokenPath, encodeStdioMcpAdmissionTokenFile(token), { mode: 0o600 });
      chmodSync(backingTokenPath, 0o600);
      tokenFilePublished = true;
      server.listen(backingEndpointPath, () => { open = true; });
      return true;
    },
    close: closeAdmission,
    settle,
    isOpen: () => open && !closed,
    get cleanupFailure() { return cleanupFailure; },
    counts: () => Object.freeze({ pending: pending.size, generations: generations.size, reservations: reservations.size, sessions })
  });
}

export function createStdioMcpConnectionAdmission(options) {
  return createStdioMcpConnectionAdmissionInternal(options, true);
}

export function createStdioMcpConnectionAdmissionForResourceScope(options) {
  return createStdioMcpConnectionAdmissionInternal(options, false);
}

export const createStdioMcpAdmission = createStdioMcpConnectionAdmission;
