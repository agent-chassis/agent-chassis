import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";

import {
  errorContent,
  getResponseSpillConfig,
  guardToolHandler,
  installProcessErrorGuards,
  jsonContent,
  readSpilledMcpContentReference,
  redactAbsolutePaths
} from "./mcp-response.mjs";

test("exports the shared response helpers", () => {
  assert.equal(typeof getResponseSpillConfig, "function");
  assert.equal(typeof readSpilledMcpContentReference, "function");
  assert.equal(typeof jsonContent, "function");
  assert.equal(typeof guardToolHandler, "function");
  assert.equal(typeof installProcessErrorGuards, "function");
  assert.equal(typeof errorContent, "function");
  assert.equal(typeof redactAbsolutePaths, "function");
});

test("redacts a POSIX absolute path with spaces and preserves following prose", () => {
  const message = "open /home/user/Portfolio Wiki Tools/wiki/work-records/WK-1160.json, denied";
  assert.equal(redactAbsolutePaths(message), "open [redacted absolute path], denied");
});

test("preserves every common trailing delimiter before following prose (POSIX, with spaces)", () => {
  const base = "/home/user/Portfolio Wiki Tools/wiki/work-records/WK-1160.json";
  for (const delimiter of [".", ")", "]", ";", "!", "?", ",", ":"]) {
    const input = `open ${base}${delimiter} denied`;
    assert.equal(
      redactAbsolutePaths(input),
      `open [redacted absolute path]${delimiter} denied`,
      `delimiter ${JSON.stringify(delimiter)} should be preserved`
    );
  }
});

test("redacts Windows drive-letter paths with backslashes or forward slashes and keeps delimiters", () => {
  const backslash = "open C:\\Users\\Alice\\Portfolio Wiki Tools\\WK-1160.json! Then continue.";
  const forwardSlash = "open C:/Users/Alice/Portfolio Wiki Tools/WK-1160.json? Then continue.";
  assert.equal(redactAbsolutePaths(backslash), "open [redacted absolute path]! Then continue.");
  assert.equal(redactAbsolutePaths(forwardSlash), "open [redacted absolute path]? Then continue.");

  for (const delimiter of [".", ")", "]", ";", "!", "?", ",", ":"]) {
    const input = `open C:\\Users\\Alice\\WK-1160.json${delimiter} denied`;
    assert.equal(redactAbsolutePaths(input), `open [redacted absolute path]${delimiter} denied`);
  }
});

test("does not redact URL schemes", () => {
  const message = "See file:///Users/alice/wiki/work-records/WK-1160.json and https://example.com/a/b.";
  assert.equal(redactAbsolutePaths(message), message);
});

test("leaves text with no absolute paths unchanged", () => {
  assert.equal(redactAbsolutePaths("nothing to redact here"), "nothing to redact here");
  assert.equal(redactAbsolutePaths(""), "");
  assert.equal(redactAbsolutePaths(undefined), undefined);
});

test("errorContent redacts an absolute path embedded in an Error message", () => {
  const result = errorContent(
    new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json: not found.")
  );
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Cannot open [redacted absolute path]: not found.");
  assert.equal(result.structuredContent, undefined);
});

test("errorContent redacts a non-Error thrown value via String()", () => {
  const result = errorContent("denied at /var/lib/wiki/work-records/WK-1160.json, retry later");
  assert.equal(result.content[0].text, "denied at [redacted absolute path], retry later");
});

test("errorContent keeps a structured error.envelope only in structuredContent", () => {
  const envelope = {
    code: "PATH_LEAK",
    category: "validation",
    severity: "medium",
    message: "Missing file /home/user/agent-chassis/wiki/work-records/WK-1160.json: not found.",
    structured: { detail: "kept verbatim" }
  };
  const result = errorContent({ envelope });

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, envelope);
  assert.match(result.content[0].text, /error envelope is available in structuredContent/u);
  assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 512);
  assert.ok(!result.content[0].text.includes(envelope.message));
});

test("jsonContent returns an inline envelope for small payloads", () => {
  const data = { ok: true, items: [1, 2, 3] };
  const result = jsonContent(data);
  assert.deepEqual(result.structuredContent, data);
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /available in structuredContent/u);
  assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 512);
  assert.ok(!result.content[0].text.includes(JSON.stringify(data)));
});

test("getResponseSpillConfig honors environment overrides", () => {
  const config = getResponseSpillConfig({
    WIKI_MCP_RESPONSE_STATE_DIR: "/tmp/example-state",
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192"
  });
  assert.equal(config.inlineByteLimit, 8192);
  assert.equal(config.stateDir, path.resolve("/tmp/example-state"));
  assert.ok(config.previewByteLimit > 0);
  assert.ok(config.maxReferenceReadBytes > 0);
});

test("jsonContent spills oversized payloads to a file-backed reference and round-trips", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-response-spill-"));
  const previous = {
    WIKI_MCP_RESPONSE_STATE_DIR: process.env.WIKI_MCP_RESPONSE_STATE_DIR,
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT
  };
  process.env.WIKI_MCP_RESPONSE_STATE_DIR = tempDir;
  process.env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT = "8192";
  try {
    const payload = { items: Array.from({ length: 4000 }, (_, index) => `item-${index}`) };
    const response = jsonContent(payload);

    assert.equal(response.structuredContent.response_spilled, true);
    const ref = response.structuredContent.content_reference;
    assert.ok(ref && typeof ref.ref_id === "string");

    const read = readSpilledMcpContentReference({ ref_id: ref.ref_id, offset: 0, length: 512 });
    assert.equal(read.schema_version, "wiki-mcp-content-reference-read.v1");
    assert.equal(read.ref_id, ref.ref_id);
    assert.equal(read.offset, 0);
    assert.ok(read.data_base64.length > 0);
    assert.ok(read.total_bytes > 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("guardToolHandler passes a structured result through and wraps throws with redaction", async () => {
  const logs = [];
  const guarded = guardToolHandler(
    async (input) => {
      if (input === "boom") {
        throw new Error("Cannot open /home/user/wiki/work-records/WK-1160.json.");
      }
      return { content: [{ type: "text", text: "already structured" }], structuredContent: { ok: true } };
    },
    { name: "demo-tool", log: (entry) => logs.push(entry) }
  );

  const success = await guarded("ok");
  assert.deepEqual(success.structuredContent, { ok: true });
  assert.equal(success.content[0].text, "already structured");

  const failure = await guarded("boom");
  assert.equal(failure.isError, true);
  assert.equal(failure.content[0].text, "Cannot open [redacted absolute path].");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].tool, "demo-tool");
  assert.equal(logs[0].level, "error");
});

test("installProcessErrorGuards reports process-level errors through the structured logger", () => {
  const processLike = new EventEmitter();
  const logs = [];
  const result = installProcessErrorGuards({ processLike, log: (entry) => logs.push(entry) });
  assert.equal(result.installed, true);

  processLike.emit("unhandledRejection", new Error("boom"));
  processLike.emit("uncaughtException", new Error("kapow"), "uncaughtException");

  assert.equal(logs.length, 2);
  assert.equal(logs[0].event, "unhandledRejection");
  assert.equal(logs[1].event, "uncaughtException");

  const again = installProcessErrorGuards({ processLike, log: () => {} });
  assert.equal(again.installed, false);
});
