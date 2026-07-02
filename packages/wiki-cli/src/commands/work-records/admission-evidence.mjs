

import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  evaluateWorkRecordAdmissionDerivedEvidenceById,
  persistWorkRecordGraphImpactByUnit,
  refreshWorkRecordAdmissionDerivedEvidenceById
} from "@agent-chassis/wiki-core/src/operations/work-records.mjs";
import {
  cleanupAllWorkRecordsDerivedEvidenceOperation,
  cleanupWorkRecordDerivedEvidenceOperation,
  normalizeCleanupConcurrency
} from "@agent-chassis/wiki-core/src/operations/work-record-derived-evidence-cleanup.mjs";
import { parseArgs, parseListOption, requireOption } from "../../lib/cli.mjs";
import {
  CLEANUP_DERIVED_EVIDENCE_COMMAND_OPTION_NAMES,
  PERSIST_GRAPH_IMPACT_COMMAND_OPTION_NAMES,
  createDiagnostic,
  parseAdmissionUnitSelector,
  parseJsonValue,
  readOptionalExpectedSourceDigest,
  readPersistGraphImpactOption,
  rejectUnknownOptions
} from "./options.mjs";
import {
  createPersistGraphImpactResult,
  formatCleanupAllResult,
  formatCleanupResult,
  formatPersistGraphImpactResult,
  formatRefreshResult,
  printJson
} from "./output.mjs";
import { selectEditUnit } from "./edit-core.mjs";

export async function runRefreshAdmissionMetrics(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records refresh-admission-metrics --id <WK-0001|WK-0001#slice-id> [--expected-source-digest <sha256:...>] [--dir <path>] [--json]\n" +
        "Refresh stored worker-admission derived evidence for one canonical JSON work record or dispatch unit.\n" +
        "This updates evidence only; it does not make an allow/deny/review policy decision."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const recordId = requireOption(
    options,
    "id",
    "work-records refresh-admission-metrics requires --id <WK-0001|WK-0001#slice-id>"
  );
  const expectedDigest = readOptionalExpectedSourceDigest(argv, options, "refresh-admission-metrics");
  if (!expectedDigest.ok) {
    const refusalResult = {
      record_id: recordId,
      source_digest: null,
      written: false,
      valid: false,
      diagnostics: [expectedDigest.diagnostic],
      canonical_record_path: null
    };
    if (options.json) {
      printJson(refusalResult);
    } else {
      console.log(formatRefreshResult(refusalResult, { recordId }));
    }
    process.exitCode = 1;
    return;
  }
  const result = await refreshWorkRecordAdmissionDerivedEvidenceById({
    dir: targetDir,
    id: recordId,
    expectedSourceDigest: expectedDigest.value,
    recordStore: null
  });

  if (options.json) {
    const response = {
      record_id: result.record_id || recordId,
      source_digest: result.source_digest || null,
      written: Boolean(result.written),
      valid: result.valid,
      diagnostics: result.diagnostics,
      canonical_record_path: result.canonical_record_path || null
    };
    if (expectedDigest.value !== null) {
      response.expected_source_digest = expectedDigest.value;
      response.current_source_digest =
        result.current_source_digest !== undefined ? result.current_source_digest : null;
    }
    printJson(response);
    return;
  }

  const formattedResult =
    expectedDigest.value !== null
      ? {
          ...result,
          expected_source_digest: expectedDigest.value,
          current_source_digest:
            result.current_source_digest !== undefined ? result.current_source_digest : null
        }
      : result;
  console.log(formatRefreshResult(formattedResult, { recordId }));
}

function evaluateRequireGraphSidecarization(result, { broadSweep }) {
  const report = result?.report ?? null;
  const updates = broadSweep
    ? report?.graph_sidecar_updates ?? 0
    : report?.graph_sidecar?.updates ?? 0;
  const reclaimed = broadSweep
    ? report?.graph_approx_bytes_reclaimed ?? 0
    : report?.graph_sidecar?.approx_bytes_reclaimed ?? 0;
  if (updates > 0 && reclaimed > 0) {
    return { ok: true, updates, reclaimed };
  }
  return {
    ok: false,
    updates,
    reclaimed,
    diagnostic: createDiagnostic(
      "graph_sidecarization_required",
      `--require-graph-sidecarization: expected graph-impact sidecarization but the run reported ${updates} graph sidecar update(s) and ${reclaimed} reclaimed byte(s); ` +
        "a WK that still contains inline graph payloads must produce at least one graph sidecar update and positive reclaim",
      { path: "require-graph-sidecarization" }
    )
  };
}

function applyRequireGraphSidecarizationGuard(result, { broadSweep }) {
  const guard = evaluateRequireGraphSidecarization(result, { broadSweep });
  if (!guard.ok) {
    result.valid = false;
    result.diagnostics = [...(result.diagnostics || []), guard.diagnostic];
  }
  return guard;
}

async function runCleanupDerivedEvidenceAll({ options, command, targetDir, write, verbose }) {
  const emitRefusal = (diagnostic) => {
    const refusal = {
      dir: targetDir,
      write,
      written: false,
      valid: false,
      invalid_request: true,
      report: null,
      diagnostics: [diagnostic]
    };
    if (options.json) {
      printJson(refusal);
    } else {
      console.log(formatCleanupAllResult(refusal));
    }
    process.exitCode = 1;
  };

  const hasAll = "all" in options;
  const hasRecords = "records" in options;
  if (hasAll && hasRecords) {
    emitRefusal(
      createDiagnostic("ambiguous_record_selector", `${command} accepts --all or --records, not both`, {
        path: "all"
      })
    );
    return;
  }
  if ("id" in options) {
    emitRefusal(
      createDiagnostic(
        "ambiguous_record_selector",
        `${command} broad sweep uses --all or --records <WK-0001,...>; --id selects a single record without --all/--records`,
        { path: "id" }
      )
    );
    return;
  }
  if ("expected-source-digest" in options) {
    emitRefusal(
      createDiagnostic(
        "unsupported_option",
        `${command} --expected-source-digest applies to single-record cleanup only; the broad sweep loads and digests each record fresh`,
        { path: "expected-source-digest" }
      )
    );
    return;
  }

  let ids = null;
  if (hasRecords) {
    ids = parseListOption(options, "records");
    if (ids.length === 0) {
      emitRefusal(
        createDiagnostic("missing_record_filter", `${command} --records requires at least one WK-#### id`, {
          path: "records"
        })
      );
      return;
    }
  }

  let concurrency = null;
  if ("concurrency" in options) {

    const rawConcurrency = options.concurrency === true ? "" : String(options.concurrency);
    const normalized = normalizeCleanupConcurrency(rawConcurrency, { write });
    if (!normalized.ok) {
      emitRefusal(normalized.diagnostic);
      return;
    }
    concurrency = normalized.value;
  }

  const result = await cleanupAllWorkRecordsDerivedEvidenceOperation({
    dir: targetDir,
    ids,
    write,
    verbose,
    concurrency,
    recordStore: null
  });

  if ("require-graph-sidecarization" in options) {
    applyRequireGraphSidecarizationGuard(result, { broadSweep: true });
  }

  if (options.json) {
    printJson(result);
  } else {
    console.log(formatCleanupAllResult(result));
  }

  if (!result.valid || (result.diagnostics || []).some((entry) => entry.severity === "error")) {
    process.exitCode = 1;
  }
}

export async function runCleanupDerivedEvidence(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records cleanup-derived-evidence (--id <WK-0001> | --all | --records <WK-0001,WK-0002,...>) [--write] [--verbose] [--concurrency <N>] [--require-graph-sidecarization] [--expected-source-digest <sha256:...>] [--dir <path>] [--json]\n" +
        "Report or prune oversized worker-admission derived-evidence entries on canonical JSON work records, moving inline graph-impact replay detail into per-WK graph sidecars (wiki/work-records/evidence/WK-####.graph.json).\n" +
        "--id cleans a single record (supports --expected-source-digest). --all sweeps every canonical wiki/work-records/WK-*.json;\n" +
        "--records cleans an explicit subset (test on WK-0764 before the broad sweep).\n" +
        "--concurrency <N> bounds the broad sweep's parallel per-record tasks (1..64; default 8 dry-run, 4 write); not valid with --id.\n" +
        "--require-graph-sidecarization exits nonzero if the run reports no graph sidecar updates or no positive reclaim (assertion guard for the WK-0764 validation gate).\n" +
        "Dry-run by default; pass --write to persist pruned records and their WK-named worker-admission and graph sidecars through validated persistence.\n" +
        "Operator fallback only; agents should use the workspace_work_record_cleanup_derived_evidence MCP route."
    );
    return;
  }

  const command = "cleanup-derived-evidence";
  const targetDir = path.resolve(String(options.dir || "."));
  const mode = options.write ? "apply" : "plan";

  const unknownOption = rejectUnknownOptions(options, CLEANUP_DERIVED_EVIDENCE_COMMAND_OPTION_NAMES, command);
  if (unknownOption) {
    const refusal = {
      record_id: null,
      mode,
      changed: false,
      written: false,
      valid: false,
      no_op: false,
      report: null,
      diagnostics: [unknownOption]
    };
    if (options.json) {
      printJson(refusal);
    } else {
      console.log(formatCleanupResult(refusal));
    }
    process.exitCode = 1;
    return;
  }

  if ("all" in options || "records" in options) {
    await runCleanupDerivedEvidenceAll({
      options,
      command,
      targetDir,
      write: Boolean(options.write),
      verbose: Boolean(options.verbose)
    });
    return;
  }

  const emitCleanupRefusal = (recordId, diagnostic) => {
    const refusal = {
      record_id: recordId,
      mode,
      changed: false,
      written: false,
      valid: false,
      no_op: false,
      report: null,
      diagnostics: [diagnostic]
    };
    if (options.json) {
      printJson(refusal);
    } else {
      console.log(formatCleanupResult(refusal));
    }
    process.exitCode = 1;
  };

  if ("concurrency" in options) {
    emitCleanupRefusal(
      null,
      createDiagnostic(
        "unsupported_option",
        `${command} --concurrency applies to the broad sweep (--all/--records) only; single-record cleanup processes one record`,
        { path: "concurrency" }
      )
    );
    return;
  }

  const recordId = requireOption(
    options,
    "id",
    "work-records cleanup-derived-evidence requires --id <WK-0001>"
  );
  const expectedDigest = readOptionalExpectedSourceDigest(argv, options, command);
  if (!expectedDigest.ok) {
    emitCleanupRefusal(recordId, expectedDigest.diagnostic);
    return;
  }

  const result = await cleanupWorkRecordDerivedEvidenceOperation({
    dir: targetDir,
    id: recordId,
    write: Boolean(options.write),
    verbose: Boolean(options.verbose),
    expectedSourceDigest: expectedDigest.value,
    recordStore: null
  });

  if ("require-graph-sidecarization" in options) {
    applyRequireGraphSidecarizationGuard(result, { broadSweep: false });
  }

  if (options.json) {
    printJson(result);
  } else {
    console.log(formatCleanupResult(result));
  }

  if (!result.valid || (result.diagnostics || []).some((entry) => entry.severity === "error")) {
    process.exitCode = 1;
  }
}

function printPersistGraphImpactResult(result, { json }) {
  if (json) {
    printJson(result);
  } else {
    console.log(formatPersistGraphImpactResult(result));
  }
}

export async function runPersistGraphImpact(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records persist-graph-impact --unit <WK-0001|WK-0001#slice-id> --graph-impact-json-file <path> [--dir <path>] [--json]\n" +
        "Persist graph-impact evidence from a JSON file onto a canonical work record or slice.\n" +
        "This writes through the trusted validated work-record persistence path."
    );
    return;
  }

  const command = "persist-graph-impact";
  const targetDir = path.resolve(String(options.dir || "."));
  const unknownOption = rejectUnknownOptions(options, PERSIST_GRAPH_IMPACT_COMMAND_OPTION_NAMES, command);
  if (unknownOption) {
    printPersistGraphImpactResult(
      createPersistGraphImpactResult({
        command,
        diagnostics: [unknownOption]
      }),
      { json: Boolean(options.json) }
    );
    process.exitCode = 1;
    return;
  }
  const selected = selectEditUnit(argv, options, command);
  if (!selected.ok) {
    printPersistGraphImpactResult(
      createPersistGraphImpactResult({
        command,
        recordId: null,
        diagnostics: [selected.diagnostic]
      }),
      { json: Boolean(options.json) }
    );
    process.exitCode = 1;
    return;
  }
  const unit = selected.unit;

  const graphImpactFileOption = readPersistGraphImpactOption(argv, options, "graph-impact-json-file", {
    command,
    allowDashValue: true
  });
  if (!graphImpactFileOption.ok) {
    printPersistGraphImpactResult(
      createPersistGraphImpactResult({
        command,
        recordId: unit.record_id,
        unit,
        diagnostics: [graphImpactFileOption.diagnostic]
      }),
      { json: Boolean(options.json) }
    );
    process.exitCode = 1;
    return;
  }

  let graphImpactText;
  try {
    graphImpactText = await readFile(graphImpactFileOption.value, "utf8");
  } catch (error) {
    printPersistGraphImpactResult(
      createPersistGraphImpactResult({
        command,
        recordId: unit.record_id,
        unit,
        graphImpactJsonFile: graphImpactFileOption.value,
        diagnostics: [
          createDiagnostic("graph_impact_json_unreadable", "Unable to read graph-impact JSON file", {
            path: "graph-impact-json-file"
          })
        ]
      }),
      { json: Boolean(options.json) }
    );
    process.exitCode = 1;
    return;
  }

  const parsedGraphImpact = parseJsonValue(graphImpactText, { fieldName: "graph-impact-json-file" });
  if (!parsedGraphImpact.ok) {
    printPersistGraphImpactResult(
      createPersistGraphImpactResult({
        command,
        recordId: unit.record_id,
        unit,
        graphImpactJsonFile: graphImpactFileOption.value,
        diagnostics: [parsedGraphImpact.diagnostic]
      }),
      { json: Boolean(options.json) }
    );
    process.exitCode = 1;
    return;
  }

  const result = await persistWorkRecordGraphImpactByUnit({
    dir: targetDir,
    unitAddress: unit.address,
    graph_impact: parsedGraphImpact.value,
    recordStore: null
  });

  const response = createPersistGraphImpactResult({
    command,
    recordId: result.record_id || unit.record_id || null,
    unit: result.selected_unit || unit,
    path: result.canonical_record_path || null,
    graphImpactJsonFile: graphImpactFileOption.value,
    sourceDigest: result.source_digest || null,
    written: result.written,
    valid: result.valid,
    diagnostics: result.diagnostics || [],
    graphImpact: result.graph_impact || null,
    derivedEvidence: result.derived_evidence || null
  });

  if (options.json) {
    printJson(response);
  } else {
    console.log(formatPersistGraphImpactResult(response));
  }

  const hasErrorDiagnostics = (result.diagnostics || []).some((entry) => entry.severity === "error");
  if (!result.valid || hasErrorDiagnostics || !result.written) {
    process.exitCode = 1;
  }
}

export async function runAdmission(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records admission (--unit <WK-0001|WK-0001#slice-id> | --id <WK-0001>) [--dir <path>]\n" +
        "Evaluate stored worker-admission derived evidence for one selected dispatch unit without refreshing it.\n" +
        "`--id` remains supported for record-level evaluation."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const unitSelector = options.unit ? String(options.unit) : options.id ? String(options.id) : null;
  if (!unitSelector) {
    throw new Error("work-records admission requires --unit <WK-0001|WK-0001#slice-id> or --id <WK-0001>");
  }
  const result = await evaluateWorkRecordAdmissionDerivedEvidenceById({
    dir: targetDir,
    id: unitSelector,
    unitAddress: options.unit ? unitSelector : null,
    recordStore: null
  });

  printJson({
    ...result,
    unit_selector: unitSelector,
    selected_unit: result.selected_unit || parseAdmissionUnitSelector(unitSelector)
  });
}
