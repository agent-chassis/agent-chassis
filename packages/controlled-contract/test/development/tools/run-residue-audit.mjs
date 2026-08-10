#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_SCHEMA } from "../../legacy/versions/controlled-contract-general-v033.mjs";
import { invokeVertex } from "../../legacy/vertex.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../../..");
const AUDIT_VERSION = "controlled-contract-residue-audit.experimental.v0.1";
const CAUSES = [
  "grammar_opportunity",
  "defective_contract",
  "model_translation_failure",
  "nonoperative_material",
  "compiler_schema_defect",
  "mixed",
  "uncertain"
];
const OPERATIVE_STATUS = ["operative", "nonoperative", "mixed", "uncertain"];
const GRAMMAR_FIT = [
  "expressible_currently",
  "requires_general_primitive",
  "should_not_be_structured",
  "uncertain"
];
const ACTIONS = [
  "no_grammar_change",
  "fix_translation",
  "fix_compiler_or_schema",
  "repair_source_contract",
  "propose_general_primitive",
  "strong_review_required"
];
const CARRIERS = [
  "none",
  "read_scope",
  "repo_paths",
  "write_scope",
  "depends_on",
  "relation",
  "verification",
  "evidence",
  "other",
  "uncertain"
];
const CONFIDENCE = ["low", "medium", "high"];
const BOOLEAN_OR_UNCERTAIN = ["yes", "no", "uncertain"];

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/run-residue-audit.mjs \\
    --project <gcp-project> [options]

Options:
  --ledger <path>          Required frozen translation ledger.
  --model <name>           Default: gemini-3.6-flash.
  --location <name>        Default: global.
  --thinking-level <name>  Default: LOW.
  --concurrency <N>        Default: 8; maximum: 16.
  --limit <N>              Limit selected criterion cases after deterministic selection.
  --output-dir <path>      Default: timestamped residue-audit directory.
  --dry-run                Write selection and prompts without calling Vertex.
  --help                   Show this help.

The audit uses the frozen translation ledger. It does not regenerate contracts,
rewrite WKs, or make policy determinations.`;
}

function integer(value, flag, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^[0-9]+$/.test(value ?? "")) throw new Error(`${flag} must be an integer`);
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) throw new Error(`${flag} must be between ${min} and ${max}`);
  return parsed;
}

function parseArgs(argv) {
  const options = {
    project: null,
    ledger: null,
    model: "gemini-3.6-flash",
    location: "global",
    thinkingLevel: "LOW",
    concurrency: 8,
    maxSpansPerCall: 8,
    limit: 0,
    outputDir: null,
    dryRun: false,
    help: false
  };
  const next = (index, flag) => {
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
    const value = next(index, flag);
    index += 1;
    switch (flag) {
      case "--project": options.project = value; break;
      case "--ledger": options.ledger = path.resolve(value); break;
      case "--model": options.model = value; break;
      case "--location": options.location = value; break;
      case "--thinking-level": options.thinkingLevel = value.toUpperCase(); break;
      case "--concurrency": options.concurrency = integer(value, flag, { min: 1, max: 16 }); break;
      case "--max-spans-per-call": options.maxSpansPerCall = integer(value, flag, { min: 1, max: 12 }); break;
      case "--limit": options.limit = integer(value, flag); break;
      case "--output-dir": options.outputDir = path.resolve(value); break;
      default: throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (options.help) return options;
  if (options.ledger === null) throw new Error("--ledger is required");
  if (!options.dryRun && options.project === null) throw new Error("--project is required unless --dry-run is used");
  if (options.outputDir === null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    options.outputDir = path.join(
      REPO_ROOT,
      "internal/scratch/controlled-contract-runs",
      `residue-audit-v033-${stamp}`
    );
  }
  return options;
}

function spread(items, count) {
  if (items.length <= count) return [...items];
  if (count === 1) return [items[0]];
  return Array.from({ length: count }, (_, index) =>
    items[Math.round(index * (items.length - 1) / (count - 1))]
  );
}

function residueEntries(row) {
  return row.compiler?.evaluation?.residue ?? [];
}

function selectAuditCases(rows) {
  const selected = new Map();
  const add = (row, reason, texts) => {
    const existing = selected.get(row.source_criterion_id) ?? {
      row,
      selectionReasons: new Set(),
      targetTexts: new Set()
    };
    existing.selectionReasons.add(reason);
    for (const text of texts) existing.targetTexts.add(text);
    selected.set(row.source_criterion_id, existing);
  };

  for (const row of rows.filter((entry) => entry.compiler?.schema_valid === false)) {
    add(row, "schema_invalid", residueEntries(row).map((entry) => entry.text));
  }

  const contextsByText = new Map();
  for (const row of rows) {
    for (const residue of residueEntries(row)) {
      const contexts = contextsByText.get(residue.text) ?? [];
      contexts.push({ row, text: residue.text });
      contextsByText.set(residue.text, contexts);
    }
  }
  const repeated = [...contextsByText.entries()]
    .filter(([, contexts]) => contexts.length > 1)
    .sort((left, right) =>
      right[1].length - left[1].length || left[0].localeCompare(right[0])
    )
    .slice(0, 20);
  for (const [text, contexts] of repeated) {
    for (const context of spread(contexts, Math.min(3, contexts.length))) {
      add(context.row, "top_repeated_residue", [text]);
    }
  }

  const highest = rows
    .filter((row) => residueEntries(row).length > 0)
    .sort((left, right) =>
      residueEntries(right).length - residueEntries(left).length ||
      left.source_criterion_id.localeCompare(right.source_criterion_id)
    )
    .slice(0, 20);
  for (const row of highest) {
    add(row, "highest_residue_criterion", residueEntries(row).map((entry) => entry.text));
  }

  for (const reason of [
    "unrepresented_enumerated_operand",
    "unsupported_by_controlled_grammar",
    "rejected_claim_operand",
    "invalid_controlled_claim"
  ]) {
    const candidates = [];
    for (const row of [...rows].sort((a, b) =>
      a.source_criterion_id.localeCompare(b.source_criterion_id)
    )) {
      for (const residue of residueEntries(row)) {
        if ((residue.diagnostic_reasons ?? [residue.reason]).includes(reason)) {
          candidates.push({ row, text: residue.text });
        }
      }
    }
    for (const candidate of spread(candidates, 5)) {
      add(candidate.row, `reason_spread:${reason}`, [candidate.text]);
    }
  }

  return [...selected.values()]
    .sort((left, right) => left.row.source_criterion_id.localeCompare(right.row.source_criterion_id))
    .map(({ row, selectionReasons, targetTexts }) => ({
      row,
      selection_reasons: [...selectionReasons].sort(),
      target_residue_texts: [...targetTexts]
    }));
}

function splitAuditCases(items, maxSpansPerCall) {
  return items.flatMap((item) => {
    if (item.target_residue_texts.length === 0) {
      return [{ ...item, audit_part: 1, audit_parts: 1 }];
    }
    const chunks = [];
    for (let index = 0; index < item.target_residue_texts.length; index += maxSpansPerCall) {
      chunks.push({
        ...item,
        audit_part: chunks.length + 1,
        audit_parts: Math.ceil(item.target_residue_texts.length / maxSpansPerCall),
        target_residue_texts: item.target_residue_texts.slice(index, index + maxSpansPerCall)
      });
    }
    return chunks;
  });
}

const operatorNames = BASE_SCHEMA.$defs.operator_code.enum;

function auditSchema(item) {
  const texts = item.target_residue_texts;
  const auditsSchemaInvalidCriterion = item.selection_reasons.includes("schema_invalid");
  const finding = {
    type: "object",
    additionalProperties: false,
    required: [
      "residue_text", "primary_cause", "operative_status", "current_grammar_fit",
      "already_entailed", "existing_carrier", "candidate_operator",
      "recommended_action", "generalized_concept", "confidence", "explanation"
    ],
    properties: {
      residue_text: { type: "string", enum: texts },
      primary_cause: { type: "string", enum: CAUSES },
      operative_status: { type: "string", enum: OPERATIVE_STATUS },
      current_grammar_fit: { type: "string", enum: GRAMMAR_FIT },
      already_entailed: { type: "string", enum: BOOLEAN_OR_UNCERTAIN },
      existing_carrier: { type: "string", enum: CARRIERS },
      candidate_operator: { type: "string", enum: ["none", ...operatorNames] },
      recommended_action: { type: "string", enum: ACTIONS },
      generalized_concept: { type: "string" },
      confidence: { type: "string", enum: CONFIDENCE },
      explanation: { type: "string" }
    }
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "source_criterion_id", "findings", "criterion_observation"],
    properties: {
      schema_version: { type: "string", enum: [AUDIT_VERSION] },
      source_criterion_id: { type: "string", enum: [item.row.source_criterion_id] },
      findings: {
        type: "array",
        minItems: texts.length,
        maxItems: texts.length,
        ...(texts.length === 0 ? {} : { items: finding })
      },
      criterion_observation: { type: "string" }
    }
  };
  if (auditsSchemaInvalidCriterion) {
    schema.required.push("schema_invalid_assessment");
    schema.properties.schema_invalid_assessment = {
      type: "object",
      additionalProperties: false,
      required: ["primary_cause", "recommended_action", "confidence", "explanation"],
      properties: {
        primary_cause: { type: "string", enum: CAUSES },
        recommended_action: { type: "string", enum: ACTIONS },
        confidence: { type: "string", enum: CONFIDENCE },
        explanation: { type: "string" }
      }
    };
  }
  return schema;
}

function renderPrompt(item) {
  const row = item.row;
  const targetResidue = residueEntries(row).filter((entry) =>
    item.target_residue_texts.includes(entry.text)
  );
  return `Classify the selected residue from one experimental controlled-contract translation.

This is vocabulary research over legacy WK prose. It is NOT a review of the WK and you must not rewrite the contract. The orchestrator remains responsible for authoring an accurate WK. Your job is only to determine why each selected exact residue span was not represented by the current controlled grammar.

For every selected span:
1. Decide whether it is operative worker meaning, nonoperative context, mixed, or uncertain.
2. If operative, decide whether the current readable operator set can already express it. Name the exact existing operator when it can.
   "Expressible" requires proposition-level equivalence: the operator, modality, subject, and object must preserve the source meaning. Never select a merely related or approximate operator. A directive to determine, inspect, compare, or review whether a relation holds is not equivalent to asserting that relation.
   When the source requires determining whether proposition P is true, the obligation is to perform an analysis of P; P itself remains undetermined. An encoding that asserts P, such as depends_on or requires, is wrong even if the analysis might eventually reach that conclusion.
3. Check whether the meaning is already entailed by a structured MUST or belongs in an existing canonical carrier such as read_scope, repo_paths, write_scope, depends_on, relations, verification, or evidence.
4. Separate an ambiguous or defective source contract from a model omission/mis-encoding and from a compiler/schema defect.
5. Propose a grammar primitive only for a general contract concept. Do not mint a primitive merely to reduce residue, encode a discourse heading, duplicate a carrier, or restate an exclusion already implied by a closed structured MUST.
6. Use generalized_concept only to name a reusable candidate; otherwise emit an empty string.
7. Treat the compiler and the prior translation as fallible evidence. Do not infer that an unused variable should have been attached to the nearest available predicate; first establish the exact proposition the source makes.

If this invocation has selection reason schema_invalid, inspect the compiler schema errors even when there is no residue span. Populate schema_invalid_assessment with the cause of the invalid result and the appropriate repair surface.

Allowed readable operators:
${JSON.stringify(operatorNames)}

Complete current model-facing grammar:
${JSON.stringify(BASE_SCHEMA, null, 2)}

Selection reasons:
${JSON.stringify(item.selection_reasons)}

Source criterion:
${row.source_text}

Selected residue entries:
${JSON.stringify(targetResidue, null, 2)}

Model-emitted payload:
${JSON.stringify(row.payload, null, 2)}

Reference catalog:
${JSON.stringify(row.reference_catalog, null, 2)}

Compiler diagnostics and evaluation:
${JSON.stringify(row.compiler, null, 2)}`;
}

function validateAuditPayload(payload, item) {
  const expected = [...item.target_residue_texts].sort();
  const actual = (payload?.findings ?? []).map((finding) => finding.residue_text).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`audit result did not classify each selected residue exactly once`);
  }
  if (item.selection_reasons.includes("schema_invalid") &&
      payload?.schema_invalid_assessment === undefined) {
    throw new Error("audit result did not assess the selected schema-invalid criterion");
  }
}

async function loadRows(ledgerPath) {
  return (await readFile(ledgerPath, "utf8"))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const rows = await loadRows(options.ledger);
  let selectedCriteria = selectAuditCases(rows);
  if (options.limit > 0) selectedCriteria = selectedCriteria.slice(0, options.limit);
  const selected = splitAuditCases(selectedCriteria, options.maxSpansPerCall);
  await mkdir(options.outputDir, { recursive: true });
  const selectionPath = path.join(options.outputDir, "selection.jsonl");
  await writeFile(selectionPath, `${selected.map((item) => JSON.stringify({
    source_criterion_id: item.row.source_criterion_id,
    audit_part: item.audit_part,
    audit_parts: item.audit_parts,
    selection_reasons: item.selection_reasons,
    target_residue_texts: item.target_residue_texts
  })).join("\n")}\n`, "utf8");
  const manifest = {
    schema_version: "controlled-contract-residue-audit-run.experimental.v0.1",
    created_at: new Date().toISOString(),
    source_ledger: options.ledger,
    source_criteria: rows.length,
    selected_criterion_cases: selectedCriteria.length,
    audit_invocations: selected.length,
    selected_residue_spans: selected.reduce((sum, item) => sum + item.target_residue_texts.length, 0),
    model: options.model,
    location: options.location,
    thinking_level: options.thinkingLevel,
    concurrency: options.concurrency,
    max_spans_per_call: options.maxSpansPerCall,
    retries: 0,
    dry_run: options.dryRun
  };
  await writeFile(path.join(options.outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

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
  const ledgerPath = path.join(options.outputDir, "ledger.jsonl");
  let appendChain = Promise.resolve();
  const outputRows = [];
  let nextIndex = 0;
  const append = async (row) => {
    outputRows.push(row);
    appendChain = appendChain.then(() => appendFile(ledgerPath, `${JSON.stringify(row)}\n`, "utf8"));
    await appendChain;
  };
  const runNext = async () => {
    while (nextIndex < selected.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = selected[index];
      process.stderr.write(`[${index + 1}/${selected.length}] ${item.row.source_criterion_id}\n`);
      const prompt = renderPrompt(item);
      const schema = auditSchema(item);
      const base = {
        source_criterion_id: item.row.source_criterion_id,
        audit_part: item.audit_part,
        audit_parts: item.audit_parts,
        selection_reasons: item.selection_reasons,
        target_residue_texts: item.target_residue_texts,
        prompt,
        response_schema: schema
      };
      if (options.dryRun) {
        await append({ ...base, transport: "dry_run", payload: null, usage: null });
        continue;
      }
      try {
        const result = await invokeVertex({
          project: options.project,
          location: options.location,
          model: options.model,
          thinkingLevel: options.thinkingLevel,
          schema,
          prompt,
          token: accessToken()
        });
        validateAuditPayload(result.payload, item);
        await append({ ...base, transport: "translated", payload: result.payload, usage: result.usage });
      } catch (error) {
        await append({
          ...base,
          transport: "error",
          payload: null,
          usage: null,
          error: error?.message ?? String(error)
        });
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(options.concurrency, Math.max(selected.length, 1)) },
    () => runNext()
  ));
  await appendChain;

  const translated = outputRows.filter((row) => row.transport === "translated");
  const causeCounts = {};
  const actionCounts = {};
  const schemaInvalidCauseCounts = {};
  const schemaInvalidActionCounts = {};
  for (const row of translated) {
    for (const finding of row.payload.findings) {
      causeCounts[finding.primary_cause] = (causeCounts[finding.primary_cause] ?? 0) + 1;
      actionCounts[finding.recommended_action] = (actionCounts[finding.recommended_action] ?? 0) + 1;
    }
    const assessment = row.payload.schema_invalid_assessment;
    if (assessment !== undefined) {
      schemaInvalidCauseCounts[assessment.primary_cause] =
        (schemaInvalidCauseCounts[assessment.primary_cause] ?? 0) + 1;
      schemaInvalidActionCounts[assessment.recommended_action] =
        (schemaInvalidActionCounts[assessment.recommended_action] ?? 0) + 1;
    }
  }
  const summary = {
    ...manifest,
    completed_at: new Date().toISOString(),
    translated_cases: translated.length,
    dry_run_cases: outputRows.filter((row) => row.transport === "dry_run").length,
    error_cases: outputRows.filter((row) => row.transport === "error").length,
    classified_residue_spans: translated.reduce(
      (sum, row) => sum + row.payload.findings.length, 0
    ),
    classified_schema_invalid_criteria: translated.filter(
      (row) => row.payload.schema_invalid_assessment !== undefined
    ).length,
    cause_counts: causeCounts,
    action_counts: actionCounts,
    schema_invalid_cause_counts: schemaInvalidCauseCounts,
    schema_invalid_action_counts: schemaInvalidActionCounts,
    selection_path: selectionPath,
    ledger_path: ledgerPath
  };
  await writeFile(path.join(options.outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (outputRows.some((row) => row.transport === "error")) process.exitCode = 1;
}

const invokedAsMain = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  main().catch((error) => {
    process.stderr.write(`error: ${error?.stack ?? error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}

export {
  auditSchema,
  parseArgs,
  renderPrompt,
  selectAuditCases,
  splitAuditCases,
  validateAuditPayload
};
