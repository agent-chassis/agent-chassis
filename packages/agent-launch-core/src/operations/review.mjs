import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stat, writeFile } from "node:fs/promises";

import { mintReviewToken } from "../lib/token.mjs";
import { loadRegistry, resolveAgentConfig } from "../lib/registry.mjs";
import { assessGraphImpactCheckpoint, loadHandoff } from "../lib/handoff.mjs";
import { getWrapperForMode, WRAPPER_VERSION } from "../lib/prompts.mjs";
import { assertAgentRunsNotTracked, findRepoRoot } from "../lib/git.mjs";
import { createReviewId, getReviewDir } from "../lib/paths.mjs";
import {
  assertPathInside,
  canonicalizePath,
  ensureDirectory,
  sha256,
  sha256File,
  writeJsonAtomic
} from "../lib/filesystem.mjs";

const DEFAULT_LIMITS = {
  maxHandoffBytes: 131072,
  maxLinkedFileBytes: 524288,
  maxTotalReviewedBytes: 2097152,
  maxLinkedFiles: 20
};

export const REVIEWED_BLACKBOARD_DEACTIVATED_DIAGNOSTIC_CODE =
  "REVIEWED_BLACKBOARD_DEACTIVATED";

const REVIEWED_BLACKBOARD_DEACTIVATED_REVIEW_MESSAGE =
  "Reviewed blackboard handoff review is deactivated. " +
  "Use direct role dispatch or your configured orchestration backend instead. " +
  "[agent-launch:reviewed-blackboard-deactivated]";

function throwReviewedBlackboardDeactivated() {
  const error = new Error(REVIEWED_BLACKBOARD_DEACTIVATED_REVIEW_MESSAGE);
  error.code = REVIEWED_BLACKBOARD_DEACTIVATED_DIAGNOSTIC_CODE;
  throw error;
}

function formatFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }
  return String(value);
}

function orderedFrontmatterEntries(frontmatter) {
  const preferredOrder = [
    "schema_version",
    "id",
    "title",
    "subject",
    "allowed_agents",
    "mode"
  ];
  const seen = new Set();
  const ordered = [];
  for (const key of preferredOrder) {
    if (key in frontmatter) {
      ordered.push([key, frontmatter[key]]);
      seen.add(key);
    }
  }
  for (const key of Object.keys(frontmatter).sort()) {
    if (!seen.has(key)) {
      ordered.push([key, frontmatter[key]]);
    }
  }
  return ordered;
}

async function confirmReview({ bypass }) {
  if (bypass) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Review confirmation requires a TTY or --reviewed-and-accept-risks");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Launch against this reviewed bundle? [y/N] ");
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new Error("Review not confirmed");
    }
  } finally {
    rl.close();
  }
}

export async function reviewHandoff({
  instructionPath,
  agent,
  reviewedAndAcceptRisks = false,
  allowMissingGraphImpactCheckpoint = false,
  allowLegacyImplementationModeHandoffReview = false
}) {
  throwReviewedBlackboardDeactivated();
  if (!instructionPath) {
    throw new Error("review requires an instruction path");
  }
  if (!agent) {
    throw new Error("review requires --agent");
  }

  const instructionRealPath = await canonicalizePath(path.resolve(instructionPath));
  const repoRoot = await findRepoRoot(path.dirname(instructionRealPath));
  assertPathInside(repoRoot, instructionRealPath, "Handoff must live inside the repo root");
  await assertAgentRunsNotTracked(repoRoot);

  const registry = await loadRegistry();
  const handoff = await loadHandoff(instructionRealPath, DEFAULT_LIMITS);
  if (String(handoff.frontmatter.mode) === "implement" && !allowLegacyImplementationModeHandoffReview) {
    throw new Error(
      "Implementation-mode reviewed handoffs are deprecated. Use WK-first direct dispatch " +
        "with a direct worker or review-role WK command instead. Pass " +
        "allowLegacyImplementationModeHandoffReview=true only to review a legacy or " +
        "exception-only implementation handoff."
    );
  }
  const graphImpactCheckpoint = assessGraphImpactCheckpoint(handoff);
  if (
    graphImpactCheckpoint.required &&
    !graphImpactCheckpoint.valid &&
    !allowMissingGraphImpactCheckpoint
  ) {
    throw new Error(
      `Implementation-scoped handoff requires a valid ${graphImpactCheckpoint.required_section}; ` +
        "include graph-impact-paths, workspace_code_index_graph_impact_paths, " +
        "graph-impact-diff, workspace_code_index_graph_impact_diff, " +
        "or not applicable with a reason"
    );
  }
  if (!handoff.frontmatter.allowed_agents.includes(agent)) {
    throw new Error(`Agent ${agent} is not allowed by this handoff`);
  }

  const agentConfig = resolveAgentConfig(registry, agent, String(handoff.frontmatter.mode));
  const reviewId = createReviewId();
  const reviewDir = getReviewDir(repoRoot, reviewId);
  const agentVisibleDir = path.join(reviewDir, "agent-visible");
  const contextDir = path.join(agentVisibleDir, "context");
  const metadataDir = path.join(reviewDir, "metadata");
  await ensureDirectory(contextDir);
  await ensureDirectory(metadataDir);

  const handoffSnapshotPath = path.join(agentVisibleDir, "handoff.snapshot.md");
  await writeFile(handoffSnapshotPath, handoff.content, "utf8");

  if (handoff.readFirst.length > DEFAULT_LIMITS.maxLinkedFiles) {
    throw new Error(`Read First exceeds max linked file count of ${DEFAULT_LIMITS.maxLinkedFiles}`);
  }

  const totalSizes = [await stat(handoffSnapshotPath).then((item) => item.size)];
  const contextFiles = [];
  for (const relativePath of handoff.readFirst) {
    const absolutePath = await canonicalizePath(path.resolve(repoRoot, relativePath));
    assertPathInside(repoRoot, absolutePath, `Read First path escapes repo root: ${relativePath}`);
    const fileStat = await stat(absolutePath);
    if (fileStat.size > DEFAULT_LIMITS.maxLinkedFileBytes) {
      throw new Error(`Read First file exceeds max size: ${relativePath}`);
    }
    totalSizes.push(fileStat.size);
    const snapshotFileName = `${sha256(relativePath).slice("sha256:".length, "sha256:".length + 12)}${path.extname(relativePath) || ".md"}`;
    const snapshotPath = path.join(contextDir, snapshotFileName);
    await writeFile(snapshotPath, await (await import("node:fs/promises")).readFile(absolutePath), "utf8");
    contextFiles.push({
      source_path: relativePath,
      snapshot_path: path.relative(reviewDir, snapshotPath).replaceAll(path.sep, "/"),
      sha256: await sha256File(snapshotPath)
    });
  }

  const totalReviewedBytes = totalSizes.reduce((sum, size) => sum + size, 0);
  if (totalReviewedBytes > DEFAULT_LIMITS.maxTotalReviewedBytes) {
    throw new Error(`Reviewed bundle exceeds max total size of ${DEFAULT_LIMITS.maxTotalReviewedBytes} bytes`);
  }

  const wrapperPath = path.join(agentVisibleDir, "wrapper.md");
  const wrapperText = getWrapperForMode(String(handoff.frontmatter.mode));
  await writeFile(wrapperPath, wrapperText, "utf8");

  const inputManifest = {
    schema_version: 1,
    handoff_id: String(handoff.frontmatter.id),
    subject: String(handoff.frontmatter.subject),
    mode: String(handoff.frontmatter.mode),
    wrapper_version: WRAPPER_VERSION,
    wrapper: {
      path: "agent-visible/wrapper.md",
      wrapper_version: WRAPPER_VERSION,
      sha256: await sha256File(wrapperPath)
    },
    handoff_snapshot: {
      path: "agent-visible/handoff.snapshot.md",
      sha256: await sha256File(handoffSnapshotPath)
    },
    context_files: contextFiles,
    captures_declared_inputs_only: true
  };
  const manifestPath = path.join(metadataDir, "input-manifest.json");
  await writeJsonAtomic(manifestPath, inputManifest);
  const manifestHash = sha256(JSON.stringify(inputManifest, null, 2) + "\n");

  console.log(`Review ${reviewId}`);
  console.log("  frontmatter:");
  for (const [key, value] of orderedFrontmatterEntries(handoff.frontmatter)) {
    console.log(`    ${key}: ${formatFrontmatterValue(value)}`);
  }
  console.log("  Read First:");
  if (handoff.readFirst.length === 0) {
    console.log("    (none)");
  } else {
    for (const relativePath of handoff.readFirst) {
      console.log(`    - ${relativePath}`);
    }
  }
  console.log(`  agent: ${agent}`);
  console.log(`  context files: ${contextFiles.length}`);
  console.log(`  reviewed bytes: ${totalReviewedBytes}`);
  if (graphImpactCheckpoint.required) {
    console.log(
      `  graph impact checkpoint: ${graphImpactCheckpoint.valid ? "valid" : "override accepted"}`
    );
  }
  console.log("  warning: linked files are untrusted prompt input");

  await confirmReview({ bypass: reviewedAndAcceptRisks });

  const now = new Date();
  const review = {
    schema_version: 1,
    review_id: reviewId,
    handoff_id: String(handoff.frontmatter.id),
    agent,
    mode: String(handoff.frontmatter.mode),
    repo_root: repoRoot,
    input_manifest_hash: manifestHash,
    registry_hash: registry.hash,
    operator_id: process.env.USER || os.userInfo().username,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    limits: DEFAULT_LIMITS,
    graph_impact_checkpoint: {
      ...graphImpactCheckpoint,
      override: {
        allow_missing_graph_impact_checkpoint: Boolean(allowMissingGraphImpactCheckpoint),
        applied: Boolean(
          allowMissingGraphImpactCheckpoint &&
            graphImpactCheckpoint.required &&
            !graphImpactCheckpoint.valid
        )
      }
    }
  };
  const reviewPath = path.join(metadataDir, "review.json");
  await writeJsonAtomic(reviewPath, review);

  const tokenPath = await mintReviewToken({
    review_id: reviewId,
    handoff_id: review.handoff_id,
    agent: review.agent,
    mode: review.mode,
    repo_root: review.repo_root,
    input_manifest_hash: review.input_manifest_hash,
    registry_hash: review.registry_hash,
    expires_at: review.expires_at,
    nonce: createReviewId()
  });

  return {
    reviewId,
    repoRoot,
    reviewDir,
    tokenPath,
    handoffId: review.handoff_id
  };
}
