import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { symlink, writeFile } from "node:fs/promises";
import {
  evaluateRoleGuardAction,
  loadRoleGuardConfig,
  readWorkerScope,
  validateTargetPayload
} from "../packages/agent-launch-core/src/index.mjs";
import {
  installFixtureEnvGuard,
  launcherProvenance,
  withTempRepo
} from "./agent-role-guard-test-helpers.mjs";

installFixtureEnvGuard();

test("worker write evaluation reads structured WK write_scope only", async () => {
  await withTempRepo(async (repoRoot) => {
    const config = await loadRoleGuardConfig({ repoRoot });
    const scope = await readWorkerScope({ repoRoot, config, wkId: "WK-0098" });
    assert.deepEqual(scope.write_scope, ["packages/feature/**"]);

    const allowed = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: { type: "check-write", paths: ["packages/feature/src/index.mjs"] }
    });
    assert.equal(allowed.allowed, true);

    const denied = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: { type: "check-write", paths: ["packages/other/src/index.mjs"] }
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.decision_code, "write_scope_denied");
  });
});

test("worker write_scope directory entries allow descendants", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeFile(
      path.join(repoRoot, "wiki", "issues", "WK-0098.md"),
      [
        "---",
        "id: WK-0098",
        "write_scope:",
        "  - packages/feature/src/",
        "---",
        "# Work"
      ].join("\n"),
      "utf8"
    );
    const config = await loadRoleGuardConfig({ repoRoot });
    const scope = await readWorkerScope({ repoRoot, config, wkId: "WK-0098" });
    assert.deepEqual(scope.write_scope, ["packages/feature/src/**"]);

    const allowed = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: { type: "check-write", paths: ["packages/feature/src/index.mjs"] }
    });
    assert.equal(allowed.allowed, true);
  });
});

test("write evaluation rejects reviewer writes, generated roots, outside paths, and symlinks", async () => {
  await withTempRepo(async (repoRoot) => {
    const config = await loadRoleGuardConfig({ repoRoot });
    const reviewer = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("reviewer", "WK-0098"),
      action: { type: "check-write", paths: ["packages/feature/src/index.mjs"] }
    });
    assert.equal(reviewer.allowed, false);
    assert.equal(reviewer.decision_code, "role_read_only");

    const generated = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: { type: "check-write", paths: ["wiki/generated/summary.md"] }
    });
    assert.equal(generated.allowed, false);
    assert.equal(generated.decision_code, "path_policy_denied");

    const outside = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: { type: "check-write", paths: ["../escape.md"] }
    });
    assert.equal(outside.allowed, false);
    assert.equal(outside.decision_code, "path_outside_repo");

    await symlink(path.join(repoRoot, "packages", "feature"), path.join(repoRoot, "packages", "linked"));
    const linked = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance: launcherProvenance("worker", "WK-0098"),
      action: { type: "check-write", paths: ["packages/linked/new.mjs"] }
    });
    assert.equal(linked.allowed, false);
    assert.equal(linked.decision_code, "path_symlink_rejected");
  });
});

test("structured diff targets cover create modify delete rename copy endpoints", () => {
  const payload = validateTargetPayload({
    target_source: "adapter_observed",
    targets: [
      { change_kind: "create", new_path: "packages/a/new.mjs" },
      { change_kind: "modify", old_path: "packages/a/edit.mjs", new_path: "packages/a/edit.mjs" },
      { change_kind: "delete", old_path: "packages/a/old.mjs" },
      { change_kind: "rename", old_path: "packages/a/name-old.mjs", new_path: "packages/a/name-new.mjs" },
      { change_kind: "copy", old_path: "packages/a/source.mjs", new_path: "packages/a/copy.mjs" }
    ]
  });
  assert.deepEqual(payload.evaluated_paths, [
    "packages/a/new.mjs",
    "packages/a/edit.mjs",
    "packages/a/old.mjs",
    "packages/a/name-old.mjs",
    "packages/a/name-new.mjs",
    "packages/a/source.mjs",
    "packages/a/copy.mjs"
  ]);

  assert.throws(
    () => validateTargetPayload({ target_source: "adapter_observed", targets: [{ change_kind: "rename", new_path: "x" }] }),
    /missing old_path/
  );
  assert.throws(
    () => validateTargetPayload({ target_source: "adapter_observed", targets: [{ change_kind: "create", old_path: "x", new_path: "y" }] }),
    /must not include old_path/
  );
  assert.throws(
    () => validateTargetPayload({
      target_source: "adapter_observed",
      launcher_metadata: true,
      targets: [{ change_kind: "create", new_path: "x" }]
    }),
    /Unsupported target payload key/
  );
  assert.throws(
    () => validateTargetPayload({
      target_source: "adapter_observed",
      targets: [{ change_kind: "create", new_path: "x", launcher_env: true }]
    }),
    /Unsupported targets\[0\] key/
  );
});
