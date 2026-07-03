import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { access, constants, mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  createDefaultRegistry,
  DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND
} from "../packages/agent-launch-core/src/lib/registry.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const ENDPOINT_PATH = path.join(
  REPO_ROOT,
  "packages",
  "agent-launch-cli",
  "bin",
  DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND
);

const HANDSHAKE_REQUEST_SCHEMA = "agent-backend-handshake.v1";
const HANDSHAKE_RESULT_SCHEMA = "agent-backend-handshake-result.v1";
const REPO_OWNED_BACKEND_ID = "agent-launch.filesystem-mcp.default";

const HOSTILE_ENV_KEYS = Object.freeze([
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "AGENT_LAUNCH_CONFIG_DIR",
  "AGENT_LAUNCH_REGISTRY_PATH",
  "AGENT_LAUNCH_HOME",
  "AGENT_LAUNCH_ROLE_GUARD_CONTEXT_PATH",
  "AGENT_LAUNCH_ROLE_GUARD_RUN_ID",
  "AGENT_BACKEND_HANDSHAKE_PATH",
  "AGENT_BACKEND_HANDSHAKE_FILE",
  "AGENT_BACKEND_HANDSHAKE_RESULT_PATH",
  "AGENT_BACKEND_HANDSHAKE_RESULT_FILE",
  "OPERATOR_CONFIG",
  "OPERATOR_CONFIG_PATH",
  "AGENT_LAUNCH_OPERATOR_CONFIG"
]);

function baseEndpointEnv() {
  const tempDir = os.tmpdir();
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C",
    HOME: tempDir,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir
  };
}

function buildChallenge(overrides = {}) {
  return {
    schema_version: HANDSHAKE_REQUEST_SCHEMA,
    backend_kind: "filesystem_mcp",
    challenge_nonce: "test-nonce-" + Math.random().toString(36).slice(2, 10),
    normalized_scope_digest: "sha256:test-scope-digest",
    raw_exec_enabled: false,
    ...overrides
  };
}

function spawnEndpoint({ stdin, argv = [], env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", "exec \"$@\"", "sh", ENDPOINT_PATH, ...argv], {
      stdio: ["pipe", "pipe", "pipe"],
      env: env ?? baseEndpointEnv()
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (c) => stdoutChunks.push(c));
    child.stderr.on("data", (c) => stderrChunks.push(c));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8")
      });
    });
    if (typeof stdin === "string") {
      child.stdin.end(stdin);
    } else if (Buffer.isBuffer(stdin)) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

function parseSingleJsonLine(stdout) {
  const trimmed = stdout.replace(/\n+$/, "");
  assert.ok(
    !trimmed.includes("\n"),
    `endpoint must emit exactly one JSON line on stdout, got: ${JSON.stringify(stdout)}`
  );
  return JSON.parse(trimmed);
}

test("endpoint exists at the repo-owned default command path and is executable", async () => {
  await access(ENDPOINT_PATH, constants.X_OK);
});

test("the default registry points at the repo-owned spawn endpoint command", () => {
  const registry = createDefaultRegistry();
  const defaultKey = registry.filesystem_mcp_backend_default;
  const entry = registry.filesystem_mcp_backends[defaultKey];
  assert.equal(entry.endpoint.kind, "spawn");
  assert.deepEqual(entry.endpoint.argv, [
    DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND
  ]);
  assert.equal(entry.handshake_source.kind, "spawn_stdout");
  assert.equal(entry.mode, "advisory");
  assert.equal(entry.backend_id, REPO_OWNED_BACKEND_ID);
});

test("DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND matches the shipped repo-owned bin filename", () => {
  assert.equal(
    DEFAULT_FILESYSTEM_MCP_BACKEND_ENDPOINT_COMMAND,
    path.basename(ENDPOINT_PATH)
  );
});

test("endpoint emits exactly one agent-backend-handshake-result.v1 envelope for a well-formed challenge", async () => {
  const challenge = buildChallenge();
  const { code, stdout } = await spawnEndpoint({
    stdin: JSON.stringify(challenge)
  });
  assert.equal(code, 0);
  const result = parseSingleJsonLine(stdout);
  assert.equal(result.schema_version, HANDSHAKE_RESULT_SCHEMA);
  assert.equal(result.backend_kind, "filesystem_mcp");
  assert.equal(result.backend_id, REPO_OWNED_BACKEND_ID);
  assert.equal(result.challenge_nonce, challenge.challenge_nonce);

  assert.equal(result.status, "unavailable");
  assert.equal(result.raw_exec_enabled, false);
  assert.equal(result.scope_binding, false);
  assert.equal(result.tool_surface, null);
  assert.equal(result.scope_digest, null);
  assert.equal(result.handshake_digest, null);
  assert.equal(result.expires_at, null);
  assert.equal(result.validation_transport, "unsupported");
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_advisory_default.v1"
  );
});

test("endpoint emits no integrity tag, scope digest, or handshake digest", async () => {

  const { stdout } = await spawnEndpoint({
    stdin: JSON.stringify(buildChallenge())
  });
  const result = parseSingleJsonLine(stdout);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "integrity"), false);
  assert.equal(result.handshake_digest, null);
  assert.equal(result.scope_digest, null);
});

test("endpoint rejects malformed JSON request input", async () => {
  const { code, stdout } = await spawnEndpoint({ stdin: "not-json" });
  assert.equal(code, 65);
  const result = parseSingleJsonLine(stdout);
  assert.equal(result.schema_version, HANDSHAKE_RESULT_SCHEMA);
  assert.equal(result.status, "unavailable");
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_request_invalid.v1"
  );
});

test("endpoint rejects an empty stdin", async () => {
  const { code, stdout } = await spawnEndpoint({ stdin: "" });
  assert.equal(code, 65);
  const result = parseSingleJsonLine(stdout);
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_request_missing.v1"
  );
});

test("endpoint rejects an unsupported challenge schema_version", async () => {
  const { code, stdout } = await spawnEndpoint({
    stdin: JSON.stringify(buildChallenge({ schema_version: "wrong.v1" }))
  });
  assert.equal(code, 65);
  const result = parseSingleJsonLine(stdout);
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_schema_invalid.v1"
  );
});

test("endpoint rejects an unsupported backend_kind in the challenge", async () => {
  const { code, stdout } = await spawnEndpoint({
    stdin: JSON.stringify(buildChallenge({ backend_kind: "exec_command" }))
  });
  assert.equal(code, 65);
  const result = parseSingleJsonLine(stdout);
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_unsupported_backend.v1"
  );
});

test("endpoint rejects a missing or malformed challenge_nonce", async () => {
  for (const bad of [
    { challenge_nonce: "" },
    { challenge_nonce: "has spaces" },
    { challenge_nonce: "x".repeat(200) },
    { challenge_nonce: null }
  ]) {
    const { code, stdout } = await spawnEndpoint({
      stdin: JSON.stringify(buildChallenge(bad))
    });
    assert.equal(code, 65);
    const result = parseSingleJsonLine(stdout);
    assert.equal(
      result.refusal_code,
      "agent_backend.filesystem_mcp.endpoint_nonce_invalid.v1",
      `expected nonce refusal for ${JSON.stringify(bad)}, got ${result.refusal_code}`
    );
  }
});

test("endpoint rejects raw_exec_enabled challenges", async () => {
  const { code, stdout } = await spawnEndpoint({
    stdin: JSON.stringify(buildChallenge({ raw_exec_enabled: true }))
  });
  assert.equal(code, 65);
  const result = parseSingleJsonLine(stdout);
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_raw_exec_forbidden.v1"
  );
});

test("endpoint rejects a non-spawn_stdout handshake transport hint", async () => {
  const { code, stdout } = await spawnEndpoint({
    stdin: JSON.stringify(buildChallenge({
      handshake_transport_kind: "unix_socket_reply"
    }))
  });
  assert.equal(code, 65);
  const result = parseSingleJsonLine(stdout);
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_transport_unsupported.v1"
  );
});

test("endpoint refuses any CLI argument with exit 64", async () => {
  for (const argv of [
    ["--operator-config", "/tmp/fake.json"],
    ["--handshake-file", "/tmp/fake-handshake.json"],
    ["positional-arg"],
    ["--"]
  ]) {
    const { code, stdout, stderr } = await spawnEndpoint({
      stdin: JSON.stringify(buildChallenge()),
      argv
    });
    assert.equal(code, 64, `expected exit 64 for argv ${JSON.stringify(argv)}`);
    assert.equal(stdout, "", "no stdout payload may leak when argv is rejected");
    assert.match(
      stderr,
      /unexpected argument/,
      "argv refusal must surface a stderr diagnostic"
    );
  }
});

test("hostile inherited environment variables do not influence the emitted result", async () => {

  const challenge = buildChallenge({ challenge_nonce: "hostile-env-nonce-001" });
  const hostileEnv = baseEndpointEnv();
  for (const key of HOSTILE_ENV_KEYS) {
    hostileEnv[key] = "/tmp/forged-" + key.toLowerCase().replace(/[^a-z0-9]/g, "-");
  }
  const cleanEnv = baseEndpointEnv();

  const hostile = await spawnEndpoint({
    stdin: JSON.stringify(challenge),
    env: hostileEnv
  });
  const clean = await spawnEndpoint({
    stdin: JSON.stringify(challenge),
    env: cleanEnv
  });

  assert.equal(hostile.code, 0);
  assert.equal(clean.code, 0);
  const hostileResult = parseSingleJsonLine(hostile.stdout);
  const cleanResult = parseSingleJsonLine(clean.stdout);
  assert.deepEqual(hostileResult, cleanResult);
  assert.equal(hostileResult.challenge_nonce, challenge.challenge_nonce);
  for (const key of HOSTILE_ENV_KEYS) {
    const forgedValue = hostileEnv[key];
    assert.equal(
      hostile.stdout.includes(forgedValue),
      false,
      `hostile env value for ${key} must not leak into stdout`
    );
    assert.equal(
      hostile.stderr.includes(forgedValue),
      false,
      `hostile env value for ${key} must not leak into stderr`
    );
  }
});

test("endpoint strips NODE_OPTIONS before Node startup so preload code cannot run", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "filesystem-mcp-node-options-"));
  const markerPath = path.join(tempDir, "preload-marker");
  const preloadPath = path.join(tempDir, "evil-preload.mjs");
  try {
    await writeFile(
      preloadPath,
      [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(markerPath)}, 'preload-ran');`,
        "process.stderr.write('PRELOAD-EXECUTED');",
        ""
      ].join("\n"),
      "utf8"
    );

    const challenge = buildChallenge({ challenge_nonce: "node-options-preload-001" });
    const result = await spawnEndpoint({
      stdin: JSON.stringify(challenge),
      env: {
        ...baseEndpointEnv(),
        NODE_OPTIONS: `--import ${pathToFileURL(preloadPath).href}`
      }
    });

    assert.equal(result.code, 0);
    assert.equal(result.stderr.includes("PRELOAD-EXECUTED"), false);
    const payload = parseSingleJsonLine(result.stdout);
    assert.equal(payload.challenge_nonce, challenge.challenge_nonce);
    await assert.rejects(
      access(markerPath),
      /ENOENT/,
      "NODE_OPTIONS preload must not execute before endpoint sanitization"
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("endpoint stdin byte cap rejects an oversized challenge", async () => {
  const oversized = JSON.stringify({
    schema_version: HANDSHAKE_REQUEST_SCHEMA,
    backend_kind: "filesystem_mcp",
    challenge_nonce: "cap-test",
    normalized_scope_digest: "sha256:cap",
    padding: "x".repeat(100000)
  });
  const { code, stdout } = await spawnEndpoint({ stdin: oversized });
  assert.equal(code, 65);
  const result = parseSingleJsonLine(stdout);
  assert.equal(
    result.refusal_code,
    "agent_backend.filesystem_mcp.endpoint_request_too_large.v1"
  );
});

test("endpoint does not derive its backend identity from request bytes", async () => {

  const { stdout } = await spawnEndpoint({
    stdin: JSON.stringify(buildChallenge({
      backend_id: "attacker.filesystem-mcp.spoof",
      backend_version: "99.99-spoof",
      handshake_digest: "sha256:spoofed",
      scope_digest: "sha256:spoofed-scope"
    }))
  });
  const result = parseSingleJsonLine(stdout);
  assert.equal(result.backend_id, REPO_OWNED_BACKEND_ID);
  assert.notEqual(result.backend_version, "99.99-spoof");
  assert.equal(result.handshake_digest, null);
  assert.equal(result.scope_digest, null);
});
