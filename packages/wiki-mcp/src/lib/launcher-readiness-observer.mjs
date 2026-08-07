

import {
  STDIO_MCP_CONDUIT_PRODUCER_DESCRIPTOR
} from "./stdio-mcp-conduit-producer-descriptor.mjs";

export const LAUNCHER_READINESS_PRODUCER_DESCRIPTOR =
  STDIO_MCP_CONDUIT_PRODUCER_DESCRIPTOR;

export const LAUNCHER_READINESS_PROTOCOL_GENERATION =
  LAUNCHER_READINESS_PRODUCER_DESCRIPTOR.protocol_generation;

export const LAUNCHER_READINESS_SCHEMA_VERSIONS = Object.freeze({
  SERVER_READY: "wiki-mcp-launcher-readiness.v2",
  CLIENT_INITIALIZED: "wiki-mcp-launcher-client-initialized.v1",
  TOOLS_LISTED: "wiki-mcp-launcher-tools-listed.v1",
  CLIENT_RESTARTED: "wiki-mcp-launcher-client-restarted.v1",
  CLIENT_CLOSED: "wiki-mcp-launcher-client-closed.v1"
});

export class LauncherReadinessObservationError extends Error {
  constructor(message, detail = null) {
    super(message);
    this.name = "LauncherReadinessObservationError";
    this.code = "wiki_mcp_launcher_readiness_observation_unavailable";
    this.detail = detail;
  }
}

export const LAUNCHER_READINESS_EVENT_WRITE_FAILED_CODE =
  "wiki_mcp_launcher_readiness_event_write_failed";

export class LauncherReadinessEventWriteError extends Error {
  constructor(message, { cause = null, event = null } = {}) {
    super(message, cause === null ? undefined : { cause });
    this.name = "LauncherReadinessEventWriteError";
    this.code = LAUNCHER_READINESS_EVENT_WRITE_FAILED_CODE;

    this.cause = cause;
    this.detail = Object.freeze({
      cause_code: cause?.code ?? null,
      cause_message: cause?.message ?? (cause === null ? null : String(cause)),
      schema_version: event?.schema_version ?? null
    });
  }
}

export function createLauncherReadinessEventWriter({
  write,
  onFailure = () => {},
  onCleanupTimeout = () => {},
  cleanupTimeoutMs = 5_000
}) {
  if (typeof write !== "function") {
    throw new LauncherReadinessObservationError(
      "a launcher readiness event writer requires a write function");
  }
  let failure = null;
  const beginBoundedCleanup = () => {
    let timer = setTimeout(() => { onCleanupTimeout(failure); }, cleanupTimeoutMs);
    if (typeof timer?.unref === "function") timer.unref();
    void (async () => {
      try {
        await onFailure(failure);
      } catch {   }
      if (timer !== null) { clearTimeout(timer); timer = null; }
    })();
  };
  return {
    emit(event) {
      if (failure !== null) return failure;
      try {
        write(event);
      } catch (cause) {
        failure = new LauncherReadinessEventWriteError(
          "the launcher readiness channel could not be written", { cause, event });
        beginBoundedCleanup();
      }
      return failure;
    },
    get failure() {
      return failure;
    }
  };
}

function isJsonRpcRequest(message) {
  return message !== null && typeof message === "object" &&
    typeof message.method === "string" && message.id !== undefined && message.id !== null;
}

function isJsonRpcNotification(message) {
  return message !== null && typeof message === "object" &&
    typeof message.method === "string" && (message.id === undefined || message.id === null);
}

function isJsonRpcResult(message) {
  return message !== null && typeof message === "object" &&
    message.id !== undefined && message.id !== null &&
    Object.prototype.hasOwnProperty.call(message, "result");
}

export class LauncherObservingTransport {
  #inner;
  #emit;
  #pendingToolsList = new Set();
  #pendingInitialize = new Set();
  #initializeRequested = false;
  #initializeAnswered = false;
  #initialized = false;
  #lifecycleFailed = false;
  #restartCount = 0;

  constructor(inner, { emit }) {
    if (!inner || typeof inner.start !== "function" || typeof inner.send !== "function" ||
        typeof inner.close !== "function") {
      throw new LauncherReadinessObservationError(
        "the MCP stdio transport does not implement the supported Transport contract",
        { start: typeof inner?.start, send: typeof inner?.send, close: typeof inner?.close }
      );
    }
    this.#inner = inner;
    this.#emit = typeof emit === "function" ? emit : () => {};
    inner.onmessage = (message, extra) => {
      this.#observeIncoming(message);
      this.onmessage?.(message, extra);
    };
    inner.onclose = () => {

      this.#emit({
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
        closed: true
      });
      this.onclose?.();
    };
    inner.onerror = (error) => { this.onerror?.(error); };
  }

  get sessionId() {
    return this.#inner.sessionId;
  }

  async start() {
    return this.#inner.start();
  }

  async send(message, options) {
    this.#observeOutgoing(message);
    return this.#inner.send(message, options);
  }

  async close() {
    return this.#inner.close();
  }

  #observeIncoming(message) {
    if (isJsonRpcRequest(message) && message.method === "initialize") {
      if (this.#initializeRequested) {

        this.#lifecycleFailed = true;
        this.#restartCount += 1;
        this.#emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_RESTARTED,
          restarted: true,
          restart_count: this.#restartCount
        });
        return;
      }
      this.#initializeRequested = true;
      this.#pendingInitialize.add(message.id);
      return;
    }
    if (isJsonRpcNotification(message) && message.method === "notifications/initialized") {

      if (this.#lifecycleFailed || !this.#initializeRequested || this.#initialized) return;
      this.#initialized = true;
      this.#emit({
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_INITIALIZED,
        initialized: true
      });
      return;
    }
    if (isJsonRpcRequest(message) && message.method === "tools/list") {
      if (this.#lifecycleFailed) return;
      this.#pendingToolsList.add(message.id);
    }
  }

  #observeOutgoing(message) {
    if (this.#lifecycleFailed) return;
    if (!isJsonRpcResult(message)) return;
    if (this.#pendingInitialize.delete(message.id)) {
      this.#initializeAnswered = true;
      return;
    }
    if (!this.#pendingToolsList.delete(message.id)) return;

    const tools = Array.isArray(message.result?.tools)
      ? message.result.tools
        .map((tool) => (typeof tool?.name === "string" ? tool.name : null))
        .filter((name) => name !== null)
      : [];
    this.#emit({
      schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.TOOLS_LISTED,
      tools_listed: true,
      tools
    });
  }

  assertObservationInstalled() {
    if (typeof this.onmessage !== "function") {
      throw new LauncherReadinessObservationError(
        "the MCP server did not install a message callback on the launcher readiness transport"
      );
    }
    return this;
  }
}

export function createLauncherObservingTransport(inner, { emit }) {
  return new LauncherObservingTransport(inner, { emit });
}
