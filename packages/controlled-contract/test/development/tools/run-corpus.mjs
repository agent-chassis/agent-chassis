#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_SCHEMA,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract,
  segmentCriterion
} from "../../legacy/versions/controlled-contract-general-v033.mjs";
import { invokeVertex } from "../../legacy/vertex.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../../..");
const DEFAULT_RECORDS_DIR = path.join(REPO_ROOT, "wiki/work-records");
const RUN_SCHEMA_VERSION = "controlled-contract-general-corpus-run.experimental.v0.33";
const ROW_SCHEMA_VERSION = "controlled-contract-general-corpus-row.experimental.v0.33";

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/run-corpus.mjs \\
    --project <gcp-project> --from <WK-N|N> --to <WK-N|N> [options]

Selection:
  --units <parent|slices|all>       Default: slices.
  --surface <criteria|validation|both>  Default: criteria.
  --work-kind <kind>               Repeatable exact work_kind filter.
  --limit <N>                      Default: 0 (all selected criteria).
  --sample <spread|first>          Default: spread when limit is nonzero.

Generation:
  --model <name>                   Default: gemini-3.6-flash.
  --location <name>                Default: global.
  --repetitions <N>                Independent generations per criterion. Default: 1.
                                   Use repeats only for a curated diagnostic subset.
  --concurrency <N>                Default: 12; maximum: 32.
  --progress-every <N>             Emit one progress line per N attempts. Default: 25.

Output:
  --output-dir <path>              Default: timestamped controlled-contract-runs directory.
  --records-dir <path>             Default: wiki/work-records.
  --dry-run                        Select and bind without invoking Vertex.
  --no-resume                      Refuse an existing ledger instead of resuming it.
  --help                           Show this help.

The model receives only "Repeat this acceptance criterion:" plus the criterion.
The dynamically bound JSON Schema is the grammar. Every independent generation
is preserved as one ledger row; no retries or model-authored diagnosis occur.`;
}

function integer(value, flag, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^[0-9]+$/.test(value ?? "")) throw new Error(`${flag} must be an integer`);
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) throw new Error(`${flag} must be between ${min} and ${max}`);
  return parsed;
}

function wkNumber(value, flag) {
  const match = /^(?:WK-)?([0-9]+)$/i.exec(value ?? "");
  if (!match) throw new Error(`${flag} must look like 1850 or WK-1850`);
  return integer(match[1], flag, { min: 1 });
}

function parseArgs(argv) {
  const options = {
    project: null,
    from: null,
    to: null,
    units: "slices",
    surface: "criteria",
    workKinds: [],
    limit: 0,
    sample: "spread",
    model: "gemini-3.6-flash",
    location: "global",
    repetitions: 1,
    concurrency: 12,
    progressEvery: 25,
    outputDir: null,
    recordsDir: DEFAULT_RECORDS_DIR,
    dryRun: false,
    resume: true,
    help: false
  };
  const valueAfter = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag === "--no-resume") {
      options.resume = false;
      continue;
    }
    const value = valueAfter(index, flag);
    index += 1;
    switch (flag) {
      case "--project": options.project = value; break;
      case "--from": options.from = wkNumber(value, flag); break;
      case "--to": options.to = wkNumber(value, flag); break;
      case "--units": options.units = value; break;
      case "--surface": options.surface = value; break;
      case "--work-kind": options.workKinds.push(value); break;
      case "--limit": options.limit = integer(value, flag); break;
      case "--sample": options.sample = value; break;
      case "--model": options.model = value; break;
      case "--location": options.location = value; break;
      case "--repetitions": options.repetitions = integer(value, flag, { min: 1, max: 20 }); break;
      case "--concurrency": options.concurrency = integer(value, flag, { min: 1, max: 32 }); break;
      case "--progress-every": options.progressEvery = integer(value, flag, { min: 1 }); break;
      case "--output-dir": options.outputDir = path.resolve(value); break;
      case "--records-dir": options.recordsDir = path.resolve(value); break;
      default: throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (options.help) return options;
  if (options.from === null || options.to === null) throw new Error("--from and --to are required");
  if (options.from > options.to) throw new Error("--from must not be greater than --to");
  if (!options.dryRun && options.project === null) throw new Error("--project is required unless --dry-run is used");
  if (!new Set(["parent", "slices", "all"]).has(options.units)) {
    throw new Error("--units must be parent, slices, or all");
  }
  if (!new Set(["criteria", "validation", "both"]).has(options.surface)) {
    throw new Error("--surface must be criteria, validation, or both");
  }
  if (!new Set(["spread", "first"]).has(options.sample)) {
    throw new Error("--sample must be spread or first");
  }
  if (options.outputDir === null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    options.outputDir = path.join(
      REPO_ROOT,
      "internal/scratch/controlled-contract-runs",
      `general-corpus-v033-${stamp}-WK-${String(options.from).padStart(4, "0")}-WK-${String(options.to).padStart(4, "0")}`
    );
  }
  return options;
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const wkId = (number) => `WK-${String(number).padStart(4, "0")}`;
const timestamp = () => new Date().toISOString();

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function criterionText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.text === "string") {
    return entry.text;
  }
  return null;
}

function surfaces(selection) {
  return selection === "both" ? ["criteria", "validation"] : [selection];
}

function addUnitCriteria(items, record, unit, unitKind, options) {
  const unitId = unitKind === "parent" ? record.id : `${record.id}#${unit.id}`;
  const workKind = unit.work_kind ?? record.work_kind ?? null;
  if (options.workKinds.length > 0 && !options.workKinds.includes(workKind)) return;
  for (const surface of surfaces(options.surface)) {
    const entries = Array.isArray(unit.acceptance?.[surface]) ? unit.acceptance[surface] : [];
    for (const [index, entry] of entries.entries()) {
      const sourceText = criterionText(entry);
      if (sourceText === null || sourceText.trim() === "") continue;
      items.push({
        sourceCriterionId: `${unitId}:${surface}:${String(index + 1).padStart(4, "0")}`,
        sourceText,
        wkId: record.id,
        unitId,
        unitKind,
        workKind,
        surface,
        unit
      });
    }
  }
}

async function loadCorpus(options) {
  const items = [];
  const recordsFound = [];
  const recordsMissing = [];
  const recordsInvalid = [];
  for (let number = options.from; number <= options.to; number += 1) {
    const id = wkId(number);
    const filePath = path.join(options.recordsDir, `${id}.json`);
    if (!(await isFile(filePath))) {
      recordsMissing.push(id);
      continue;
    }
    let record;
    try {
      record = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      recordsInvalid.push({ id, error: error?.message ?? String(error) });
      continue;
    }
    recordsFound.push(id);
    if (options.units === "parent" || options.units === "all") {
      addUnitCriteria(items, record, record, "parent", options);
    }
    if (options.units === "slices" || options.units === "all") {
      for (const slice of Array.isArray(record.slices) ? record.slices : []) {
        addUnitCriteria(items, record, slice, "slice", options);
      }
    }
  }
  return { items, recordsFound, recordsMissing, recordsInvalid };
}

function selectItems(items, options) {
  if (options.limit === 0 || options.limit >= items.length) return [...items];
  if (options.sample === "first") return items.slice(0, options.limit);
  if (options.limit === 1) return [items[0]];
  const selected = [];
  const seen = new Set();
  for (let index = 0; index < options.limit; index += 1) {
    const sourceIndex = Math.round(index * (items.length - 1) / (options.limit - 1));
    if (seen.has(sourceIndex)) continue;
    seen.add(sourceIndex);
    selected.push(items[sourceIndex]);
  }
  return selected;
}

async function resumeKeys(ledgerPath) {
  if (!(await isFile(ledgerPath))) return new Set();
  const keys = new Set();
  for (const line of (await readFile(ledgerPath, "utf8")).split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row = JSON.parse(line);
      if (row.transport === "translated" && typeof row.resume_key === "string") keys.add(row.resume_key);
    } catch {

    }
  }
  return keys;
}

async function ledgerRows(ledgerPath) {
  if (!(await isFile(ledgerPath))) return [];
  const rows = [];
  for (const line of (await readFile(ledgerPath, "utf8")).split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch {

    }
  }
  return rows;
}

function resumeKeyFor({ item, repetition, options, baseSchemaDigest, compilerDigest }) {
  return digest(JSON.stringify({
    source_criterion_id: item.sourceCriterionId,
    source_sha256: digest(item.sourceText),
    repetition,
    model: options.model,
    location: options.location,
    base_schema_sha256: baseSchemaDigest,
    compiler_sha256: compilerDigest
  }));
}

function statusOf(row) {
  if (row.transport !== "translated") return row.transport;
  if (row.compiler?.schema_valid === false) return "schema_invalid";
  return row.compiler?.evaluation?.status ?? "compiler_invalid";
}

function normalizeSpan(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceCoverage(row) {
  const segments = segmentCriterion(row.source_text);
  const residueTexts = (row.compiler?.evaluation?.residue ?? [])
    .map((entry) => normalizeSpan(entry.text))
    .filter(Boolean);
  const withResidue = segments.filter((segment) => {
    const normalized = normalizeSpan(segment);
    return residueTexts.some((residue) =>
      normalized.includes(residue) || residue.includes(normalized)
    );
  }).length;
  return {
    sourceSegments: segments.length,
    sourceSegmentsWithResidue: withResidue,
    sourceSegmentsWithoutResidue: segments.length - withResidue
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const corpus = await loadCorpus(options);
  const selected = selectItems(corpus.items, options);
  const baseSchemaText = JSON.stringify(BASE_SCHEMA);
  const baseSchemaDigest = digest(baseSchemaText);
  const compilerPath = "../versions/controlled-contract-general-v033.mjs";
  const compilerText = await readFile(new URL(compilerPath, import.meta.url), "utf8");
  const compilerSubstratePaths = [
    "../versions/controlled-contract-general-v032.mjs",
    "../versions/controlled-contract-general-v031.mjs",
    "../versions/controlled-contract-general-v030.mjs",
    "../versions/controlled-contract-general-v029.mjs",
    "../versions/controlled-contract-general-v028.mjs",
    "../versions/controlled-contract-general-v027.mjs",
    "../versions/controlled-contract-general-v026.mjs"
  ];
  const compilerSubstrateTexts = await Promise.all(compilerSubstratePaths.map((sourcePath) =>
    readFile(new URL(sourcePath, import.meta.url), "utf8")
  ));
  const compilerDigest = digest([compilerText, ...compilerSubstrateTexts].join("\u0000"));

  await mkdir(options.outputDir, { recursive: true });
  const ledgerPath = path.join(options.outputDir, "ledger.jsonl");
  if (!options.resume && await isFile(ledgerPath)) throw new Error(`ledger already exists: ${ledgerPath}`);
  await writeFile(
    path.join(options.outputDir, "schema.snapshot.json"),
    `${JSON.stringify(BASE_SCHEMA, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(options.outputDir, "compiler.snapshot.mjs"),
    compilerText,
    "utf8"
  );
  for (let index = 0; index < compilerSubstrateTexts.length; index += 1) {
    const snapshotName = path.basename(compilerSubstratePaths[index], ".mjs");
    await writeFile(
      path.join(options.outputDir, `${snapshotName}.snapshot.mjs`),
      compilerSubstrateTexts[index],
      "utf8"
    );
  }

  const attempts = selected.flatMap((item) =>
    Array.from({ length: options.repetitions }, (_, index) => ({ item, repetition: index + 1 }))
  );
  const manifest = {
    schema_version: RUN_SCHEMA_VERSION,
    created_at: timestamp(),
    base_schema_sha256: baseSchemaDigest,
    compiler_sha256: compilerDigest,
    range: { from: wkId(options.from), to: wkId(options.to) },
    selection: {
      units: options.units,
      surface: options.surface,
      work_kinds: options.workKinds,
      limit: options.limit,
      sample: options.sample,
      available_criteria: corpus.items.length,
      selected_criteria: selected.length
    },
    generation: {
      project: options.project,
      location: options.location,
      model: options.model,
      repetitions: options.repetitions,
      concurrency: options.concurrency,
      progress_every: options.progressEvery,
      prompt: "Repeat this acceptance criterion:\n\n<criterion>",
      retries: 0
    },
    records_found: corpus.recordsFound,
    records_missing: corpus.recordsMissing,
    records_invalid: corpus.recordsInvalid
  };
  await writeFile(path.join(options.outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(options.outputDir, "selection.jsonl"),
    `${selected.map((item) => JSON.stringify({
      source_criterion_id: item.sourceCriterionId,
      source_text: item.sourceText,
      source_sha256: digest(item.sourceText),
      wk_id: item.wkId,
      unit_id: item.unitId,
      unit_kind: item.unitKind,
      work_kind: item.workKind,
      surface: item.surface,
      carrier: {
        read_scope: item.unit.read_scope ?? [],
        repo_paths: item.unit.repo_paths ?? [],
        write_scope: item.unit.write_scope ?? [],
        depends_on: item.unit.depends_on ?? []
      }
    })).join("\n")}\n`,
    "utf8"
  );

  const completed = options.resume ? await resumeKeys(ledgerPath) : new Set();
  const pending = attempts.filter(({ item, repetition }) => {
    const key = resumeKeyFor({ item, repetition, options, baseSchemaDigest, compilerDigest });
    return !completed.has(key);
  });

  process.stderr.write(
    `selected ${selected.length} of ${corpus.items.length} criteria from ${corpus.recordsFound.length} records; ` +
    `${attempts.length} requested generations, ${pending.length} pending\noutput: ${options.outputDir}\n`
  );

  let token = null;
  let tokenReadAt = 0;
  const accessToken = () => {
    if (options.dryRun) return null;
    if (token === null || Date.now() - tokenReadAt >= 5 * 60 * 1000) {
      token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
      tokenReadAt = Date.now();
    }
    return token;
  };
  let appendChain = Promise.resolve();
  const rows = [];
  let nextIndex = 0;
  const appendRow = async (row) => {
    rows.push(row);
    appendChain = appendChain.then(() => appendFile(ledgerPath, `${JSON.stringify(row)}\n`, "utf8"));
    await appendChain;
  };

  const runOne = async ({ item, repetition }, ordinal) => {
    const prompt = `Repeat this acceptance criterion:\n\n${item.sourceText}`;
    const catalog = buildReferenceCatalog({
      sourceText: item.sourceText,
      unitId: item.unitId,
      unit: item.unit,
      repoRoot: REPO_ROOT
    });
    const boundSchema = bindGeneralSchema(BASE_SCHEMA, { sourceText: item.sourceText, catalog });
    const resumeKey = resumeKeyFor({ item, repetition, options, baseSchemaDigest, compilerDigest });
    if (ordinal === 0 || ordinal + 1 === pending.length || (ordinal + 1) % options.progressEvery === 0) {
      process.stderr.write(
        `[${ordinal + 1}/${pending.length}] ${options.dryRun ? "bind" : "run"} ` +
        `${item.sourceCriterionId} repetition ${repetition}/${options.repetitions}\n`
      );
    }
    const base = {
      schema_version: ROW_SCHEMA_VERSION,
      resume_key: resumeKey,
      source_criterion_id: item.sourceCriterionId,
      source_text: item.sourceText,
      source_sha256: digest(item.sourceText),
      wk_id: item.wkId,
      unit_id: item.unitId,
      unit_kind: item.unitKind,
      work_kind: item.workKind,
      surface: item.surface,
      repetition,
      model: options.model,
      location: options.location,
      base_schema_sha256: baseSchemaDigest,
      bound_schema_sha256: digest(JSON.stringify(boundSchema)),
      compiler_sha256: compilerDigest,
      prompt,
      prompt_sha256: digest(prompt),
      reference_catalog: catalog
    };
    if (options.dryRun) {
      await appendRow({ ...base, transport: "dry_run", usage: null, payload: null, compiler: null });
      return;
    }
    try {
      const result = await invokeVertex({
        project: options.project,
        location: options.location,
        model: options.model,
        schema: boundSchema,
        prompt,
        thinkingLevel: "MINIMAL",
        token: accessToken()
      });
      await appendRow({
        ...base,
        transport: "translated",
        usage: result.usage,
        payload: result.payload,
        compiler: evaluateGeneralContract(result.payload, { sourceText: item.sourceText, catalog })
      });
    } catch (error) {
      await appendRow({
        ...base,
        transport: "error",
        usage: null,
        payload: null,
        compiler: null,
        error: error?.message ?? String(error)
      });
    }
  };

  const workers = Array.from(
    { length: Math.min(options.concurrency, Math.max(pending.length, 1)) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= pending.length) return;
        await runOne(pending[index], index);
      }
    }
  );
  await Promise.all(workers);
  await appendChain;

  const expectedKeys = new Set(attempts.map(({ item, repetition }) =>
    resumeKeyFor({ item, repetition, options, baseSchemaDigest, compilerDigest })
  ));
  const latestByKey = new Map();
  for (const row of await ledgerRows(ledgerPath)) {
    if (expectedKeys.has(row.resume_key)) latestByKey.set(row.resume_key, row);
  }
  const accumulatedRows = [...latestByKey.values()];
  const counts = {};
  for (const row of accumulatedRows) {
    const status = statusOf(row);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const translated = accumulatedRows.filter((row) => row.transport === "translated");
  const coverage = translated.map(sourceCoverage);
  const uniqueResidueSpans = new Set(translated.flatMap((row) =>
    (row.compiler?.evaluation?.residue ?? []).map((entry) =>
      `${row.source_criterion_id}\u0000${entry.text}`
    )
  ));
  const summary = {
    schema_version: RUN_SCHEMA_VERSION,
    completed_at: timestamp(),
    base_schema_sha256: baseSchemaDigest,
    compiler_sha256: compilerDigest,
    model: options.model,
    criteria_selected: selected.length,
    repetitions: options.repetitions,
    generations_requested: attempts.length,
    resumed_skips: attempts.length - pending.length,
    rows_written: rows.length,
    accumulated_attempts: accumulatedRows.length,
    attempts_without_translated_result: attempts.length - translated.length,
    counts,
    admitted_claims: translated.reduce(
      (sum, row) => sum + (row.compiler?.evaluation?.admitted_claims ?? 0), 0
    ),
    admitted_relations: translated.reduce(
      (sum, row) => sum + (row.compiler?.evaluation?.admitted_relations ?? 0), 0
    ),
    residue_entries: translated.reduce(
      (sum, row) => sum + (row.compiler?.evaluation?.residue_entries ?? 0), 0
    ),
    unique_residue_spans: uniqueResidueSpans.size,
    source_segments: coverage.reduce((sum, item) => sum + item.sourceSegments, 0),
    source_segments_without_residue: coverage.reduce(
      (sum, item) => sum + item.sourceSegmentsWithoutResidue, 0
    ),
    source_segments_with_residue: coverage.reduce(
      (sum, item) => sum + item.sourceSegmentsWithResidue, 0
    ),
    ledger_path: ledgerPath
  };
  await writeFile(path.join(options.outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (rows.some((row) => row.transport === "error")) process.exitCode = 1;
}

const invokedAsMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  main().catch((error) => {
    process.stderr.write(`error: ${error?.stack ?? error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}

export { loadCorpus, main, parseArgs, selectItems, sourceCoverage };
