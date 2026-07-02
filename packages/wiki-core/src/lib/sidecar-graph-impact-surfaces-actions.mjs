import { uniqueStrings } from "./sidecar-graph-impact-shared.mjs";

export function firstNodeByKind(impact, nodesById, kinds) {
  for (const nodeId of impact.node_ids || []) {
    const node = nodesById.get(nodeId);
    if (node && kinds.has(node.kind)) {
      return node;
    }
  }
  return null;
}

function targetingForSurface({ kind, name = null, path: surfacePath = null, line = null }) {
  if (kind === "cli_command") {
    return {
      granularity: name ? "command" : "file",
      command: name,
      path: surfacePath,
      line,
      confidence: name ? "named_surface" : "file_surface"
    };
  }
  if (kind === "mcp_tool") {
    return {
      granularity: name ? "tool" : "file",
      tool: name,
      path: surfacePath,
      line,
      confidence: name ? "named_surface" : "file_surface"
    };
  }
  return null;
}

export function compactNodeSurface({ impact, node, surfaceKind }) {
  const surfacePath = node?.path ?? impact.input_path ?? null;
  const line = node?.line ?? null;
  const targeting = targetingForSurface({
    kind: surfaceKind,
    name: node?.name ?? null,
    path: surfacePath,
    line
  });
  return {
    kind: surfaceKind,
    name: node?.name ?? null,
    path: surfacePath,
    line,
    input_path: impact.input_path,
    severity: impact.severity,
    reason: impact.reason,
    ...(targeting ? { targeting } : {}),
    provenance: impact.provenance
  };
}

export function uniqueSurfaceEntries(entries, keyForEntry, limit = 10) {
  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const key = keyForEntry(entry);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
}

function terminalStatus(status) {
  return new Set(["done", "accepted", "rejected", "superseded", "deprecated"]).has(
    String(status || "").toLowerCase()
  );
}

export function summaryFocusTokens(result) {
  const text = [
    ...(result.input_paths || []),
    ...(result.affected_paths || []),
    ...(result.validated_paths || []),
    ...(result.structural_impacts || []).flatMap((impact) => [
      impact.kind,
      impact.input_path,
      impact.reason
    ]),
    ...(result.missing_update_hints || []).flatMap((hint) => [
      hint.kind,
      hint.input_path,
      hint.missing_surface,
      hint.reason,
      ...(hint.suggested_paths || [])
    ])
  ].join(" ");
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (token) =>
          token.length >= 4 &&
          !["docs", "wiki", "tests", "packages", "src", "lib", "path"].includes(token)
      )
  );
}

function textFocusScore(value, focusTokens) {
  const text = String(value || "").toLowerCase();
  let score = 0;
  for (const token of focusTokens) {
    if (text.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function refFocusScore(ref, focusTokens) {
  const text = [
    ref.id,
    ref.title,
    ref.path,
    ...(ref.match_explanations || []).flatMap((explanation) => [
      explanation.declared_path,
      explanation.input_path,
      explanation.related_id
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of focusTokens) {
    if (text.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function surfaceFocusScore(entry, focusTokens) {
  return (
    textFocusScore(entry.name, focusTokens) +
    textFocusScore(entry.path, focusTokens) +
    textFocusScore(entry.targeting?.command, focusTokens) +
    textFocusScore(entry.targeting?.tool, focusTokens)
  );
}

export function sortFocusedSurfaces(entries, focusTokens) {
  return [...entries].sort(
    (left, right) =>
      surfaceFocusScore(right, focusTokens) - surfaceFocusScore(left, focusTokens) ||
      String(left.path || "").localeCompare(String(right.path || "")) ||
      String(left.name || "").localeCompare(String(right.name || ""))
  );
}

function entryTargetPaths(entry) {
  return uniqueStrings([
    entry.path,
    ...(entry.suggested_paths || []),
    ...(entry.target_paths || [])
  ].filter(Boolean)).sort((left, right) => left.localeCompare(right));
}

function actionItemFocusScore(entry, focusTokens) {
  return (
    surfaceFocusScore(entry, focusTokens) +
    textFocusScore(entry.kind, focusTokens) +
    textFocusScore(entry.surface, focusTokens) +
    textFocusScore(entry.reason, focusTokens) +
    textFocusScore(entry.input_path, focusTokens) +
    textFocusScore((entry.input_paths || []).join(" "), focusTokens) +
    textFocusScore((entry.suggested_paths || []).join(" "), focusTokens) +
    textFocusScore((entry.target_paths || []).join(" "), focusTokens)
  );
}

function actionItemMatchStrength(entry, validPaths = new Set()) {
  const targetPaths = entryTargetPaths(entry);
  let score = 0;
  if (entry.targeting?.confidence === "named_surface") {
    score += 8;
  }
  if (entry.name) {
    score += 3;
  }
  if (entry.path) {
    score += 2;
  }
  if (targetPaths.some((targetPath) => validPaths.has(targetPath))) {
    score += 2;
  }
  if (entry.action === "must_update") {
    score += 1;
  }
  if (entry.kind === "check_downstream_surface") {
    score += 1;
  }
  return score;
}

function actionItemSurfaceName(entry) {
  return String(entry.name || entry.targeting?.command || entry.targeting?.tool || "");
}

function isGraphImpactValidationAction(entry) {
  const name = actionItemSurfaceName(entry).toLowerCase();
  return (
    (entry.kind === "cli_command" || entry.kind === "mcp_tool") &&
    (name.includes("graph-impact") || name.includes("graph_impact"))
  );
}

function actionItemPlanningPriority(entry) {
  if (entry.action === "must_update") {
    return 100;
  }
  if (isGraphImpactValidationAction(entry)) {
    return 80;
  }
  if (
    (entry.kind === "cli_command" || entry.kind === "mcp_tool") &&
    entry.targeting?.confidence === "named_surface"
  ) {
    return 60;
  }
  if (entry.kind === "check_downstream_surface") {
    return 50;
  }
  if (
    entry.kind === "docs_contract" ||
    entry.kind === "missing_docs_contract_check" ||
    entry.kind === "missing_structural_test_coverage" ||
    entry.kind === "protocol_docs_check" ||
    entry.kind === "test" ||
    entry.surface === "docs_contract" ||
    entry.surface === "test"
  ) {
    return 20;
  }
  return 40;
}

function actionItemRank(entry, { focusTokens, validPaths }) {
  return {
    planningPriority: actionItemPlanningPriority(entry),
    focusScore: actionItemFocusScore(entry, focusTokens),
    matchStrength: actionItemMatchStrength(entry, validPaths),
    targetPath: entryTargetPaths(entry)[0] || "",
    name: actionItemSurfaceName(entry),
    inputPath: entry.input_path || (entry.input_paths || [])[0] || ""
  };
}

function compareActionItems(left, right, options) {
  const leftRank = actionItemRank(left, options);
  const rightRank = actionItemRank(right, options);
  return (
    rightRank.planningPriority - leftRank.planningPriority ||
    rightRank.focusScore - leftRank.focusScore ||
    rightRank.matchStrength - leftRank.matchStrength ||
    String(left.action || "").localeCompare(String(right.action || "")) ||
    String(left.kind || "").localeCompare(String(right.kind || "")) ||
    leftRank.targetPath.localeCompare(rightRank.targetPath) ||
    leftRank.name.localeCompare(rightRank.name) ||
    leftRank.inputPath.localeCompare(rightRank.inputPath)
  );
}

function actionItemGroupingTarget(entry) {
  const targetPaths = entryTargetPaths(entry);
  if (targetPaths.length === 0) {
    return null;
  }
  const groupingKinds = new Set([
    "docs_contract",
    "missing_docs_contract_check",
    "missing_structural_test_coverage",
    "protocol_docs_check",
    "test"
  ]);
  if (
    groupingKinds.has(entry.kind) ||
    entry.surface === "docs_contract" ||
    entry.surface === "test"
  ) {
    return targetPaths.join(",");
  }
  return null;
}

function mergeActionItemGroup(existing, next) {
  const inputPaths = uniqueStrings([
    ...(existing.input_paths || []),
    existing.input_path,
    ...(next.input_paths || []),
    next.input_path
  ].filter(Boolean)).sort((left, right) => left.localeCompare(right));
  const targetPaths = uniqueStrings([
    ...(existing.target_paths || []),
    ...entryTargetPaths(existing),
    ...(next.target_paths || []),
    ...entryTargetPaths(next)
  ].filter(Boolean)).sort((left, right) => left.localeCompare(right));
  const suggestedPaths = uniqueStrings([
    ...(existing.suggested_paths || []),
    ...(next.suggested_paths || [])
  ].filter(Boolean)).sort((left, right) => left.localeCompare(right));
  const reasons = uniqueStrings([
    ...(existing.reasons || []),
    existing.reason,
    ...(next.reasons || []),
    next.reason
  ].filter(Boolean)).sort((left, right) => left.localeCompare(right));

  return {
    ...existing,
    suggested_paths: suggestedPaths.length > 0 ? suggestedPaths : existing.suggested_paths,
    input_paths: inputPaths,
    target_paths: targetPaths,
    count: (existing.count || 1) + (next.count || 1),
    ...(reasons.length > 1 ? { reasons } : {})
  };
}

function groupActionItems(items) {
  const grouped = new Map();
  const ordered = [];
  for (const item of items) {
    const groupingTarget = actionItemGroupingTarget(item);
    if (!groupingTarget) {
      ordered.push(item);
      continue;
    }
    const key = [
      item.action,
      item.kind,
      item.surface || "",
      item.name || "",
      groupingTarget
    ].join("|");
    if (grouped.has(key)) {
      grouped.set(key, mergeActionItemGroup(grouped.get(key), item));
    } else {
      grouped.set(key, {
        ...item,
        input_paths: uniqueStrings([...(item.input_paths || []), item.input_path].filter(Boolean)),
        target_paths: entryTargetPaths(item),
        count: item.count || 1
      });
    }
  }
  return [...ordered, ...grouped.values()];
}

function graphCanonicalRefPriority(ref, focusTokens = new Set()) {
  const id = String(ref.id || "");
  const isWorkRecord = /^(?:WK|IN)-\d{4}$/.test(id);
  const isClosedIssue = ref.issue_state === "closed";
  const activeWork = isWorkRecord && !isClosedIssue && !terminalStatus(ref.status);
  const closedWork = isWorkRecord && (isClosedIssue || terminalStatus(ref.status));
  const sourcePriority = {
    canonical_docs: 5,
    decision: 4,
    canonical_wiki: 3,
    area: 2,
    issue: 1
  }[ref.source_kind] ?? 0;

  return {
    activeWork,
    closedWork,
    focusScore: refFocusScore(ref, focusTokens),
    priority_score: (ref.score || 0) - (closedWork ? 225 : 0) + sourcePriority
  };
}

function compareGraphCanonicalRefs(left, right, focusTokens) {
  const leftPriority = graphCanonicalRefPriority(left, focusTokens);
  const rightPriority = graphCanonicalRefPriority(right, focusTokens);
  return (
    (right.best_match_weight || 0) - (left.best_match_weight || 0) ||
    rightPriority.focusScore - leftPriority.focusScore ||
    Number(rightPriority.activeWork) - Number(leftPriority.activeWork) ||
    Number(leftPriority.closedWork) - Number(rightPriority.closedWork) ||
    rightPriority.priority_score - leftPriority.priority_score ||
    String(right.updated || "").localeCompare(String(left.updated || "")) ||
    String(left.id || "").localeCompare(String(right.id || "")) ||
    String(left.path || "").localeCompare(String(right.path || ""))
  );
}

export function rankGraphCanonicalRefs(refs, result) {
  const focusTokens = summaryFocusTokens(result);
  return [...(refs || [])]
    .sort((left, right) => compareGraphCanonicalRefs(left, right, focusTokens))
    .map((ref, index) => {
      const priority = graphCanonicalRefPriority(ref, focusTokens);
      return {
        ...ref,
        graph_summary_rank: index + 1,
        graph_summary_focus_score: priority.focusScore,
        graph_summary_priority: priority.activeWork
          ? "active_work"
          : priority.closedWork
            ? "closed_work"
            : "canonical_context"
      };
    });
}

export function actionForHint(hint) {
  if (hint.action === "must_update" || hint.required === true) {
    return "must_update";
  }
  return "check_this";
}

function actionForSurface(entry) {
  if (entry.action === "must_update" || entry.required === true) {
    return "must_update";
  }
  return "check_this";
}

function actionItemFromHint(hint) {
  return {
    action: actionForHint(hint),
    kind: hint.kind,
    input_path: hint.input_path,
    surface: hint.missing_surface,
    suggested_paths: hint.suggested_paths || [],
    reason: hint.reason,
    provenance: hint.provenance
  };
}

function actionItemFromSurface(entry) {
  return {
    action: actionForSurface(entry),
    kind: entry.kind,
    name: entry.name ?? null,
    path: entry.path ?? null,
    input_path: entry.input_path,
    reason: entry.reason,
    ...(entry.targeting ? { targeting: entry.targeting } : {}),
    provenance: entry.provenance
  };
}

function sortActionItems(items, options) {
  return [...items].sort((left, right) => compareActionItems(left, right, options));
}

export function createActionBuckets({ surfaces, missingUpdateHints, focusTokens, validPaths }) {
  const items = [
    ...surfaces.cli.map(actionItemFromSurface),
    ...surfaces.mcp.map(actionItemFromSurface),
    ...surfaces.code.map(actionItemFromSurface),
    ...surfaces.likelyTests.map(actionItemFromSurface),
    ...surfaces.docsContracts.map(actionItemFromSurface),
    ...(missingUpdateHints || []).map(actionItemFromHint)
  ].filter(
    (entry) =>
      !(
        entry.kind === "check_downstream_surface" &&
        Array.isArray(entry.suggested_paths) &&
        entry.suggested_paths.length === 0
      )
  );
  const grouped = groupActionItems(items);
  const sorted = sortActionItems(grouped, { focusTokens, validPaths });
  return {
    must_update: uniqueSurfaceEntries(
      sorted.filter((entry) => entry.action === "must_update"),
      (entry) =>
        `${entry.kind}:${entry.input_path}:${entry.path || ""}:${(entry.suggested_paths || []).join(",")}`
    ),
    check_this: uniqueSurfaceEntries(
      sorted.filter((entry) => entry.action === "check_this"),
      (entry) =>
        `${entry.kind}:${actionItemSurfaceName(entry)}:${entry.path || ""}:${(entry.suggested_paths || []).join(",")}:${(entry.input_paths || [entry.input_path || ""]).join(",")}`
    )
  };
}

function groupTargetForImpact(impact, nodesById) {
  if (impact.kind === "schema_field_contract") {
    return firstNodeByKind(impact, nodesById, new Set(["schema_field"]));
  }
  if (impact.kind === "docs_contract") {
    return firstNodeByKind(impact, nodesById, new Set(["docs_contract"]));
  }
  if (impact.kind === "downstream_cli_command") {
    return firstNodeByKind(impact, nodesById, new Set(["cli_command"]));
  }
  if (impact.kind === "downstream_mcp_tool") {
    return firstNodeByKind(impact, nodesById, new Set(["mcp_tool"]));
  }
  return null;
}

export function createImpactGroups(impacts, nodesById) {
  const groups = new Map();
  impacts.forEach((impact, index) => {
    const target = groupTargetForImpact(impact, nodesById);
    if (!target) {
      return;
    }
    const key =
      impact.kind === "schema_field_contract" || impact.kind === "docs_contract"
        ? impact.kind
        : `${impact.kind}:${target.kind}:${target.path || ""}:${target.name || ""}`;
    const group =
      groups.get(key) ||
      {
        kind: impact.kind,
        target_kind: target.kind,
        target_name: target.name ?? null,
        target_path: target.path ?? null,
        target_names: [],
        target_paths: [],
        action: "check_this",
        count: 0,
        input_paths: [],
        impact_indexes: [],
        provenance: impact.provenance
      };
    group.count += 1;
    group.input_paths.push(impact.input_path);
    if (target.name) {
      group.target_names.push(target.name);
    }
    if (target.path) {
      group.target_paths.push(target.path);
    }
    const targeting = targetingForSurface({
      kind:
        target.kind === "cli_command"
          ? "cli_command"
          : target.kind === "mcp_tool"
            ? "mcp_tool"
            : target.kind,
      name: target.name ?? null,
      path: target.path ?? null,
      line: target.line ?? null
    });
    if (targeting) {
      group.targeting = targeting;
    }
    group.impact_indexes.push(index);
    groups.set(key, group);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      input_paths: uniqueStrings(group.input_paths).sort((left, right) => left.localeCompare(right)),
      target_names: uniqueStrings(group.target_names).sort((left, right) => left.localeCompare(right)),
      target_paths: uniqueStrings(group.target_paths).sort((left, right) => left.localeCompare(right)),
      ...(group.targeting ? { targeting: group.targeting } : {}),
      impact_indexes: group.impact_indexes
    }))
    .filter((group) => group.count > 1 || group.kind === "schema_field_contract" || group.kind === "docs_contract")
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.kind.localeCompare(right.kind) ||
        String(left.target_path || "").localeCompare(String(right.target_path || "")) ||
        String(left.target_name || "").localeCompare(String(right.target_name || ""))
    );
}
