

import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import {
  AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
  issueBackendHandshakeResult,
  loadLauncherVerifierCapability
} from "../packages/agent-launch-cli/src/lib/agent-backend-verifier.mjs";
import {
  createLauncherContextNonceStore
} from "../packages/agent-launch-core/src/lib/launcher-context-mint.mjs";

export const TEST_VERIFIER_SECRET = "fixture-agent-backend-test-secret-0123456789abcdef";

export async function loadVerifierFixture() {
  const issueNonceDir = await mkdtemp(path.join(tmpdir(), "agent-backend-test-issue-"));
  const resultNonceDir = await mkdtemp(path.join(tmpdir(), "agent-backend-test-result-"));
  const issueNonceStore = await createLauncherContextNonceStore({ dir: issueNonceDir });
  const resultNonceStore = await createLauncherContextNonceStore({ dir: resultNonceDir });
  const capability = await loadLauncherVerifierCapability({
    secret: TEST_VERIFIER_SECRET,
    nonceStore: issueNonceStore
  });
  return {
    capability,
    resultNonceStore,
    cleanup: async () => {
      await rm(issueNonceDir, { recursive: true, force: true });
      await rm(resultNonceDir, { recursive: true, force: true });
    }
  };
}

export async function issueVerifiedHandshake({ capability, request, scopeDigest }) {
  const challenge = {
    schema_version: AGENT_BACKEND_VERIFIER_CHALLENGE_SCHEMA_VERSION,
    backend_kind: "filesystem_mcp",
    challenge_nonce: randomBytes(16).toString("base64url"),
    normalized_scope_digest: scopeDigest,
    validation_transport: "argv",
    provenance_sink: "launcher_owned",
    raw_exec_enabled: false
  };
  const evidence = {
    backend_kind: "filesystem_mcp",
    backend_id: "portfolio-filesystem-mcp",
    backend_version: "0.1.0",
    status: "available",
    raw_exec_enabled: false,
    tool_surface: request.tools.filesystem_mcp,
    scope_binding: true,
    bound_scope_digest: scopeDigest
  };
  return issueBackendHandshakeResult({ capability, challenge, backendEvidence: evidence });
}

export const repo = "agent-chassis/agent-chassis";

export function baseSubject() {
  return {
    kind: "work_unit",
    repo,
    unit: {
      record_id: "WK-0274",
      slice_id: null,
      address: "WK-0274"
    }
  };
}

export function baseRequest(overrides = {}) {
  return {
    backend_kind: "filesystem_mcp",
    subject: baseSubject(),
    agent: {
      family: "codex",
      role: "worker",
      profile: "filesystem-mcp-worker",
      model: null
    },
    scope: {
      read_scope: ["docs/agent-launch-quickstart.md"],
      write_scope: ["tests/agent-backend.test.mjs"]
    },
    validation: {
      commands: [
        {
          form: "argv",
          argv: ["npm", "test", "--", "tests/agent-backend.test.mjs"]
        }
      ]
    },
    environment_policy: {
      mode: "closed",
      allowed_keys: []
    },
    provenance_destination: {
      kind: "launcher_owned",
      run_id: "RUN-00000000-0000-0000-0000-000000000000",
      path: ".agent-runs/runs/HO-0001/RUN-00000000-0000-0000-0000-000000000000/response.md"
    },
    tools: {
      raw_exec_enabled: false
    },
    ...overrides
  };
}

export const REGISTRY_BACKEND_KEY = "default";
export const REGISTRY_BACKEND_ID = "portfolio-filesystem-mcp";
export const REGISTRY_BACKEND_VERSION = "0.1.0";
export const REGISTRY_PROFILE_FAMILY = "codex";
export const REGISTRY_PROFILE_NAME = "filesystem-mcp-worker";

export function baseRegistry(overrides = {}) {
  const data = {
    schema_version: 1,
    filesystem_mcp_backend_default: REGISTRY_BACKEND_KEY,
    filesystem_mcp_backends: {
      [REGISTRY_BACKEND_KEY]: {
        backend_id: REGISTRY_BACKEND_ID,
        backend_version: REGISTRY_BACKEND_VERSION,
        mode: "enforced",
        endpoint: {
          kind: "spawn",
          argv: ["agent-launch-filesystem-mcp-backend"]
        },
        supported_profiles: [
          {
            agent_family: "codex",
            profile: REGISTRY_PROFILE_NAME,
            roles: ["worker", "code_review", "redteam"]
          },
          {
            agent_family: "claude",
            profile: REGISTRY_PROFILE_NAME,
            roles: ["worker", "code_review", "redteam"]
          }
        ],
        handshake_source: { kind: "spawn_stdout" },

        child_mount: {
          transport: "stdio",
          command: "node",
          args: ["/launcher/owned/filesystem-mcp-server.mjs", "--enforced"],
          env: { FILESYSTEM_MCP_BACKEND_PROFILE: REGISTRY_PROFILE_NAME }
        }
      },
      ...(overrides.extraBackends ?? {})
    }
  };
  if (overrides.mutateData) {
    overrides.mutateData(data);
  }
  return {
    path: "/tmp/fake-launchers.v1.json",
    hash: "sha256:fake-launchers",
    data
  };
}
