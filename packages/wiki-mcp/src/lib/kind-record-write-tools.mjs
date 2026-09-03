

import {
  amendKindRecordSection,
  amendKindRecordScalar,
  rejectDecisionRecord
} from "@agent-chassis/wiki-core/src/operations/kind-record-edit.mjs";
import { assignWorkRecordToInitiativeByUnit as defaultAssignWorkRecordToInitiative } from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";

import { parseWorkRecordUnitAddress } from "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import { INITIATIVE_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-shared.mjs";

import { createWikiRecord } from "@agent-chassis/wiki-core/src/operations/create.mjs";

import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";

function createCompactKindRecordEditResponse(workspaceRepo, id, result) {
  const response = {
    workspaceRepo,
    id: id ?? null,
    ok: Boolean(result?.ok),
    written: Boolean(result?.written),
    source_digest: result?.source_digest ?? null,
    changedFields: Array.isArray(result?.changedFields) ? result.changedFields : [],
    diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : []
  };
  if (result?.current_source_digest !== undefined) {
    response.current_source_digest = result.current_source_digest;
  }
  if (result?.expected_source_digest !== undefined) {
    response.expected_source_digest = result.expected_source_digest;
  }
  return response;
}

function createCompactInitiativeAssignmentResponse(workspaceRepo, result) {
  const response = {
    workspaceRepo,
    operation: result?.operation ?? "assign_work_record_to_initiative",
    unit: result?.selected_unit?.address ?? null,
    initiative: result?.record?.initiative ?? null,
    ok: Boolean(result?.valid && (result?.written || result?.no_op)),
    valid: Boolean(result?.valid),
    written: Boolean(result?.written),
    no_op: Boolean(result?.no_op),
    source_digest: result?.source_digest ?? null,
    changed_fields: Array.isArray(result?.changed_fields) ? result.changed_fields : [],
    diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : []
  };
  if (result?.current_source_digest !== undefined) {
    response.current_source_digest = result.current_source_digest;
  }
  if (result?.expected_source_digest !== undefined) {
    response.expected_source_digest = result.expected_source_digest;
  }
  return response;
}

export const ASSIGNMENT_MISSING_SEMANTIC_IDENTITY_CODE = "missing_semantic_identity";
export const ASSIGNMENT_CONFLICTING_IDENTITY_ALIAS_CODE = "conflicting_identity_alias";
export const ASSIGNMENT_REQUIRED_ONE_OF = Object.freeze([
  Object.freeze(["unit", "work_record_id"]),
  Object.freeze(["initiative", "initiative_id"])
]);

function parseAssignmentUnitIdentity(value) {
  const parsed = parseWorkRecordUnitAddress(value);
  if (!parsed.ok || parsed.unit.kind !== "work_item") {
    return null;
  }
  return parsed.recordId;
}

function parseAssignmentInitiativeIdentity(value) {
  return typeof value === "string" && INITIATIVE_ID_PATTERN.test(value) ? value : null;
}

function resolveAssignmentIdentityPair(args, { canonicalField, aliasField, parseIdentity }) {
  const hasCanonical = args[canonicalField] !== undefined;
  const hasAlias = args[aliasField] !== undefined;
  if (!hasCanonical && !hasAlias) {
    return { state: "missing", canonicalField, aliasField };
  }
  if (!hasCanonical || !hasAlias) {
    const suppliedField = hasCanonical ? canonicalField : aliasField;
    return { state: "resolved", value: args[suppliedField], identity: parseIdentity(args[suppliedField]) };
  }

  const canonicalValue = args[canonicalField];
  const aliasValue = args[aliasField];
  const canonicalIdentity = parseIdentity(canonicalValue);
  const aliasIdentity = parseIdentity(aliasValue);
  if (canonicalIdentity === null) {
    return { state: "resolved", value: canonicalValue, identity: null };
  }
  if (aliasIdentity === null) {
    return { state: "resolved", value: aliasValue, identity: null };
  }
  if (canonicalIdentity === aliasIdentity) {
    return { state: "resolved", value: canonicalValue, identity: canonicalIdentity };
  }
  return {
    state: "conflict",
    canonicalField,
    aliasField,
    canonicalValue,
    aliasValue,
    value: canonicalValue,
    identity: canonicalIdentity,
    identities: [canonicalIdentity, aliasIdentity]
  };
}

function assignmentBoundaryRefusal(workspaceRepo, { code, message, path, extra }) {
  const error = new Error(message);
  error.name = "InitiativeAssignmentInputError";
  error.code = code;
  error.envelope = {
    workspaceRepo,
    operation: "assign_work_record_to_initiative",
    ok: false,
    valid: false,
    written: false,
    no_op: false,
    mechanical_failure: true,
    diagnostics: [{ code, severity: "error", message, path }],
    ...extra
  };
  return error;
}

function buildAssignmentRetryOptions(unitPair, initiativePair, args) {
  const candidates = (pair) =>
    pair.state === "conflict" ? pair.identities : [pair.identity];
  const executionContext = {};
  if (args?.repo !== undefined) {
    executionContext.repo = args.repo;
  }
  if (args?.expected_source_digest !== undefined) {
    executionContext.expected_source_digest = args.expected_source_digest;
  }
  const options = [];
  for (const unit of candidates(unitPair)) {
    for (const initiative of candidates(initiativePair)) {
      options.push({ unit, initiative, ...executionContext });
    }
  }
  return options;
}

export function registerKindRecordWriteTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  assignWorkRecordToInitiative = defaultAssignWorkRecordToInitiative
}) {

  const sectionInputSchema = () =>
    z
      .object({
        repo: z.string().optional(),
        id: z.string(),
        section: z.string(),
        value: z.string(),
        expected_source_digest: z.string().optional()
      })
      .strict();

  const scalarInputSchema = () =>
    z
      .object({
        repo: z.string().optional(),
        id: z.string(),
        field: z.string(),
        value: z.union([z.string(), z.array(z.string()), z.null()]),
        expected_source_digest: z.string().optional()
      })
      .strict();

  const createInputSchema = () =>
    z
      .object({
        repo: z.string().optional(),
        title: z.string(),
        id: z.string().optional()
      })
      .strict();

  const lifecycleInputSchema = () =>
    z
      .object({
        repo: z.string().optional(),
        id: z.string(),
        expected_source_digest: z.string().optional()
      })
      .strict();

  const initiativeAssignmentInputSchema = () =>
    z
      .object({
        repo: z.string().optional(),
        unit: z.string().optional(),
        work_record_id: z.string().optional(),
        initiative: z.string().optional(),
        initiative_id: z.string().optional(),
        expected_source_digest: z.string().optional()
      })
      .strict();

  const DEC_DRAFT_NOTE =
    "DEC-0152: agents may create and edit only `proposed` decisions. Human-only CLI actions ratify or " +
    "unratify them; amending an accepted decision refuses.";

  const IN_DRAFT_NOTE =
    "Agents may create and edit draft initiatives. Lifecycle and provenance fields remain server-managed; " +
    "initiatives have no ratification gate.";

  registerTool(
    "assign_work_record_to_initiative",
    {

      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Assign a record-level WK to an existing initiative. This is the sole canonical assignment authority: it CAS-updates only WK.initiative and never writes the initiative record. Use unit/work_record_id and initiative/initiative_id as equivalent input pairs; conflicting aliases or slice selectors refuse. Repeating the same assignment is a no-op.",
      inputSchema: initiativeAssignmentInputSchema()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);

        const unitPair = resolveAssignmentIdentityPair(args, {
          canonicalField: "unit",
          aliasField: "work_record_id",
          parseIdentity: parseAssignmentUnitIdentity
        });
        const initiativePair = resolveAssignmentIdentityPair(args, {
          canonicalField: "initiative",
          aliasField: "initiative_id",
          parseIdentity: parseAssignmentInitiativeIdentity
        });

        const missing = [unitPair, initiativePair].filter((pair) => pair.state === "missing");
        if (missing.length > 0) {
          throw assignmentBoundaryRefusal(workspace.repo, {
            code: ASSIGNMENT_MISSING_SEMANTIC_IDENTITY_CODE,
            message:
              "assign_work_record_to_initiative requires at least one of unit/work_record_id and at least one of " +
              "initiative/initiative_id",
            path: missing[0].canonicalField,
            extra: {
              required_one_of: ASSIGNMENT_REQUIRED_ONE_OF.map((pair) => [...pair]),
              missing_semantic_identities: missing.map((pair) => [pair.canonicalField, pair.aliasField])
            }
          });
        }

        const identityErrors = [unitPair, initiativePair].some((pair) => pair.identity === null);
        const conflicts = identityErrors
          ? []
          : [unitPair, initiativePair].filter((pair) => pair.state === "conflict");
        if (conflicts.length > 0) {
          throw assignmentBoundaryRefusal(workspace.repo, {
            code: ASSIGNMENT_CONFLICTING_IDENTITY_ALIAS_CODE,
            message:
              "a canonical identity field and its alias were supplied with different canonical identities; " +
              "retry with one of the canonical retry_options",
            path: conflicts[0].canonicalField,
            extra: {
              conflicts: conflicts.map((pair) => ({
                canonical_field: pair.canonicalField,
                alias_field: pair.aliasField,
                canonical_value: pair.canonicalValue,
                alias_value: pair.aliasValue
              })),
              retry_options: buildAssignmentRetryOptions(unitPair, initiativePair, args)
            }
          });
        }

        const result = await assignWorkRecordToInitiative({
          dir: workspace.dir,
          unit: unitPair.value,
          initiative: initiativePair.value,
          expectedSourceDigest: args.expected_source_digest ?? null,
          verbose: true
        });
        return jsonContent(createCompactInitiativeAssignmentResponse(workspace.repo, result));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  const registerAmendSection = (toolName, subjectDescription, note) =>
    registerTool(
      toolName,
      {

        writeSemantics: MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT,
        description:
          `Set one declared body section of ${subjectDescription}. Write-capable; validated persistence honors ` +
          `optional expected_source_digest, and identity is server-resolved. ${note}`,
        inputSchema: sectionInputSchema()
      },
      async (args) => {
        try {
          const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
          const result = await amendKindRecordSection({
            repoRoot: workspace.dir,
            id: args.id,
            section: args.section,
            value: args.value,
            expectedSourceDigest: args.expected_source_digest ?? null
          });
          return jsonContent(createCompactKindRecordEditResponse(workspace.repo, args.id, result));
        } catch (error) {
          return errorContent(error);
        }
      }
    );

  const registerAmendScalar = (toolName, subjectDescription, note) =>
    registerTool(
      toolName,
      {

        writeSemantics: MCP_WRITE_SEMANTICS.NONE,
        description:
          `Amend one controlled scalar of ${subjectDescription}. Write-capable; validated persistence honors optional ` +
          `expected_source_digest. Server-managed lifecycle/provenance fields refuse; identity is server-resolved. ${note}`,
        inputSchema: scalarInputSchema()
      },
      async (args) => {
        try {
          const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
          const result = await amendKindRecordScalar({
            repoRoot: workspace.dir,
            id: args.id,
            field: args.field,
            value: args.value,
            expectedSourceDigest: args.expected_source_digest ?? null
          });
          return jsonContent(createCompactKindRecordEditResponse(workspace.repo, args.id, result));
        } catch (error) {
          return errorContent(error);
        }
      }
    );

  registerAmendSection("workspace_decision_amend_section", "a decision (`DEC-*`) record", DEC_DRAFT_NOTE);
  registerAmendScalar("workspace_decision_amend_scalar", "a decision (`DEC-*`) record", DEC_DRAFT_NOTE);
  registerAmendSection("workspace_initiative_amend_section", "an initiative (`IN-*`) record", IN_DRAFT_NOTE);
  registerAmendScalar("workspace_initiative_amend_scalar", "an initiative (`IN-*`) record", IN_DRAFT_NOTE);

  registerTool(
    "workspace_decision_reject",
    {

      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Reject a never-accepted proposed decision. Write-capable and agent-callable; server-resolved provenance and optional expected_source_digest protect the write. Other source states refuse. Human-only actions confer or remove accepted authority.",
      inputSchema: lifecycleInputSchema()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await rejectDecisionRecord({
          repoRoot: workspace.dir,
          id: args.id,
          expectedSourceDigest: args.expected_source_digest ?? null
        });
        return jsonContent(createCompactKindRecordEditResponse(workspace.repo, args.id, result));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  const registerCreate = (toolName, type, subjectDescription, birthState, note) =>
    registerTool(
      toolName,
      {

        writeSemantics: MCP_WRITE_SEMANTICS.NONE,
        description:
          `Create one ${subjectDescription} ${birthState} through the shared allocator. Write-capable; server-resolved ` +
          `identity and provenance produce canonical JSON and Markdown together. ${note}`,
        inputSchema: createInputSchema()
      },
      async (args) => {
        try {
          const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
          const result = await createWikiRecord({
            dir: workspace.dir,
            type,
            title: args.title,
            id: args.id ?? null
          });
          return jsonContent({
            workspaceRepo: workspace.repo,
            id: result.id,
            created: result.created ?? true
          });
        } catch (error) {
          return errorContent(error);
        }
      }
    );

  registerCreate(
    "workspace_decision_create",
    "decision",
    "decision (`DEC-*`) record",
    "in its non-binding `proposed` draft state",
    DEC_DRAFT_NOTE
  );
  registerCreate(
    "workspace_initiative_create",
    "initiative",
    "initiative (`IN-*`) record",
    "as a draft initiative",
    IN_DRAFT_NOTE
  );
}
