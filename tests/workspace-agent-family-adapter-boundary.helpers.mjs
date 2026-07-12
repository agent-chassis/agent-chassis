

import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC_ROOT = "../packages/agent-launch-cli/src/";
const CORE_SRC_ROOT = "../packages/agent-launch-core/src/";
const SRC_ROOT_PATH = fileURLToPath(new URL(SRC_ROOT, import.meta.url));

export function load(rel) {
  const path = fileURLToPath(new URL(SRC_ROOT + rel, import.meta.url));
  const source = readFileSync(path, "utf8");
  return { rel, path, source, lines: source.split(/\r?\n/) };
}

export function loadCore(rel) {
  const path = fileURLToPath(new URL(CORE_SRC_ROOT + rel, import.meta.url));
  const source = readFileSync(path, "utf8");
  return { rel, path, source, lines: source.split(/\r?\n/) };
}

export const FILES = Object.freeze({
  codexExecutor: load("lib/workspace-agent-dispatch-codex-executor.mjs"),
  claudeExecutor: load("lib/workspace-agent-dispatch-claude-executor.mjs"),
  agyExecutor: load("lib/workspace-agent-dispatch-agy-executor.mjs"),
  codexRoleAdapter: load("lib/workspace-agent-codex-role-adapter.mjs"),
  codexRolePrompts: load("lib/codex-role-prompts.mjs"),
  agentBackend: load("lib/agent-backend.mjs"),

  agentBackendRequest: load("lib/agent-backend-request.mjs"),
  agentBackendDecision: load("lib/agent-backend-decision.mjs"),
  agentBackendRegistryAuthority: load("lib/agent-backend-registry-authority.mjs"),
  agentBackendSourceSurface: load("lib/agent-backend-source-surface.mjs"),

  codexFinalResult: load("lib/workspace-agent-codex-final-result.mjs"),
  claudeOrchestrator: load("lib/claude-orchestrator-plan.mjs"),
  codexRole: load("commands/codex-role.mjs"),
  orchestratorCmd: load("commands/orchestrator.mjs"),
  resumeCmd: load("commands/resume.mjs"),
  runEntry: load("run.mjs"),

  orchestratorLaunchDispatch: load("lib/orchestrator-launch-dispatch.mjs"),
});

export const EXECUTORS = Object.freeze([
  FILES.codexExecutor,
  FILES.claudeExecutor,
  FILES.agyExecutor,
]);

export const FAMILY_ORCHESTRATORS = Object.freeze([
  FILES.claudeOrchestrator,
  FILES.codexRole,
]);

export const WK1089_BOUNDARY_FILES = Object.freeze([
  FILES.codexExecutor,
  FILES.claudeExecutor,
  FILES.agyExecutor,
  FILES.codexRoleAdapter,
  FILES.codexRolePrompts,
  FILES.codexRole,
  FILES.agentBackend,
  FILES.agentBackendRequest,
  FILES.agentBackendDecision,
  FILES.agentBackendRegistryAuthority,
  FILES.agentBackendSourceSurface,
  FILES.claudeOrchestrator,
]);

export const WK1089_JUSTIFIED_EXCLUSIONS = Object.freeze([
  {
    rel: "commands/agent-role.mjs",
    reason: "shared command-role contract/refusal surface; not a family adapter launch-plan consumer",
  },
  {
    rel: "commands/install-drift-check.mjs",
    reason: "operator drift-check command surface; not a family adapter launch-plan consumer",
  },
  {
    rel: "commands/orchestrator.mjs",
    reason: "covered by the split entrypoint scan, not the WK-1089 family adapter registry",
  },
  {
    rel: "commands/redteam.mjs",
    reason: "public dispatch command entrypoint; routes through shared backend rather than owning family adapter policy",
  },
  {
    rel: "commands/resume.mjs",
    reason: "covered by the split entrypoint scan, not the WK-1089 family adapter registry",
  },
  {
    rel: "commands/review.mjs",
    reason: "public dispatch command entrypoint; routes through shared backend rather than owning family adapter policy",
  },
  {
    rel: "commands/role-guard.mjs",
    reason: "post-launch role guard command, not a launch-plan/prompt/refusal family adapter producer",
  },
  {
    rel: "commands/worker.mjs",
    reason: "public dispatch command entrypoint; routes through shared backend rather than owning family adapter policy",
  },
  {
    rel: "lib/agent-backend-verifier.mjs",
    reason: "filesystem-MCP backend verifier shared substrate, not a family adapter consumer",
  },
  {
    rel: "lib/agent-child-tool-surface.mjs",
    reason: "shared source-tool-surface descriptor/refusal substrate, not a family adapter consumer",
  },
  {
    rel: "lib/agent-launch-profiles.mjs",
    reason: "profile resolution substrate; family adapters consume its facts but it is not a family adapter",
  },
  {
    rel: "lib/codex-role-refusal-format.mjs",
    reason: "formatting-only Codex command helper, not a launch-plan/prompt/refusal policy consumer",
  },
  {
    rel: "lib/codex-role-run-capture.mjs",
    reason: "Codex run-capture/result-source helper covered outside WK-1089's adapter registry",
  },
  {
    rel: "lib/codex-worker-plan.mjs",
    reason: "legacy Codex worker-plan builder; WK-1089 registry targets dispatch executors plus role adapter/prompt path",
  },
  {
    rel: "lib/filesystem-mcp-authority-bridge.mjs",
    reason: "shared filesystem-MCP bridge substrate, not a family adapter launch-plan consumer",
  },
  {
    rel: "lib/host-write-authority-launch-input-fields.mjs",
    reason: "shared host-write launch-input field list, not a family adapter",
  },
  {
    rel: "lib/host-write-authority-substrate.mjs",
    reason: "shared host-write substrate constants, not a family adapter",
  },

  {
    rel: "lib/host-write-authority-substrate/adapter.mjs",
    reason: "shared host-write substrate (broker/endpoint adapter), not a family adapter",
  },
  {
    rel: "lib/host-write-authority-substrate/broker.mjs",
    reason: "shared host-write substrate (broker policy/dispatch), not a family adapter",
  },
  {
    rel: "lib/host-write-authority-substrate/broker-server.mjs",
    reason: "shared host-write substrate (broker server transport), not a family adapter",
  },
  {
    rel: "lib/host-write-authority-substrate/forbidden-token-scan.mjs",
    reason: "shared host-write substrate (forbidden-token scan helper), not a family adapter",
  },
  {
    rel: "lib/host-write-authority-substrate/protocol-constants.mjs",
    reason: "shared host-write substrate protocol constants, not a family adapter",
  },
  {
    rel: "lib/host-write-authority-substrate/request-envelopes.mjs",
    reason: "shared host-write substrate request envelopes, not a family adapter",
  },
  {
    rel: "lib/launch-isolation.mjs",
    reason: "shared isolation substrate, not a family adapter",
  },
  {
    rel: "lib/orchestrator-launch-isolation.mjs",
    reason: "shared operator-orchestrator isolation substrate, not a family adapter",
  },
  {
    rel: "lib/orchestrator-launch-settings.mjs",
    reason: "shared orchestrator settings substrate, not a family adapter",
  },
  {
    rel: "lib/orchestrator-refusal-taxonomy.mjs",
    reason: "shared orchestrator refusal taxonomy producer, not a family adapter",
  },
  {
    rel: "lib/workspace-agent-broker-plan-policy.mjs",
    reason: "shared broker plan policy producer, not a family adapter",
  },
  {
    rel: "lib/workspace-agent-codex-launch-policy.mjs",
    reason: "shared Codex launch-policy substrate already covered by executor scans, not a WK-1089 adapter registry input",
  },
  {
    rel: "lib/workspace-agent-dispatch-backend.mjs",
    reason: "shared dispatch backend, not a family adapter",
  },
  {
    rel: "lib/workspace-agent-dispatch-refusal.mjs",
    reason: "WK-1193 behavior-preserving extraction of the shared dispatch backend's refusal/status/run-identity helpers; family-neutral dispatch substrate, not a family adapter",
  },
  {
    rel: "lib/workspace-agent-dispatch-run-lifecycle.mjs",
    reason: "WK-1193 behavior-preserving extraction of the shared dispatch backend's run lifecycle (startLaunch/getRunStatus/waitForRunStatus/planLaunch); family-neutral dispatch substrate, not a family adapter",
  },
  {
    rel: "lib/workspace-agent-dispatch-source-access.mjs",
    reason: "WK-1193 behavior-preserving extraction of the shared dispatch backend's launcher-owned source-access policy gate; family-neutral dispatch substrate, not a family adapter",
  },
  {
    rel: "lib/workspace-agent-family-adapter-core.mjs",
    reason: "shared adapter core producer, not a family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-family-bwrap-plan.mjs",
    reason: "shared family bwrap-plan producer, not a family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-family-launch-policy.mjs",
    reason: "shared family launch-policy producer, not a family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-family-policy.mjs",
    reason: "shared family policy producer for later convergence slices, not a family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-findings-role-context.mjs",
    reason: "shared findings-acceptance producer; the boundary scan locks consumers to it",
  },
  {
    rel: "lib/workspace-agent-launch-adapter-contract.mjs",
    reason: "shared adapter contract substrate, not a family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-launch-core.mjs",
    reason: "shared launch core, not a family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-role-contract.mjs",
    reason: "shared role-contract/prompt renderer producer, not a family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-worker-admission.mjs",
    reason: "shared worker-admission substrate, not a family adapter",
  },
  {
    rel: "lib/workspace-agent-worker-admission/runtime.mjs",
    reason: "behavior-preserving extraction of the shared worker-admission decision/runtime substrate, not a family adapter",
  },

  {
    rel: "lib/workspace-agent-worker-admission-recovery/kernel.mjs",
    reason: "shared worker-admission recovery-projection kernel (taxonomy codes, reason-code vocabularies, fail-closed scalar allowlists), not a family adapter",
  },
  {
    rel: "lib/workspace-agent-worker-admission-recovery/cce-recovery-v1.mjs",
    reason: "shared worker-admission CCE recovery.v1 projection (bounded remedy_guidance carrier), not a family adapter",
  },
  {
    rel: "lib/workspace-agent-worker-admission-recovery/detail-builders.mjs",
    reason: "shared worker-admission recovery detail builders (precondition/needs_review/reject/remote-gate) + top-level projector, not a family adapter",
  },
  {
    rel: "lib/codex-role-mcp-env.mjs",
    reason: "existence-decision-only: reads and injects Codex MCP config facts, never resolves findings acceptance",
  },

  {
    rel: "lib/mcp-sandbox-profile.mjs",
    reason: "shared launcher MCP sandbox-profile policy surface (orchestrator-only cache/runtime-state mount capability + path-class authority, WK-1128); a shared launcher policy producer, not a family adapter consumer",
  },
  {
    rel: "commands/role-guard-claude-hook.mjs",
    reason: "post-launch Claude role-guard hook command surface; not a family adapter launch-plan/prompt/refusal consumer",
  },
  {
    rel: "lib/claude-auth-config-policy.mjs",
    reason: "Claude auth/config path-fact allowlist (harness auth/config surface facts); not a launch-plan/prompt/refusal family adapter consumer",
  },
  {
    rel: "lib/codex-role-io.mjs",
    reason: "pure Codex role command-surface filesystem/output helpers (WK-0661 extraction); no launcher policy, dispatch, isolation, or sidecar behavior",
  },
  {
    rel: "lib/codex-role-isolation.mjs",
    reason: "Codex role isolation seam; the role-posture partition is tracked DEC-0049 debt owned by WK-1166#SLICE-013, not a WK-1089 launch-plan adapter consumer",
  },
  {
    rel: "lib/codex-role-orchestrator-history.mjs",
    reason: "Codex orchestrator runtime-directory/meta/history-listing helpers (WK-0661 extraction); on-disk runtime-state model, not a launch-plan/prompt/refusal adapter",
  },
  {
    rel: "lib/codex-role-write-scope.mjs",
    reason: "Codex write-scope/sandbox-argv shaping helpers (WK-0661 extraction); harness argv-spelling facts, write-scope authority stays with shared launcher gates",
  },
  {
    rel: "lib/codex-role-wiki-mcp-override.mjs",
    reason: "Codex wiki-MCP config-override helpers (WK-1212 extraction from commands/codex-role.mjs); MCP transport-posture detection + synthesized stdio server/read-only-root facts, not a launch-plan/prompt/refusal/findings-acceptance family adapter consumer",
  },

  {
    rel: "lib/codex-role-sandbox-args.mjs",
    reason: "pure Codex sandbox-argv shaping facts (WK-1434 extraction from the Codex adapter): orchestrator-role predicate, repo-internal --add-dir extraction, env->setenv map, and the -C realpath rewrite; harness argv-spelling facts consumed by the adapter's plan builders, not a launch-plan/prompt/refusal family adapter consumer",
  },
  {
    rel: "lib/codex-role-read-only-support.mjs",
    reason: "Codex read-only (review/redteam) plan SUPPORT helpers (WK-1434 extraction from the Codex adapter): subject classification, the synthetic preparation-audit + sha256 digest, and the canonical reviewer subject-scope loader; consumed by the adapter's buildReadOnlyPlan, not a launch-plan/prompt/refusal family adapter consumer",
  },
  {
    rel: "lib/codex-role-reasoning-effort.mjs",
    reason: "Codex model/effort argv spelling (WK-1434 extraction from the Codex adapter); `-m`/`model_reasoning_effort` harness facts translated from the neutral role-effort resolver, not a launch-plan/prompt/refusal family adapter consumer",
  },
  {
    rel: "lib/codex-role-fact-refusal.mjs",
    reason: "Codex harness-fact-resolution refusal shape (WK-1434 extraction from the Codex adapter); recognizes an { ok:false, reason } fact-resolution failure and builds its refusal plan, not a launch-plan/prompt/refusal-policy family adapter consumer",
  },
  {
    rel: "lib/codex-role-sandbox-fail-open.mjs",
    reason: "Codex sandbox fail-open decision + isolation summaries + plain-spawn/refusal provenance formatters (WK-1434 extraction from commands/codex-role.mjs); reshapes plan/error/availability facts into the shared launcher fail-open contract, not a launch-plan/prompt/refusal family adapter consumer",
  },
  {
    rel: "lib/codex-role-orchestrator-runtime.mjs",
    reason: "Codex interactive operator-orchestrator execution runtime (WK-1434 extraction from commands/codex-role.mjs); bwrap/direct spawn-wait primitives + interactive-orchestrator child supervision, not a launch-plan/prompt/refusal family adapter consumer",
  },
  {
    rel: "lib/workspace-agent-codex-runtime-facts.mjs",
    reason: "Codex harness host/runtime FACTS (WK-1196 extraction): codex binary/source-home discovery, system-root classification, harness-extra runtime roots, and the launcher-minted per-launch runtime-home layout; on-disk runtime-state and PATH/source-home facts, not a launch-plan/prompt/refusal adapter consumer",
  },
  {
    rel: "lib/codex-worker-write-scope-plan.mjs",
    reason: "focused Codex worker write-scope planning helpers (WK-0764 extraction); mirrors planner write-scope classification, not a launch-plan/prompt/refusal adapter consumer",
  },
  {
    rel: "lib/workspace-agent-codex-final-result.mjs",
    reason: "Codex final-result capture/redaction/clean-review extraction (WK-1037#SLICE-026); covered by the family-orchestrator final-result delegation lock-in scan (SLICE-036), not the WK-1089 adapter registry",
  },
]);

const WK1089_POLICY_SURFACE_PREDICATE =
  /\b(?:build[A-Za-z0-9_]*(?:Plan|Prompt|Refusal)|(?:review|redteam|orchestrator)Prompt|refusal|permission|model|acceptance|FindingsOnly|launcherRoleWritePosture|gateRoleWriteScope)\b|--(?:permission|model)\b/;

const WK1089_META_GUARD_STRUCTURAL_PREDICATE =
  /(?:^|\/)(?:workspace-agent-dispatch-[A-Za-z0-9_-]+-executor|[A-Za-z0-9_-]+-role-adapter|[A-Za-z0-9_-]+-role-prompts|[A-Za-z0-9_-]+-orchestrator-plan|[A-Za-z0-9_-]+-launch-plan)\.mjs$/;

export const WK1089_FAMILY_FILE_NAME_PREDICATE =
  /(?:^|[/_-])(?:codex|claude|agy)(?:[/_.-]|$)/;

const WK1089_META_GUARD_FILENAME_PREDICATE = WK1089_META_GUARD_STRUCTURAL_PREDICATE;

export const WK1089_SHARED_POLICY_PRODUCER_SYMBOLS = Object.freeze([
  "resolveFindingsOnlyAcceptanceContract",
  "resolveLauncherRoleWritePosture",
  "launcherRoleWritableRootPolicy",
  "gateRoleWriteScope",
]);

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

function sourceRelPath(absPath) {
  return path.relative(SRC_ROOT_PATH, absPath).split(path.sep).join("/");
}

function enumerateSourceDir(relDir) {
  const root = path.join(SRC_ROOT_PATH, relDir);
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile() && entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs")) {
        out.push(sourceRelPath(abs));
      }
    }
  };
  visit(root);
  return out;
}

export function enumerateAgentLaunchSourceFiles() {
  return Object.freeze(
    [...enumerateSourceDir("lib"), ...enumerateSourceDir("commands")].sort()
  );
}

export function enumerateWK1089PolicySurfaceFiles() {
  return Object.freeze(
    enumerateAgentLaunchSourceFiles()
      .map((rel) => load(rel))
      .filter((file) =>
        file.rel === "lib/codex-role-mcp-env.mjs" ||
        WK1089_POLICY_SURFACE_PREDICATE.test(stripComments(file.source))
      )
      .map((file) => file.rel)
      .sort()
  );
}

export function enumerateWK1089MetaGuardFiles() {
  return Object.freeze(
    enumerateAgentLaunchSourceFiles()
      .filter(
        (rel) =>
          WK1089_FAMILY_FILE_NAME_PREDICATE.test(rel) ||
          WK1089_META_GUARD_FILENAME_PREDICATE.test(rel)
      )
      .sort()
  );
}

export function enumerateWK1089FamilyNamedFiles() {
  return Object.freeze(
    enumerateAgentLaunchSourceFiles()
      .filter((rel) => WK1089_FAMILY_FILE_NAME_PREDICATE.test(rel))
      .sort()
  );
}

export function loadWK1089FamilyNamedFiles() {
  return enumerateWK1089FamilyNamedFiles().map((rel) => load(rel));
}

export function assertRegisteredOrExcluded({ candidates, registeredFiles, exclusions, category, owningSlice }) {
  const registered = new Set(registeredFiles.map((file) => file.rel));
  const excluded = new Map(exclusions.map((entry) => [entry.rel, entry.reason]));
  const missing = [];
  for (const rel of candidates) {
    if (registered.has(rel) || excluded.has(rel)) continue;
    missing.push(`${rel}: not registered in FILES/WK1089_BOUNDARY_FILES and not justified-excluded`);
  }
  assert.deepEqual(
    missing,
    [],
    `single-launcher boundary (DEC-0049): ${category} must be a complete closed registry. ` +
      `Owning slice: ${owningSlice}.` +
      (missing.length
        ? `\n  ${missing.join("\n  ")}`
        : "")
  );
}

export function assertWK1089PolicySurfaceRegistryComplete(owningSlice) {
  assertRegisteredOrExcluded({
    candidates: enumerateWK1089PolicySurfaceFiles(),
    registeredFiles: WK1089_BOUNDARY_FILES,
    exclusions: WK1089_JUSTIFIED_EXCLUSIONS,
    category: "launch-plan/prompt/refusal/permission/model/acceptance source enumeration",
    owningSlice,
  });
}

export function assertNoUnregisteredWK1089FamilyBoundarySources(owningSlice) {
  assertRegisteredOrExcluded({
    candidates: enumerateWK1089MetaGuardFiles(),
    registeredFiles: WK1089_BOUNDARY_FILES,
    exclusions: WK1089_JUSTIFIED_EXCLUSIONS,
    category: "family executor/adapter/prompts/orchestrator-launch-plan source meta-guard",
    owningSlice,
  });
}

function findLocalDefinitions(file, name) {
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+${escaped}\s*\(`),
    new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+${escaped}\s*=`),
    new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?class\s+${escaped}\b`),
  ];
  const hits = [];
  for (const pattern of patterns) {
    const global = new RegExp(pattern.source, "g");
    let match;
    while ((match = global.exec(file.source))) {
      const offset = match[0].startsWith("\n") ? match.index + 1 : match.index;
      const line = lineOf(file.source, offset);
      hits.push({ line, excerpt: file.lines[line - 1].trim() });
    }
  }
  return hits;
}

export function findCodeTokens(file, regex) {
  const haystack = stripComments(file.source);
  const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  const hits = [];
  let match;
  while ((match = global.exec(haystack))) {
    const line = lineOf(haystack, match.index);
    hits.push({ line, excerpt: (file.lines[line - 1] ?? "").trim(), token: match[0] });
    if (match.index === global.lastIndex) global.lastIndex += 1;
  }
  return hits;
}

export function assertDelegates(file, category, callTokens, owningSlice) {
  const missing = [];
  for (const token of callTokens) {
    const callRegex = new RegExp(String.raw`\b${escapeRegExp(token)}\s*\(`);
    if (findCodeTokens(file, callRegex).length === 0) {
      missing.push(`${file.rel}: must delegate ${category} via ${token}(...)`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `single-launcher boundary (DEC-0049): family executor must DELEGATE ${category} ` +
      `to the shared launcher substrate, not re-own it under a local helper. ` +
      `Owning slice: ${owningSlice}.` +
      (missing.length ? `\n  ${missing.join("\n  ")}` : ""),
  );
}

export function assertDelegatesToSharedSymbol(file, { category, symbol, module, owningSlice }) {
  let importsSymbol = false;
  const importDeclarations = file.source.match(/import[\s\S]*?;\n/g) ?? [];
  for (const declaration of importDeclarations) {
    if (!new RegExp(String.raw`\bfrom\s+["']${escapeRegExp(module)}["']`).test(declaration)) {
      continue;
    }
    const namedBlock = declaration.match(/\{([\s\S]*?)\}/)?.[1] ?? "";
    const importedNames = namedBlock
      .split(",")
      .map((entry) => entry.trim().split(/\s+as\s+/)[0]?.trim())
      .filter(Boolean);
    if (importedNames.includes(symbol)) {
      importsSymbol = true;
      break;
    }
  }
  const missing = [];
  if (!importsSymbol) {
    missing.push(`${file.rel}: must import ${symbol} from ${module}`);
  }
  const callRegex = new RegExp(String.raw`\b${escapeRegExp(symbol)}\s*\(`);
  if (findCodeTokens(file, callRegex).length === 0) {
    missing.push(`${file.rel}: must invoke ${symbol}(...)`);
  }
  assert.deepEqual(
    missing,
    [],
    `single-launcher boundary (DEC-0049): family code must DELEGATE ${category} ` +
      `to shared symbol ${symbol}, not re-own it locally. Owning slice: ${owningSlice}.` +
      (missing.length ? `\n  ${missing.join("\n  ")}` : ""),
  );
}

export function assertNoCodeTokens(files, category, regex, owningSlice) {
  const violations = [];
  for (const file of files) {
    for (const hit of findCodeTokens(file, regex)) {
      violations.push(`${file.rel}:${hit.line}: ${category} — ${hit.excerpt}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `single-launcher boundary (DEC-0049): family code must not own ${category}; ` +
      `move it to the shared launcher substrate. Owning slice: ${owningSlice}.` +
      (violations.length ? `\n  ${violations.join("\n  ")}` : ""),
  );
}

export function assertNoLocalOwnership(files, category, names, owningSlice) {
  const violations = [];
  for (const file of files) {
    for (const name of names) {
      for (const hit of findLocalDefinitions(file, name)) {
        violations.push(`${file.rel}:${hit.line}: owns ${name} (${category}) — ${hit.excerpt}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `single-launcher boundary (DEC-0049): family code must not own ${category}; ` +
      `move it to the shared launcher substrate. Owning slice: ${owningSlice}.` +
      (violations.length ? `\n  ${violations.join("\n  ")}` : ""),
  );
}

export function plantedSource(rel, source) {
  return { rel, path: rel, source, lines: source.split(/\r?\n/) };
}

export const DEC0049_FAMILY_TOKENS = Object.freeze(["codex", "claude", "agy", "gemini"]);

const FAMILY_LITERAL = "(?:codex|claude|agy|gemini)";

export const DEC0049_FAMILY_IDENTITY_BRANCH = new RegExp(
  String.raw`(?:===|!==|==|!=)\s*["']${FAMILY_LITERAL}["']` +
    String.raw`|["']${FAMILY_LITERAL}["']\s*(?:===|!==|==|!=)` +
    String.raw`|\bcase\s+["']${FAMILY_LITERAL}["']\s*:`
);

export const DEC0049_ROLE_KEYED_BRANCH = new RegExp(
  String.raw`\b(?:role|roleName|launchRole|agentRole)\s*(?:===|!==|==|!=)\s*["'](?:worker|reviewer|redteam|orchestrator)["']` +
    String.raw`|["'](?:worker|reviewer|redteam|orchestrator)["']\s*(?:===|!==|==|!=)\s*(?:role|roleName|launchRole|agentRole)\b` +
    String.raw`|\bcase\s+["'](?:worker|reviewer|redteam|orchestrator)["']\s*:`
);

export const DEC0049_SHARED_POLICY_TOKENS =
  /\b(?:write[_]?scope|writable|writableRoot|readiness|readOnly|admission|refus|posture|isolation|sandbox)/i;

export const DEC0049_POLICY_SHAPED_CAPABILITY_NAME =
  /\b(?:requires|mustRefuse|shouldRefuse|refuses|denies|gates|authorizes|enforces)[A-Z][A-Za-z0-9]*\b/;

function entrySelectorless(rel, token, linePattern) {
  return rel === null && token === null && linePattern === null;
}

export function buildBoundaryAllowlist(entries = []) {
  return Object.freeze(
    entries.map((entry, index) => {
      const rel = entry.rel ?? null;
      const token = entry.token ?? null;
      const linePattern = entry.linePattern ?? null;
      if (entrySelectorless(rel, token, linePattern)) {
        throw new Error(
          `single-launcher boundary (DEC-0049): allowlist entry #${index} must include at least ` +
            `one concrete selector (rel, token, or linePattern); a reason alone must never match or ` +
            `suppress scanner hits. reason=${JSON.stringify(entry.reason ?? "")}`
        );
      }
      return Object.freeze({ rel, token, linePattern, reason: entry.reason ?? "" });
    })
  );
}

function boundaryHitAllowed(file, hit, allowlist) {
  return allowlist.some((entry) => {
    const rel = entry.rel ?? null;
    const token = entry.token ?? null;
    const linePattern = entry.linePattern ?? null;

    if (entrySelectorless(rel, token, linePattern)) return false;
    if (rel !== null && rel !== file.rel) return false;
    if (token !== null && token !== hit.token) return false;
    if (linePattern !== null && !linePattern.test(hit.excerpt)) return false;
    return true;
  });
}

export function partitionBoundaryHits(file, hits, allowlist = []) {
  const allowed = [];
  const violations = [];
  for (const hit of hits) {
    if (boundaryHitAllowed(file, hit, allowlist)) allowed.push(hit);
    else violations.push(hit);
  }
  return { allowed, violations };
}

function runBoundaryScan(files, finder, { category, owningSlice, allow = [] }) {
  const allowlist = Array.isArray(allow) ? allow : buildBoundaryAllowlist(allow);
  const violations = [];
  for (const file of files) {
    const { violations: hits } = partitionBoundaryHits(file, finder(file), allowlist);
    for (const hit of hits) {
      violations.push(`${file.rel}:${hit.line}: ${category} — ${hit.excerpt}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `single-launcher boundary (DEC-0049): family/shared code must not own ${category}; ` +
      `move the decision to the shared launcher substrate. Owning slice: ${owningSlice}.` +
      (violations.length ? `\n  ${violations.join("\n  ")}` : "")
  );
}

export function findFamilyIdentityBranches(file) {
  return findCodeTokens(file, DEC0049_FAMILY_IDENTITY_BRANCH);
}

export function assertNoFamilyIdentityPolicyBranches(files, { owningSlice, allow = [] }) {
  runBoundaryScan(files, findFamilyIdentityBranches, {
    category: "family-identity policy branch (decides policy from app/family identity)",
    owningSlice,
    allow,
  });
}

export function findRoleKeyedSharedPolicy(file, { window = 3 } = {}) {
  const stripped = stripComments(file.source);
  const lines = stripped.split(/\r?\n/);
  const branchRegex = new RegExp(DEC0049_ROLE_KEYED_BRANCH.source, "g");
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    branchRegex.lastIndex = 0;
    const match = branchRegex.exec(lines[index]);
    if (!match) continue;
    const lo = Math.max(0, index - window);
    const hi = Math.min(lines.length - 1, index + window);
    let policyNear = false;
    for (let cursor = lo; cursor <= hi; cursor += 1) {
      if (DEC0049_SHARED_POLICY_TOKENS.test(lines[cursor])) {
        policyNear = true;
        break;
      }
    }
    if (policyNear) {
      hits.push({ line: index + 1, excerpt: (file.lines[index] ?? "").trim(), token: match[0] });
    }
  }
  return hits;
}

export function assertNoRoleKeyedSharedPolicyInFamilyFiles(files, { owningSlice, allow = [] }) {
  runBoundaryScan(files, findRoleKeyedSharedPolicy, {
    category: "role-keyed shared policy in a family-named file (reviewer/readiness/isolation posture)",
    owningSlice,
    allow,
  });
}

export function findPolicyShapedCapabilityFacts(file) {
  return findCodeTokens(file, DEC0049_POLICY_SHAPED_CAPABILITY_NAME);
}

export function assertNoPolicyShapedCapabilityFacts(files, { owningSlice, allow = [] }) {
  runBoundaryScan(files, findPolicyShapedCapabilityFacts, {
    category: "policy-shaped capability fact (decision-verb name used as a family escape hatch)",
    owningSlice,
    allow,
  });
}
