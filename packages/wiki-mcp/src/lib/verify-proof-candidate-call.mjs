

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { VERIFY_PROOF_TOOL_NAME } from "./verify-proof-public-result.mjs";

const WK_ID_RE = /^WK-\d{4,}$/u;
const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const EXACT_COMMIT_ROLE = "orchestrator";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function terminalCandidateVerifyProofCall({ sessionRole, repository, subject, lifecycle }) {
  if (sessionRole !== EXACT_COMMIT_ROLE || typeof repository !== "string" || repository === "") return null;
  if (!isRecord(lifecycle) || lifecycle.phase !== "finalized" || lifecycle.integrated !== true) return null;
  const { binding, materialization } = isRecord(lifecycle.terminal_candidate)
    ? lifecycle.terminal_candidate : {};
  if (!isRecord(binding) || !isRecord(materialization)) return null;
  const wkId = binding.canonical_wk_id;
  const candidate = binding.candidate;
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId) ||
      typeof candidate !== "string" || !COMMIT_RE.test(candidate)) return null;
  if (String(subject ?? "").split("#")[0] !== wkId) return null;
  if (materialization.verified !== true || materialization.candidate !== candidate ||
      materialization.canonical_wk_id !== wkId) return null;
  return buildNextCall({ tool: VERIFY_PROOF_TOOL_NAME, recommended: false,
    arguments: { repo: repository, subject: wkId, git_sha: candidate } });
}
