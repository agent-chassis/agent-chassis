import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  buildBubblewrapLaunchPlan,
  spawnIsolated
} from "../packages/agent-launch-cli/src/lib/launch-isolation.mjs";
import {
  resolveFindingsRoleGitMetadata
} from "../packages/agent-launch-cli/src/lib/launch-isolation-findings-git-metadata.mjs";

function makeLinkedMetadataFixture(prefix = "findings-git-metadata-") {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const checkout = path.join(root, "checkout");
  const commonGitDir = path.join(root, "main.git");
  const worktreeGitDir = path.join(commonGitDir, "worktrees", "review");
  const primaryObjectDirectory = path.join(commonGitDir, "objects");
  mkdirSync(checkout, { recursive: true });
  mkdirSync(path.join(primaryObjectDirectory, "info"), { recursive: true });
  mkdirSync(worktreeGitDir, { recursive: true });
  writeFileSync(path.join(checkout, ".git"), `gitdir: ${worktreeGitDir}\n`);
  writeFileSync(path.join(worktreeGitDir, "commondir"), "../..\n");
  writeFileSync(path.join(worktreeGitDir, "gitdir"), `${path.join(checkout, ".git")}\n`);
  return { root, checkout, commonGitDir, worktreeGitDir, primaryObjectDirectory };
}

function expectMetadataRefusal(fn, code = BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BubblewrapIsolationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("findings Git metadata resolves the linked checkout chain and recursive external alternates", () => {
  const fixture = makeLinkedMetadataFixture();
  const alternate = path.join(fixture.root, "alternate-objects");
  const transitive = path.join(fixture.root, "transitive-objects");
  try {
    mkdirSync(path.join(alternate, "info"), { recursive: true });
    mkdirSync(path.join(transitive, "info"), { recursive: true });
    writeFileSync(
      path.join(fixture.primaryObjectDirectory, "info", "alternates"),
      `${path.relative(fixture.primaryObjectDirectory, alternate)}\n`
    );
    writeFileSync(
      path.join(alternate, "info", "alternates"),
      `${path.relative(alternate, transitive)}\n`
    );

    const metadata = resolveFindingsRoleGitMetadata({
      repoReal: fixture.checkout,
      role: "reviewer"
    });
    assert.equal(metadata.gitPointerFile, path.join(fixture.checkout, ".git"));
    assert.equal(metadata.worktreeGitDir, fixture.worktreeGitDir);
    assert.equal(metadata.commonGitDir, fixture.commonGitDir);
    assert.deepEqual(metadata.objectDirectories, [
      fixture.primaryObjectDirectory,
      alternate,
      transitive
    ]);
    assert.deepEqual(
      metadata.readOnlyBinds.map(({ src }) => src),
      [
        fixture.commonGitDir,
        fixture.worktreeGitDir,
        path.join(fixture.checkout, ".git"),
        alternate,
        transitive
      ]
    );
    assert.ok(metadata.pinnedPaths.some(({ path: pinned }) =>
      pinned === path.join(fixture.primaryObjectDirectory, "info", "alternates")));
    assert.ok(metadata.pinnedPaths.some(({ path: pinned }) =>
      pinned === path.join(alternate, "info", "alternates")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("findings Git metadata refuses missing dependencies", () => {
  const fixture = makeLinkedMetadataFixture();
  try {
    rmSync(fixture.worktreeGitDir, { recursive: true, force: true });
    expectMetadataRefusal(() => resolveFindingsRoleGitMetadata({
      repoReal: fixture.checkout,
      role: "reviewer"
    }));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("findings Git metadata refuses wrong-type dependencies", () => {
  const fixture = makeLinkedMetadataFixture();
  try {
    rmSync(fixture.primaryObjectDirectory, { recursive: true, force: true });
    writeFileSync(fixture.primaryObjectDirectory, "not a directory\n");
    expectMetadataRefusal(() => resolveFindingsRoleGitMetadata({
      repoReal: fixture.checkout,
      role: "redteam"
    }));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("findings Git metadata refuses symlink substitution", () => {
  const fixture = makeLinkedMetadataFixture();
  const realAlternate = path.join(fixture.root, "real-alternate");
  const linkedAlternate = path.join(fixture.root, "linked-alternate");
  try {
    mkdirSync(realAlternate, { recursive: true });
    symlinkSync(realAlternate, linkedAlternate, "dir");
    writeFileSync(
      path.join(fixture.primaryObjectDirectory, "info", "alternates"),
      `${linkedAlternate}\n`
    );
    expectMetadataRefusal(() => resolveFindingsRoleGitMetadata({
      repoReal: fixture.checkout,
      role: "reviewer"
    }));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("findings Git metadata replacement is refused at the final pre-spawn boundary", () => {
  const fixture = makeLinkedMetadataFixture();
  try {
    const plan = buildBubblewrapLaunchPlan({
      repo: fixture.checkout,
      command: "/bin/true",
      findingsRole: "reviewer"
    });
    const pointer = path.join(fixture.checkout, ".git");
    renameSync(pointer, `${pointer}.planned`);
    writeFileSync(pointer, `gitdir: ${fixture.worktreeGitDir}\n`);
    expectMetadataRefusal(
      () => spawnIsolated(plan),
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_CHANGED
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("findings Git metadata rejects supplied Git topology while worker planning remains unchanged", () => {
  const fixture = makeLinkedMetadataFixture();
  try {
    expectMetadataRefusal(() => buildBubblewrapLaunchPlan({
      repo: fixture.checkout,
      command: "/bin/true",
      findingsRole: "reviewer",
      provisionedWorktreeGitIdentity: {
        worktreePath: fixture.checkout,
        gitDir: fixture.worktreeGitDir,
        mainGitDir: fixture.commonGitDir
      }
    }));

    const workerPlan = buildBubblewrapLaunchPlan({
      repo: fixture.checkout,
      command: "/bin/true"
    });
    assert.equal(workerPlan.findingsRoleGitMetadata, null);
    assert.equal(workerPlan.bwrapArgs.includes(fixture.commonGitDir), false);
    assert.equal(workerPlan.bwrapArgs.includes(fixture.worktreeGitDir), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("findings Git metadata cannot overlap a writable or runtime mount", () => {
  const fixture = makeLinkedMetadataFixture();
  try {
    const writableFile = path.join(fixture.checkout, "not-allowed.txt");
    writeFileSync(writableFile, "read only\n");
    expectMetadataRefusal(() => buildBubblewrapLaunchPlan({
      repo: fixture.checkout,
      command: "/bin/true",
      findingsRole: "reviewer",
      writableFiles: [writableFile]
    }));
    assert.throws(() => buildBubblewrapLaunchPlan({
      repo: fixture.checkout,
      command: "/bin/true",
      findingsRole: "redteam",
      runtimeRoots: [fixture.commonGitDir]
    }), (error) => {
      assert.ok(error instanceof BubblewrapIsolationError);
      assert.equal(error.code, BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL);
      return true;
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("normal in-repository .git directories need no findings runtime-support mounts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "findings-normal-gitdir-"));
  try {
    mkdirSync(path.join(root, ".git"), { recursive: true });
    const metadata = resolveFindingsRoleGitMetadata({ repoReal: root, role: "reviewer" });
    assert.equal(metadata, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
