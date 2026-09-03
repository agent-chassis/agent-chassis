

import { analyzeWorkRecordFindingsUnit } from "./work-record-findings-semantics.mjs";

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isString(value) {
  return typeof value === "string";
}

export function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

export function createDiagnostic(code, message, { severity = "error", path = null } = {}) {
  return { code, severity, message, path };
}

export function escapeInlineCode(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

export function renderSectionHeading(title) {
  return `## ${title}`;
}

export function renderParagraph(text) {
  const normalized = String(text ?? "").trim();
  return normalized ? normalized : "- None";
}

export function renderBulletList(
  items,
  { empty = "- None", formatter = (value) => String(value) } = {}
) {
  if (!Array.isArray(items) || items.length === 0) {
    return empty;
  }
  return items.map((item) => `- ${formatter(item)}`).join("\n");
}

export function renderKeyValueBulletList(pairs, { empty = "- None" } = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return empty;
  }
  return pairs.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

export function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => isString(entry)) : [];
}

export function normalizeAgentNotes(value) {
  return Array.isArray(value) ? value.join("\n") : isString(value) ? value : "";
}

export function formatRecordId(record) {
  return escapeInlineCode(record?.id || "(missing)");
}

export function formatRepoPath(value) {
  return escapeInlineCode(value);
}

export function formatValidationCommand(value) {
  return escapeInlineCode(value);
}

export function formatFieldList(value) {
  return renderBulletList(stringList(value), {
    empty: "- None",
    formatter: (entry) => escapeInlineCode(entry)
  });
}

export function formatChildEntry(child, { selected = false } = {}) {
  const parts = [
    `${formatRecordId(child)}: ${String(child?.title ?? "(missing)")}`
  ];
  if (child?.relation) {
    parts.push(`relation: ${escapeInlineCode(child.relation)}`);
  }
  if (child?.work_kind) {
    parts.push(`work kind: ${escapeInlineCode(child.work_kind)}`);
  }
  if (child?.status) {
    parts.push(`status: ${escapeInlineCode(child.status)}`);
  }
  if (child?.dispatch_unit_ref) {
    parts.push(`dispatch unit: ${escapeInlineCode(child.dispatch_unit_ref)}`);
  }
  if (selected) {
    parts.push("selected: true");
  }
  return `- ${parts.join(", ")}`;
}

function findingsReviewPurposeLabel(slice) {
  const purpose = analyzeWorkRecordFindingsUnit(slice).effective_review_purpose;
  return purpose === null ? null : `review purpose: ${escapeInlineCode(purpose)}`;
}

export function formatSliceEntry(slice, { selected = false } = {}) {
  const dispatchUnit = selected ? `${escapeInlineCode(slice?.id || "(missing)")}` : null;
  const agentNotes = normalizeAgentNotes(slice?.sections?.agent_notes);
  const details = [
    `${escapeInlineCode(slice?.id || "(missing)")}: ${String(slice?.title ?? "(missing)")}`,
    slice?.work_kind ? `work kind: ${escapeInlineCode(slice.work_kind)}` : null,

    findingsReviewPurposeLabel(slice),
    slice?.status ? `status: ${escapeInlineCode(slice.status)}` : null,
    dispatchUnit ? `dispatch unit: ${dispatchUnit}` : null,
    agentNotes !== "" ? "agent notes: yes" : null
  ].filter(Boolean);
  return `- ${details.join(", ")}`;
}

export function formatEscalationEntry(escalation) {
  const parts = [
    `${escapeInlineCode(escalation?.id || "(missing)")}: ${String(escalation?.kind ?? "(missing)")}`,
    escalation?.status ? `status: ${escapeInlineCode(escalation.status)}` : null
  ].filter(Boolean);

  const lines = [parts.join(", ")];
  const scope = escalation?.scope || {};
  lines.push(
    `  - scope unit: ${escapeInlineCode(scope.unit || "(missing)")}`,
    `  - slice id: ${scope.slice_id === null ? "null" : escapeInlineCode(scope.slice_id || "")}`,
    `  - write scope:`,
    ...stringList(scope.write_scope).map((entry) => `    - ${escapeInlineCode(entry)}`),
    scope.max_blast_radius
      ? `  - max blast radius: ${escapeInlineCode(scope.max_blast_radius)}`
      : "  - max blast radius: -"
  );
  if (escalation?.reason) {
    lines.push(`  - reason: ${String(escalation.reason)}`);
  }
  if (escalation?.accepted_by) {
    lines.push(
      `  - accepted by: ${escapeInlineCode(escalation.accepted_by.actor || "(missing)")}, ${escapeInlineCode(escalation.accepted_by.id || "(missing)")}, source: ${escapeInlineCode(escalation.accepted_by.source || "(missing)")}`
    );
  }
  if (escalation?.accepted_at) {
    lines.push(`  - accepted at: ${escapeInlineCode(escalation.accepted_at)}`);
  }
  if (escalation?.expires_at) {
    lines.push(`  - expires at: ${escapeInlineCode(escalation.expires_at)}`);
  }
  if (escalation?.authority_ref) {
    lines.push(`  - authority ref: ${escapeInlineCode(escalation.authority_ref)}`);
  }
  if (escalation?.provenance) {
    lines.push(
      `  - provenance: source kind ${escapeInlineCode(escalation.provenance.source_kind || "(missing)")}, canonicality ${escapeInlineCode(escalation.provenance.canonicality || "(missing)")}, evidence basis ${escapeInlineCode(escalation.provenance.evidence_basis || "(missing)")}`
    );
  }
  return lines.join("\n");
}
