

export const FIXED_PROBE_MCP_CLIENT_SOURCE = String.raw`
function connectFixedProbeMcp({ clientName, requestTimeoutMs = 15000,
  acknowledgementTimeoutMs = 15000, onSocketError = null }) {
  const { createConnection } = require("node:net");
  const { readFileSync } = require("node:fs");
  const socket = createConnection({ path: "/run/agent-launch/mcp.sock" });
  const pending = new Map();
  let buffer = "";
  let nextId = 1;
  let failure = null;
  function fail(error) {
    if (failure !== null) return;
    failure = error;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
    socket.off("data", receive);
    socket.destroy();
  }
  socket.on("error", fail);
  if (onSocketError !== null) socket.once("error", onSocketError);
  function request(method, params, { timeoutMs = requestTimeoutMs } = {}) {
    if (failure !== null) return Promise.reject(failure);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fail(new Error("MCP probe timeout: " + method));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  function receive(chunk) {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { fail(new Error("MCP probe response is not JSON")); return; }
      if (message === null || typeof message !== "object" || Array.isArray(message)) {
        fail(new Error("MCP probe response is not an object"));
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message || "MCP error"));
      else waiter.resolve(message.result);
    }
  }
  return (async () => {
    await new Promise((resolve, reject) => {
      const connected = () => { socket.off("error", rejected); resolve(); };
      const rejected = error => { socket.off("connect", connected); reject(error); };
      socket.once("connect", connected);
      socket.once("error", rejected);
    });
    socket.setEncoding("utf8");
    const token = readFileSync("/run/agent-launch/mcp.token");
    socket.write(Buffer.concat([Buffer.from("agent-chassis-v1 ", "ascii"), token]));
    await new Promise((resolve, reject) => {
      let acknowledgement = "";
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("data", onAcknowledgement);
        socket.off("end", onEnd);
        socket.off("close", onClose);
        socket.off("error", rejected);
      };
      const rejected = error => { cleanup(); fail(error); reject(error); };
      const onEnd = () => rejected(new Error("MCP connection ended before acknowledgement"));
      const onClose = () => rejected(new Error("MCP connection closed before acknowledgement"));
      const timeout = setTimeout(() => rejected(new Error("MCP acknowledgement timeout")), acknowledgementTimeoutMs);
      const onAcknowledgement = chunk => {
        acknowledgement += chunk;
        const end = acknowledgement.indexOf("\n");
        if (end < 0) return;
        cleanup();
        if (acknowledgement.slice(0, end + 1) !== "agent-chassis-v1 OK\n") {
          rejected(new Error("MCP acknowledgement invalid"));
          return;
        }
        socket.on("data", receive);
        socket.once("end", () => fail(new Error("MCP connection ended before response")));
        socket.once("close", () => fail(new Error("MCP connection closed before response")));
        const remainder = acknowledgement.slice(end + 1);
        if (remainder) receive(remainder);
        resolve();
      };
      socket.on("data", onAcknowledgement);
      socket.once("end", onEnd);
      socket.once("close", onClose);
      socket.once("error", rejected);
    });
    const initialized = await request("initialize", { protocolVersion: "2024-11-05",
      capabilities: {}, clientInfo: { name: clientName, version: "1.0.0" } });
    socket.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized",
      params: {} }) + "\n");
    const listed = await request("tools/list", {});
    return {
      socket,
      request,
      initialized,
      tools: Array.isArray(listed?.tools) ? listed.tools : null,
      callTool: (name, args, options) => request("tools/call", { name, arguments: args }, options)
    };
  })();
}

// WK-2570: a managed worker's startup text carries no assignment body; the
// probe retrieves it exactly as a worker does -- workspace_read_wiki
// {reads:[{assignment:true}]}, then its returned complete guidance selection -- and consumes the
// startup text followed by the retrieved guidance.
async function readFixedProbeAssignment(mcp) {
  const page = result => {
    if (!result || result.isError === true) {
      const body = result && (result.structuredContent || result.content) || null;
      const error = new Error("assignment_read_refused:" + JSON.stringify(body));
      error.stage = "assignment_read";
      throw error;
    }
    const body = result.structuredContent || JSON.parse(result.content[0].text);
    const selected = body.results?.[0];
    if (body.results?.length !== 1 || selected?.status !== "ok") {
      const error = new Error("assignment_selection_refused:" + JSON.stringify(body));
      error.stage = "assignment_read";
      throw error;
    }
    return { ...selected.value, next_calls: selected.next_calls || [] };
  };
  const first = page(await mcp.callTool("workspace_read_wiki", { reads: [{ assignment: true }] }));
  const next = first.next_calls?.find(call => call.arguments?.reads?.[0]?.select?.field === "guidance");
  if (!next || typeof next.tool !== "string" || typeof first.reference?.ref_id !== "string" ||
      next.arguments.reads.length !== 1 || JSON.stringify(next.arguments.reads[0].reference) !== JSON.stringify(first.reference)) {
    throw new Error("assignment_read_missing_guidance_selection:" + JSON.stringify(first));
  }
  const selected = page(await mcp.callTool(next.tool, next.arguments));
  if (selected.field !== "guidance" ||
      typeof selected.value !== "string") {
    throw new Error("assignment_read_invalid_guidance_selection:" + JSON.stringify(selected));
  }
  return { guidance: selected.value, reads: 2, reference: first.reference };
}

function fixedProbeDeliveredText(prompt, assignment) {
  return prompt + "\n\n" + assignment.guidance;
}
`;

export const SCOPE_CANARY_FIRST_PATH =
  "scope-only/canary-0000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt";
export const SCOPE_CANARY_LAST_PATH =
  "scope-only/canary-1023-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt";

export const FIXED_PROBE_PHYSICAL_ACCESS_SOURCE = String.raw`
function sourceRead(relative) {
  try { return { readable: true, text: require("node:fs").readFileSync(relative, "utf8") }; }
  catch (error) { return { readable: false, code: error && error.code || null, message: error && error.message || String(error) }; }
}
function writeProbe(relative, bytes) {
  const { readFileSync, writeFileSync } = require("node:fs");
  try {
    writeFileSync(relative, bytes, "utf8");
    return { writable: true, text: readFileSync(relative, "utf8") };
  } catch (error) {
    return { writable: false, code: error && error.code || null, message: error && error.message || String(error) };
  }
}
function fileKind(relative) {
  try {
    const stats = require("node:fs").statSync(relative);
    return { exists: true, file: stats.isFile(), directory: stats.isDirectory() };
  } catch (error) {
    return { exists: false, code: error && error.code || null, message: error && error.message || String(error) };
  }
}
function probeAssignedPhysicalAccess() {
  return {
    source: sourceRead("src/witness-source.mjs"),
    undeclared_sentinel: sourceRead("undeclared/sentinel.txt"),
    filesystem: {
      writable_existing_before: sourceRead("writable/existing.txt"),
      writable_existing_write: writeProbe("writable/existing.txt", "worker-existing-write\n"),
      missing_directory_before: fileKind("writable/new-dir"),
      missing_directory_write: writeProbe("writable/new-dir/created.txt", "worker-directory-write\n"),
      extensionless_before: fileKind("bin/witness-tool"),
      extensionless_write: writeProbe("bin/witness-tool", "worker-extensionless-write\n"),
      extensionless_after: fileKind("bin/witness-tool"),
      glob_existing_before: sourceRead("glob/existing-one.txt"),
      glob_existing_write: writeProbe("glob/existing-one.txt", "worker-glob-write\n"),
      glob_new_write: writeProbe("glob/new-matching.txt", "escaped-glob-write\n"),
      writable_sibling_write: writeProbe("writable/denied-sibling.txt", "escaped-writable-sibling\n"),
      bin_sibling_before: sourceRead("bin/keep.txt"),
      bin_sibling_write: writeProbe("bin/keep.txt", "escaped-bin-sibling\n"),
      undeclared_write: writeProbe("undeclared/escaped.txt", "escaped-undeclared-write\n")
    },
    scope_canaries: {
      first: sourceRead(` + JSON.stringify(SCOPE_CANARY_FIRST_PATH) + String.raw`),
      last: sourceRead(` + JSON.stringify(SCOPE_CANARY_LAST_PATH) + String.raw`)
    }
  };
}
`;

export const FIXED_PROBE_PROMPT_SECTION_SOURCE = String.raw`
function promptSectionAfter(prompt, heading, nextHeading) {
  const start = prompt.indexOf(heading);
  if (start < 0) return null;
  const bodyStart = start + heading.length;
  const end = nextHeading === null ? prompt.length : prompt.indexOf(nextHeading, bodyStart);
  return prompt.slice(bodyStart, end < 0 ? prompt.length : end);
}
`;

export const CONNECTED_PARENT_CONTROL_DIRECTIVE = "CONNECTED-PARENT-CONTROL";
export const CONNECTED_VERIFY_DIRECTIVE = "CONNECTED-VERIFY";
const CONNECTED_DIRECTIVES = Object.freeze({
  parent_control: CONNECTED_PARENT_CONTROL_DIRECTIVE,
  verify: CONNECTED_VERIFY_DIRECTIVE
});

export const CONNECTED_OPERATIVE_NOTES_HEADING = "\n### Operative Notes\n";
export const CONNECTED_OPERATIVE_WINDOW_END = "\n### Acceptance Criteria\n";

export function buildConnectedVerificationDirective(directive, subject) {
  if (!Object.values(CONNECTED_DIRECTIVES).includes(directive)) {
    throw new TypeError(`unknown connected verification directive ${directive}`);
  }
  if (typeof subject !== "string" || subject.length === 0) {
    throw new TypeError("a connected verification directive subject is a nonempty string");
  }
  return `${directive} ${JSON.stringify({ subject })}`;
}

export const FIXED_PROBE_CONNECTED_DIRECTIVES_SOURCE = String.raw`
function decodeConnectedDirectives(prompt) {
  const directives = ` + JSON.stringify(CONNECTED_DIRECTIVES) + String.raw`;
  const start = ` + JSON.stringify(CONNECTED_OPERATIVE_NOTES_HEADING) + String.raw`;
  const end = ` + JSON.stringify(CONNECTED_OPERATIVE_WINDOW_END) + String.raw`;
  const occurrences = needle => prompt.split(needle).length - 1;
  if (occurrences(start) !== 1 || occurrences(end) !== 1 ||
      prompt.indexOf(start) > prompt.indexOf(end)) {
    throw new Error("operative notes window boundaries are not complete and unique");
  }
  const window = promptSectionAfter(prompt, start, end);
  const lines = window.split("\n");
  const decoded = {};
  const delivered = [];
  for (const [name, prefix] of Object.entries(directives)) {
    const matching = lines.filter(line => line === prefix || line.startsWith(prefix + " "));
    if (matching.length !== 1) throw new Error(prefix + " directive count " + matching.length);
    const [line] = matching;
    let value;
    try { value = JSON.parse(line.slice(prefix.length + 1)); }
    catch { throw new Error(prefix + " directive is malformed"); }
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== 1 || typeof value.subject !== "string" || value.subject === "") {
      throw new Error(prefix + " directive must carry exactly one nonempty subject");
    }
    decoded[name] = { subject: value.subject };
    delivered.push(line);
  }
  return { notes: window.trim(), directive_lines: delivered, requests: decoded };
}
`;

export const CONNECTED_ROW_VERIFY_DIRECTIVE = "CONNECTED-ROW-VERIFY";
const ROW_KEY = /^[a-z][a-z0-9-]{0,63}$/u;

export function buildConnectedRowVerificationDirective(row, subject) {
  if (typeof row !== "string" || !ROW_KEY.test(row)) {
    throw new TypeError("a connected row verification directive names one lower-case row key");
  }
  if (typeof subject !== "string" || subject.length === 0) {
    throw new TypeError("a connected row verification directive subject is a nonempty string");
  }
  return `${CONNECTED_ROW_VERIFY_DIRECTIVE} ${JSON.stringify({ row, subject })}`;
}

export const FIXED_PROBE_CONNECTED_ROW_DIRECTIVES_SOURCE = String.raw`
function decodeConnectedRowDirectives(prompt, rowKeys) {
  const prefix = ` + JSON.stringify(CONNECTED_ROW_VERIFY_DIRECTIVE) + String.raw`;
  const start = ` + JSON.stringify(CONNECTED_OPERATIVE_NOTES_HEADING) + String.raw`;
  const end = ` + JSON.stringify(CONNECTED_OPERATIVE_WINDOW_END) + String.raw`;
  const occurrences = needle => prompt.split(needle).length - 1;
  if (occurrences(start) !== 1 || occurrences(end) !== 1 ||
      prompt.indexOf(start) > prompt.indexOf(end)) {
    throw new Error("operative notes window boundaries are not complete and unique");
  }
  if (!Array.isArray(rowKeys) || rowKeys.length === 0 || new Set(rowKeys).size !== rowKeys.length) {
    throw new Error("the fixed plan's row keys are not a nonempty distinct list");
  }
  const window = promptSectionAfter(prompt, start, end);
  const lines = window.split("\n").filter(line => line === prefix || line.startsWith(prefix + " "));
  const subjects = {};
  for (const line of lines) {
    let value;
    try { value = JSON.parse(line.slice(prefix.length + 1)); }
    catch { throw new Error(prefix + " directive is malformed"); }
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== "row,subject" ||
        typeof value.row !== "string" || typeof value.subject !== "string" || value.subject === "") {
      throw new Error(prefix + " directive must carry exactly one row and one nonempty subject");
    }
    if (!rowKeys.includes(value.row)) throw new Error(prefix + " directive names unknown row " + value.row);
    if (Object.hasOwn(subjects, value.row)) throw new Error(prefix + " directive repeats row " + value.row);
    if (Object.values(subjects).includes(value.subject)) {
      throw new Error(prefix + " directive gives one subject to two rows: " + value.subject);
    }
    subjects[value.row] = value.subject;
  }
  const missing = rowKeys.filter(key => !Object.hasOwn(subjects, key));
  if (missing.length > 0) throw new Error(prefix + " directive missing for rows " + missing.join(","));
  return { notes: window.trim(), directive_lines: lines, subjects };
}
`;

const FIXED_PROBE_FAMILIES = Object.freeze(["codex", "claude"]);

function nativePlanShape(family, childArgs, label) {
  if (family === "codex") {
    const finalPathIndex = childArgs.indexOf("--output-last-message");
    const finalPath = finalPathIndex >= 0 ? childArgs[finalPathIndex + 1] : null;
    if (typeof finalPath !== "string") {
      throw new TypeError(`${label} requires the Codex final-message path`);
    }
    return Object.freeze({ family, result_transport: "final_message_file", finalPath });
  }
  if (childArgs.at(-2) !== "--" || childArgs.includes("--output-last-message")) {
    throw new TypeError(`${label} requires the Claude option terminator before its prompt`);
  }
  return Object.freeze({ family, result_transport: "stdout_capture", finalPath: null });
}

export function substituteFixedProbeCommand(plan, { family, label, programSource, programArgs }) {
  if (!FIXED_PROBE_FAMILIES.includes(family)) {
    throw new TypeError(`${label} requires an explicit codex or claude family`);
  }
  const childArgs = Array.isArray(plan?.childArgs) ? plan.childArgs : [];
  const prompt = childArgs.at(-1);
  if (typeof prompt !== "string" ||
      plan?.stdioMcpConduit === null || plan?.stdioMcpConduit === undefined) {
    throw new TypeError(`${label} requires prompt and MCP conduit`);
  }
  const shape = nativePlanShape(family, childArgs, label);

  const planArgs = Array.isArray(plan.bwrapArgs) ? plan.bwrapArgs : [];
  const separator = planArgs.length - childArgs.length - 2;
  if (separator < 0 || planArgs[separator] !== "--" ||
      childArgs.some((value, index) => planArgs[separator + 2 + index] !== value)) {
    throw new TypeError(`${label} requires a bwrap command separator before the native command`);
  }
  const { finalPath } = shape;
  const args = typeof programArgs === "function"
    ? programArgs({ prompt, finalPath, childArgs }) : programArgs;
  const bwrapArgs = [
    ...planArgs.slice(0, separator + 1),
    process.execPath,
    "-e",
    `${FIXED_PROBE_MCP_CLIENT_SOURCE}\n${programSource}`,
    ...args
  ];
  return Object.freeze({
    family,
    resultTransport: shape.result_transport,
    nativeCommand: planArgs[separator + 1],
    prompt,
    finalPath,
    childArgs,
    bwrapArgs,
    probePlan: Object.freeze({ ...plan, bwrapArgs: Object.freeze(bwrapArgs) })
  });
}
