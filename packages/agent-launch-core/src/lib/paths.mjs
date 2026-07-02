import path from "node:path";
import { randomUUID } from "node:crypto";

export function getAgentRunsDir(repoRoot) {
  return path.join(repoRoot, ".agent-runs");
}

export function getReviewDir(repoRoot, reviewId) {
  return path.join(getAgentRunsDir(repoRoot), "reviews", reviewId);
}

export function getRunDir(repoRoot, handoffId, runId) {
  return path.join(getAgentRunsDir(repoRoot), "runs", handoffId, runId);
}

export function createReviewId() {
  return `RV-${randomUUID()}`;
}

export function createRunId() {
  return `RUN-${randomUUID()}`;
}

