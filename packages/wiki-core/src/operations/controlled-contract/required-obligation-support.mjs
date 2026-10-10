

import { assessProofAuthoringRowSemantics } from "@agent-chassis/controlled-contract/proof-contract";

const compare = (left, right) => String(left).localeCompare(String(right));

export function requiredObligationSupport(rows, claimId, subject, contractNodes) {
  const obligationIds = [];
  const diagnostics = [];
  const candidates = [];
  for (const [index, row] of rows.entries()) {
    const ids = row.controlled_contract_node_ids;
    if (!Array.isArray(ids) || !ids.includes(claimId)) continue;
    if (Array.isArray(row.diagnostics)) diagnostics.push(...structuredClone(row.diagnostics));
    if (row.wk_id !== undefined && row.wk_id !== subject.wk_id) continue;
    if (row.focus !== undefined && (row.focus ?? null) !== subject.focus) continue;
    const semanticDiagnostics = assessProofAuthoringRowSemantics(row, `/obligations/${index}`,
      { contract_nodes: contractNodes });
    diagnostics.push(...structuredClone(semanticDiagnostics));
    const qualifies = semanticDiagnostics.length === 0 && typeof row.obligation_id === "string" &&
      row.obligation_id.length > 0 && typeof row.statement === "string" &&
      row.statement.trim().length > 0;
    if (qualifies) obligationIds.push(row.obligation_id);
    candidates.push({ row, qualifies });
  }
  return { obligationIds: obligationIds.sort(compare), diagnostics, candidates };
}
