

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";

import { buildBubblewrapLaunchPlan } from "../packages/agent-launch-cli/src/lib/launch-isolation.mjs";
import {
  CODES,
  repoRoot,
  expectIsolationError,
  indexOfSequence,
  makeTmpDir,
  makeRepoTmpDir
} from "./agent-launch-isolation-helpers.mjs";

test("homePolicy.writableFiles: emits one --bind <src> <dst> AFTER the read-only home reads", () => {
  const baseDir = makeTmpDir("iso-home-wf-order-");
  const src = path.join(baseDir, "src-credential.json");
  const dst = path.join(baseDir, "dst-credential.json");
  try {
    writeFileSync(src, "{}\n");
    const plan = buildBubblewrapLaunchPlan({
      repo: repoRoot,
      command: "/bin/true",
      homePolicy: {
        reads: ["/etc/ssl/certs"],
        writableFiles: [{ src, dst }]
      }
    });
    const argv = [...plan.bwrapArgs];
    const homeReadIdx = indexOfSequence(argv, ["--ro-bind-try", "/etc/ssl/certs", "/etc/ssl/certs"]);
    const writableIdx = indexOfSequence(argv, ["--bind", src, dst]);
    assert.notEqual(homeReadIdx, -1, "read-only home read must appear");
    assert.notEqual(writableIdx, -1, "writable home file --bind must appear (src may differ from dst)");
    assert.ok(writableIdx > homeReadIdx, "writable home bind must follow the read-only home reads");

    const hits = argv.reduce(
      (acc, _v, i) => (argv[i] === "--bind" && argv[i + 1] === src && argv[i + 2] === dst ? acc + 1 : acc),
      0
    );
    assert.equal(hits, 1, "exactly one --bind per writable home file entry");
    assert.equal(indexOfSequence(argv, ["--bind", baseDir, baseDir]), -1, "must not synthesize a containing-directory writable bind");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("homePolicy.writableFiles: a plain string entry binds src == dst", () => {
  const baseDir = makeTmpDir("iso-home-wf-string-");
  const leaf = path.join(baseDir, "leaf.json");
  try {
    writeFileSync(leaf, "");
    const plan = buildBubblewrapLaunchPlan({
      repo: repoRoot,
      command: "/bin/true",
      homePolicy: { writableFiles: [leaf] }
    });
    assert.deepEqual(
      plan.homePolicyWritableFiles.map((b) => ({ ...b })),
      [{ src: leaf, dst: leaf }]
    );
    assert.notEqual(indexOfSequence([...plan.bwrapArgs], ["--bind", leaf, leaf]), -1);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("homePolicy.writableFiles: plan surfaces a frozen homePolicyWritableFiles list and dedupes by (src,dst)", () => {
  const baseDir = makeTmpDir("iso-home-wf-frozen-");
  const src = path.join(baseDir, "a.json");
  const dst = path.join(baseDir, "b.json");
  try {
    const plan = buildBubblewrapLaunchPlan({
      repo: repoRoot,
      command: "/bin/true",
      homePolicy: { writableFiles: [{ src, dst }, { src, dst }] }
    });
    assert.ok(Object.isFrozen(plan.homePolicyWritableFiles), "homePolicyWritableFiles must be frozen");
    assert.equal(plan.homePolicyWritableFiles.length, 1, "duplicate (src,dst) collapses to one bind");
    assert.ok(Object.isFrozen(plan.homePolicyWritableFiles[0]), "each record must be frozen");
    assert.deepEqual({ ...plan.homePolicyWritableFiles[0] }, { src, dst });
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("homePolicy.writableFiles: an in-repo dst is refused (write_scope owns in-repo writable binds)", () => {
  const inRepoDst = path.join(repoRoot, "docs", "leaked-credential.json");
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({
      repo: repoRoot,
      command: "/bin/true",
      homePolicy: { writableFiles: [{ src: "/etc/hosts", dst: inRepoDst }] }
    }),
    CODES.SANDBOX_WRITE_DENIAL
  );
});

test("homePolicy.writableFiles: a dst symlinked into the repo is refused via realpath", () => {
  const baseDir = makeTmpDir("iso-home-wf-symescape-");
  const dstLink = path.join(baseDir, "dst-link.json");
  try {

    symlinkSync(path.join(repoRoot, "docs"), dstLink);
    expectIsolationError(
      () => buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        homePolicy: { writableFiles: [{ src: "/etc/hosts", dst: dstLink }] }
      }),
      CODES.SANDBOX_WRITE_DENIAL
    );
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("homePolicy.writableFiles: non-array input is refused with HOME_POLICY_INVALID", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({
      repo: repoRoot,
      command: "/bin/true",
      homePolicy: { writableFiles: "/home/user/.claude/.credentials.json" }
    }),
    CODES.HOME_POLICY_INVALID
  );
});

test("homePolicy.writableFiles: an unknown homePolicy key is refused with HOME_POLICY_INVALID", () => {
  expectIsolationError(
    () => buildBubblewrapLaunchPlan({
      repo: repoRoot,
      command: "/bin/true",
      homePolicy: { writable: [] }
    }),
    CODES.HOME_POLICY_INVALID
  );
});

test("homePolicy.writableFiles: entries go through the shared bind-entry path-shape guards", () => {
  const cases = [
    { input: ["relative/path.json"], expected: CODES.PATH_NOT_ABSOLUTE },
    { input: [`${os.tmpdir()}/*.json`], expected: CODES.PATH_HAS_GLOB },
    { input: [`${os.tmpdir()}/foo/../bar.json`], expected: CODES.PATH_HAS_TRAVERSAL },
    { input: [{ src: "/etc/hosts", flavor: "x", dst: "/tmp/x" }], expected: CODES.BIND_ENTRY_INVALID }
  ];
  for (const { input, expected } of cases) {
    expectIsolationError(
      () => buildBubblewrapLaunchPlan({
        repo: repoRoot,
        command: "/bin/true",
        homePolicy: { writableFiles: input }
      }),
      expected
    );
  }
});

test("homePolicy.writableFiles: absent seam yields an empty list and zero behavior change", () => {

  const withReads = buildBubblewrapLaunchPlan({
    repo: repoRoot,
    command: "/bin/true",
    homePolicy: { reads: ["/etc/ssl/certs"] }
  });
  assert.deepEqual([...withReads.homePolicyWritableFiles], []);
  const argv = [...withReads.bwrapArgs];

  assert.equal(indexOfSequence(argv, ["--bind", "/etc/ssl/certs", "/etc/ssl/certs"]), -1);

  const bare = buildBubblewrapLaunchPlan({ repo: repoRoot, command: "/bin/true" });
  assert.deepEqual([...bare.homePolicyWritableFiles], []);
});

test("homePolicy.writableFiles: an in-repo src with an out-of-repo dst is allowed (only dst is guarded)", () => {
  const repoTmp = makeRepoTmpDir("iso-home-wf-insrc-");
  const src = path.join(repoTmp, "in-repo-src.json");
  const outDir = makeTmpDir("iso-home-wf-outdst-");
  const dst = path.join(outDir, "out-dst.json");
  try {
    writeFileSync(src, "");
    const plan = buildBubblewrapLaunchPlan({
      repo: repoRoot,
      command: "/bin/true",
      homePolicy: { writableFiles: [{ src, dst }] }
    });
    assert.deepEqual({ ...plan.homePolicyWritableFiles[0] }, { src, dst });
    assert.notEqual(indexOfSequence([...plan.bwrapArgs], ["--bind", src, dst]), -1);
  } finally {
    rmSync(repoTmp, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});
