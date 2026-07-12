

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION,
  COMMIT_SCOPE_ENVELOPE_DIAGNOSTIC_CODES as CODES,
  COMMIT_SCOPE_ENVELOPE_REFUSAL_REASONS as REASONS,
  ENVELOPE_ATTESTATION_STATES,
  ENVELOPE_ATTESTATION_MARKER_SCHEMA_VERSION,
  EXPECTED_ENVELOPE_FIELD_SCHEMA,
  CommitScopeEnvelopeError,
  buildFreeTierNotAttestedMarker,
  assertExpectedEnvelopeInvariant,
  verifyAndMeasureCommitScope
} from "../packages/agent-launch-cli/src/lib/commit-scope-envelope.mjs";

function oid(n) {
  return n.toString(16).padStart(40, "0");
}

const ZERO_OID = "0".repeat(40);

const GIT_DIR = "/abs/isolated/.git";
const BASE_SHA = oid(0xba5e);
const COMMIT = oid(0xc0);
const TREE = oid(0x77);

const SYMLINK_MODE = "120000";

function rawLine({ oldMode = "100644", newMode = "100644", status = "M", path }) {

  return `:${oldMode} ${newMode} ${"a".repeat(40)} ${"b".repeat(40)} ${status}\t${path}`;
}

function lsLine(path, size) {

  return `100644 blob ${"c".repeat(40)} ${String(size).padStart(7)}\t${path}`;
}

function makeGit(spec = {}) {
  const calls = [];
  const fail = spec.fail ?? new Set();
  const runGit = ({ gitDir, args }) => {

    let i = 0;
    while (args[i] === "-c") i += 2;
    const sub = args[i];
    const rest = args.slice(i + 1);
    let op;
    if (sub === "diff-tree" && rest.includes("--raw")) op = "gate";
    else if (sub === "diff-tree" && rest.includes("--numstat")) op = "numstat";
    else if (sub === "ls-tree") op = `ls-tree:${rest[rest.length - 1]}`;
    else throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    calls.push({ op, gitDir, args, config: args.slice(0, i) });
    if (fail.has(op)) return { ok: false, status: 128, stderr: `forced failure on ${op}` };
    if (op === "gate") {
      return { ok: true, stdout: (spec.raw ?? []).map(rawLine).join("\n") + "\n" };
    }
    if (op === "numstat") {
      return {
        ok: true,
        stdout: (spec.numstat ?? []).map((n) => `${n.added}\t${n.deleted}\t${n.path}`).join("\n") + "\n"
      };
    }
    const treeish = rest[rest.length - 1];
    const sizes = (spec.sizes ?? {})[treeish] ?? {};
    return { ok: true, stdout: Object.entries(sizes).map(([p, s]) => lsLine(p, s)).join("\n") + "\n" };
  };
  return { runGit, calls };
}

function makeResolver() {
  return (writeScope) => ({
    matches(rel) {
      return (writeScope ?? []).some((entry) => {
        if (entry.endsWith("/**")) return rel.startsWith(entry.slice(0, -2));
        return rel === entry;
      });
    }
  });
}

function callVerify(spec, overrides = {}) {
  const { runGit, calls } = makeGit(spec);
  const result = verifyAndMeasureCommitScope({
    gitDir: GIT_DIR,
    baseSha: BASE_SHA,
    commit: COMMIT,
    tree: TREE,
    writeScope: ["tests/**"],
    expectedEnvelope: { declared_metrics: { changed_line_count: 50 } },
    deps: { runGit, resolveWriteScope: makeResolver() },
    ...overrides
  });
  return { result, calls };
}

function expectCode(fn, code, message) {
  assert.throws(fn, (err) => {
    assert.ok(
      err instanceof CommitScopeEnvelopeError,
      `expected CommitScopeEnvelopeError, got: ${err && err.name}: ${err && err.message}`
    );
    assert.equal(err.code, code, message);
    return true;
  });
}

test("gate: contained delivery — changed-paths ⊆ write_scope, sorted set, no refusal, full measurement", () => {
  const { result, calls } = callVerify({
    raw: [
      { path: "tests/b.mjs", status: "A" },
      { path: "tests/a.mjs", status: "M" }
    ],
    numstat: [
      { added: 3, deleted: 1, path: "tests/a.mjs" },
      { added: 5, deleted: 0, path: "tests/b.mjs" }
    ],
    sizes: {
      [COMMIT]: { "tests/a.mjs": 100, "tests/b.mjs": 200, "tests/untouched.mjs": 42 },
      [BASE_SHA]: { "tests/a.mjs": 90 }
    }
  });

  assert.equal(result.schema_version, COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION);
  assert.equal(result.contained, true);
  assert.equal(result.refusal, null);

  assert.deepEqual(result.changed_paths, ["tests/a.mjs", "tests/b.mjs"]);
  assert.ok(Object.isFrozen(result), "verify result must be frozen");

  assert.equal(result.metrics.measured, true);
  assert.deepEqual(result.metrics.changed_line_count, { added: 8, deleted: 1, total: 9, binary_paths: [] });
  assert.deepEqual(result.metrics.final_file_sizes, { "tests/a.mjs": 100, "tests/b.mjs": 200 });
  assert.equal(result.metrics.changed_file_count, 2);
  assert.equal(result.metrics.scope_count, 1);

  assert.equal(result.baseline.measured, true);
  assert.deepEqual(result.baseline.file_sizes_at_base, { "tests/a.mjs": 90 });

  const gate = calls.find((c) => c.op === "gate");
  assert.ok(gate.args.includes("--raw"), "gate diff is --raw name-status");
  assert.ok(gate.args.includes("--no-renames"), "rename detection OFF — a rename cannot launder an out-of-scope write");
  assert.ok(gate.args.includes("-r"), "gate diff recurses into subtrees");
  assert.ok(
    !gate.args.some((a, idx) => a === BASE_SHA && gate.args.slice(idx + 1).some((x) => x.startsWith("--"))),
    "no pathspec — the full changed set is gated"
  );

  const cfg = gate.args.slice(0, gate.args.indexOf("diff-tree"));
  assert.ok(cfg.includes("-c") && cfg.includes("diff.*.textconv="), "textconv pinned off on the gate diff");
});

test("gate: SYMLINK_OR_TYPE_SWAP refusal on a mode-120000 entry, BEFORE containment (even when the path is in scope)", () => {

  const { result } = callVerify({
    raw: [{ path: "tests/link.mjs", newMode: SYMLINK_MODE, status: "A" }]
  });
  assert.equal(result.contained, false);
  assert.ok(result.refusal);
  assert.equal(result.refusal.code, CODES.SYMLINK_OR_TYPE_SWAP);
  assert.deepEqual(result.refusal.reasons, [REASONS.SYMLINK_OR_TYPE_SWAP]);
  assert.deepEqual(result.refusal.symlink_or_type_swap, ["tests/link.mjs"]);
  assert.deepEqual(result.refusal.out_of_scope, []);
});

test("gate: SYMLINK_OR_TYPE_SWAP refusal on an old-side symlink and on a `T` type-change status", () => {
  const oldSide = callVerify({
    raw: [{ path: "tests/was-link.mjs", oldMode: SYMLINK_MODE, status: "M" }]
  }).result;
  assert.equal(oldSide.refusal.code, CODES.SYMLINK_OR_TYPE_SWAP);

  const typeSwap = callVerify({
    raw: [{ path: "tests/swap.mjs", status: "T" }]
  }).result;
  assert.equal(typeSwap.refusal.code, CODES.SYMLINK_OR_TYPE_SWAP);
  assert.deepEqual(typeSwap.refusal.symlink_or_type_swap, ["tests/swap.mjs"]);
});

test("gate: a symlink AND an out-of-scope path present — the mode-laundering code is primary, both reasons recorded", () => {
  const { result } = callVerify({
    raw: [
      { path: "tests/link.mjs", newMode: SYMLINK_MODE, status: "A" },
      { path: "src/evil.mjs", status: "A" }
    ]
  });
  assert.equal(result.contained, false);
  assert.equal(result.refusal.code, CODES.SYMLINK_OR_TYPE_SWAP, "symlink is the more security-sensitive primary code");
  assert.deepEqual(result.refusal.reasons, [REASONS.SYMLINK_OR_TYPE_SWAP, REASONS.OUT_OF_SCOPE]);
  assert.deepEqual(result.refusal.symlink_or_type_swap, ["tests/link.mjs"]);
  assert.deepEqual(result.refusal.out_of_scope, ["src/evil.mjs"]);
});

test("gate: canonical generated and runtime-state paths are refused even when write_scope matches", () => {
  for (const path of ["wiki/catalog.md", "wiki/generated/summary.md", ".agent-runs/RUN-1/result.json", ".cache/code-index/state.json"]) {
    const { result } = callVerify(
      { raw: [{ path, status: "A" }] },
      { writeScope: [path] }
    );
    assert.equal(result.contained, false, path);
    assert.equal(result.refusal.code, CODES.FORBIDDEN_REPOSITORY_PATH, path);
    assert.deepEqual(result.refusal.reasons, [REASONS.FORBIDDEN_REPOSITORY_PATH]);
    assert.deepEqual(result.refusal.forbidden_repository_paths.map((entry) => entry.path), [path]);
    assert.equal(typeof result.refusal.forbidden_repository_paths[0].pattern, "string");
    assert.equal(typeof result.refusal.forbidden_repository_paths[0].reason, "string");
  }
});

test("gate: rename-shaped delete/add attempts cannot launder a forbidden generated path", () => {
  for (const raw of [
    [
      { path: "wiki/catalog.md", status: "D" },
      { path: "docs/catalog-copy.md", status: "A" }
    ],
    [
      { path: "docs/source.md", status: "D" },
      { path: ".agent-runs/RUN-1/source.md", status: "A" }
    ]
  ]) {
    const writeScope = raw.map((entry) => entry.path);
    const { result } = callVerify({ raw }, { writeScope });
    assert.equal(result.contained, false);
    assert.equal(result.refusal.code, CODES.FORBIDDEN_REPOSITORY_PATH);
    assert.equal(result.refusal.forbidden_repository_paths.length, 1);
  }
});

test("gate: ordinary canonical docs, wiki records, and source paths retain existing behavior", () => {
  const paths = ["docs/design.md", "wiki/work-records/WK-1520.json", "packages/app/src/index.mjs"];
  const { result } = callVerify(
    { raw: paths.map((path) => ({ path, status: "M" })) },
    { writeScope: paths }
  );
  assert.equal(result.contained, true);
  assert.equal(result.refusal, null);
});

test("gate: GATE_DIFF_FAILED (fail-closed) when the pinned gate diff cannot run", () => {
  const { runGit } = makeGit({ fail: new Set(["gate"]) });
  expectCode(
    () =>
      verifyAndMeasureCommitScope({
        gitDir: GIT_DIR,
        baseSha: BASE_SHA,
        commit: COMMIT,
        tree: TREE,
        writeScope: ["tests/**"],
        deps: { runGit, resolveWriteScope: makeResolver() }
      }),
    CODES.GATE_DIFF_FAILED,
    "an unrunnable gate diff must fail closed, never pass"
  );
});

test("containment: OUT_OF_SCOPE structured refusal naming the offending paths", () => {
  const { result } = callVerify({
    raw: [
      { path: "tests/ok.mjs", status: "M" },
      { path: "src/secret.mjs", status: "A" },
      { path: "packages/wiki-mcp/src/leak.mjs", status: "A" }
    ]
  });
  assert.equal(result.contained, false);
  assert.equal(result.refusal.code, CODES.OUT_OF_SCOPE);
  assert.deepEqual(result.refusal.reasons, [REASONS.OUT_OF_SCOPE]);
  assert.deepEqual(
    result.refusal.out_of_scope,
    ["packages/wiki-mcp/src/leak.mjs", "src/secret.mjs"],
    "the refusal names exactly the offending paths (sorted), never the in-scope one"
  );
  assert.deepEqual(result.refusal.symlink_or_type_swap, []);
});

test("containment: MISSING_RESOLVER when no resolver is injected — no naive fallback", () => {
  const { runGit } = makeGit({ raw: [{ path: "tests/a.mjs", status: "M" }] });
  expectCode(
    () =>
      verifyAndMeasureCommitScope({
        gitDir: GIT_DIR,
        baseSha: BASE_SHA,
        commit: COMMIT,
        tree: TREE,
        writeScope: ["tests/**"],
        deps: { runGit }
      }),
    CODES.MISSING_RESOLVER,
    "a missing resolver is fail-closed, never a naive existsSync fallback"
  );
});

test("containment: MISSING_RESOLVER when the resolver returns a misshaped matcher", () => {
  const { runGit } = makeGit({ raw: [{ path: "tests/a.mjs", status: "M" }] });
  expectCode(
    () =>
      verifyAndMeasureCommitScope({
        gitDir: GIT_DIR,
        baseSha: BASE_SHA,
        commit: COMMIT,
        tree: TREE,
        writeScope: ["tests/**"],
        deps: { runGit, resolveWriteScope: () => ({ nope: true }) }
      }),
    CODES.MISSING_RESOLVER
  );
});

test("containment: a resolver throw is fail-closed — the path counts as out of scope, never a silent pass", () => {
  const { runGit } = makeGit({ raw: [{ path: "tests/a.mjs", status: "M" }] });
  const result = verifyAndMeasureCommitScope({
    gitDir: GIT_DIR,
    baseSha: BASE_SHA,
    commit: COMMIT,
    tree: TREE,
    writeScope: ["tests/**"],
    deps: {
      runGit,
      resolveWriteScope: () => ({
        matches() {
          throw new Error("resolver blew up");
        }
      })
    }
  });
  assert.equal(result.contained, false);
  assert.equal(result.refusal.code, CODES.OUT_OF_SCOPE);
  assert.deepEqual(result.refusal.out_of_scope, ["tests/a.mjs"]);
});

test("measurement: a numstat failure degrades metrics to measured:false WITHOUT touching the gate", () => {
  const { result } = callVerify({
    raw: [{ path: "tests/a.mjs", status: "M" }],
    fail: new Set(["numstat"]),
    sizes: { [BASE_SHA]: { "tests/a.mjs": 10 } }
  });

  assert.equal(result.contained, true);
  assert.equal(result.refusal, null);
  assert.equal(result.metrics.measured, false, "metric half degrades, never gates");
  assert.equal(result.metrics.schema_version, COMMIT_SCOPE_ENVELOPE_SCHEMA_VERSION);
  assert.ok(result.metrics.reason, "a degraded metric records a reason");

  assert.equal(result.baseline.measured, true);
  assert.deepEqual(result.baseline.file_sizes_at_base, { "tests/a.mjs": 10 });
});

test("measurement: a final-size ls-tree failure degrades metrics to measured:false, gate intact", () => {
  const { result } = callVerify({
    raw: [{ path: "tests/a.mjs", status: "M" }],
    numstat: [{ added: 1, deleted: 0, path: "tests/a.mjs" }],
    fail: new Set([`ls-tree:${COMMIT}`]),
    sizes: { [BASE_SHA]: { "tests/a.mjs": 10 } }
  });
  assert.equal(result.contained, true);
  assert.equal(result.metrics.measured, false);
  assert.equal(result.baseline.measured, true);
});

test("measurement: a baseline ls-tree failure degrades baseline to measured:false, gate + metrics intact", () => {
  const { result } = callVerify({
    raw: [{ path: "tests/a.mjs", status: "M" }],
    numstat: [{ added: 2, deleted: 2, path: "tests/a.mjs" }],
    fail: new Set([`ls-tree:${BASE_SHA}`]),
    sizes: { [COMMIT]: { "tests/a.mjs": 20 } }
  });
  assert.equal(result.contained, true);
  assert.equal(result.metrics.measured, true);
  assert.equal(result.metrics.changed_line_count.total, 4);
  assert.equal(result.baseline.measured, false, "baseline degrades independently, never gates");
  assert.ok(result.baseline.reason);
});

test("measurement: a binary path (- / -) is recorded, contributes 0 to the line count", () => {
  const { result } = callVerify({
    raw: [
      { path: "tests/a.mjs", status: "M" },
      { path: "tests/blob.bin", status: "A" }
    ],
    numstat: [
      { added: 4, deleted: 0, path: "tests/a.mjs" },
      { added: "-", deleted: "-", path: "tests/blob.bin" }
    ],
    sizes: { [COMMIT]: {}, [BASE_SHA]: {} }
  });
  assert.equal(result.metrics.measured, true);
  assert.equal(result.metrics.changed_line_count.total, 4);
  assert.deepEqual(result.metrics.changed_line_count.binary_paths, ["tests/blob.bin"]);
});

test("attestation: the free-tier NOT-ATTESTED marker is stamped and object-bound", () => {
  const { result } = callVerify({ raw: [{ path: "tests/a.mjs", status: "M" }] });
  assert.deepEqual(result.attestation, {
    schema_version: ENVELOPE_ATTESTATION_MARKER_SCHEMA_VERSION,
    state: ENVELOPE_ATTESTATION_STATES.NOT_ATTESTED_FREE,
    attested: false,
    base_sha: BASE_SHA,
    commit: COMMIT,
    tree: TREE
  });
});

test("attestation: buildFreeTierNotAttestedMarker binds the object so it cannot be replayed onto another delivery", () => {
  const marker = buildFreeTierNotAttestedMarker({ baseSha: BASE_SHA, commit: COMMIT, tree: TREE });
  assert.equal(marker.state, ENVELOPE_ATTESTATION_STATES.NOT_ATTESTED_FREE);
  assert.equal(marker.attested, false);
  assert.equal(marker.base_sha, BASE_SHA);
  assert.equal(marker.commit, COMMIT);
  assert.equal(marker.tree, TREE);
  assert.ok(Object.isFrozen(marker));
});

test("expected-envelope invariant: present + non-blocking when a non-empty envelope is supplied", () => {
  const inv = assertExpectedEnvelopeInvariant({ declared_metrics: { changed_line_count: 5 } });
  assert.equal(inv.schema_version, EXPECTED_ENVELOPE_FIELD_SCHEMA.schema_version);
  assert.equal(inv.present, true);
  assert.equal(inv.blocking, false);
  assert.equal(inv.violation, null);
  assert.ok(Object.isFrozen(inv));
});

test("expected-envelope invariant: absent field surfaces a NON-BLOCKING violation (never a third gate)", () => {
  for (const absent of [null, undefined, {}, "nope", 123]) {
    const inv = assertExpectedEnvelopeInvariant(absent);
    assert.equal(inv.present, false, `${JSON.stringify(absent)} is not a non-empty envelope`);
    assert.equal(inv.blocking, false, "the invariant NEVER gates the commit (DEC-0132 two-blocker rule)");
    assert.ok(inv.violation, "a provisioning-invariant violation is surfaced, not thrown");
    assert.equal(inv.violation.kind, "expected_envelope_absent_at_commit");
  }
});

test("expected-envelope invariant: an absent envelope does NOT block a contained commit", () => {
  const { result } = callVerify(
    { raw: [{ path: "tests/a.mjs", status: "M" }] },
    { expectedEnvelope: null }
  );
  assert.equal(result.contained, true, "the missing expected-envelope must not gate the commit");
  assert.equal(result.expected_envelope_invariant.present, false);
  assert.equal(result.expected_envelope_invariant.blocking, false);
  assert.ok(result.expected_envelope_invariant.violation);
});

test("validation: rejects a non-oid / zero base_sha, commit, or tree", () => {
  const { runGit } = makeGit();
  const base = {
    gitDir: GIT_DIR,
    baseSha: BASE_SHA,
    commit: COMMIT,
    tree: TREE,
    writeScope: ["tests/**"],
    deps: { runGit, resolveWriteScope: makeResolver() }
  };
  for (const key of ["baseSha", "commit", "tree"]) {
    for (const bad of ["cafe", ZERO_OID, "", 42, null]) {
      expectCode(
        () => verifyAndMeasureCommitScope({ ...base, [key]: bad }),
        CODES.INVALID_SHA,
        `${key}=${JSON.stringify(bad)} must be rejected`
      );
    }
  }
});

test("validation: rejects an empty gitDir and a non-array writeScope", () => {
  const { runGit } = makeGit();
  const base = {
    gitDir: GIT_DIR,
    baseSha: BASE_SHA,
    commit: COMMIT,
    tree: TREE,
    writeScope: ["tests/**"],
    deps: { runGit, resolveWriteScope: makeResolver() }
  };
  expectCode(() => verifyAndMeasureCommitScope({ ...base, gitDir: "" }), CODES.INVALID_ARG);
  expectCode(() => verifyAndMeasureCommitScope({ ...base, writeScope: "tests/**" }), CODES.INVALID_ARG);
});

test("validation: an oid failure is raised BEFORE any git invocation (no gate diff on bad input)", () => {
  const { runGit, calls } = makeGit();
  expectCode(
    () =>
      verifyAndMeasureCommitScope({
        gitDir: GIT_DIR,
        baseSha: ZERO_OID,
        commit: COMMIT,
        tree: TREE,
        writeScope: ["tests/**"],
        deps: { runGit, resolveWriteScope: makeResolver() }
      }),
    CODES.INVALID_SHA
  );
  assert.equal(calls.length, 0, "argument validation fails closed before touching git");
});
