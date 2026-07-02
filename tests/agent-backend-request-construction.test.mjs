
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_BACKEND_AGENT_FAMILIES,
  buildAgentBackendRequestV1,
  buildFilesystemMcpAgentBackendRequestV1,
  buildFilesystemMcpAgentBackendHandshakeResultV1,
  normalizeAgentBackendRequestV1
} from "../packages/agent-launch-cli/src/lib/agent-backend.mjs";
import {
  baseSubject,
  baseRequest
} from "./agent-backend-test-helpers.mjs";

test("request construction covers codex, claude, and gemini without spawning model CLIs", () => {
  for (const family of AGENT_BACKEND_AGENT_FAMILIES) {
    const result = buildAgentBackendRequestV1(
      baseRequest({
        agent: {
          family,
          role: "worker",
          profile: `${family}-filesystem-mcp`,
          model: null
        }
      })
    );

    assert.equal(result.schema_version, "agent-backend-request.v1");
    assert.equal(result.backend_kind, "filesystem_mcp");
    assert.equal(result.agent.family, family);
    assert.equal(result.agent.role, "worker");
    assert.equal(result.agent.profile, `${family}-filesystem-mcp`);
    assert.deepEqual(result.subject, baseSubject());
    assert.deepEqual(result.scope, baseRequest().scope);
    assert.deepEqual(result.validation, baseRequest().validation);
    assert.deepEqual(result.environment_policy, baseRequest().environment_policy);
    assert.deepEqual(result.provenance_destination, baseRequest().provenance_destination);
    assert.equal(result.tools.raw_exec_enabled, false);
  }
});

test("request construction requires subject, role, profile, read scope, write scope, validation policy, environment policy, and provenance destination fields", () => {
  const requiredPaths = [
    ["subject", (input) => {
      delete input.subject;
    }],
    ["agent.role", (input) => {
      delete input.agent.role;
    }],
    ["agent.profile", (input) => {
      delete input.agent.profile;
    }],
    ["scope.read_scope", (input) => {
      delete input.scope.read_scope;
    }],
    ["scope.write_scope", (input) => {
      delete input.scope.write_scope;
    }],
    ["validation", (input) => {
      delete input.validation;
    }],
    ["environment_policy", (input) => {
      delete input.environment_policy;
    }],
    ["provenance_destination", (input) => {
      delete input.provenance_destination;
    }]
  ];

  for (const [path, mutate] of requiredPaths) {
    const input = baseRequest();
    mutate(input);

    const result = normalizeAgentBackendRequestV1(input);
    assert.equal(result.ok, false, path);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.path === path), path);
    assert.ok(
      result.diagnostics.every((diagnostic) => diagnostic.code === "invalid_agent_backend_input"),
      path
    );
  }
});

test("reviewer and redteam backend requests accept canonical empty scope.write_scope and bind the empty list deterministically", () => {
  for (const role of ["reviewer", "redteam"]) {
    const input = baseRequest({
      agent: {
        family: "codex",
        role,
        profile: `filesystem-mcp-${role}`,
        model: null
      },
      scope: {
        read_scope: ["docs/agent-launch-quickstart.md"],
        write_scope: []
      }
    });

    const normalized = normalizeAgentBackendRequestV1(input);
    assert.equal(normalized.ok, true, `${role} normalization should succeed`);
    assert.deepEqual(normalized.diagnostics, [], `${role} should produce no diagnostics`);
    assert.deepEqual(
      normalized.value.scope.write_scope,
      [],
      `${role} write_scope should be the canonical empty list`
    );
    assert.equal(normalized.value.agent.role, role);

    const built = buildAgentBackendRequestV1(input);
    assert.equal(built.schema_version, "agent-backend-request.v1");
    assert.deepEqual(built.scope.write_scope, []);

    const rebuilt = buildAgentBackendRequestV1(input);
    assert.deepEqual(
      rebuilt.scope,
      built.scope,
      `${role} repeat construction must produce the same scope object`
    );
  }
});

test("worker backend requests still reject empty scope.write_scope with the existing invalid-input diagnostic", () => {
  const input = baseRequest({
    scope: {
      read_scope: ["docs/agent-launch-quickstart.md"],
      write_scope: []
    }
  });

  const result = normalizeAgentBackendRequestV1(input);
  assert.equal(result.ok, false);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "invalid_agent_backend_input" &&
        diagnostic.path === "scope.write_scope"
    ),
    "worker empty write_scope should produce the existing invalid-input diagnostic"
  );
});

test("reviewer and redteam empty write_scope cannot be broadened by CLI/env/prompt/default-style request overrides", () => {
  for (const role of ["reviewer", "redteam"]) {
    const baseInput = baseRequest({
      agent: {
        family: "codex",
        role,
        profile: `filesystem-mcp-${role}`,
        model: null
      },
      scope: {
        read_scope: ["docs/agent-launch-quickstart.md"],
        write_scope: []
      }
    });

    const aliasInput = { ...baseInput, write_scope: ["tests/agent-backend.test.mjs"] };
    const aliasResult = normalizeAgentBackendRequestV1(aliasInput);
    assert.equal(aliasResult.ok, true);
    assert.deepEqual(
      aliasResult.value.scope.write_scope,
      [],
      `${role} write_scope must remain empty regardless of top-level overrides`
    );

    const nonEmpty = baseRequest({
      agent: {
        family: "codex",
        role,
        profile: `filesystem-mcp-${role}`,
        model: null
      },
      scope: {
        read_scope: ["docs/agent-launch-quickstart.md"],
        write_scope: ["tests/agent-backend.test.mjs"]
      }
    });
    const nonEmptyResult = normalizeAgentBackendRequestV1(nonEmpty);
    assert.equal(nonEmptyResult.ok, true);
    assert.deepEqual(nonEmptyResult.value.scope.write_scope, ["tests/agent-backend.test.mjs"]);
  }
});

test("missing scope.write_scope still fails for reviewer and redteam because the empty list must be supplied explicitly", () => {
  for (const role of ["reviewer", "redteam"]) {
    const input = baseRequest({
      agent: {
        family: "codex",
        role,
        profile: `filesystem-mcp-${role}`,
        model: null
      }
    });
    delete input.scope.write_scope;

    const result = normalizeAgentBackendRequestV1(input);
    assert.equal(result.ok, false, `${role} with missing write_scope should fail`);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "invalid_agent_backend_input" &&
          diagnostic.path === "scope.write_scope"
      ),
      `${role} missing write_scope should surface the existing invalid-input diagnostic`
    );
  }
});

test("filesystem-MCP request construction records raw_exec_enabled false in the tool policy", () => {
  const result = buildFilesystemMcpAgentBackendRequestV1(
    baseRequest({
      backend_kind: "filesystem_mcp",
      tools: {
        raw_exec_enabled: false,
        filesystem_mcp: {
          read: true,
          write: true,
          structured_validation: true,
          final_report: true
        }
      }
    })
  );

  assert.equal(result.backend_kind, "filesystem_mcp");
  assert.equal(result.tools.raw_exec_enabled, false);
  assert.deepEqual(result.tools.filesystem_mcp, {
    read: true,
    write: true,
    structured_validation: true,
    final_report: true
  });
});

test("filesystem-MCP handshake normalization preserves flat read-only tool surfaces", () => {
  for (const role of ["reviewer", "redteam"]) {
    const request = buildFilesystemMcpAgentBackendRequestV1(
      baseRequest({
        agent: {
          family: "codex",
          role,
          profile: `filesystem-mcp-${role}`,
          model: null
        },
        scope: {
          read_scope: ["docs/agent-launch-quickstart.md"],
          write_scope: []
        },
        tools: {
          raw_exec_enabled: false,
          filesystem_mcp: {
            read: true,
            write: false,
            structured_validation: true,
            final_report: true
          }
        }
      })
    );

    const handshake = buildFilesystemMcpAgentBackendHandshakeResultV1({
      request,
      challenge_nonce: `nonce-${role}`,
      status: "available",
      mode: "enforced",
      raw_exec_enabled: false,
      tool_surface: {
        read: true,
        write: false,
        structured_validation: true,
        final_report: true
      },
      scope_binding: true,
      validation_transport: "argv",
      provenance_sink: "launcher_owned",
      scope_digest: "sha256:filesystem-mcp-scope-digest",
      handshake_digest: "sha256:filesystem-mcp-handshake-digest",
      expires_at: new Date(Date.now() + 60_000).toISOString()
    });

    assert.deepEqual(handshake.tool_surface, {
      read: true,
      write: false,
      structured_validation: true,
      final_report: true
    });
  }
});
