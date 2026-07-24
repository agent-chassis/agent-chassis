import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

import { createChildFrameReader } from "./fixtures/mcp-stdio-frame-reader.mjs";
import { resolveLauncherRoleToolNamesForEnv } from
  "../packages/agent-launch-cli/src/lib/launcher-role-tool-profile.mjs";

const REPO_ROOT = process.cwd();
const INITIALIZE_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: {
    name: "agent-chassis-test",
    version: "1.0.0"
  }
};

function freeLocalServerEnv(profile) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
  }
  for (const key of [
    "NODE_ENGINE_API_KEY",
    "NODE_ENGINE_LICENSE_KEY",
    "WIKI_MCP_WORKSPACE_ALIAS",
    "WIKI_MCP_WORKSPACE_DIR",
    "WIKI_MCP_REPOS",
    "WIKI_MCP_DEFAULT_REPO"
  ]) {
    delete env[key];
  }
  env.WIKI_MCP_TOOL_PROFILE = profile;
  return env;
}

async function listServerTools(serverPath, profile) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: REPO_ROOT,
    env: freeLocalServerEnv(profile),
    stdio: ["pipe", "pipe", "pipe"]
  });
  const reader = createChildFrameReader(child, { label: `production stdio (${profile})` });

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS })}\n`);
    await reader.waitForResponse(1);

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const { message } = await reader.waitForResponse(2);

    if (message.error) {
      throw new Error(`production tools/list refused for ${profile}: ${JSON.stringify(message.error)}`);
    }
    return message.result.tools;
  } finally {
    child.stdin.end();
    if (!reader.exitInfo) child.kill("SIGKILL");
    await reader.waitForExit();
    reader.dispose();
  }
}

async function listServerToolNames(serverPath, profile) {
  return (await listServerTools(serverPath, profile)).map((tool) => tool.name).sort();
}

async function listFreeLocalServerToolNames(profile) {
  return listServerToolNames("packages/wiki-mcp/src/server.mjs", profile);
}

async function listFreeLocalServerTools(profile) {
  return listServerTools("packages/wiki-mcp/src/server.mjs", profile);
}

const STDIO_FDS = new Set(["0", "1", "2"]);

function processSocketSummary(pid) {
  const heldInodes = new Set();
  let fdNames;
  try {
    fdNames = readdirSync(`/proc/${pid}/fd`);
  } catch {
    return { held: 0, listening: 0, connected: 0, boundUnix: 0 };
  }
  for (const fd of fdNames) {
    if (STDIO_FDS.has(fd)) continue;
    let link;
    try {
      link = readlinkSync(`/proc/${pid}/fd/${fd}`);
    } catch {
      continue;
    }
    const match = /^socket:\[(\d+)\]$/u.exec(link);
    if (match) heldInodes.add(match[1]);
  }
  let listening = 0;
  let connected = 0;
  for (const proto of ["tcp", "tcp6", "udp", "udp6"]) {
    let text;
    try {
      text = readFileSync(`/proc/${pid}/net/${proto}`, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/u);
      if (fields.length < 10) continue;
      const inode = fields[9];
      if (!heldInodes.has(inode)) continue;

      if (fields[3] === "0A" || (proto.startsWith("udp") && fields[3] === "07")) {
        listening += 1;
      } else {
        connected += 1;
      }
    }
  }

  let boundUnix = 0;
  try {
    for (const line of readFileSync(`/proc/${pid}/net/unix`, "utf8").split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/u);
      if (fields.length >= 8 && heldInodes.has(fields[6])) boundUnix += 1;
    }
  } catch {   }
  return { held: heldInodes.size, listening, connected, boundUnix };
}

test("DEC-0159: production MCP startup opens no listener and emits no URL or bearer config",
  async () => {
    const child = spawn(process.execPath, ["packages/wiki-mcp/src/server.mjs"], {
      cwd: REPO_ROOT,
      env: freeLocalServerEnv("worker"),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const exitPromise = once(child, "exit");
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    try {

      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`initialize timed out; stderr=${stderr}`)), 15_000);
        child.stdout.on("data", () => {
          for (const line of stdout.split("\n")) {
            if (!line.trim()) continue;
            let message;
            try { message = JSON.parse(line); } catch { continue; }
            if (message.id === 1) { clearTimeout(timer); resolve(message); return; }
          }
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`server exited ${code} before initialize; stderr=${stderr}`));
        });
      });
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE_PARAMS
      })}\n`);
      await ready;

      const sockets = processSocketSummary(child.pid);
      assert.equal(sockets.listening, 0,
        `repository-owned MCP startup must open no TCP/UDP listener of any kind (${JSON.stringify(sockets)})`);

      assert.equal(sockets.connected, 0,
        `MCP startup must not connect a network socket (${JSON.stringify(sockets)})`);
      assert.equal(sockets.boundUnix, 0,
        `MCP startup must not bind a Unix-domain socket path (${JSON.stringify(sockets)})`);
      assert.equal(sockets.held, 0,
        `MCP startup must hold no socket descriptor beyond its own stdio (${JSON.stringify(sockets)})`);

      const emitted = `${stdout}\n${stderr}`;
      for (const forbidden of [
        /\bbearer\b/iu,
        /\bhttps?:\/\//iu,
        /\bwss?:\/\//iu,
        /127\.0\.0\.1:\d+/u,
        /\blocalhost:\d+/iu,
        /AGENT_LAUNCH_HOST_WRITE_AUTHORITY[A-Z_]*ENDPOINT/u,
        /broker\.sock/u
      ]) {
        assert.equal(forbidden.test(emitted), false,
          `MCP startup output must not contain ${forbidden}`);
      }
    } finally {
      child.stdin.end();
      child.kill("SIGKILL");
      await exitPromise;
    }
  });

test("every supported confined role resolves an explicit non-empty policy-derived surface",
  async () => {
    for (const profile of ["worker", "reviewer", "redteam", "orchestrator"]) {
      const toolNames = await listFreeLocalServerToolNames(profile);
      assert.ok(Array.isArray(toolNames) && toolNames.length > 0,
        `${profile} must resolve a non-empty tool surface`);

      const launcherDerived = await resolveLauncherRoleToolNamesForEnv(
        profile, freeLocalServerEnv(profile));
      assert.deepEqual(toolNames, [...launcherDerived].sort(),
        `${profile} server surface must equal its launcher-derived role profile`);
      if (profile === "worker") {
        assert.deepEqual(toolNames, ["commit"],
          "a confined worker is commit-only (DEC-0167/DEC-0168)");
      } else {
        assert.equal(toolNames.includes("commit"), false,
          `${profile} must not receive the worker's commit authority`);
      }
    }
  });

test("production stdio tools/list never exposes decision ratify/unratify to any role", async () => {
  const removed = ["workspace_decision_ratify", "workspace_decision_unratify"];
  let orchestratorToolNames = null;
  for (const profile of ["orchestrator", "reviewer", "redteam", "worker", "operator"]) {
    const toolNames = await listFreeLocalServerToolNames(profile);
    if (profile === "orchestrator") {
      orchestratorToolNames = toolNames;
    }
    for (const toolName of removed) {
      assert.equal(
        toolNames.includes(toolName),
        false,
        `${profile} must not list ${toolName}; accepted DEC authority is CLI-only`
      );
    }
  }

  for (const toolName of [
    "workspace_decision_create",
    "workspace_decision_amend_section",
    "workspace_decision_amend_scalar",
    "workspace_decision_reject"
  ]) {
    assert.ok(
      orchestratorToolNames.includes(toolName),
      `free/local orchestrator must still list proposed-lane ${toolName}`
    );
  }
});

test("production stdio exposes committed-slice integration only to coordinator roles", async () => {
  const orchestrator = await listFreeLocalServerToolNames("orchestrator");
  assert.ok(orchestrator.includes("workspace_integrate_committed_slice"));

  const reviewer = await listFreeLocalServerToolNames("reviewer");
  assert.equal(reviewer.includes("workspace_integrate_committed_slice"), false);
});

function publishesSchemaAbsentEmptyObjectSentinel(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object") return false;
  if (inputSchema.type !== "object") return false;

  if ("$schema" in inputSchema) return false;
  const properties = inputSchema.properties;
  const propertyCount =
    properties && typeof properties === "object" ? Object.keys(properties).length : 0;
  return propertyCount === 0;
}

test("WK-1697: no registered tool publishes the $schema-absent empty-object inputSchema sentinel",
  async () => {

    const ZOD_EFFECTS_TOOLS = new Set([
      "workspace_read_page",
      "workspace_get_record",
      "workspace_work_record_summary",
      "workspace_work_record_ready_slice",
      "workspace_tool_router_recommend",
      "workspace_initiative_status"
    ]);
    const repairedToolsSeen = new Set();

    for (const profile of ["orchestrator", "reviewer", "redteam", "worker", "operator"]) {
      const tools = await listFreeLocalServerTools(profile);
      for (const tool of tools) {
        assert.equal(
          publishesSchemaAbsentEmptyObjectSentinel(tool.inputSchema),
          false,
          `${profile}: tool ${tool.name} publishes the $schema-absent EMPTY_OBJECT_JSON_SCHEMA ` +
            "sentinel; a ZodEffects inputSchema must be normalized to its inner ZodObject at the " +
            "registerTool boundary so its properties publish"
        );
        if (ZOD_EFFECTS_TOOLS.has(tool.name)) {
          repairedToolsSeen.add(tool.name);
          const schema = tool.inputSchema;
          assert.ok(
            schema && typeof schema === "object" && "$schema" in schema,
            `${profile}: ${tool.name} inputSchema must carry a $schema key`
          );
          assert.ok(
            schema.properties && Object.keys(schema.properties).length > 0,
            `${profile}: ${tool.name} inputSchema must publish non-empty properties`
          );
          assert.equal(
            schema.additionalProperties,
            false,
            `${profile}: ${tool.name} must preserve .strict() additionalProperties:false in publication`
          );
        }
      }
    }

    assert.deepEqual(
      [...repairedToolsSeen].sort(),
      [...ZOD_EFFECTS_TOOLS].sort(),
      "every repaired ZodEffects tool must be exposed to at least one role profile and verified"
    );
  });
