

import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  isNonEmptyString
} from "./protocol-constants.mjs";
import {
  HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES,
  brokerFailServer,
  formatEndpoint,
  normalizeEndpointShape
} from "./endpoint.mjs";
import {
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES,
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS,
  brokerBuildRefusalResponse
} from "./broker.mjs";

const BROKER_MAX_REQUEST_BYTES = 1024 * 1024;

export function createHostWriteAuthorityBrokerServer(options = {}) {
  const {
    broker,
    socketPath = null,
    endpoint = null,
    logger = null,
    maxRequestBytes = BROKER_MAX_REQUEST_BYTES,
    removeStaleSocket = true
  } = options;

  if (!broker || typeof broker.handleRequest !== "function") {
    throw new Error(
      "createHostWriteAuthorityBrokerServer: broker (with handleRequest) is required"
    );
  }

  const hasEndpoint = endpoint !== null && endpoint !== undefined;
  const hasSocketPath = !hasEndpoint && isNonEmptyString(socketPath);
  if (hasEndpoint && isNonEmptyString(socketPath)) {
    brokerFailServer(
      HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.TRANSPORT_AMBIGUOUS,
      "exactly one of { socketPath, endpoint } must be provided"
    );
  }
  if (!hasEndpoint) {
    if (!isNonEmptyString(socketPath)) {
      brokerFailServer(
        HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.SOCKET_PATH_REQUIRED,
        "socketPath is required"
      );
    }
  }

  let resolvedEndpoint = null;
  if (hasEndpoint) {
    const normalized = normalizeEndpointShape(endpoint, {
      allowPortZero: true,
      requireLoopback: true
    });
    if (normalized === null) {
      brokerFailServer(
        HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.ENDPOINT_INVALID,
        `endpoint must be { host: "127.0.0.1", port: 0 }: ${JSON.stringify(endpoint)}`
      );
    }

    if (normalized.port !== 0) {
      brokerFailServer(
        HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.ENDPOINT_INVALID,
        `endpoint port must be 0 (kernel-assigned); static loopback ports are forbidden: ${JSON.stringify(endpoint)}`
      );
    }
    resolvedEndpoint = { host: normalized.host, port: normalized.port };
  } else {
    if (!path.isAbsolute(socketPath)) {
      brokerFailServer(
        HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.SOCKET_PATH_NOT_ABSOLUTE,
        `socketPath must be absolute: ${socketPath}`
      );
    }
  }

  let server = null;
  let listening = false;

  function logEvent(level, message, detail) {
    if (!logger || typeof logger[level] !== "function") return;
    try {
      logger[level](`[host-write-authority-broker] ${message}`, detail ?? null);
    } catch {

    }
  }

  function handleConnection(socket) {
    let buffer = Buffer.alloc(0);
    let closed = false;

    socket.on("data", (chunk) => {
      if (closed) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maxRequestBytes) {
        const refusal = brokerBuildRefusalResponse({
          code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
          reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
          detail: { issue: "request_too_large", max_bytes: maxRequestBytes }
        });
        try {
          socket.write(JSON.stringify(refusal) + "\n");
        } catch {

        }
        closed = true;
        try { socket.destroy(); } catch {   }
        return;
      }
      processBuffered();
    });
    socket.on("error", (err) => {
      logEvent("warn", "connection error", { message: err?.message ?? null });
      closed = true;
    });
    socket.on("close", () => {
      closed = true;
    });

    async function processBuffered() {
      while (!closed) {
        const newlineIdx = buffer.indexOf(0x0a);
        if (newlineIdx === -1) return;
        const line = buffer.subarray(0, newlineIdx).toString("utf8");
        buffer = buffer.subarray(newlineIdx + 1);
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          const refusal = brokerBuildRefusalResponse({
            code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.REQUEST_INVALID,
            reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.REQUEST_MALFORMED,
            detail: {
              issue: "request_not_json",
              message: err?.message ?? null
            }
          });
          try { socket.write(JSON.stringify(refusal) + "\n"); } catch {   }
          continue;
        }
        let response;
        try {
          response = await broker.handleRequest(parsed);
        } catch (err) {
          response = brokerBuildRefusalResponse({
            code: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_CODES.PLAN_THREW,
            reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_THREW,
            detail: { message: err?.message ?? String(err) }
          });
        }
        try {
          socket.write(JSON.stringify(response) + "\n");
        } catch {

        }
      }
    }
  }

  async function start() {
    if (server !== null) {
      brokerFailServer(
        HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.SERVER_ALREADY_STARTED,
        "broker server is already started"
      );
    }
    if (hasSocketPath) {
      const parentDir = path.dirname(socketPath);
      try {
        mkdirSync(parentDir, { recursive: true, mode: 0o700 });
      } catch (err) {
        brokerFailServer(
          HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.SOCKET_PARENT_UNUSABLE,
          `socket parent directory is not usable: ${parentDir}`,
          { errno: err?.code ?? null, message: err?.message ?? null },
          err
        );
      }
      if (removeStaleSocket && existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch (err) {
          brokerFailServer(
            HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.SOCKET_STALE_REMOVE_FAILED,
            `stale socket could not be removed: ${socketPath}`,
            { errno: err?.code ?? null, message: err?.message ?? null },
            err
          );
        }
      }
    }

    const candidate = net.createServer(handleConnection);
    candidate.on("error", (err) => {
      logEvent("error", "server error", { message: err?.message ?? null });
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        candidate.removeListener("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        candidate.removeListener("error", onError);
        resolve();
      };
      candidate.once("error", onError);
      candidate.once("listening", onListening);
      try {
        if (hasSocketPath) {
          candidate.listen(socketPath);
        } else {
          candidate.listen(resolvedEndpoint.port, resolvedEndpoint.host);
        }
      } catch (err) {
        candidate.removeListener("error", onError);
        candidate.removeListener("listening", onListening);
        reject(err);
      }
    }).catch((err) => {
      try { candidate.close(); } catch {   }
      const target = hasSocketPath ? socketPath : formatEndpoint(resolvedEndpoint);
      brokerFailServer(
        HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.SOCKET_LISTEN_FAILED,
        `failed to bind ${hasSocketPath ? "socket" : "endpoint"}: ${target}`,
        { errno: err?.code ?? null, message: err?.message ?? null },
        err
      );
    });

    if (hasEndpoint) {
      const addr = candidate.address();
      if (!addr || typeof addr !== "object" || typeof addr.port !== "number" || addr.port <= 0) {
        try { candidate.close(); } catch {   }
        brokerFailServer(
          HOST_WRITE_AUTHORITY_BROKER_ERROR_CODES.SOCKET_LISTEN_FAILED,
          `failed to resolve bound endpoint after listen on ${formatEndpoint(resolvedEndpoint)}`
        );
      }
      resolvedEndpoint = { host: resolvedEndpoint.host, port: addr.port };
    }

    server = candidate;
    listening = true;
    if (hasSocketPath) {
      logEvent("info", "listening", { socket_path: socketPath });
      return { socketPath };
    }
    logEvent("info", "listening", { endpoint: formatEndpoint(resolvedEndpoint) });
    return { endpoint: { ...resolvedEndpoint } };
  }

  async function stop() {
    if (server === null) return;
    listening = false;
    const closing = server;
    server = null;
    await new Promise((resolve) => {
      try {
        closing.close(() => resolve());
      } catch {
        resolve();
      }
    });
    if (hasSocketPath) {
      if (existsSync(socketPath)) {
        try { unlinkSync(socketPath); } catch {   }
      }
      logEvent("info", "stopped", { socket_path: socketPath });
    } else {
      logEvent("info", "stopped", {
        endpoint: resolvedEndpoint ? formatEndpoint(resolvedEndpoint) : null
      });
    }
  }

  return {
    start,
    stop,
    get listening() { return listening; },
    get socketPath() { return hasSocketPath ? socketPath : null; },
    get endpoint() { return hasEndpoint && resolvedEndpoint ? { ...resolvedEndpoint } : null; }
  };
}
