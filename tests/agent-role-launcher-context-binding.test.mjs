import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLauncherContextActionBinding,
  computeActionPayloadHash
} from "../packages/agent-launch-core/src/index.mjs";

const EMPTY_SCOPE_DIGEST = computeActionPayloadHash([]);
const NONEMPTY_SCOPE_DIGEST = computeActionPayloadHash(["packages/example/src/index.mjs"]);
const READ_SCOPE_DIGEST = computeActionPayloadHash(["packages/example"]);
const HANDSHAKE_DIGEST = `sha256:${"A".repeat(43)}`;
const ENV_POLICY_DIGEST = `sha256:${"B".repeat(43)}`;
const AGENT_BRIEF_DIGEST = `sha256:${"C".repeat(43)}`;

function workerArgs(overrides = {}) {
  return {
    actionType: "agent_role_launch",
    repoRoot: "/repo",
    configPath: ".agent-role-guard.json",
    role: "worker",
    wk: "WK-0098",
    acceptedHandshakeDigest: HANDSHAKE_DIGEST,
    backendKind: "filesystem_mcp",
    agentFamily: "claude",
    agentProfile: "worker",
    agentRole: "worker",
    unitAddress: "WK-0098",
    recordId: "WK-0098",
    sliceId: null,
    runId: "RUN-launch",
    readScopeDigest: READ_SCOPE_DIGEST,
    writeScopeDigest: NONEMPTY_SCOPE_DIGEST,
    validationTransport: "argv",
    provenanceDestinationKind: "launcher_owned",
    envPolicyDigest: ENV_POLICY_DIGEST,
    agentBriefDigest: AGENT_BRIEF_DIGEST,
    ...overrides
  };
}

function reviewerArgs(overrides = {}) {
  return workerArgs({
    role: "reviewer",
    agentRole: "reviewer",
    agentProfile: "reviewer",
    writeScopeDigest: EMPTY_SCOPE_DIGEST,
    ...overrides
  });
}

function redteamArgs(overrides = {}) {
  return workerArgs({
    role: "redteam",
    agentRole: "redteam",
    agentProfile: "redteam",
    writeScopeDigest: EMPTY_SCOPE_DIGEST,
    ...overrides
  });
}

function assertRefusal(args, expectedFragment) {
  let err;
  try {
    buildLauncherContextActionBinding(args);
  } catch (caught) {
    err = caught;
  }
  assert.ok(err, `expected refusal containing ${JSON.stringify(expectedFragment)}`);
  assert.equal(err.name, "RoleGuardError");
  assert.equal(err.code, "launcher_context_invalid");
  if (expectedFragment) {
    assert.match(err.message, expectedFragment);
  }
}

test("valid worker agent_role_launch binding round-trips every contract field", () => {
  const binding = buildLauncherContextActionBinding(workerArgs());
  assert.deepEqual(binding, {
    action_type: "agent_role_launch",
    config_path: ".agent-role-guard.json",
    repo_root: "/repo",
    role: "worker",
    wk: "WK-0098",
    accepted_handshake_digest: HANDSHAKE_DIGEST,
    backend_kind: "filesystem_mcp",
    agent_family: "claude",
    agent_profile: "worker",
    agent_role: "worker",
    unit_address: "WK-0098",
    record_id: "WK-0098",
    slice_id: null,
    run_id: "RUN-launch",
    read_scope_digest: READ_SCOPE_DIGEST,
    write_scope_digest: NONEMPTY_SCOPE_DIGEST,
    validation_transport: "argv",
    provenance_destination_kind: "launcher_owned",
    env_policy_digest: ENV_POLICY_DIGEST,
    agent_brief_digest: AGENT_BRIEF_DIGEST
  });
  assert.ok(!("target_source" in binding));
  assert.ok(!("target_hash" in binding));
  assert.ok(!("raw_argv" in binding));
});

test("valid worker agent_role_launch binding accepts a slice address", () => {
  const binding = buildLauncherContextActionBinding(workerArgs({
    unitAddress: "WK-0098#slice-foo",
    sliceId: "slice-foo"
  }));
  assert.equal(binding.unit_address, "WK-0098#slice-foo");
  assert.equal(binding.record_id, "WK-0098");
  assert.equal(binding.slice_id, "slice-foo");
});

test("valid reviewer agent_role_launch binding requires the canonical empty write-scope digest", () => {
  const binding = buildLauncherContextActionBinding(reviewerArgs());
  assert.equal(binding.agent_role, "reviewer");
  assert.equal(binding.write_scope_digest, EMPTY_SCOPE_DIGEST);
});

test("valid redteam agent_role_launch binding requires the canonical empty write-scope digest", () => {
  const binding = buildLauncherContextActionBinding(redteamArgs());
  assert.equal(binding.agent_role, "redteam");
  assert.equal(binding.write_scope_digest, EMPTY_SCOPE_DIGEST);
});

test("valid worker agent_role_launch binding accepts the named validation transport", () => {
  const binding = buildLauncherContextActionBinding(workerArgs({ validationTransport: "named" }));
  assert.equal(binding.validation_transport, "named");
});

test("valid worker agent_role_launch binding accepts the gemini family", () => {
  const binding = buildLauncherContextActionBinding(workerArgs({ agentFamily: "gemini" }));
  assert.equal(binding.agent_family, "gemini");
});

test("agent_role_launch refuses missing required base fields", () => {
  assertRefusal(
    workerArgs({ actionType: "" }),
    /actionType/
  );
  assertRefusal(
    workerArgs({ repoRoot: "" }),
    /repoRoot/
  );
  assertRefusal(
    workerArgs({ configPath: "" }),
    /configPath/
  );
  assertRefusal(
    workerArgs({ role: "" }),
    /role/
  );
});

test("agent_role_launch refuses null wk because wk must equal record_id", () => {
  assertRefusal(workerArgs({ wk: null }), /wk === record_id/);
});

test("agent_role_launch refuses non-empty-string wk values that do not normalize cleanly", () => {
  assertRefusal(workerArgs({ wk: "" }), /wk must be null or non-empty string/);
});

test("agent_role_launch refuses stray target_source", () => {
  assertRefusal(
    workerArgs({ targetSource: "adapter_observed" }),
    /must not include target_source/
  );
});

test("agent_role_launch refuses stray target_hash", () => {
  assertRefusal(
    workerArgs({ targetHash: computeActionPayloadHash(["x"]) }),
    /must not include target_hash/
  );
});

test("agent_role_launch refuses missing accepted_handshake_digest", () => {
  assertRefusal(workerArgs({ acceptedHandshakeDigest: null }), /accepted_handshake_digest/);
});

test("agent_role_launch refuses malformed accepted_handshake_digest", () => {
  for (const value of [
    "",
    "not-a-digest",
    "sha256:short",
    "md5:" + "A".repeat(43),
    "sha256:" + "A".repeat(42),
    "sha256:" + "A".repeat(44),
    "sha256:" + "$".repeat(43),
    123
  ]) {
    assertRefusal(
      workerArgs({ acceptedHandshakeDigest: value }),
      /accepted_handshake_digest/
    );
  }
});

test("agent_role_launch refuses unsupported backend_kind values", () => {
  for (const value of ["local_cli", "", null, "FILESYSTEM_MCP"]) {
    assertRefusal(workerArgs({ backendKind: value }), /backend_kind/);
  }
});

test("agent_role_launch refuses unsupported agent_family values", () => {
  for (const value of ["codex", "", null, "Claude"]) {
    assertRefusal(workerArgs({ agentFamily: value }), /agent_family/);
  }
});

test("agent_role_launch refuses empty agent_profile", () => {
  assertRefusal(workerArgs({ agentProfile: "" }), /agent_profile/);
  assertRefusal(workerArgs({ agentProfile: null }), /agent_profile/);
});

test("agent_role_launch refuses unsupported agent_role values", () => {
  for (const value of ["operator", "orchestrator", "unknown", "", null]) {
    assertRefusal(
      workerArgs({ role: value, agentRole: value }),
      /agent_role|role/
    );
  }
});

test("agent_role_launch refuses role/agent_role mismatch", () => {
  assertRefusal(
    workerArgs({ role: "worker", agentRole: "reviewer" }),
    /role === agent_role/
  );
  assertRefusal(
    workerArgs({ role: "reviewer", agentRole: "worker" }),
    /role === agent_role/
  );
});

test("agent_role_launch refuses non-canonical unit_address", () => {
  for (const value of ["", "WK-", "wk-0001", "WK-0001 slice-foo", "WK-0001slice-foo", "WK-0001/slice-foo", "WK-0001#Bad"]) {
    assertRefusal(
      workerArgs({
        recordId: "WK-0001",
        wk: "WK-0001",
        unitAddress: value
      }),
      /unit_address/
    );
  }
});

test("agent_role_launch refuses non-canonical record_id", () => {
  for (const value of ["wk-0001", "WK-", "", null, "WK-0001-extra"]) {
    assertRefusal(
      workerArgs({ recordId: value, wk: "WK-0098" }),
      /record_id/
    );
  }
});

test("agent_role_launch refuses wk !== record_id", () => {
  assertRefusal(
    workerArgs({ wk: "WK-0099", recordId: "WK-0001", unitAddress: "WK-0001" }),
    /wk === record_id/
  );
});

test("agent_role_launch refuses prefix-collision unit address with null slice", () => {
  assertRefusal(
    workerArgs({
      recordId: "WK-0001",
      wk: "WK-0001",
      sliceId: null,
      unitAddress: "WK-00011#slice-foo"
    }),
    /unit_address/
  );
});

test("agent_role_launch refuses prefix-collision unit address with declared slice", () => {
  assertRefusal(
    workerArgs({
      recordId: "WK-0001",
      wk: "WK-0001",
      sliceId: "slice-foo",
      unitAddress: "WK-0001#other-slice"
    }),
    /unit_address must equal <record_id>#<slice_id>/
  );
});

test("agent_role_launch refuses sliced unit address with null slice_id", () => {
  assertRefusal(
    workerArgs({
      recordId: "WK-0001",
      wk: "WK-0001",
      sliceId: null,
      unitAddress: "WK-0001#slice-foo"
    }),
    /unit_address must equal record_id when slice_id is null/
  );
});

test("agent_role_launch refuses bare unit address with declared slice_id", () => {
  assertRefusal(
    workerArgs({
      recordId: "WK-0001",
      wk: "WK-0001",
      sliceId: "slice-foo",
      unitAddress: "WK-0001"
    }),
    /unit_address/
  );
});

test("agent_role_launch refuses malformed slice_id variants", () => {

  assertRefusal(
    workerArgs({
      recordId: "WK-0001",
      wk: "WK-0001",
      sliceId: "",
      unitAddress: "WK-0001"
    }),
    /slice_id/
  );

  for (const value of ["Slice-foo", "foo_bar", "slice-foo/bar", "-bad", "bad?"]) {
    assertRefusal(
      workerArgs({
        recordId: "WK-0001",
        wk: "WK-0001",
        sliceId: value,
        unitAddress: `WK-0001#${value}`
      }),
      /unit_address|slice_id/
    );
  }
});

test("agent_role_launch refuses empty run_id", () => {
  assertRefusal(workerArgs({ runId: "" }), /run_id/);
  assertRefusal(workerArgs({ runId: null }), /run_id/);
});

test("agent_role_launch refuses malformed read_scope_digest", () => {
  for (const value of [null, "", "not-a-digest", "sha256:short", "md5:" + "A".repeat(43)]) {
    assertRefusal(workerArgs({ readScopeDigest: value }), /read_scope_digest/);
  }
});

test("agent_role_launch refuses malformed write_scope_digest", () => {
  for (const value of [null, "", "not-a-digest", "sha256:short", "md5:" + "A".repeat(43)]) {
    assertRefusal(workerArgs({ writeScopeDigest: value }), /write_scope_digest/);
  }
});

test("agent_role_launch refuses worker with empty write_scope_digest", () => {
  assertRefusal(
    workerArgs({ writeScopeDigest: EMPTY_SCOPE_DIGEST }),
    /worker write_scope_digest must not equal the canonical empty-scope digest/
  );
});

test("agent_role_launch refuses reviewer with non-empty write_scope_digest", () => {
  assertRefusal(
    reviewerArgs({ writeScopeDigest: NONEMPTY_SCOPE_DIGEST }),
    /reviewer write_scope_digest must equal the canonical empty-scope digest/
  );
});

test("agent_role_launch refuses redteam with non-empty write_scope_digest", () => {
  assertRefusal(
    redteamArgs({ writeScopeDigest: NONEMPTY_SCOPE_DIGEST }),
    /redteam write_scope_digest must equal the canonical empty-scope digest/
  );
});

test("agent_role_launch refuses unsupported validation_transport values", () => {
  for (const value of ["unsupported", "", null, "shell", "ARGV"]) {
    assertRefusal(workerArgs({ validationTransport: value }), /validation_transport/);
  }
});

test("agent_role_launch refuses unsupported provenance_destination_kind values", () => {
  for (const value of ["path", "handle", "", null, "Launcher_Owned"]) {
    assertRefusal(workerArgs({ provenanceDestinationKind: value }), /provenance_destination_kind/);
  }
});

test("agent_role_launch refuses malformed env_policy_digest", () => {
  for (const value of [null, "", "not-a-digest", "sha256:short"]) {
    assertRefusal(workerArgs({ envPolicyDigest: value }), /env_policy_digest/);
  }
});

test("agent_role_launch refuses malformed agent_brief_digest", () => {
  for (const value of [null, "", "not-a-digest", "sha256:short"]) {
    assertRefusal(workerArgs({ agentBriefDigest: value }), /agent_brief_digest/);
  }
});

test("agent_role_launch silently drops a non-null rawArgv from the returned binding", () => {
  const binding = buildLauncherContextActionBinding(workerArgs({
    rawArgv: ["unused", "argv"]
  }));
  assert.ok(!("raw_argv" in binding));
  assert.equal(binding.action_type, "agent_role_launch");
});

test("check-write action binding remains compatible after WK-0333", () => {
  const targets = ["packages/feature/src/index.mjs", "packages/feature/src/extra.mjs"].sort();
  const targetHash = computeActionPayloadHash(targets);
  const binding = buildLauncherContextActionBinding({
    actionType: "check-write",
    repoRoot: "/repo",
    configPath: ".agent-role-guard.json",
    role: "worker",
    wk: "WK-0098",
    targetHash
  });
  assert.deepEqual(binding, {
    action_type: "check-write",
    config_path: ".agent-role-guard.json",
    repo_root: "/repo",
    role: "worker",
    wk: "WK-0098",
    target_hash: targetHash
  });
});

test("check-diff action binding remains compatible after WK-0333", () => {
  const payload = {
    target_source: "adapter_observed",
    targets: [
      { change_kind: "create", new_path: "packages/feature/src/new.ts" }
    ]
  };
  const targetHash = computeActionPayloadHash(payload);
  const binding = buildLauncherContextActionBinding({
    actionType: "check-diff",
    repoRoot: "/repo",
    configPath: ".agent-role-guard.json",
    role: "worker",
    wk: "WK-0098",
    targetSource: "adapter_observed",
    targetHash
  });
  assert.deepEqual(binding, {
    action_type: "check-diff",
    config_path: ".agent-role-guard.json",
    repo_root: "/repo",
    role: "worker",
    wk: "WK-0098",
    target_source: "adapter_observed",
    target_hash: targetHash
  });
});

test("check-command action binding remains compatible after WK-0333", () => {
  const argv = ["git", "status"];
  const binding = buildLauncherContextActionBinding({
    actionType: "check-command",
    repoRoot: "/repo",
    configPath: ".agent-role-guard.json",
    role: "operator",
    wk: "WK-0098",
    rawArgv: argv
  });
  assert.deepEqual(binding, {
    action_type: "check-command",
    config_path: ".agent-role-guard.json",
    repo_root: "/repo",
    role: "operator",
    wk: "WK-0098",
    raw_argv: argv
  });
});

test("check-command action binding refuses empty rawArgv", () => {
  let err;
  try {
    buildLauncherContextActionBinding({
      actionType: "check-command",
      repoRoot: "/repo",
      configPath: ".agent-role-guard.json",
      role: "operator",
      wk: "WK-0098",
      rawArgv: []
    });
  } catch (caught) {
    err = caught;
  }
  assert.ok(err);
  assert.equal(err.code, "launcher_context_invalid");
  assert.match(err.message, /raw_argv/);
});
