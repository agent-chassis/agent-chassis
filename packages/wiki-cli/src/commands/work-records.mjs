

import {
  runDigest,
  runLoad,
  runSummary,
  runValidate
} from "./work-records/read-commands.mjs";
import {
  runAdmission,
  runCleanupDerivedEvidence,
  runPersistGraphImpact,
  runRefreshAdmissionMetrics
} from "./work-records/admission-evidence.mjs";
import {
  runSetClosure,
  runSetStatus,
  runSetTask
} from "./work-records/status-task-closure.mjs";
import {
  runUpsertSlice,
  runDeleteSlice,
  runSetListField,
  runSetAcceptance,
  runShapeReviewUnit
} from "./work-record-contract-edit.mjs";

export async function runWorkRecords(argv) {
  const [subcommand = "load", ...rest] = argv;

  switch (subcommand) {
    case "load":
      await runLoad(rest);
      return;
    case "digest":
      await runDigest(rest);
      return;
    case "validate":
      await runValidate(rest);
      return;
    case "summary":
      await runSummary(rest);
      return;
    case "admission":
    case "evaluate-admission":
      await runAdmission(rest);
      return;
    case "refresh-admission-metrics":
      await runRefreshAdmissionMetrics(rest);
      return;
    case "cleanup-derived-evidence":
      await runCleanupDerivedEvidence(rest);
      return;
    case "persist-graph-impact":
      await runPersistGraphImpact(rest);
      return;
    case "set-status":
      await runSetStatus(rest);
      return;
    case "set-task":
      await runSetTask(rest);
      return;
    case "set-closure":
      await runSetClosure(rest);
      return;
    case "upsert-slice":
      await runUpsertSlice(rest);
      return;
    case "delete-slice":
      await runDeleteSlice(rest);
      return;
    case "set-list-field":
      await runSetListField(rest);
      return;
    case "set-acceptance":
      await runSetAcceptance(rest);
      return;
    case "shape-review-unit":
      await runShapeReviewUnit(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(
        "Usage: wiki work-records <load|digest|validate|summary|admission|evaluate-admission|refresh-admission-metrics|cleanup-derived-evidence|persist-graph-impact|set-status|set-task|set-closure|upsert-slice|delete-slice|set-list-field|set-acceptance|shape-review-unit> [options]\n" +
          "Inspect canonical JSON work-records, evaluate or refresh worker-admission evidence, or perform trusted schema-aware work-record edits.\n" +
          "Edit commands use --unit <WK-0001|WK-0001#slice-id>; --id is record-only where supported.\n" +
          "Contract/slice edit commands (upsert-slice, delete-slice, set-list-field, set-acceptance, shape-review-unit) are operator fallbacks;\n" +
          "agents should use the workspace_work_record_contract_edit MCP route."
      );
      return;
    default:
      throw new Error(`Unknown work-records subcommand: ${subcommand}`);
  }
}
