

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";

import { collectOccupiedAllocatedRecordValues, nextId } from "../../packages/wiki-core/src/lib/wiki-allocator.mjs";
import { loadManifest } from "../../packages/wiki-core/src/lib/contract.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import { bootstrapRepo } from "../../packages/wiki-core/src/operations/bootstrap.mjs";
import { createWikiRecord } from "../../packages/wiki-core/src/operations/create.mjs";
import {
  loadKindRecordById,
  getKindRecordPath
} from "../../packages/wiki-core/src/lib/kind-record-store.mjs";
import { validateRecordByKind } from "../../packages/wiki-core/src/lib/work-record-kind-registry.mjs";
import { renderRecordByKindMarkdown } from "../../packages/wiki-core/src/lib/work-record-kind-renderer.mjs";

async function withTempRepo(fn) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-wk-1449-slice-037-"));
  try {
    await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function assertBornKindRecord({ repoRoot, created, kind, prefix }) {

  assert.equal(typeof created.id, "string");
  assert.ok(created.id.startsWith(`${prefix}-`), `expected an allocator-minted ${prefix}- id`);

  const relativeJsonPath = await getKindRecordPath(kind, created.id);
  assert.equal(created.jsonRelativeFile, relativeJsonPath);
  const relativeMarkdownPath = relativeJsonPath.replace(/\.json$/, ".md");
  const absoluteJsonPath = path.resolve(repoRoot, relativeJsonPath);
  const absoluteMarkdownPath = path.resolve(repoRoot, relativeMarkdownPath);

  assert.ok(await pathExists(absoluteJsonPath), `${kind} .json must be born`);
  assert.ok(await pathExists(absoluteMarkdownPath), `${kind} .md must be regenerated in lockstep`);

  const onDiskJson = JSON.parse(await readFile(absoluteJsonPath, "utf8"));
  assert.equal(onDiskJson.id, created.id);
  assert.equal(onDiskJson.record_kind, kind);

  const diagnostics = validateRecordByKind(onDiskJson);
  assert.deepEqual(
    diagnostics.filter((entry) => entry.severity === "error"),
    [],
    `a born ${kind} must validate against its kind spec`
  );

  const projection = renderRecordByKindMarkdown(onDiskJson);
  assert.equal(projection.valid, true);
  const onDiskMarkdown = await readFile(absoluteMarkdownPath, "utf8");
  assert.equal(onDiskMarkdown, projection.markdown, `${kind} .md must match the projector`);

  assert.equal(typeof onDiskJson.updated, "string");
  assert.ok(onDiskJson.updated.length > 0, "updated must be stamped");
  assert.equal(typeof onDiskJson.updated_by, "string");
  assert.ok(onDiskJson.updated_by.length > 0, "updated_by provenance must be stamped");

  const loaded = await loadKindRecordById({ repoRoot, id: created.id });
  assert.equal(loaded.valid, true);
  assert.deepEqual(loaded.diagnostics, []);
  assert.equal(loaded.record_id, created.id);
  assert.deepEqual(loaded.record, onDiskJson);

  return onDiskJson;
}

test("createWikiRecord births a DEC as canonical proposed JSON with .md and provenance in lockstep", async () => {
  await withTempRepo(async (repoRoot) => {
    await bootstrapRepo({ dir: repoRoot, repo: "agent-chassis/wk1449-slice037-dec-demo" });

    const created = await createWikiRecord({
      dir: repoRoot,
      type: "decision",
      title: "Adopt the JSON birth path"
    });

    const record = await assertBornKindRecord({
      repoRoot,
      created,
      kind: "decision",
      prefix: "DEC"
    });

    assert.equal(record.status, "proposed");
    assert.equal(record.title, "Adopt the JSON birth path");
    assert.equal(typeof record.date, "string");
    assert.ok(Array.isArray(record.owners));
  });
});

test("createWikiRecord births an IN as a canonical draft JSON with .md and provenance in lockstep", async () => {
  await withTempRepo(async (repoRoot) => {
    await bootstrapRepo({ dir: repoRoot, repo: "agent-chassis/wk1449-slice037-in-demo" });

    const created = await createWikiRecord({
      dir: repoRoot,
      type: "initiative",
      title: "Track the JSON authority rollout"
    });

    const record = await assertBornKindRecord({
      repoRoot,
      created,
      kind: "initiative",
      prefix: "IN"
    });

    assert.equal(record.title, "Track the JSON authority rollout");
    assert.equal(typeof record.status, "string");
    assert.ok(record.status.length > 0);
    assert.equal(typeof record.priority, "string");
    assert.equal(typeof record.owner, "string");
    assert.equal(typeof record.created, "string");
    assert.equal(record.updated, record.created);
  });
});

test("kind allocation skips canonical JSON without projections", async t => {
  for (const kind of ['decision', 'initiative']) for (const initialize of [false, true]) {
    await t.test(`${kind}: initialize ${initialize}`, async t => {
      const resources = createTestResourceScope();
      t.after(() => resources.dispose());
      const repoRoot = await resources.acquire('allocator repository', () => mkdtemp(path.join(os.tmpdir(), 'kind-allocation-')),
        root => rm(root, { recursive: true, force: true }));
      await bootstrapRepo({ dir: repoRoot, repo: 'test/kind-allocation' });
      const first = await createWikiRecord({ dir: repoRoot, type: kind, title: 'JSON authority' });
      const json = first.absoluteFile, markdown = json.replace(/\.json$/u, '.md');
      const before = await readFile(json);
      await unlink(markdown);
      if (initialize) await unlink(path.join(repoRoot, 'wiki/.id-state.json'));
      else {
        const file = path.join(repoRoot, 'wiki/.id-state.json');
        const state = JSON.parse(await readFile(file)); state[kind] = 0;
        await writeFile(file, JSON.stringify(state));
      }
      const second = await createWikiRecord({ dir: repoRoot, type: kind, title: 'Distinct next identity' });
      assert.notEqual(second.id, first.id);
      assert.deepEqual(await readFile(json), before);
      const reserved = await nextId(repoRoot, kind, await loadManifest(), { reserve: true });
      assert.equal((await createWikiRecord({ dir: repoRoot, type: kind, title: 'Reserved identity' })).id, reserved);
      const gapId = `${first.id.split('-')[0]}-${String(Number(reserved.split('-')[1]) + 1).padStart(4, '0')}`;
      const orphan = path.join(path.dirname(json), `${gapId}.md`);
      await writeFile(orphan, 'Projection alone is not canonical');
      assert.equal((await collectOccupiedAllocatedRecordValues(repoRoot, (await loadManifest()).types[kind])).has(Number(gapId.split('-')[1])), false);
      await unlink(orphan);
      const next = await createWikiRecord({ dir: repoRoot, type: kind, title: 'Projection-independent identity' });
      assert.equal(next.id, gapId);
      assert.deepEqual(await readFile(json), before);
    });
  }
});
