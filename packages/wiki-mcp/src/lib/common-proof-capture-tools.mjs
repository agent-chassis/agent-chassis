import {
  COMMON_PROOF_CAPTURE_FAMILY_IDS
} from "@agent-chassis/wiki-core/src/lib/common-proof-capture-tools.mjs";

import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";

export const COMMON_PROOF_CAPTURE_TOOL_NAME =
  "workspace_controlled_common_proof_capture";

export const COMMON_PROOF_CAPTURE_MCP_FAMILY_IDS = Object.freeze(
  COMMON_PROOF_CAPTURE_FAMILY_IDS.filter((family) => family !== "integration_prefix_safety")
);

const ADAPTER_INLINE_BYTE_LIMIT = 16 * 1024;
const UNIT_PATTERN = /^WK-[0-9]{4}(?:#SLICE-[0-9]{3})?$/u;

function projection(result, workspace) {

  const { canonical_store_root: _privateRoot, ...publicResult } = result;
  return { workspaceRepo: workspace.repo, ...publicResult };
}

function prettyJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

function respond(result, jsonContent) {
  if (prettyJsonBytes(result) <= ADAPTER_INLINE_BYTE_LIMIT) return jsonContent(result);

  return jsonContent(result, { forceSpill: true });
}

export function registerCommonProofCaptureTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  operation,
  focusSchema
}) {
  if (typeof operation !== "function") {
    throw new TypeError("common proof capture registration requires one preconstructed operation");
  }
  if (!focusSchema) {
    throw new TypeError("common proof capture registration requires the controlled-contract focus schema");
  }

  const inputSchema = z.object({
    repo: z.string().max(128).optional(),
    wk_id: z.string().regex(/^WK-[0-9]{4}$/u),
    unit: z.string().regex(UNIT_PATTERN),
    focus: focusSchema,
    family: z.enum(COMMON_PROOF_CAPTURE_MCP_FAMILY_IDS),
    profile_id: z.string().min(1).max(256),
    profile_version: z.string().min(1).max(64),
    verification_id: z.string().min(1).max(512).optional()
  }).strict();

  registerTool(
    COMMON_PROOF_CAPTURE_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Mixed-effect bounded common proof capture over one server-resolved repository, WK, unit, " +
        "focus, family, exact profile identity, and optional verification identity. " +
        "Behavioral-preservation, test-verification-validity, and write-confinement are read-only " +
        "joins over launcher receipts; declared-boundary-consistency may atomically publish its " +
        "canonical repository carrier. Integration-prefix capture remains owned by " +
        "workspace_controlled_integration_prefix_capture_author. It accepts no roots, paths, " +
        "receipts, reports, policies, commits, executors, resolvers, continuations, or authority digests.",
      inputSchema
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await operation({
          repository: workspace.repo,
          wkId: args.wk_id,
          unit: args.unit,
          focus: args.focus ?? null,
          family: args.family,
          profileId: args.profile_id,
          profileVersion: args.profile_version,
          verificationId: args.verification_id ?? null
        });
        return respond(projection(result, workspace), jsonContent);
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
