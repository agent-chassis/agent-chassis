import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import { generateOrchestratorGuidance, reconcileOrchestratorGuidance } from
  "../../packages/agent-launch-core/src/lib/orchestrator-guidance-generation.mjs";
import { resolveOrchestratorGuidancePair } from
  "../../packages/agent-launch-core/src/lib/agent-role-guides.mjs";

const paths = ["01/guide.md", "01/authoring-vignette.md", "02/guide.md", "02/authoring-vignette.md", "03/guide.md", "03/authoring-vignette.md", "04/guide.md", "04/authoring-vignette.md"]
  .map(file => `packages/agent-launch-core/data/role-guides/orchestrator/${file}`);
const guide = "common introduction\n<!-- tier:free_local -->\nordinary only\n<!-- /tier -->\n<!-- tier:paid_cce -->\ncompiled only\n<!-- /tier -->\ncommon close\n";
const vignette = guide.replace("introduction", "example");

test("generation returns exactly eight ordered neutral outputs with complete selected bytes", () => {
  const outputs = generateOrchestratorGuidance({ guideSource: guide, vignetteSource: vignette });
  assert.deepEqual([...outputs.keys()], paths);
  assert.deepEqual([...outputs.values()], [
    "common introduction\nordinary only\ncommon close\n", "common example\nordinary only\ncommon close\n",
    "common introduction\ncompiled only\ncommon close\n", "common example\ncompiled only\ncommon close\n",
    "common introduction\nordinary only\ncommon close\n", "common example\nordinary only\ncommon close\n",
    "common introduction\ncompiled only\ncommon close\n", "common example\ncompiled only\ncommon close\n"]);
  assert.deepEqual(generateOrchestratorGuidance({ guideSource: guide, vignetteSource: vignette }), outputs);
  for (const [file, bytes] of outputs) assert.doesNotMatch(file + bytes, /<!--|paid_cce|free_local/u);
  assert.deepEqual([...generateOrchestratorGuidance({ guideSource: "common\n\n", vignetteSource: "example" }).values()],
    Array(4).fill(["common\n", "example\n"]).flat());
});

test("vignette variants use evidence from their own authoring path and stay within the retry example", async () => {
  const [guideSource, vignetteSource] = await Promise.all([
    readFile(new URL("../../docs/orchestrator-guide-source.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/orchestrator-authoring-vignette-source.md", import.meta.url), "utf8")
  ]);
  const outputs = generateOrchestratorGuidance({ guideSource, vignetteSource });
  const ordinary = outputs.get(paths[1]);
  const controlled = outputs.get(paths[3]);
  const unpublished = outputs.get(paths[5]);
  assert.doesNotMatch(unpublished, /ordinary-exception-inputs|explicit-author-choice|"kind"\s*:\s*"controlled_acceptance"/u);
  assert.match(unpublished, /save-compilation-blocker/u);
  assert.equal(outputs.get(paths[7]), controlled);
  const delivery = text => text.split("## After delivery: inspect the assertions\n")[1]
    .split("## Repair an incomplete saved case")[0];

  assert.match(ordinary, /request:save-written save_record/u);
  assert.doesNotMatch(ordinary, /request:proof|"proof"\s*:|"falsification"\s*:/u);
  assert.match(delivery(ordinary), /saved validation file, `tests\/unit\/retry-config\.test\.mjs`/u);
  assert.match(delivery(ordinary), /regression file, `tests\/unit\/config-result\.test\.mjs`/u);
  assert.doesNotMatch(delivery(ordinary), /verify_proof|falsifier|selected tests/u);
  assert.match(controlled, /"proof"\s*:\s*\{"name"\s*:\s*"proof\.verification\.test-validity"\}/u);
  assert.match(delivery(controlled), /`verify_proof` reports both tests ran unskipped/u);
  assert.match(controlled, /A falsifier introduces a deliberate fault/u);
  assert.match(controlled, /Both tests call the reader and encounter the injected throw/u);
  assert.match(controlled, /importing alone would not/u);
  assert.doesNotMatch(controlled, /any test that loads it fail|breaks the reader module loaded/u);

  assert.match(ordinary, /Run the saved validation file, `tests\/unit\/retry-config.test.mjs`, and the selected regression file/u);
  assert.doesNotMatch(ordinary.split("```json unsent:dispatch")[0], /\. Run that regression and the saved validation/u);

  for (const text of [ordinary, controlled]) {
    assert.match(text, /[Tt]he user has selected (?:the|its) existing initiative `IN-0002`/u);
    assert.match(text, /"initiative"\s*:\s*"<initiative>"/u);
    assert.doesNotMatch(text, /\bMAY\b|MUST_NOT|number:returns|[Ss]et-valued|DataVar|StateChart|`State`/u);
    assert.match(text, /The inspected `negativeInput` means JavaScript number/u);
    assert.doesNotMatch(text, /[Aa]sk the user whether|numeric.string question|[Kk]eep numeric strings unresolved|open question with the user/u);
    assert.match(delivery(text), /R3 unverified until a zero assertion exists/u);
  }
});

test("every complete generated guide reads the vignette selected by its host profile", async () => {
  const [guideSource, vignetteSource] = await Promise.all([
    readFile(new URL("../../docs/orchestrator-guide-source.md", import.meta.url), "utf8"),
    readFile(new URL("../../docs/orchestrator-authoring-vignette-source.md", import.meta.url), "utf8")
  ]);
  const outputs = generateOrchestratorGuidance({ guideSource, vignetteSource });
  for (const registeredTier of ["free_local", "paid_cce"]) {
    for (const publishControlledAcceptanceOptOut of [true, false]) {
      const pair = resolveOrchestratorGuidancePair(registeredTier, publishControlledAcceptanceOptOut);
      const [guidePath, vignettePath] = pair.references;
      const text = outputs.get(guidePath);
      const references = [...text.matchAll(/`workspace_read_wiki\((\{[^\n]+\})\)`/gu)]
        .map(match => match[1]).filter(call => call.includes("authoring-vignette.md"));
      assert.deepEqual(references, [`{reference:{tool_name:"save_record",path:"${vignettePath}"}}`]);
      assert.ok(outputs.has(vignettePath));
      assert.doesNotMatch(text, /\{\{|<!--/u);
      assert.equal(await readFile(pair.guide, "utf8"), text, "checked-in guide matches generation");
      assert.equal(await readFile(pair.vignette, "utf8"), outputs.get(vignettePath));
      assert.equal(await readFile(new URL(`../../packages/core/docs/_refs/${guidePath}`, import.meta.url), "utf8"), text);
    }
  }
});

test("malformed templates publish no outputs and preserve every existing sentinel", async t => {
  const resources = createTestResourceScope();
  t.after(() => resources.dispose());
  const root = await resources.acquire("generation fixture", () => mkdtemp(path.join(os.tmpdir(), "guidance-")),
    directory => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs"));
  for (const file of paths) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), `sentinel:${file}`); }
  await writeFile(path.join(root, "docs/orchestrator-authoring-vignette-source.md"), vignette);
  const failures = [
    ["<!-- tier:free_local -->\n<!-- tier:paid_cce -->", "nested tier block"],
    ["<!-- publication:controlled-acceptance-opt-out -->", "unclosed publication block"],
    ["<!-- /publication -->", "unmatched publication marker"],
    ["<!-- publication:controlled-acceptance-opt-out -->\n<!-- publication:controlled-acceptance-opt-out -->", "nested publication block"],
    ["<!-- tier:unknown -->", "unknown tier block"], ["<!-- /tier -->", "unmatched closing tier marker"],
    ["<!-- tier:free_local -->\ntext", "unclosed tier block"],
    ["text <!-- tier:free_local -->", "marker must occupy one complete line with exact syntax"],
    ["<!-- tier: free_local -->", "marker must occupy one complete line with exact syntax"],
    ["<!-- / tier -->", "marker must occupy one complete line with exact syntax"],
    ["<!-- Tier:free_local -->", "marker must occupy one complete line with exact syntax"], ["", "template is empty or not text"],
    ["<!-- tier:free_local -->\n<!-- /tier -->", "selected document is empty"]
  ];
  for (const [source, cause] of failures) {
    await writeFile(path.join(root, "docs/orchestrator-guide-source.md"), source);
    await assert.rejects(reconcileOrchestratorGuidance({ repoRoot: root, check: false }), error =>
      error.code === "orchestrator_guidance_template_invalid" && error.cause === cause);
    assert.deepEqual(await Promise.all(paths.map(file => readFile(path.join(root, file), "utf8"))), paths.map(file => `sentinel:${file}`));
  }
  await writeFile(path.join(root, "docs/orchestrator-guide-source.md"), guide);
  await assert.rejects(reconcileOrchestratorGuidance({ repoRoot: root }), { code: "orchestrator_guidance_output_mismatch" });
  await reconcileOrchestratorGuidance({ repoRoot: root, check: false });
  assert.deepEqual(await reconcileOrchestratorGuidance({ repoRoot: root }), generateOrchestratorGuidance({ guideSource: guide, vignetteSource: vignette }));
  await writeFile(path.join(root, path.dirname(paths[0]), "unexpected.md"), "extra");
  await assert.rejects(reconcileOrchestratorGuidance({ repoRoot: root, check: false }), error =>
    error.code === "orchestrator_guidance_output_mismatch" && error.differences.some(row => row.state === "extra"));
});
