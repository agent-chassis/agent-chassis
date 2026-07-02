

import path from "node:path";
import { parseArgs } from "../lib/cli.mjs";
import { editWorkRecordContractByUnit } from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function mkDiag(code, message, { severity = "error", path: fieldPath = null } = {}) {
  return { code, severity, message, path: fieldPath };
}

function getOption(options, key) {
  const v = options[key];
  return v === undefined || v === true ? null : String(v);
}

function parseJsonValue(raw, { fieldName }) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      diagnostic: mkDiag("invalid_json", `${fieldName} must be valid JSON`, { path: fieldName })
    };
  }
}

const EXPECTED_SOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const CONTRACT_EDIT_ALLOWED_OPTIONS = {
  "upsert-slice": new Set([
    "dir", "expected-source-digest", "help", "id", "json", "slice-json", "unit", "verbose"
  ]),
  "delete-slice": new Set([
    "dir", "expected-source-digest", "help", "id", "json", "slice-id", "unit", "verbose"
  ]),
  "set-list-field": new Set([
    "dir", "expected-source-digest", "field", "help", "id", "json", "unit", "values-json", "verbose"
  ]),
  "set-acceptance": new Set([
    "criteria-json", "dir", "expected-source-digest", "help", "id", "json", "unit", "validation-json", "verbose"
  ]),
  "shape-review-unit": new Set([
    "dir", "expected-source-digest", "help", "id", "json", "unit", "verbose"
  ])
};

function printContractEditResult(result, { json = false } = {}) {
  if (json) {
    printJson(result);
    return;
  }
  const op = result.operation || "(unknown)";
  const hasErr = (result.diagnostics || []).some((d) => d.severity === "error");
  const label = result.no_op
    ? "no-op"
    : result.written
    ? "written"
    : !hasErr && result.valid
    ? "valid"
    : "refused";
  console.log(`${op}: ${label}`);
  if (result.record_id) {
    console.log(`Record: ${result.record_id}`);
  }
  if (result.selected_unit?.address) {
    console.log(`Unit: ${result.selected_unit.address}`);
  }
  const displayPath =
    result.canonical_record_path || result.source_path_relative || result.source_path;
  if (displayPath) {
    console.log(`Path: ${displayPath}`);
  }
  if (result.source_digest) {
    console.log(`Source digest: ${result.source_digest}`);
  }
  if ((result.changed_fields || []).length) {
    console.log(`Changed: ${result.changed_fields.join(", ")}`);
  }
  console.log(`Valid: ${result.valid}`);
  console.log(`Written: ${result.written}`);
  if ("expected_source_digest" in result) {
    console.log(`Expected source digest: ${result.expected_source_digest ?? "(missing)"}`);
    console.log(`Current source digest: ${result.current_source_digest ?? "(missing)"}`);
  }
  if (result.next_action) {
    console.log(`Next: ${result.next_action}`);
  }
  for (const d of result.diagnostics || []) {
    console.log(`- ${d.code}: ${d.message}`);
  }
}

function refuseEarly(operation, diagnostic, { json }) {
  const result = {
    operation,
    valid: false,
    written: false,
    no_op: false,
    changed_fields: [],
    diagnostics: [diagnostic]
  };
  printContractEditResult(result, { json });
  process.exitCode = 1;
}

function rejectUnknown(options, allowed, command) {
  const unknown = Object.keys(options).filter((k) => !allowed.has(k));
  if (!unknown.length) {
    return null;
  }
  unknown.sort();
  return mkDiag(
    "unknown_option",
    `${command} does not accept option(s): ${unknown.map((k) => `--${k}`).join(", ")}`,
    { path: unknown[0] }
  );
}

function readUnit(options, command) {
  const hasUnit = "unit" in options;
  const hasId = "id" in options;
  if (hasUnit && hasId) {
    return {
      ok: false,
      diagnostic: mkDiag("ambiguous_selector", `${command} accepts --unit or --id, not both`, {
        path: "unit"
      })
    };
  }
  if (!hasUnit && !hasId) {
    return {
      ok: false,
      diagnostic: mkDiag(
        "missing_selector",
        `${command} requires --unit <WK-0001|WK-0001#slice-id>`,
        { path: "unit" }
      )
    };
  }
  const raw = hasUnit ? getOption(options, "unit") : getOption(options, "id");
  if (!raw) {
    return {
      ok: false,
      diagnostic: mkDiag(
        "missing_option",
        `${command} requires a non-empty value for --${hasUnit ? "unit" : "id"}`,
        { path: hasUnit ? "unit" : "id" }
      )
    };
  }
  if (hasId && raw.includes("#")) {
    return {
      ok: false,
      diagnostic: mkDiag("invalid_id", `${command} --id is record-only; use --unit for slices`, {
        path: "id"
      })
    };
  }
  return { ok: true, unitAddress: raw };
}

function readExpectedSourceDigest(options, command) {
  if (!("expected-source-digest" in options)) {
    return { ok: true, value: null };
  }
  const raw = getOption(options, "expected-source-digest");
  if (!raw || !EXPECTED_SOURCE_DIGEST_PATTERN.test(raw)) {
    return {
      ok: false,
      diagnostic: mkDiag(
        "invalid_expected_source_digest",
        `${command} requires --expected-source-digest sha256:<64 lowercase hex>`,
        { path: "expected-source-digest" }
      )
    };
  }
  return { ok: true, value: raw };
}

async function runContractEdit(options, { command, operation, buildParams }) {
  const json = Boolean(options.json);
  const targetDir = path.resolve(String(options.dir || "."));

  const unknownOpt = rejectUnknown(options, CONTRACT_EDIT_ALLOWED_OPTIONS[command], command);
  if (unknownOpt) {
    refuseEarly(operation, unknownOpt, { json });
    return;
  }

  const unitResult = readUnit(options, command);
  if (!unitResult.ok) {
    refuseEarly(operation, unitResult.diagnostic, { json });
    return;
  }

  const digestResult = readExpectedSourceDigest(options, command);
  if (!digestResult.ok) {
    refuseEarly(operation, digestResult.diagnostic, { json });
    return;
  }

  const paramsResult = buildParams(options);
  if (!paramsResult.ok) {
    refuseEarly(operation, paramsResult.diagnostic, { json });
    return;
  }

  const result = await editWorkRecordContractByUnit({
    dir: targetDir,
    unitAddress: unitResult.unitAddress,
    operation,
    params: paramsResult.params,
    expectedSourceDigest: digestResult.value,
    verbose: Boolean(options.verbose)
  });

  printContractEditResult(result, { json });

  const hasErr = (result.diagnostics || []).some((d) => d.severity === "error");
  if (!result.valid || hasErr || (!result.written && !result.no_op)) {
    process.exitCode = 1;
  }
}

export async function runUpsertSlice(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records upsert-slice --unit <WK-0001> --slice-json <json> [--expected-source-digest <sha256:...>] [--dir <path>] [--json] [--verbose]\n" +
        "       (--id <WK-0001> is accepted as an alias for --unit when targeting a record)\n" +
        "Create or update a tracker-local slice from a JSON object payload. Omit slice-json.id to create the next SLICE-### id.\n" +
        "Explicit new semantic ids are refused; existing semantic ids remain updateable as grandfathered slices.\n" +
        "Validates before writing and delegates id allocation/refusal to the core planner.\n" +
        "Operator fallback; agents should use workspace_work_record_contract_edit."
    );
    return;
  }
  await runContractEdit(options, {
    command: "upsert-slice",
    operation: "upsert_slice",
    buildParams(opts) {
      const raw = getOption(opts, "slice-json");
      if (!raw) {
        return {
          ok: false,
          diagnostic: mkDiag("missing_option", "upsert-slice requires --slice-json <json>", {
            path: "slice-json"
          })
        };
      }
      const parsed = parseJsonValue(raw, { fieldName: "slice-json" });
      if (!parsed.ok) {
        return parsed;
      }
      if (
        !parsed.value ||
        typeof parsed.value !== "object" ||
        Array.isArray(parsed.value)
      ) {
        return {
          ok: false,
          diagnostic: mkDiag("invalid_slice_payload", "--slice-json must be a JSON object", {
            path: "slice-json"
          })
        };
      }
      return { ok: true, params: { slice: parsed.value } };
    }
  });
}

export async function runDeleteSlice(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records delete-slice --unit <WK-0001#slice-id> [--slice-id <id>] [--expected-source-digest <sha256:...>] [--dir <path>] [--json] [--verbose]\n" +
        "       (--id <WK-0001> is accepted as an alias for --unit when using explicit --slice-id)\n" +
        "Delete a tracker-local slice by id. Slice id is inferred from a slice-scoped --unit address (WK-0001#slice-id),\n" +
        "or supply --slice-id explicitly alongside a record-scoped --unit (or --id).\n" +
        "If --unit is slice-scoped and --slice-id is also supplied, they must agree.\n" +
        "Operator fallback; agents should use workspace_work_record_contract_edit."
    );
    return;
  }
  await runContractEdit(options, {
    command: "delete-slice",
    operation: "delete_slice",
    buildParams(opts) {
      const sliceId = getOption(opts, "slice-id");
      return { ok: true, params: sliceId ? { slice_id: sliceId } : {} };
    }
  });
}

export async function runSetListField(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records set-list-field --unit <WK-0001|WK-0001#slice-id> --field <field> --values-json <json-array> [--expected-source-digest <sha256:...>] [--dir <path>] [--json] [--verbose]\n" +
        "       (--id <WK-0001> is accepted as an alias for --unit when targeting a record)\n" +
        "Set a controlled list-valued contract field to the supplied array of strings.\n" +
        "Record-scope fields: docs, repo_paths, write_scope, depends_on, related, blocks.\n" +
        "Slice-scope fields: docs, repo_paths, write_scope, depends_on (related and blocks are record-only).\n" +
        "Operator fallback; agents should use workspace_work_record_contract_edit."
    );
    return;
  }
  await runContractEdit(options, {
    command: "set-list-field",
    operation: "set_list_field",
    buildParams(opts) {
      const field = getOption(opts, "field");
      if (!field) {
        return {
          ok: false,
          diagnostic: mkDiag("missing_option", "set-list-field requires --field <field>", {
            path: "field"
          })
        };
      }
      const rawValues = getOption(opts, "values-json");
      if (rawValues === null) {
        return {
          ok: false,
          diagnostic: mkDiag(
            "missing_option",
            "set-list-field requires --values-json <json-array>",
            { path: "values-json" }
          )
        };
      }
      const parsed = parseJsonValue(rawValues, { fieldName: "values-json" });
      if (!parsed.ok) {
        return parsed;
      }
      if (!Array.isArray(parsed.value)) {
        return {
          ok: false,
          diagnostic: mkDiag("invalid_list_value", "--values-json must be a JSON array", {
            path: "values-json"
          })
        };
      }
      return { ok: true, params: { field, values: parsed.value } };
    }
  });
}

export async function runSetAcceptance(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records set-acceptance --unit <WK-0001|WK-0001#slice-id> [--criteria-json <json>] [--validation-json <json-array>] [--expected-source-digest <sha256:...>] [--dir <path>] [--json] [--verbose]\n" +
        "       (--id <WK-0001> is accepted as an alias for --unit when targeting a record)\n" +
        "Set acceptance.criteria and/or acceptance.validation at record or slice scope. At least one must be provided.\n" +
        "--criteria-json is a JSON array (strings or objects). --validation-json is a JSON array of strings.\n" +
        "Operator fallback; agents should use workspace_work_record_contract_edit."
    );
    return;
  }
  await runContractEdit(options, {
    command: "set-acceptance",
    operation: "set_acceptance",
    buildParams(opts) {
      const params = {};
      if ("criteria-json" in opts) {
        const raw = getOption(opts, "criteria-json");
        if (raw === null) {
          return {
            ok: false,
            diagnostic: mkDiag(
              "missing_option",
              "set-acceptance requires a non-empty value for --criteria-json",
              { path: "criteria-json" }
            )
          };
        }
        const parsed = parseJsonValue(raw, { fieldName: "criteria-json" });
        if (!parsed.ok) {
          return parsed;
        }
        if (!Array.isArray(parsed.value)) {
          return {
            ok: false,
            diagnostic: mkDiag(
              "invalid_acceptance_payload",
              "--criteria-json must be a JSON array",
              { path: "criteria-json" }
            )
          };
        }
        params.criteria = parsed.value;
      }
      if ("validation-json" in opts) {
        const raw = getOption(opts, "validation-json");
        if (raw === null) {
          return {
            ok: false,
            diagnostic: mkDiag(
              "missing_option",
              "set-acceptance requires a non-empty value for --validation-json",
              { path: "validation-json" }
            )
          };
        }
        const parsed = parseJsonValue(raw, { fieldName: "validation-json" });
        if (!parsed.ok) {
          return parsed;
        }
        if (!Array.isArray(parsed.value)) {
          return {
            ok: false,
            diagnostic: mkDiag(
              "invalid_acceptance_payload",
              "--validation-json must be a JSON array",
              { path: "validation-json" }
            )
          };
        }
        params.validation = parsed.value;
      }
      if (!("criteria" in params) && !("validation" in params)) {
        return {
          ok: false,
          diagnostic: mkDiag(
            "missing_acceptance_payload",
            "set-acceptance requires --criteria-json and/or --validation-json",
            { path: "acceptance" }
          )
        };
      }
      return { ok: true, params };
    }
  });
}

export async function runShapeReviewUnit(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records shape-review-unit --unit <WK-0001|WK-0001#slice-id> [--expected-source-digest <sha256:...>] [--dir <path>] [--json] [--verbose]\n" +
        "       (--id <WK-0001> is accepted as an alias for --unit when targeting a record)\n" +
        "Shape a record or slice into a findings-only review unit: sets work_kind: review, write_scope: [],\n" +
        "and dispatch_intent.intended_agent_role: reviewer. Creates dispatch_intent if absent. Idempotent; no-op when already shaped.\n" +
        "Operator fallback; agents should use workspace_work_record_contract_edit."
    );
    return;
  }
  await runContractEdit(options, {
    command: "shape-review-unit",
    operation: "shape_review_unit",
    buildParams() {
      return { ok: true, params: {} };
    }
  });
}
