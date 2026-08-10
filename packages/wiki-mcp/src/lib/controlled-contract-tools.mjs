import {
  assessControlledContractOperation,
  buildProofPlanOperation,
  describeProofPackOperation,
  discoverControlledProofIntentsOperation,
  inspectProofPackBindingsOperation,
  queryControlledVocabularyOperation,
  readControlledContractAssessmentArtifactOperation,
  readControlledContractCarrierOperation,
  selectProofPacksOperation,
  writeControlledContractCarrierOperation
} from "@agent-chassis/wiki-core";
import {
  createControlledContractCarrierOperation,
  describeControlledContractAuthoringOperation,
  patchControlledContractCarrierOperation,
  queryControlledContractCarrierOperation
} from "@agent-chassis/wiki-core/src/operations/controlled-contract.mjs";
import { getControlledContractProjectionSpills } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";

const QUERY_INDEX_BYTES = 4096;
const QUERY_SELECTED_BYTES = 16384;

function prettyJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

export function materializeControlledContractProjectionSpills({
  result,
  jsonContent,
  limit,
  prefix = {}
}) {
  const spills = getControlledContractProjectionSpills(result);
  if (spills.length === 0) return { ...prefix, ...result };
  const projected = structuredClone(result);
  for (const spill of spills) {
    const descriptor = jsonContent(spill.value, { forceSpill: true }).structuredContent;
    const reference = descriptor?.content_reference;
    if (!reference || typeof reference.sha256 !== "string" ||
        !Number.isInteger(reference.byte_count)) {
      throw new Error("production item spill did not return integrity-bound content_reference metadata");
    }
    projected[spill.collection][spill.index] = {
      ...projected[spill.collection][spill.index],
      [`${spill.integrity_prefix}_byte_count`]: reference.byte_count,
      [`${spill.integrity_prefix}_sha256`]: reference.sha256,
      content_reference: reference
    };
  }
  if (projected.selection === "selected") {
    const candidates = projected.items;
    projected.items = [];
    projected.returned_count = 0;
    projected.byte_omitted_matched_count = projected.matched_count;
    for (const candidate of candidates) {
      projected.items.push(candidate);
      projected.returned_count += 1;
      projected.byte_omitted_matched_count -= 1;
      if (prettyJsonBytes({ ...prefix, ...projected }) <= limit) continue;
      projected.items.pop();
      projected.returned_count -= 1;
      projected.byte_omitted_matched_count += 1;
    }
  }
  const response = { ...prefix, ...projected };
  if (prettyJsonBytes(response) > limit) {
    throw new Error("item-scoped spill projection exceeds its final production byte limit");
  }
  return response;
}

export const CONTROLLED_CONTRACT_MCP_TOOL_NAMES = Object.freeze([
  "workspace_controlled_contract_carrier_read",
  "workspace_controlled_contract_carrier_write",
  "workspace_controlled_vocabulary_query",
  "workspace_controlled_proof_intents_discover",
  "workspace_controlled_proof_packs_select",
  "workspace_controlled_proof_pack_describe",
  "workspace_controlled_proof_pack_bindings_inspect",
  "workspace_controlled_proof_plan_build",
  "workspace_controlled_contract_assess",
  "workspace_controlled_contract_artifact_read",
  "workspace_controlled_contract_carrier_create",
  "workspace_controlled_contract_carrier_query",
  "workspace_controlled_contract_carrier_patch",
  "workspace_controlled_contract_authoring_describe"
]);

export function registerControlledContractTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo
}) {
  const wkId = z.string().regex(/^WK-[0-9]{4}$/);
  const focusSlug = () => z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional();
  const focus = focusSlug();
  const profileId = z.string().min(1).max(256);
  const profileVersion = z.string().min(1).max(64);
  const requestedIntents = z.array(z.string().min(1).max(512)).min(1).max(28);
  const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable();
  const carrierKind = z.enum([
    "contract",
    "evaluation_input",
    "proof_plan_request",
    "proof_plan"
  ]);
  const writableCarrierKind = z.enum(["contract", "evaluation_input"]);
  const authorableCarrierKind = z.enum(["contract", "evaluation_input", "proof_plan_request"]);
  const patchOperation = z.object({
    op: z.enum(["upsert", "remove"]),
    target: z.enum([
      "references", "propositions", "claims", "relations", "collections", "residue",
      "annotations", "reference_bindings", "number_bindings", "claim_pattern_bindings",
      "resolver_facts", "delivered_evidence", "evaluation_stage", "requested_intents", "selected_packs"
    ]),
    id: z.string().min(1).max(4096).optional(),
    value: z.unknown().optional()
  }).strict();
  const artifactFile = z.enum([
    "assessment.json",
    "assessment.md",
    "structural.full.json",
    "proof-packs.full.json",
    "manifest.json"
  ]);

  const materializeProjectionSpills = (result, options) =>
    materializeControlledContractProjectionSpills({ result, jsonContent, ...options });

  const respond = async (args, callback) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await callback(workspace);
      return jsonContent({ workspaceRepo: workspace.repo, ...result });
    } catch (error) {
      return errorContent(error);
    }
  };
  const respondBounded = async (args, callback) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      return jsonContent(await callback(workspace));
    } catch (error) {
      return errorContent(error);
    }
  };
  const respondCarrierQuery = async (args, callback) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await callback(workspace);
      const limit = result.selection === "index" ? QUERY_INDEX_BYTES : QUERY_SELECTED_BYTES;
      return jsonContent(materializeProjectionSpills(result, { limit }));
    } catch (error) { return errorContent(error); }
  };
  const respondProjection = async (args, callback, {
    limit,
    includeWorkspace = false,
    resolveWorkspace = true
  }) => {
    try {
      const workspace = resolveWorkspace
        ? resolveWorkspaceRepo(workspaceRepos, args.repo)
        : null;
      const result = await callback(workspace);
      const prefix = includeWorkspace ? { workspaceRepo: workspace.repo } : {};
      return jsonContent(materializeProjectionSpills(result, { limit, prefix }));
    } catch (error) { return errorContent(error); }
  };

  registerTool(
    "workspace_controlled_contract_carrier_read",
    {
      description:
        "Read one deterministic controlled-contract JSON carrier from wiki/contracts by canonical WK identity, optional focused slug, and typed carrier kind. Accepts no path or root.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        carrier_kind: carrierKind
      }).strict()
    },
    (args) => respond(args, (workspace) => readControlledContractCarrierOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      carrierKind: args.carrier_kind
    }))
  );

  registerTool(
    "workspace_controlled_contract_carrier_write",
    {
      description:
        "CAS-write one deterministic controlled contract or evaluation-input JSON carrier under wiki/contracts. Requires the exact current content digest, or null for confirmed absence; accepts no path or output location.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        carrier_kind: writableCarrierKind,
        expected_content_digest: digest,
        content: z.record(z.unknown())
      }).strict()
    },
    (args) => respond(args, (workspace) => writeControlledContractCarrierOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      carrierKind: args.carrier_kind,
      expectedContentDigest: args.expected_content_digest,
      content: args.content
    }))
  );

  registerTool(
    "workspace_controlled_vocabulary_query",
    {
      description:
        "Query the package-owned controlled vocabulary by bounded text and controlled term kinds. Advisory authoring output only; no caller catalog or package root is accepted.",
      inputSchema: z.object({
        text: z.string().max(4096),
        kinds: z.array(z.enum([
          "operator",
          "type_term",
          "applicability_mode",
          "value_kind"
        ])).max(4).optional()
      }).strict()
    },
    async (args) => {
      try {
        return jsonContent(await queryControlledVocabularyOperation({
          text: args.text,
          kinds: args.kinds
        }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_controlled_proof_intents_discover",
    {
      description:
        "List or search the package-owned controlled proof-intent catalog. Discovery is bounded, non-authoritative, and performs no selection or admission.",
      inputSchema: z.object({
        query: z.string().min(1).max(4096).optional(),
        limit: z.number().int().positive().max(28).optional()
      }).strict()
    },
    async (args) => {
      try {
        return jsonContent(await discoverControlledProofIntentsOperation(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_controlled_proof_packs_select",
    {
      description:
        "Mechanically select exact admitted proof-pack candidates for explicit controlled intents against a canonical WK contract. Returns the package compact projection and no applicability or authorization claim.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        requested_intents: requestedIntents
      }).strict()
    },
    (args) => respond(args, (workspace) => selectProofPacksOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      requestedIntents: args.requested_intents
    }))
  );

  registerTool(
    "workspace_controlled_proof_pack_describe",
    {
      description:
        "Describe one exact package-owned proof pack for authoring by profile ID, version, and optional controlled intents. Accepts no profile path, module, catalog, or package root.",
      inputSchema: z.object({
        profile_id: profileId,
        profile_version: profileVersion,
        requested_intents: requestedIntents.optional(),
        detail_sections: z.array(z.string().min(1).max(128)).max(16).optional(),
        detail_selectors: z.array(z.string().min(1).max(512)).max(64).optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondProjection(args, () => describeProofPackOperation({
          profileId: args.profile_id,
          profileVersion: args.profile_version,
          requestedIntents: args.requested_intents,
          sections: args.detail_sections, selectors: args.detail_selectors, cursor: args.cursor
        }), { limit: QUERY_SELECTED_BYTES, resolveWorkspace: false })
  );

  registerTool(
    "workspace_controlled_proof_pack_bindings_inspect",
    {
      description:
        "Inspect compact or selector-aware paged binding assistance for one exact proof pack. Omit evaluation_focus for no input, use null for the root carrier, or a canonical slug for a focused carrier.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        evaluation_focus: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .nullable().optional(),
        profile_id: profileId,
        profile_version: profileVersion,
        requested_intents: requestedIntents.optional(),
        roles: z.array(z.string().min(1).max(512)).max(64).optional(),
        statuses: z.array(z.string().min(1).max(64)).max(8).optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondProjection(args, (workspace) => inspectProofPackBindingsOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      evaluationFocus: args.evaluation_focus,
      profileId: args.profile_id,
      profileVersion: args.profile_version,
      requestedIntents: args.requested_intents, roles: args.roles,
      statuses: args.statuses, cursor: args.cursor, workspaceRepo: workspace.repo
    }), { limit: args.roles?.length || args.statuses?.length || args.cursor
        ? QUERY_SELECTED_BYTES : QUERY_INDEX_BYTES, includeWorkspace: true })
  );

  registerTool(
    "workspace_controlled_proof_plan_build",
    {
      description:
        "Compile the canonical proof-plan request and evaluation inputs for one WK carrier through the package API, then CAS-write only the deterministic proof-plan carrier. Compilation validates all supplied bindings without enumerating the agent-facing candidate projection.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus,
        expected_content_digest: digest
      }).strict()
    },
    (args) => respond(args, (workspace) => buildProofPlanOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null,
      expectedContentDigest: args.expected_content_digest
    }))
  );

  registerTool(
    "workspace_controlled_contract_assess",
    {
      description:
        "Assess one canonical contract and persisted proof plan through the package API and publish only its package-produced ignored content-addressed bundle. Returns the package compact non-authoritative assessment projection.",
      inputSchema: z.object({
        repo: z.string().optional(),
        wk_id: wkId,
        focus
      }).strict()
    },
    (args) => respond(args, (workspace) => assessControlledContractOperation({
      repoRoot: workspace.dir,
      wkId: args.wk_id,
      focus: args.focus ?? null
    }))
  );

  registerTool(
    "workspace_controlled_contract_artifact_read",
    {
      description:
        "Read one fixed file from a package-produced content-addressed assessment bundle by exact assessment identity. Accepts no artifact URI, path, root, or output location.",
      inputSchema: z.object({
        repo: z.string().optional(),
        assessment_identity: z.string().regex(/^[0-9a-f]{64}$/),
        artifact_file: artifactFile
      }).strict()
    },
    (args) => respond(args, (workspace) => readControlledContractAssessmentArtifactOperation({
      repoRoot: workspace.dir,
      assessmentIdentity: args.assessment_identity,
      artifactFile: args.artifact_file
    }))
  );

  registerTool(
    "workspace_controlled_contract_carrier_create",
    {
      description: "Create one absent canonical contract, evaluation-input, or proof-plan-request carrier after complete package validation. Returns only a compact digest receipt.",
      inputSchema: z.object({
        repo: z.string().optional(), wk_id: wkId, focus,
        carrier_kind: authorableCarrierKind,
        expected_content_digest: z.null(),
        content: z.record(z.unknown())
      }).strict()
    },
    (args) => respondBounded(args, (workspace) => createControlledContractCarrierOperation({
      repoRoot: workspace.dir, wkId: args.wk_id, focus: args.focus ?? null,
      carrierKind: args.carrier_kind, expectedContentDigest: args.expected_content_digest,
      content: args.content
    }))
  );

  registerTool(
    "workspace_controlled_contract_carrier_query",
    {
      description: "Return a byte-bounded canonical-carrier index or selected contract nodes, evaluation bindings, intents, and packs by stable ID or role; never returns a complete carrier implicitly.",
      inputSchema: z.object({
        repo: z.string().optional(), wk_id: wkId, focus,
        carrier_kind: carrierKind,
        selectors: z.array(z.string().min(1).max(4096)).min(1).max(64).optional(),
        target: z.string().min(1).max(128).optional(),
        filter: z.string().min(1).max(4096).optional(),
        cursor: z.string().min(1).max(8192).optional()
      }).strict()
    },
    (args) => respondCarrierQuery(args, (workspace) => queryControlledContractCarrierOperation({
      repoRoot: workspace.dir, wkId: args.wk_id, focus: args.focus ?? null,
      carrierKind: args.carrier_kind, selectors: args.selectors,
      target: args.target, filter: args.filter, cursor: args.cursor
    }))
  );

  registerTool(
    "workspace_controlled_contract_carrier_patch",
    {
      description: "Apply up to 64 bounded typed domain upserts/removals to one existing canonical authoring carrier, validate the complete prospective graph through the package, and perform one digest-CAS write.",
      inputSchema: z.object({
        repo: z.string().optional(), wk_id: wkId, focus,
        carrier_kind: authorableCarrierKind,
        expected_content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        operations: z.array(patchOperation).min(1).max(64)
      }).strict()
    },
    (args) => respondBounded(args, (workspace) => patchControlledContractCarrierOperation({
      repoRoot: workspace.dir, wkId: args.wk_id, focus: args.focus ?? null,
      carrierKind: args.carrier_kind, expectedContentDigest: args.expected_content_digest,
      operations: args.operations
    }))
  );

  registerTool(
    "workspace_controlled_contract_authoring_describe",
    {
      description: "Describe one package-backed controlled-contract authoring carrier and optional mutable target with bounded schema, identity, mutability, and minimal-template detail.",
      inputSchema: z.object({
        carrier_kind: authorableCarrierKind,
        target: z.string().min(1).max(128).optional()
      }).strict()
    },
    async (args) => {
      try { return jsonContent(await describeControlledContractAuthoringOperation({
        carrierKind: args.carrier_kind, target: args.target
      })); } catch (error) { return errorContent(error); }
    }
  );
}
