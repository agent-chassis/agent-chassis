

import {
  amendKindRecordSection,
  amendKindRecordScalar,
  ratifyDecisionRecord,
  unratifyDecisionRecord,
  rejectDecisionRecord
} from "@agent-chassis/wiki-core/src/operations/kind-record-edit.mjs";
import { assignWorkRecordToInitiativeByUnit as defaultAssignWorkRecordToInitiative } from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";

import { createWikiRecord } from "@agent-chassis/wiki-core/src/operations/create.mjs";

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
        unit: z.string(),
        initiative: z.string(),
        expected_source_digest: z.string().optional()
      })
      .strict();

  const DEC_DRAFT_NOTE =
    "DEC-0152: agents DRAFT decisions but cannot ratify. `create` mints a `proposed` DEC and `amend` edits a " +
    "`proposed` DEC; neither can set `status`. Making a decision binding (`proposed`->`accepted`) is a HUMAN-ONLY " +
    "action by the operator (the `wiki decision ratify` CLI once it ships; operator-only in the interim) - there " +
    "is no agent ratify tool. To get a decision ratified, finish the `proposed` draft and ask the operator to " +
    "ratify it. Amending an `accepted` decision is refused until it is unratified back to `proposed`.";

  const IN_DRAFT_NOTE =
    "DEC-0152: agents draft initiatives (`IN-*`) freely - `create` mints a draft and `amend` edits it; neither " +
    "can set lifecycle/provenance-managed fields (status/updated). Initiatives have no ratification gate.";

  registerTool(
    "assign_work_record_to_initiative",
    {
      description:
        "Write-capable: assign one record-level work record (`WK-####`) to an existing initiative (`IN-####`). " +
        "Slice selectors are refused before mutation. `WK.initiative` is the sole canonical assignment authority; " +
        "initiative membership is derived by querying WK records with that scalar. The target initiative is " +
        "validated before at most one CAS-protected WK write. This tool never writes an initiative record or " +
        "`included_issues`. Repeating the current assignment is a true no-op without digest churn; reassignment " +
        "atomically overwrites only the WK initiative scalar. Missing targets, invalid WK records, unsupported " +
        "selectors, and stale expected_source_digest values return stable typed diagnostics without mutation. " +
        "When supplied, expected_source_digest must be `sha256:<64 lowercase hex>`; malformed values return " +
        "invalid_expected_source_digest rather than stale_source_digest.",
      inputSchema: initiativeAssignmentInputSchema()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await assignWorkRecordToInitiative({
          dir: workspace.dir,
          unit: args.unit,
          initiative: args.initiative,
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
        description:
          `Write-capable: amend one declared body section (\`section\`/\`value\`) of ${subjectDescription} ` +
          "by id through the validated kind-record persistence path, honoring an optional expected_source_digest " +
          `for stale-write protection. Identity is server-resolved; there is no actor input. ${note}`,
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
        description:
          `Write-capable: amend one controlled top-level scalar field (\`field\`/\`value\`) of ${subjectDescription} ` +
          "by id through the validated kind-record persistence path, honoring an optional expected_source_digest " +
          "for stale-write protection. Lifecycle/provenance-managed fields (status/ratified/updated) are refused. " +
          `Identity is server-resolved; there is no actor input. ${note}`,
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
    "workspace_decision_ratify",
    {
      description:
        "Write-capable: ratify a decision (`DEC-*`) record - the human `proposed` -> `accepted` status flip - by id, " +
        "stamping who/when provenance through the validated kind-record persistence path and honoring an optional " +
        "expected_source_digest. OPERATOR-ONLY human ratification action: agents are denied this tool by the " +
        "session-role policy (DEC-0152); it is being superseded by the `wiki decision ratify` CLI (WK-1512). Not " +
        "agent-callable and not ungated. Identity is server-resolved; there is no actor input.",
      inputSchema: lifecycleInputSchema()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await ratifyDecisionRecord({
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

  registerTool(
    "workspace_decision_unratify",
    {
      description:
        "Write-capable: unratify a decision (`DEC-*`) record - the human `accepted` -> `proposed` status flip - by " +
        "id, clearing the ratification provenance and stamping who/when through the validated kind-record " +
        "persistence path, honoring an optional expected_source_digest. Unratify first when an accepted decision " +
        "must be amended. OPERATOR-ONLY human action: agents are denied this tool by the session-role policy " +
        "(DEC-0152); it is being superseded by the `wiki decision unratify` CLI (WK-1512). Not agent-callable and " +
        "not ungated. Identity is server-resolved; there is no actor input.",
      inputSchema: lifecycleInputSchema()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await unratifyDecisionRecord({
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

  registerTool(
    "workspace_decision_reject",
    {
      description:
        "Write-capable: reject a decision (`DEC-*`) record - the `proposed` -> `rejected` status flip - by id, " +
        "stamping who/when provenance through the validated kind-record persistence path and honoring an optional " +
        "expected_source_digest. AGENT-CALLABLE: an agent may decline/reject its OWN never-accepted `proposed` draft " +
        "DEC. This is the ONLY DEC status transition an agent may perform (DEC-0155). It REFUSES any source status " +
        "other than `proposed` with an invalid_lifecycle_transition diagnostic - an accepted DEC cannot be rejected " +
        "as a backdoor unlock. Conferring or removing `accepted` authority (ratify/unratify/superseded/expired/" +
        "deprecated) stays HUMAN-ONLY. Identity is server-resolved; there is no actor input.",
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

  const registerCreate = (toolName, type, subjectDescription, note) =>
    registerTool(
      toolName,
      {
        description:
          `Write-capable: create a new ${subjectDescription} through the shared allocator/birth path (no ` +
          "caller-supplied filesystem root). The record is born in its non-binding draft state (a decision as " +
          "`proposed`), seeded to its required fields, and written as canonical `.json` with the `.md` projection in " +
          "lockstep. Identity/provenance is server-resolved; there is no actor input. Returns the compact born-record " +
          `envelope. ${note}`,
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

  registerCreate("workspace_decision_create", "decision", "decision (`DEC-*`) record", DEC_DRAFT_NOTE);
  registerCreate("workspace_initiative_create", "initiative", "initiative (`IN-*`) record", IN_DRAFT_NOTE);
}
