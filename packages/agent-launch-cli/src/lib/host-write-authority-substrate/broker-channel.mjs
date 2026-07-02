

import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  isNonEmptyString
} from "./protocol-constants.mjs";
import {
  normalizeEndpointShape
} from "./endpoint.mjs";
import {
  createHostWriteAuthoritySubstrateAdapter
} from "./adapter.mjs";

export function createHostWriteAuthorityBrokerChannel(options = {}) {
  const {
    socketPath = null,
    endpoint = null,
    connectTimeoutMs = 5000,
    readTimeoutMs = 60000
  } = options;

  const hasEndpoint = endpoint !== null && endpoint !== undefined;
  const hasSocketPath = !hasEndpoint && isNonEmptyString(socketPath);
  if (hasEndpoint && isNonEmptyString(socketPath)) {
    throw new Error(
      "createHostWriteAuthorityBrokerChannel: exactly one of { socketPath, endpoint } may be provided"
    );
  }
  let resolvedEndpoint = null;
  if (hasEndpoint) {
    resolvedEndpoint = normalizeEndpointShape(endpoint, { requireLoopback: true });
    if (resolvedEndpoint === null) {
      throw new Error(
        `createHostWriteAuthorityBrokerChannel: endpoint must be { host: "127.0.0.1", port: <integer in [1, 65535]> }: ${JSON.stringify(endpoint)}`
      );
    }
  } else {
    if (!isNonEmptyString(socketPath)) {
      throw new Error(
        "createHostWriteAuthorityBrokerChannel: socketPath is required"
      );
    }
    if (!path.isAbsolute(socketPath)) {
      throw new Error(
        `createHostWriteAuthorityBrokerChannel: socketPath must be absolute: ${socketPath}`
      );
    }
  }

  function connect() {
    if (hasSocketPath) {
      return net.createConnection(socketPath);
    }
    return net.createConnection({ host: resolvedEndpoint.host, port: resolvedEndpoint.port });
  }

  return async function hostWriteAuthorityBrokerChannel(envelope) {
    return await new Promise((resolve, reject) => {
      const socket = connect();
      let buffer = Buffer.alloc(0);
      let settled = false;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch {   }
        reject(new Error(`host write authority broker connect timed out after ${connectTimeoutMs}ms`));
      }, connectTimeoutMs);
      connectTimer.unref?.();

      let readTimer = null;

      socket.once("connect", () => {
        clearTimeout(connectTimer);
        readTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { socket.destroy(); } catch {   }
          reject(new Error(`host write authority broker read timed out after ${readTimeoutMs}ms`));
        }, readTimeoutMs);
        readTimer.unref?.();
        try {
          socket.write(JSON.stringify(envelope) + "\n");
        } catch (err) {
          if (settled) return;
          settled = true;
          clearTimeout(readTimer);
          try { socket.destroy(); } catch {   }
          reject(err);
        }
      });
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const newlineIdx = buffer.indexOf(0x0a);
        if (newlineIdx === -1) return;
        const line = buffer.subarray(0, newlineIdx).toString("utf8");
        if (settled) return;
        settled = true;
        if (readTimer) clearTimeout(readTimer);
        try { socket.end(); } catch {   }
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          reject(new Error(`host write authority broker returned non-JSON: ${err?.message ?? String(err)}`));
          return;
        }
        resolve(parsed);
      });
      socket.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        if (readTimer) clearTimeout(readTimer);
        reject(err);
      });
      socket.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        if (readTimer) clearTimeout(readTimer);
        reject(new Error("host write authority broker connection closed before response"));
      });
    });
  };
}

export function createHostWriteAuthoritySubstrateAdapterIfBrokerReachable({
  socketPath = null,
  endpoint = null,
  requireEndpoint = false,
  existsSync: existsSyncImpl = existsSync,
  createBrokerChannel = createHostWriteAuthorityBrokerChannel,
  createAdapter = createHostWriteAuthoritySubstrateAdapter
} = {}) {

  if (endpoint !== null && endpoint !== undefined) {
    const normalized = normalizeEndpointShape(endpoint, { requireLoopback: true });
    if (normalized === null) return null;
    const channel = createBrokerChannel({ endpoint: normalized });
    return createAdapter({ channel });
  }
  if (requireEndpoint) return null;
  if (!isNonEmptyString(socketPath)) return null;
  if (!path.isAbsolute(socketPath)) return null;
  if (typeof existsSyncImpl !== "function") return null;
  if (!existsSyncImpl(socketPath)) return null;
  const channel = createBrokerChannel({ socketPath });
  return createAdapter({ channel });
}
