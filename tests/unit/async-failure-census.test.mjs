

import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { allocateRetainedArtifact } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { injectFilesystemFault } from "../helpers/filesystem-fault.mjs";
import { createTestFixture } from "../helpers/test-fixture.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_REL = "tests/fixtures/async-failure-census.v1.json";

const fixture = JSON.parse(await readFile(path.join(REPO, FIXTURE_REL), "utf8"));

const MECHANISM_START = "export function createEvictOnRejectionMemo(load) {";
const MECHANISM_SPAN = 6;

const DETECTORS = Object.freeze({
  poisoned_memoized_promises:
    /^\s*const\s+\w+\s*=\s*createEvictOnRejectionMemo(?:Store)?\(|\w*[Pp]romise\w*\s*\?\?=/u,
  finally_block_masking: /\}\s*finally\s*\{/u,
  detached_promises: /^\s*void\s+\w|^\s*[\w.]+\.(?:catch|then|finally)\(/u,
  stream_error_listeners:
    /\b(?:on|once)\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?["']error["']/u,
  process_guards: /\.on\(\s*["'](?:uncaughtException|unhandledRejection)["']/u
});

const sources = new Map();
for (const rel of fixture.corpus) {
  sources.set(rel, await readFile(path.join(REPO, rel), "utf8"));
}

function executableLines(rel) {
  const lines = sources.get(rel).split("\n");
  const skip = new Set();
  lines.forEach((line, index) => {
    if (!line.startsWith(MECHANISM_START)) return;
    for (let offset = 0; offset < MECHANISM_SPAN; offset += 1) skip.add(index + offset);
  });
  return lines.flatMap((line, index) => {
    if (skip.has(index)) return [];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return [];
    return [{ line: index + 1, raw: line, trimmed }];
  });
}

function deriveSites(population) {
  const detector = DETECTORS[population];
  const derived = [];
  for (const rel of fixture.corpus) {
    const seen = new Map();
    for (const { raw, trimmed, line } of executableLines(rel)) {
      if (!detector.test(raw)) continue;
      const occurrence = (seen.get(trimmed) ?? 0) + 1;
      seen.set(trimmed, occurrence);
      derived.push({ module: rel, anchor: trimmed, occurrence, line });
    }
  }
  return derived;
}

function identity({ module, anchor, occurrence }) {
  return `${module}\u0000${anchor}\u0000${occurrence}`;
}

test("the census covers exactly the five populations over exactly the bounded corpus", () => {
  assert.equal(fixture.schema_version, "async-failure-census.v1");
  assert.deepEqual(Object.keys(fixture.populations).sort(), [
    "detached_promises",
    "finally_block_masking",
    "poisoned_memoized_promises",
    "process_guards",
    "stream_error_listeners"
  ]);
  assert.deepEqual(Object.keys(fixture.populations).sort(), Object.keys(DETECTORS).sort(),
    "every declared population has a detector and vice versa");
  assert.deepEqual([...fixture.corpus].sort(), [
    "packages/wiki-core/src/operations/controlled-contract/package-runtime.mjs",
    "packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs",
    "packages/controlled-contract/lib/compiled-validator-cache.mjs",
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store.mjs",
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store-io.mjs",
    "packages/wiki-core/src/lib/wiki-allocator.mjs",
    "packages/wiki-mcp/src/lib/mcp-response.mjs",
    "packages/wiki-mcp/src/lib/mcp-response-diagnostics.mjs",
    "packages/agent-launch-cli/src/lib/launch-isolation-spawn.mjs"
  ].sort(), "the exact bounded owners include both halves of the response extraction");
  assert.equal(new Set(fixture.corpus).size, fixture.corpus.length, "the corpus has no duplicates");
});

for (const population of Object.keys(DETECTORS)) {
  test(`${population}: every derived source site resolves to exactly one census row`, () => {
    const derived = deriveSites(population);
    const recorded = fixture.populations[population].sites;

    const derivedIds = derived.map(identity);
    const recordedIds = recorded.map(identity);

    assert.equal(new Set(derivedIds).size, derivedIds.length,
      "site identity is unique per derived site");
    assert.equal(new Set(recordedIds).size, recordedIds.length,
      "the fixture records no duplicate site identity");

    const undisposed = derivedIds.filter((id) => !recordedIds.includes(id));
    assert.deepEqual(undisposed.map((id) => id.split("\u0000").join(" :: ")), [],
      "a source site exists with no census disposition");

    const stale = recordedIds.filter((id) => !derivedIds.includes(id));
    assert.deepEqual(stale.map((id) => id.split("\u0000").join(" :: ")), [],
      "the census records a site that no longer exists in the integrated source");

    assert.equal(recorded.length,
      fixture.denominators.retained_sites_by_population[population],
      "the reported denominator matches the recorded rows");
  });
}

test("every recorded site names a declared disposition and a real owner module", () => {
  const declared = new Set(Object.keys(fixture.dispositions));
  for (const [population, entry] of Object.entries(fixture.populations)) {
    assert.equal(typeof entry.retained_owner, "string");
    assert.equal(entry.retained_owner.length > 0, true);
    for (const row of entry.sites) {
      assert.equal(declared.has(row.disposition), true,
        `${population} site ${row.symbol} uses an undeclared disposition ${row.disposition}`);
      assert.equal(fixture.corpus.includes(row.module), true,
        `${population} site ${row.symbol} names a module outside the bounded corpus`);
      assert.equal(typeof row.rationale, "string");
      assert.equal(row.rationale.length > 0, true, `${row.symbol} carries no rationale`);
    }
  }
});

test("the reported denominators are exact", () => {
  const totals = Object.fromEntries(Object.entries(fixture.populations)
    .map(([name, entry]) => [name, entry.sites.length]));
  assert.deepEqual(fixture.denominators.retained_sites_by_population, totals);
  assert.equal(fixture.denominators.retained_sites_total,
    Object.values(totals).reduce((sum, count) => sum + count, 0));
  assert.equal(fixture.denominators.populations, Object.keys(fixture.populations).length);
  assert.equal(fixture.denominators.corpus_modules, fixture.corpus.length);

  const removed = Object.values(fixture.populations)
    .flatMap((entry) => entry.removed_copies)
    .reduce((sum, copy) => sum + (copy.count ?? 1), 0);
  assert.equal(fixture.denominators.removed_copies_total, removed);
});

test("every removed copy is genuinely gone from the integrated source", async () => {
  const gone = [
    [
      "packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs",
      ["controlledContractPackagePromise", "generationEvaluationInputValidatorPromise",
        "CONTROLLED_CONTRACT_VALIDATOR_CACHE_SPECIFIER"]
    ],
    [
      "packages/controlled-contract/lib/validator-population.mjs",
      ["wiki-core.controlled-contract-tool-shared.evaluation-input.v1"]
    ],
    [
      "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store.mjs",
      ["acquireStoreLock", "await release();"]
    ],
    [
      "packages/wiki-mcp/src/lib/mcp-response.mjs",
      ["keeping server process alive"]
    ]
  ];
  for (const [rel, needles] of gone) {
    const source = sources.get(rel) ?? await readFile(path.join(REPO, rel), "utf8");
    for (const needle of needles) {
      assert.equal(source.includes(needle), false,
        `${rel} still carries the collapsed copy ${needle}`);
    }
  }
});

test("a collapsed copy is not counted as an independent site", () => {

  const storeRel =
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store.mjs";
  const storeSites = deriveSites("finally_block_masking")
    .filter((site) => site.module === storeRel);
  assert.deepEqual(storeSites, [],
    "the collapsed call sites must contribute no denominator members");

  const record = fixture.populations.finally_block_masking.removed_copies
    .find((copy) => copy.module === storeRel);
  assert.equal(record.count, 17, "the collapse is recorded with its exact multiplicity");
  assert.equal(
    fixture.populations.finally_block_masking.sites.some((site) => site.module === storeRel),
    false
  );
});

const TEST_NAME_RE = /^test\(\s*(?:"([^"]+)"|'([^']+)')/gmu;

async function testNamesIn(rel) {
  const source = await readFile(path.join(REPO, rel), "utf8");
  const names = new Set();
  for (const match of source.matchAll(TEST_NAME_RE)) names.add(match[1] ?? match[2]);
  return names;
}

test("every retained site names one executable behavioral witness that exists", async () => {
  const rows = Object.values(fixture.populations).flatMap((entry) => entry.sites);
  const byFile = new Map();
  for (const row of rows) {
    assert.equal(typeof row.witness, "string", `${row.symbol} names no witness`);
    const [file, name] = row.witness.split("::");
    assert.equal(typeof name, "string",
      `${row.symbol} witness must be "<test file>::<test name>"`);
    if (!byFile.has(file)) byFile.set(file, await testNamesIn(file));
    assert.equal(byFile.get(file).has(name), true,
      `${row.symbol} names witness "${name}" which does not exist in ${file}`);
  }
  assert.equal(rows.length, fixture.denominators.retained_sites_total);
});

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

async function isRetryable(makeMemo) {
  let attempts = 0;
  const memo = makeMemo(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("transient");
    return "recovered";
  });
  await rejectionOf(memo());
  const second = await rejectionOf(memo());
  return second === null && attempts === 2;
}

async function keepsPrimary(run) {
  const primary = new Error("primary");
  primary.code = "primary_code";
  const ran = [];
  const thrown = await rejectionOf(run({
    body: () => { throw primary; },
    steps: [
      { name: "first", fail: true },
      { name: "second", fail: false }
    ],
    ran
  }));
  return thrown === primary && thrown.code === "primary_code" &&
    ran.join(",") === "first,second";
}

function isSettlementClosed({ observed, logOnly }) {
  return observed === true && logOnly !== true;
}

test("a suppression whose identical rejection is awaited elsewhere is closed", async () => {

  const failure = new Error("group failed");
  const resolved = Promise.reject(failure);
  resolved.catch(() => {});

  let observed = false;
  const seen = await rejectionOf(resolved.then((value) => value));
  observed = seen === failure;

  assert.equal(isSettlementClosed({ observed, logOnly: false }), true);
  assert.equal(seen, failure, "the identical rejection reached the awaiting owner");
});

test("an ENOENT-only catch that rethrows every other failure is closed", async () => {
  const read = async (code) => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
  const enoentOnly = async (code) => {
    try {
      return await read(code);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };

  assert.equal(await enoentOnly("ENOENT"), null, "absence is the suppressed case");
  const other = await rejectionOf(enoentOnly("EACCES"));
  assert.notEqual(other, null, "every other failure is rethrown");
  assert.equal(other.code, "EACCES");
});

test("a suppressed cleanup failure cannot replace the primary", async () => {

  const primary = new Error("publication failed");
  const thrown = await rejectionOf((async () => {
    try {
      throw primary;
    } finally {
      await Promise.reject(new Error("cleanup failed")).catch(() => {});
    }
  })());
  assert.equal(thrown, primary);
});

test("a cleanup with no rejection path cannot replace the primary", async () => {

  const primary = new Error("generation failed");
  primary.code = "validator_cache_generation_failed";
  const thrown = await rejectionOf((async () => {
    try {
      throw primary;
    } finally {
      await Promise.resolve(0);
    }
  })());
  assert.equal(thrown, primary);
  assert.equal(thrown.code, "validator_cache_generation_failed");
});

test("a synchronous cleanup cannot replace the primary", async () => {

  let sink = "set";
  const primary = new Error("population failed");
  const thrown = await rejectionOf((async () => {
    try {
      throw primary;
    } finally {
      sink = null;
    }
  })());
  assert.equal(thrown, primary);
  assert.equal(sink, null, "the cleanup still ran");
});

test("an inner-caught cleanup failure cannot replace the primary", async () => {

  const primary = new Error("read failed");
  const thrown = await rejectionOf((async () => {
    try {
      throw primary;
    } finally {
      try {
        throw new Error("close failed");
      } catch {

      }
    }
  })());
  assert.equal(thrown, primary);
});

test("a static-specifier import failure is retained by the loader, not by the local memo",
  async (t) => {

    const dir = await mkdtemp(path.join(os.tmpdir(), "wk2382-esm-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const target = path.join(dir, "fails-to-evaluate.mjs");
    await writeFile(target, 'throw new Error("module evaluation failed");\n', "utf8");

    const first = await rejectionOf(import(target));
    const second = await rejectionOf(import(target));
    assert.notEqual(first, null);
    assert.equal(second, first,
      "the loader returns the identical retained error, so eviction above it is inert");

    let attempts = 0;
    const owned = (() => {
      let pending = null;
      return () => {
        if (pending !== null) return pending;
        const attempt = Promise.resolve().then(async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient");
          return "recovered";
        });
        pending = attempt.catch((error) => { pending = null; throw error; });
        return pending;
      };
    })();
    await rejectionOf(owned());
    assert.equal(await owned(), "recovered");
    assert.equal(attempts, 2);

    const rows = fixture.populations.poisoned_memoized_promises.sites
      .filter((site) => site.disposition === "accepted_static_module_map_memo");
    assert.equal(rows.length, 3, "exactly the three accepted static-module-map loaders");
    assert.equal(rows.every((site) => site.module.endsWith("controlled-contract-tool-shared.mjs")),
      true);
  });

test("the accepted sites are not counted as eviction-owner sites", () => {
  const memo = fixture.populations.poisoned_memoized_promises;
  const accepted = memo.sites.filter((s) => s.disposition === "accepted_static_module_map_memo");
  const owned = memo.sites.filter((s) => s.disposition === "evict_on_rejection_owned");

  assert.equal(accepted.length, 3);
  assert.equal(owned.length, 12);
  assert.equal(accepted.length + owned.length, memo.sites.length,
    "the memo population is exactly the owned sites plus the accepted ones");
  assert.equal(memo.accepted_non_remediated.count, accepted.length);
  assert.equal(memo.accepted_non_remediated.disposition, "accepted_static_module_map_memo");
  assert.equal(fixture.denominators.accepted_non_remediated_total, 3);

  for (const site of accepted) assert.match(site.anchor, /\?\?= import\(/u);
  for (const site of owned) assert.match(site.anchor, /createEvictOnRejectionMemo/u);
});

test("the recorded allocator residual is a real masking site, not a closed one", async () => {

  const primary = new Error("rename failed");
  primary.code = "rename_failed";
  const thrown = await rejectionOf((async () => {
    try {
      throw primary;
    } finally {
      throw new Error("temp cleanup failed");
    }
  })());
  assert.notEqual(thrown, primary, "the sequential finally shape does mask");
  assert.equal(thrown.message, "temp cleanup failed");

  const row = fixture.populations.finally_block_masking.sites
    .find((site) => site.symbol === "writeAllocatorStateAtomically");
  assert.equal(row.disposition, "masking_capable_recorded_residual",
    "the census must not record this site as closed");
});

test("retained artifact cleanup can mask publication failure and remains an open residual", async (t) => {
  const owned = await createTestFixture({ prefix: "retained-allocator-census-" });
  t.after(() => owned.dispose());
  const { rootPath: stateDir } = owned;
  const originalLink = fs.linkSync;
  const publicationFailure = new Error("injected metadata publication failure");
  let mode = "healthy";
  let cleanupFault = null;
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(fs, "linkSync", (pending, metadata) => {
    if (path.dirname(pending) !== stateDir || path.dirname(metadata) !== stateDir) {
      return originalLink(pending, metadata);
    }
    if (mode === "cleanup" || mode === "both") {
      cleanupFault = injectFilesystemFault(t, { operation: "unlinkSync", path: pending });
    }
    if (mode === "publication" || mode === "both") throw publicationFailure;
    return originalLink(pending, metadata);
  });
  syncBuiltinESMExports();
  const allocate = (refId) => allocateRetainedArtifact({ stateDir, bytes: Buffer.from("payload"),
    metadataFor: (id) => ({ ref_id: id }), mintRefId: () => refId });
  try {
    assert.equal(allocate("healthy1"), "healthy1");
    assert.deepEqual(fs.readdirSync(stateDir).filter(file => file.endsWith(".pending")), []);
    mode = "publication";
    assert.throws(() => allocate("primary1"), error => error === publicationFailure,
      "successful cleanup preserves the exact publication failure");
    assert.equal(fs.existsSync(path.join(stateDir, "primary1.json.meta.json")), false);
    assert.deepEqual(fs.readdirSync(stateDir).filter(file => file.endsWith(".pending")), []);
    mode = "cleanup";
    assert.throws(() => allocate("cleanup1"), error => error === cleanupFault.error);
    assert.equal(cleanupFault.hits, 1);
    assert.equal(fs.existsSync(path.join(stateDir, "cleanup1.json.meta.json")), true,
      "cleanup can fail after metadata was published");
    cleanupFault.restore();
    mode = "both";
    assert.throws(() => allocate("bothfail"), error => error === cleanupFault.error && error !== publicationFailure,
      "the real allocator's cleanup masks the original publication failure");
    assert.equal(cleanupFault.hits, 1);
    assert.equal(fs.existsSync(path.join(stateDir, "bothfail.json.meta.json")), false);
    const row = fixture.populations.finally_block_masking.sites
      .find(site => site.symbol === "allocateRetainedArtifact:pending_metadata");
    assert.equal(row.disposition, "masking_capable_recorded_residual");
    assert.equal(fixture.populations.finally_block_masking.residuals.some(residual =>
      residual.symbol === row.symbol && residual.module === row.module), true);
  } finally {
    cleanupFault?.restore();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("a permanently cached rejection fails the retryability adjudicator", async () => {
  const poisoned = (load) => {
    let promise = null;
    return () => {
      promise ??= load();
      return promise;
    };
  };
  const evicting = (load) => {
    let pending = null;
    return () => {
      if (pending !== null) return pending;
      const attempt = Promise.resolve().then(load);
      pending = attempt.catch((error) => { pending = null; throw error; });
      return pending;
    };
  };

  assert.equal(await isRetryable(poisoned), false,
    "a ??= memo replays its rejection and never re-executes");
  assert.equal(await isRetryable(evicting), true,
    "the evicting shape re-executes on the next authorized attempt");
});

test("cleanup masking fails the precedence adjudicator", async () => {
  const masking = async ({ body, steps, ran }) => {
    try {
      return await body();
    } finally {

      for (const step of steps) {
        ran.push(step.name);
        if (step.fail) throw new Error(`${step.name} failed`);
      }
    }
  };
  const precedent = async ({ body, steps, ran }) => {
    let primary = null;
    let hasPrimary = false;
    try {
      await body();
    } catch (error) {
      primary = error;
      hasPrimary = true;
    }
    const failures = [];
    for (const step of steps) {
      ran.push(step.name);
      if (step.fail) failures.push(new Error(`${step.name} failed`));
    }
    if (hasPrimary) {
      primary.cleanup_failures = failures;
      throw primary;
    }
    if (failures.length > 0) throw failures[0];
    return undefined;
  };

  assert.equal(await keepsPrimary(masking), false,
    "the masking shape replaces the primary and skips the remaining step");
  assert.equal(await keepsPrimary(precedent), true,
    "the precedence owner keeps the primary and runs every step");
});

test("log-only settlement fails the closure adjudicator", () => {
  const logs = [];
  const logOnly = { observed: true, logOnly: true };
  logs.push("wiki-mcp process-level error caught");
  assert.equal(isSettlementClosed(logOnly), false,
    "a rejection that only reaches a log is not settled");
  assert.equal(isSettlementClosed({ observed: true, logOnly: false }), true);
});

test("unowned detachment fails the closure adjudicator", async () => {

  const orphan = Promise.reject(new Error("no owner"));
  let observed = false;
  orphan.catch(() => {});
  assert.equal(isSettlementClosed({ observed, logOnly: false }), false);

  const owned = Promise.reject(new Error("has an owner"));
  owned.catch(() => {});
  observed = (await rejectionOf(owned.then((value) => value))) !== null;
  assert.equal(isSettlementClosed({ observed, logOnly: false }), true);
});

test("source shape alone decides nothing: identical syntax lands on both verdicts", async () => {

  const closedPromise = Promise.reject(new Error("observed"));
  closedPromise.catch(() => {});
  const closed = isSettlementClosed({
    observed: (await rejectionOf(closedPromise.then((value) => value))) !== null,
    logOnly: false
  });

  const openPromise = Promise.reject(new Error("unobserved"));
  openPromise.catch(() => {});
  const open = isSettlementClosed({ observed: false, logOnly: false });

  assert.equal(closed, true);
  assert.equal(open, false);
  assert.notEqual(closed, open, "the discriminator is semantic, not syntactic");
});

test("the census reconciles with what SLICE-003, SLICE-004, and SLICE-005 delivered", () => {
  const memo = fixture.populations.poisoned_memoized_promises;
  assert.equal(memo.retained_owner,
    "packages/controlled-contract/lib/compiled-validator-cache.mjs#createEvictOnRejectionMemo");

  assert.equal(
    memo.sites.every((site) => ["evict_on_rejection_owned",
      "accepted_static_module_map_memo"].includes(site.disposition)),
    true);
  assert.equal(
    memo.sites.filter((site) => site.disposition === "evict_on_rejection_owned").length, 12,
    "SLICE-003 leaves every owner-retained memo on the one settlement owner");

  const cleanup = fixture.populations.finally_block_masking;
  assert.equal(cleanup.retained_owner.includes("withStoreLock"), true);
  assert.equal(cleanup.retained_owner.includes("withAllocatorLock"), true);

  const guards = fixture.populations.process_guards;
  assert.equal(guards.sites.length, 2, "exactly the two process-level invariant escapes");
  assert.equal(guards.sites.every((site) => site.disposition === "fail_stop_owned"), true,
    "SLICE-005 leaves no log-only process guard");
  assert.equal(guards.retained_owner.includes("packages/wiki-mcp/src/server.mjs"), true,
    "the guards are composed at the single production composition root");
});

test("WK-2361's scope is not entered: the corpus stays closed after the owner extraction", () => {

  for (const entry of Object.values(fixture.populations)) {
    for (const row of entry.sites) {
      assert.equal(fixture.corpus.includes(row.module), true);
    }
  }
  assert.match(fixture.boundary, /WK-2361/u);

  assert.match(fixture.boundary, /CONSUMES and RECONCILES/u);
  assert.match(fixture.boundary, /does not own remediation/u);
  assert.match(fixture.boundary, /coordinator\s+closeout work/u);

  const residual = fixture.populations.finally_block_masking.residuals[0];
  assert.equal(residual.symbol, "writeAllocatorStateAtomically");
  assert.match(residual.remediation_owner, /coordinator closeout/u);
  assert.match(residual.not_owned_by, /WK-2361/u);
  assert.equal(fixture.denominators.open_residuals_total, 2);
  assert.equal(fixture.populations.finally_block_masking.residuals.length, 2);
  assert.equal(fixture.corpus.length, fixture.denominators.corpus_modules);
});
