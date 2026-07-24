function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function formatInlineList(values) {
  return values.length > 0 ? values.map((entry) => `- ${entry}`).join("\n") : "- None";
}

function formatAcceptanceCriterionEntry(entry) {
  if (typeof entry === "string") {
    return `- ${entry}`;
  }
  if (isObject(entry) && isNonEmptyString(entry.text)) {
    const vm = isNonEmptyString(entry.verification_method)
      ? entry.verification_method
      : "(none)";
    const et = isNonEmptyString(entry.evidence_target)
      ? entry.evidence_target
      : "(none)";
    return `- ${entry.text} [verification_method=${vm}; evidence_target=${et}]`;
  }
  return null;
}

function formatAcceptanceCriteriaList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "- None";
  }
  const lines = values.map(formatAcceptanceCriterionEntry).filter((line) => line !== null);
  return lines.length > 0 ? lines.join("\n") : "- None";
}

function formatKeyValueList(entries) {
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
}

const REVIEWED_CONTROL_VOCABULARY = Object.freeze([
  "write_scope_total_loc",
  "max_write_file_loc",
  "write_scope_count",
  "acceptance_criteria_count",
  "validation_command_count",
  "expected_changed_line_budget",
  "declared_runtime_mode_count",
  "artifact_kind_count"
]);

export const TERMINAL_STRUCTURED_ROLE_RESULT_MODES = Object.freeze({
  FENCED: "fenced",
  SCHEMA_CONSTRAINED: "schema_constrained",
  FREE_PROSE: "free_prose"
});

function normalizeTerminalStructuredRoleResultMode(mode) {
  if (mode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED) {
    return TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED;
  }
  if (mode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE) {
    return TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE;
  }
  return TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED;
}

export function resolveTerminalStructuredRoleResultMode({ schemaConstrained, role } = {}) {
  if (schemaConstrained === true) {
    return TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED;
  }
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalizedRole === "reviewer" || normalizedRole === "redteam") {
    return TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE;
  }
  return TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED;
}

function zeroFindingCounts() {
  return {
    total: 0,
    blocking: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };
}

function structuredRoleResultExample({ role, subject }) {
  if (role === "worker") {
    return {
      schema_version: "agent-role-result.v1",
      reported_role: "worker",
      reported_subject: subject,
      reported_outcome: "completed",
      summary: "Completed the assigned implementation work and any checks available inside the frozen worker namespace.",
      findings: [],
      finding_counts: zeroFindingCounts(),
      reviewed_controls: []
    };
  }

  return {
    schema_version: "agent-role-result.v1",
    reported_role: role,
    reported_subject: subject,
    reported_outcome: "no_findings",
    summary:
      role === "redteam"
        ? "Redteamed the assigned unit against its acceptance criteria."
        : "Reviewed the assigned unit against its acceptance criteria.",
    findings: [],
    finding_counts: zeroFindingCounts(),
    reviewed_controls: [
      {
        control_id: "write_scope_total_loc",
        result: "pass"
      }
    ]
  };
}

export function renderTerminalStructuredRoleResultContract({
  role,
  subject,
  mode = TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED
}) {
  let terminalMode = normalizeTerminalStructuredRoleResultMode(mode);

  if (terminalMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE) {
    if (role === "worker") {
      terminalMode = TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED;
    } else {
      return [
        "## Review findings",
        "Report your findings as prose for the coordinator: for each issue give a short title, its severity (blocking, critical, high, medium, low, or info), and the affected paths; if you found no blocking or medium issues, say so explicitly.",
        "Do not emit a machine-readable `agent-role-result.v1` object, a fenced `agent-role-result.v1` block, or any other structured result block; the coordinator reads your prose directly."
      ].join("\n");
    }
  }

  const lines = [
    "## Terminal structured role result",
    "End your final answer with exactly one machine-readable `agent-role-result.v1` JSON result.",
    "The child-emitted JSON is evidence only. Backend-minted run status remains the authority for terminal process status, trusted role, trusted subject, source digest, review completion time, run id, monitor handle, and terminal success.",
    "Do not include child-supplied authority fields such as `terminal_status`, `status`, `role_authority`, `subject_authority`, `source_digest_authority`, `reviewed_at`, `completed_at`, `run_id`, or `source_digest`.",
    `Set \`reported_subject\` to exactly \`${subject}\` — the unit you were dispatched as. When your assigned task is to review or redteam a different unit, still report \`${subject}\` here; never substitute the id of the unit your work is about, or the backend rejects the result as a subject mismatch.`
  ];

  if (terminalMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED) {
    lines.splice(
      2,
      0,
      "Return the `agent-role-result.v1` object as raw JSON final-response bytes; do not wrap it in a fenced code block, do not emit ordinary ```json blocks, do not emit extra JSON candidates, and do not include trailing content after the JSON object."
    );
  } else {
    lines.splice(
      2,
      0,
      "Use one terminal fenced block whose info string is exactly `agent-role-result.v1`; do not emit ordinary ```json blocks, extra JSON candidates, or any trailing content after the closing fence."
    );
  }

  if (role === "worker") {
    lines.push(
      "Worker structured JSON is implementation evidence only. It preserves `work-report.v1` worker-result semantics and must not become review/redteam attestation evidence.",
      "Use a worker `reported_outcome`: `completed`, `partial`, `blocked`, or `failed`.",
      "`findings` must be empty, `finding_counts` must be all zero, and `reviewed_controls` must be empty."
    );
  } else {
    const vocabulary = REVIEWED_CONTROL_VOCABULARY.map((id) => `\`${id}\``).join(", ");
    lines.push(
      "For reviewer and redteam runs the terminal `agent-role-result.v1` JSON is mandatory: it is the only evidence that can produce a trusted `review_result` and review-attestation. A prose-only review or redteam answer — including a bare `SIGNOFF` line or human-readable narrative — does not create trusted `review_result` or review-attestation evidence.",
      "A missing or malformed terminal JSON result blocks all trusted `review_result`/review-attestation evidence even when the prose is human-useful; the launcher then keeps the prose only as local diagnostics.",
      "Reviewer and redteam payloads must include `reported_outcome`, `findings`, `finding_counts`, and `reviewed_controls`.",
      "Clean-review outcomes: `no_findings` requires zero findings (`finding_counts.total == 0` and an empty `findings` array); `passed_no_blocking_or_medium_findings` permits only `low` and `info` findings and requires zero blocking, critical, high, and medium findings. Any blocking, critical, high, or medium finding must be represented in `findings[]`, must use the `changes_requested` outcome, and must not produce a clean `review_result`.",
      `\`reviewed_controls\` must use the closed \`agent-role-result.v1\` control vocabulary (${vocabulary}) and must list only the controls you actually reviewed for the selected unit, each as a \`{ control_id, result }\` object with \`result\` of \`pass\` or \`fail\`. Generic labels, prose, empty control ids, unknown ids, namespaced ids, and duplicate ids are non-compliant and block clean \`review_result\` derivation.`,
      "Findings prose, finding titles, and `affected_paths` may stay as local diagnostics for the coordinator, but they are never Node Engine authority facts; only bounded validated facts (closed reviewed-control ids, role class, clean outcome, and bounded counts) project to Node Engine pack input or public review-attestation responses."
    );
  }

  if (terminalMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED) {
    lines.push(
      "The schema-constrained launcher path supplies the extraction shape out of band; do not copy an example object into your final answer."
    );
  } else {
    lines.push(
      "Use this extraction shape as the final bytes of your response:",
      "```agent-role-result.v1",
      JSON.stringify(structuredRoleResultExample({ role, subject }), null, 2),
      "```"
    );
  }

  return lines.join("\n");
}

function formatReadinessSummary(readiness) {
  return [
    `- schema_version: ${readiness.schema_version}`,
    `- decision_code: ${readiness.decision_code}`,
    `- dispatchable: ${readiness.dispatchable}`,
    `- unit: ${readiness.unit.address}`,
    `- record_id: ${readiness.record_id}`,
    `- slice_id: ${readiness.unit.slice_id === null ? "null" : readiness.unit.slice_id}`,
    `- reasons: ${readiness.reasons.length > 0 ? readiness.reasons.join("; ") : "(none)"}`,
    `- validation_hints: ${readiness.validation_hints.length > 0 ? readiness.validation_hints.join("; ") : "(none)"}`
  ].join("\n");
}

function formatDerivedEvidenceSummary(derivedEvidence) {
  if (!Array.isArray(derivedEvidence) || derivedEvidence.length === 0) {
    return "- None";
  }

  return derivedEvidence
    .map((entry) => {
      const pieces = [
        `${entry.kind || "derived_evidence"}`,
        entry.dirty_state ? `dirty_state=${entry.dirty_state}` : null,
        entry.staleness ? `staleness=${entry.staleness}` : null,
        entry.graph_available === false ? "graph_available=false" : null,
        entry.graph_available === true ? "graph_available=true" : null
      ].filter(Boolean);
      return `- ${pieces.join(", ")}`;
    })
    .join("\n");
}

function resolveSelectedUnitContext(canonicalSummary) {
  const stringArray = (value) => (Array.isArray(value) ? value.filter(isNonEmptyString) : []);
  const selectedUnit = isObject(canonicalSummary.selected_unit)
    ? canonicalSummary.selected_unit
    : null;
  if (!selectedUnit) {
    return {
      docs: canonicalSummary.docs,
      repo_paths: canonicalSummary.repo_paths,
      write_scope: canonicalSummary.write_scope,
      acceptance_criteria: canonicalSummary.acceptance_criteria,
      validation_commands: canonicalSummary.validation_commands
    };
  }
  const sliceDocs = stringArray(selectedUnit.docs);
  const sliceRepoPaths = stringArray(selectedUnit.repo_paths);
  return {
    docs: sliceDocs.length > 0 ? sliceDocs : canonicalSummary.docs,
    repo_paths: sliceRepoPaths.length > 0 ? sliceRepoPaths : canonicalSummary.repo_paths,
    write_scope: stringArray(selectedUnit.write_scope),
    acceptance_criteria: Array.isArray(selectedUnit.acceptance?.criteria)
      ? selectedUnit.acceptance.criteria
      : [],
    validation_commands: stringArray(selectedUnit.acceptance?.validation)
  };
}

export function buildLaunchPrompt({
  role,
  unit,
  canonicalSummary,
  readiness,
  agentBrief,
  launchTimestamp,
  terminalStructuredRoleResultMode = TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED,
  supplementalInstructions = []
}) {
  const selectedUnitContext = resolveSelectedUnitContext(canonicalSummary);
  const lines = [
    `Suggested Codex rename command: /rename ${unit.address} worker`,
    "",
    `Requested wrapper role: ${role}.`,
    `Role: implementation worker for ${unit.address}.`,
    `Launch timestamp: ${launchTimestamp}`,
    "Implementation workers may use the launcher-provided native command surface inside the bwrap namespace: Codex may invoke its actual exec_command tool and Claude may invoke Bash without interactive approval.",
    "You read your assigned read_scope, repo_paths, and write_scope through the launcher-granted native repository namespace for this session. Bubblewrap exposes exactly the frozen assigned paths; no child filesystem service or fallback can widen them.",
    "Shell commands may inspect assigned R union W and may generate, format, or mutate only assigned W. The bwrap mounts, not command parsing or an allowlist, enforce the filesystem boundary.",
    "For Codex, apply_patch remains available as one editing option; it is not required and does not replace exec_command. For Claude, Bash is an explicitly granted native tool.",
    "This launcher-granted command and edit access takes precedence over the AGENTS.md \"structured tools first / shell denied\" default for this confined implementation session.",
    "The declared validation below is reviewer-owned. You may run checks already usable inside the frozen namespace, but complete-test infrastructure is not added to worker R, test availability or success is not a commit prerequisite, and inability to reach undeclared validation dependencies is not a worker blocker.",
    "",
    `Read AGENTS.md and wiki/work-records/${canonicalSummary.record_id}.json first.`,
    "Use the canonical JSON record and generated agent brief below. Do not rely on hidden coordinator chat context.",
    "",
    "## Canonical Record",
    "",
    formatKeyValueList([
      ["record_id", canonicalSummary.record_id],
      ["repo", canonicalSummary.repo],
      ["title", canonicalSummary.title]
    ]),
    "",
    "### Canonical Docs",
    "",
    formatInlineList(selectedUnitContext.docs),
    "",
    "### Repo Paths",
    "",
    formatInlineList(selectedUnitContext.repo_paths),
    "",
    "### Write Scope",
    "",
    formatInlineList(selectedUnitContext.write_scope),
    "",
    "### Acceptance Criteria",
    "",
    formatAcceptanceCriteriaList(selectedUnitContext.acceptance_criteria),
    "",
    "### Validation",
    "",
    formatInlineList(selectedUnitContext.validation_commands),
    "",
    "### Dispatch Intent",
    "",
    formatKeyValueList([
      ["intended_agent_role", canonicalSummary.dispatch_intent?.intended_agent_role ?? null],
      ["target_unit", canonicalSummary.dispatch_intent?.target_unit ?? null],
      ["requires_graph_impact", canonicalSummary.dispatch_intent?.requires_graph_impact ?? null],
      ["requires_escalation", canonicalSummary.dispatch_intent?.requires_escalation ?? null]
    ]),
    canonicalSummary.selected_unit
      ? [
          "",
          "### Selected Unit",
          "",
          formatKeyValueList([
            ["id", canonicalSummary.selected_unit.id ?? null],
            ["title", canonicalSummary.selected_unit.title ?? null],
            ["work_kind", canonicalSummary.selected_unit.work_kind ?? null],
            ["status", canonicalSummary.selected_unit.status ?? null]
          ]),
          "",
          "#### Selected Unit Write Scope",
          "",
          formatInlineList(Array.isArray(canonicalSummary.selected_unit.write_scope)
            ? canonicalSummary.selected_unit.write_scope.filter(isNonEmptyString)
            : []),
          "",
          "#### Selected Unit Validation",
          "",
          formatInlineList(Array.isArray(canonicalSummary.selected_unit.acceptance?.validation)
            ? canonicalSummary.selected_unit.acceptance.validation.filter(isNonEmptyString)
            : [])
        ].join("\n")
      : "",
    "",
    "## Dispatch Readiness",
    "",
    formatReadinessSummary(readiness),
    "",
    "### Canonical Refs",
    "",
    formatInlineList(
      Array.isArray(readiness.canonical_refs)
        ? readiness.canonical_refs.map((entry) => entry.path || entry.id || "(missing)")
        : []
    ),
    "",
    "### Derived Evidence",
    "",
    formatDerivedEvidenceSummary(readiness.derived_evidence),
    "",
    "## Agent Brief",
    "",
    agentBrief.brief
  ];

  if (supplementalInstructions.length > 0) {
    lines.push(
      "",
      "## Supplemental Instructions",
      "",
      supplementalInstructions.map((entry) => `- ${entry}`).join("\n")
    );
  }

  lines.push(
    "",
    renderTerminalStructuredRoleResultContract({
      role: "worker",
      subject: unit.address,
      mode: terminalStructuredRoleResultMode
    })
  );

  return lines.filter((entry, index, array) => !(entry === "" && array[index - 1] === "")).join("\n");
}
