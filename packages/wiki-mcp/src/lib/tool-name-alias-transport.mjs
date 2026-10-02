

export const WORKSPACE_TOOL_NAME_PREFIX = "workspace_";

export function resolveToolCallName(name, registeredToolNames) {
  if (typeof name !== "string" || name.length === 0 || registeredToolNames.has(name) ||
      name.startsWith(WORKSPACE_TOOL_NAME_PREFIX)) {
    return name;
  }
  const canonical = `${WORKSPACE_TOOL_NAME_PREFIX}${name}`;
  return registeredToolNames.has(canonical) ? canonical : name;
}

function resolveIncoming(message, registeredToolNames) {
  if (message === null || typeof message !== "object" || message.method !== "tools/call" ||
      message.id === undefined || message.id === null ||
      message.params === null || typeof message.params !== "object") {
    return message;
  }
  const resolved = resolveToolCallName(message.params.name, registeredToolNames);
  return resolved === message.params.name
    ? message
    : { ...message, params: { ...message.params, name: resolved } };
}

export class ToolNameAliasTransport {
  #inner;
  #registeredToolNames;

  constructor(inner, { registeredToolNames }) {
    if (!inner || typeof inner.start !== "function" || typeof inner.send !== "function" ||
        typeof inner.close !== "function") {
      throw new TypeError("the tool-name alias transport requires a Transport with start, send and close");
    }
    this.#inner = inner;
    this.#registeredToolNames = new Set(registeredToolNames);
  }

  get sessionId() {
    return this.#inner.sessionId;
  }

  async start() {
    this.#inner.onmessage = (message, extra) => {
      this.onmessage?.(resolveIncoming(message, this.#registeredToolNames), extra);
    };
    this.#inner.onclose = () => { this.onclose?.(); };
    this.#inner.onerror = (error) => { this.onerror?.(error); };
    return this.#inner.start();
  }

  async send(message, options) {
    return this.#inner.send(message, options);
  }

  async close() {
    return this.#inner.close();
  }
}

export function createToolNameAliasTransport(inner, { registeredToolNames }) {
  return new ToolNameAliasTransport(inner, { registeredToolNames });
}
