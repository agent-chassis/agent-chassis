

import { buildNextCall } from "./mcp-response.mjs";

const WORK_UNIT = /^WK-[0-9]{4}(?:#SLICE-[0-9]{3})?$/u;

export function createInitiativeGuidanceProjector(contracts) {
  async function admitted(tool, args, purpose) {
    const contract = contracts?.contractFor(tool);
    if (contract === null || contract === undefined || !await contract.acceptsArguments(args)) return null;
    return { ...buildNextCall({ tool, arguments: args }), purpose };
  }

  async function action(row) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
    const { suggested_tool: _nativeTool, tool: _tool, arguments: _arguments,
      next_call: _call, next_calls: _calls, allowed_next_calls: _allowed, ...meaning } = row;
    const unit = row.target_unit ?? row.id;
    let operation = null;
    let args = null;
    let missingInputs = [];
    let missingCapability = null;
    switch (row.kind) {
      case "allocate_work_record":
        operation = "workspace_create_record";
        missingInputs = ["title"];
        break;
      case "dispatch_review":
        operation = "start_agent";
        args = { subject: unit, role: row.target_role };
        if (!row.target_role) missingInputs = ["role"];
        break;
      case "validate_record":
      case "validate_dispatch":
        operation = "workspace_assess_contract";
        args = { unit };
        break;
      case "inspect":
        operation = row.reason_code === "review_result_ready" ? "get_run_result" : "workspace_read_wiki";
        args = { subject: unit };
        break;
      case "no_action":
        break;
      case "record_graph_impact_evidence":
        missingCapability = "persist_selected_unit_graph_impact_evidence";
        break;
      case "resolve_runtime_blocker":
        missingCapability = "resolve_runtime_blocker";
        break;
      case "split_work":
      case "create_remediation_slice":
      case "mark_slice_done":
      case "close_parent":
        operation = "save_record";
        missingInputs = ["revision", "changes"];
        break;
      default:

        operation = row.tool ?? row.suggested_tool ?? null;
        args = row.arguments ?? row.next_call?.arguments ?? null;
        if (operation !== null && args === null) missingInputs = ["arguments"];
    }
    if (args?.subject === undefined && args?.unit === undefined &&
        ["start_agent", "workspace_assess_contract", "workspace_read_wiki", "get_run_result"].includes(operation)) {
      missingInputs.push(operation === "workspace_assess_contract" ? "unit" : "subject");
    }
    const available = operation !== null && contracts?.contractFor(operation) != null;
    const nextCalls = [];
    if (available && missingInputs.length === 0 && args !== null) {
      const call = await admitted(operation, args, "requested_action");
      if (call !== null) nextCalls.push(call);
      else missingInputs.push("arguments satisfying the registered request contract");
    }
    if (operation !== null && !available) missingCapability ??= `current_role_operation_for_${row.kind ?? "recommendation"}`;

    if (nextCalls.length === 0 && WORK_UNIT.test(unit ?? "") && row.kind !== "no_action") {
      const inspection = await admitted("workspace_read_wiki", { subject: unit }, "information_acquisition");
      if (inspection !== null) nextCalls.push(inspection);
    }
    const guidance = { state: missingCapability !== null ? "capability_unavailable"
      : missingInputs.length > 0 ? "missing_inputs" : nextCalls.length > 0 ? "action_available" : "no_action",
    ...(available ? { operation } : {}),
    ...(row.kind === "allocate_work_record" && available ? { known_arguments: { kind: "work_item", initial: { initiative: unit } } } : {}),
    ...(missingInputs.length > 0 ? { missing_inputs: missingInputs } : {}),
    ...(missingCapability === null ? {} : { missing_capability: missingCapability }),
    ...(row.kind === "record_graph_impact_evidence" ? { limitation: "Inspection does not persist graph-impact evidence." } : {}) };
    return slots({ ...meaning, suggested_tool: available ? operation : null, guidance, next_calls: nextCalls });
  }

  async function slots(value) {
    const result = { ...value };
    for (const key of ["top_actions", "recommendations"]) {
      if (Array.isArray(value[key])) result[key] = await Promise.all(value[key].map(action));
    }
    if (value.next_action !== undefined) result.next_action = await action(value.next_action);
    return result;
  }
  return slots;
}
