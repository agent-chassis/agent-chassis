import {
  createTaskResultSnapshotRegistry
} from "@agent-chassis/controlled-contract";
import {
  AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH,
  AUTHORING_ERGONOMICS_REPORT_AUTHORITY,
  AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS,
  AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS,
  authoringErgonomicsCollectionDescriptor,
  buildAuthoringErgonomicsReport,
  projectAuthoringErgonomicsCompactReport,
  projectAuthoringErgonomicsReportPage,
  projectAuthoringErgonomicsReportPageContext
} from "@agent-chassis/wiki-core/src/operations/authoring-ergonomics.mjs";
import { buildNextCall } from
  "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { buildPublicMechanicalRefusal } from
  "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";

export const AUTHORING_ERGONOMICS_REPORT_TOOL_NAME =
  "workspace_authoring_ergonomics_report";
export const AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME =
  "workspace_authoring_ergonomics_report_query";

export const AUTHORING_ERGONOMICS_REPORT_FIRST_CALL_EXAMPLES = Object.freeze({
  workspace_errors_log: Object.freeze({ source_kind: "workspace_errors_log" }),
  retained_smoke_evidence: Object.freeze({
    source_kind: "retained_smoke_evidence",
    retained_smoke_evidence: Object.freeze({
      schema_version: "authoring-ergonomics-retained-smoke.v1",
      trace_id: "RETAINED-1",
      retained_source: Object.freeze({
        source_kind: "retained_smoke",
        source_locator: "retained://run"
      }),
      sessions: Object.freeze([
        Object.freeze({ session_token: "RUN-1", source_ordinal: 0 })
      ]),
      capture: Object.freeze({
        declarations: Object.freeze([
          Object.freeze({
            event_families: Object.freeze(["tool_call"]),
            capture_mode: "all_calls",
            captured_record_count: 1,
            total_record_count: 1
          })
        ])
      }),
      observations: Object.freeze([
        Object.freeze({
          kind: "mcp_call",
          session_token: "RUN-1",
          tool: "example_tool",
          diagnostic: false,
          response: Object.freeze({
            transport_status: "ok",
            application_status: "normal",
            route_present: false
          }),
          receipt: Object.freeze({ receipt_state: "present", receipt_id: "RCPT-1" })
        })
      ])
    })
  })
});

const REPORT_DESCRIPTION = [
  "Read-only compact authoring-ergonomics summary over one bounded evidence source; advisory evidence only.",
  `source_kind:\"workspace_errors_log\" reads only ${AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH}; source_kind:\"retained_smoke_evidence\" requires the bounded envelope.`,
  `First calls: ${JSON.stringify(AUTHORING_ERGONOMICS_REPORT_FIRST_CALL_EXAMPLES.workspace_errors_log)} or ${JSON.stringify(AUTHORING_ERGONOMICS_REPORT_FIRST_CALL_EXAMPLES.retained_smoke_evidence)}.`,
  "Owner routing is summarized as owner_resolved, owner_unresolved, or lookup_degraded.",
  `The response stores one immutable authenticated snapshot and recommends ${AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME}; it never returns the old full report or a report-local spill.`
].join(" ");

const QUERY_DESCRIPTION = [
  "Read-only typed inspection of one immutable authoring-ergonomics snapshot; advisory evidence only.",
  `Collections: ${AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS.map(({ collection }) => collection).join(", ")}.`,
  `Required prior state is a snapshot created by ${AUTHORING_ERGONOMICS_REPORT_TOOL_NAME}; invoke this query only with that report's executable continuation.`,
  "Use selector for a stable row, cursor for the next page, and field_path plus offset/length only for a selected scalar. Expired or unknown identity or cursor refuses loudly. Journal recovery returns the report rerun route; retained-evidence recovery is callable only while the original bounded envelope remains available, otherwise the refusal identifies that caller-supplied prerequisite and emits no unusable call. No live reread or whole-response fallback exists."
].join(" ");

const REPORT_REQUEST_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    repo: Object.freeze({ type: "string" }),
    source_kind: Object.freeze({
      type: "string",
      enum: AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS
    }),
    retained_smoke_evidence: Object.freeze({ type: "object" })
  }),
  required: Object.freeze(["source_kind"]),
  additionalProperties: false
});

function measureAuthoringProjectionBytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

function assertAuthoringProjectionBound(value, maximumBytes) {
  if (measureAuthoringProjectionBytes(value) > maximumBytes) {
    throw new RangeError("authoring-ergonomics query projection exceeds its byte bound");
  }
  return value;
}

function authoringSnapshotUnavailable(reason, recovery, details = {}) {
  const error = new Error("authoring-ergonomics snapshot is unavailable");
  error.code = "authoring_ergonomics_snapshot_unavailable";
  error.details = Object.freeze({ reason, recovery, ...details });
  return error;
}

function authoringQueryInvalid(reason, recovery, details = {}) {
  const error = new Error("authoring-ergonomics query is invalid");
  error.code = "authoring_ergonomics_query_invalid";
  error.details = Object.freeze({ reason, recovery, ...details });
  return error;
}

export function createAuthoringErgonomicsSnapshotRegistry(options = {}) {
  return createTaskResultSnapshotRegistry({
    ...options,
    maximumItems: 64,
    maximumBytes: 64 * 1024,
    maximumScalarRangeBytes: 8 * 1024,
    collectionDescriptor: (domain, collection) => domain === "authoring_ergonomics"
      ? authoringErgonomicsCollectionDescriptor(collection) : null,
    projectPage: ({ result, collection, selector, ordinal, maximumItems,
      sourceCurrent }) => projectAuthoringErgonomicsReportPage({
      report: result,
      collection,
      selector,
      ordinal,
      maximumItems,
      sourceCurrent
    }),
    projectPageContext: ({ result, collection }) =>
      projectAuthoringErgonomicsReportPageContext({ report: result, collection }),
    measureProjectionBytes: measureAuthoringProjectionBytes,
    assertProjectionBound: assertAuthoringProjectionBound,
    queryOperationForDomain: () => AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME,
    unavailableError: authoringSnapshotUnavailable,
    invalidError: authoringQueryInvalid,
    accountingMode: "fields",
    schemaVersions: {
      field: "authoring-ergonomics-report-query-field.v1",
      row: "task-result-row-projection.v1"
    }
  });
}

export const authoringErgonomicsSnapshots = createAuthoringErgonomicsSnapshotRegistry();

function reportRecoveryArguments(args) {
  return Object.freeze({
    ...(args.repo === undefined ? {} : { repo: args.repo }),
    source_kind: args.source_kind,
    ...(args.retained_smoke_evidence === undefined
      ? {}
      : { retained_smoke_evidence: structuredClone(args.retained_smoke_evidence) })
  });
}

function queryNextCall(snapshotIdentity, args) {
  return buildNextCall({
    tool: AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME,
    arguments: {
      ...(args.repo === undefined ? {} : { repo: args.repo }),
      source_kind: args.source_kind,
      snapshot_identity: snapshotIdentity,
      collection: "finding_observations"
    },
    recommended: true
  });
}

function queryRecovery(args) {
  if (!AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS.includes(args.source_kind)) return null;
  if (args.source_kind === "retained_smoke_evidence" &&
      args.retained_smoke_evidence === undefined) return null;
  return Object.freeze({
    tool: AUTHORING_ERGONOMICS_REPORT_TOOL_NAME,
    arguments: reportRecoveryArguments(args)
  });
}

function mechanicalRefusal(error, args) {
  const recovery = error.details?.recovery ?? queryRecovery(args);
  const code = error.code === "authoring_ergonomics_snapshot_unavailable"
    ? "authoring_ergonomics_snapshot_unavailable"
    : "authoring_ergonomics_query_invalid";
  if (code === "authoring_ergonomics_snapshot_unavailable" &&
      recovery?.tool === AUTHORING_ERGONOMICS_REPORT_TOOL_NAME) {
    const predicate = Object.freeze({
      fact: "authoring_ergonomics.snapshot_available",
      operator: "is_true"
    });
    const nextCall = buildNextCall({
      tool: recovery.tool,
      arguments: recovery.arguments,
      recommended: true,
      success_predicate: predicate
    });
    return buildPublicMechanicalRefusal({
      code,
      deciding_facts: [{ field: "authoring_ergonomics.snapshot_available", value: false }],
      next_calls: [nextCall],
      recovery: {
        state: "callable",
        prerequisite: "the previous immutable authoring-ergonomics snapshot is unavailable",
        operation: recovery.tool,
        success_condition: "workspace_authoring_ergonomics_report returns a new current snapshot identity",
        success_predicate: predicate,
        selected_from: ["authoring_ergonomics.snapshot_available"]
      },
      route: AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME,
      observed_facts: { "authoring_ergonomics.snapshot_available": false },
      request_schemas: { [recovery.tool]: REPORT_REQUEST_SCHEMA }
    });
  }
  if (code === "authoring_ergonomics_snapshot_unavailable" &&
      args.source_kind === "retained_smoke_evidence") {
    const field = "authoring_ergonomics.retained_smoke_evidence";
    return buildPublicMechanicalRefusal({
      code,
      deciding_facts: [{ field, value: "caller_supplied_prior_state_required" }],
      no_supported_route: true,
      recovery: { state: "no_supported_route" },
      route: AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME,
      observed_facts: { [field]: "caller_supplied_prior_state_required" }
    });
  }
  return buildPublicMechanicalRefusal({
    code,
    deciding_facts: [{ field: "authoring_ergonomics.query_valid", value: false }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    route: AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME,
    observed_facts: { "authoring_ergonomics.query_valid": false }
  });
}

function throwMechanicalRefusal(error, args) {
  const wrapped = new Error(error.message);
  wrapped.code = error.code;
  wrapped.envelope = mechanicalRefusal(error, args);
  throw wrapped;
}

export function registerAuthoringErgonomicsTools({
  registerTool,
  z,
  jsonContent,
  errorContent,
  workspaceRepos,
  resolveWorkspaceRepo,
  snapshots = authoringErgonomicsSnapshots
}) {
  const reportInput = z.object({
    repo: z.string().max(128).optional(),
    source_kind: z.enum(AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS),
    retained_smoke_evidence: z.object({}).passthrough().optional()
  }).strict().refine(
    (value) => value.source_kind === "retained_smoke_evidence"
      ? value.retained_smoke_evidence !== undefined
      : value.retained_smoke_evidence === undefined,
    { message: "source selection is mutually exclusive and complete" }
  );

  const selectorInput = z.object({
    id: z.string().max(256).optional(),
    population_class: z.string().max(128).optional(),
    workflow_token: z.string().max(256).optional(),
    evidence_state: z.string().max(128).optional(),
    severity: z.string().max(128).optional(),
    category: z.string().max(128).optional(),
    owner_routing_state: z.enum(["owner_resolved", "owner_unresolved", "lookup_degraded"]).optional(),
    axis: z.string().max(128).optional(),
    observed: z.boolean().optional(),
    outcome: z.string().max(128).optional(),
    routing_state: z.enum(["owner_resolved", "owner_unresolved", "lookup_degraded"]).optional(),
    source: z.enum(["adapter", "report", "routing"]).optional(),
    kind: z.string().max(128).optional()
  }).strict().refine((value) => Object.keys(value).length > 0, {
    message: "selector must contain at least one declared field"
  });

  const queryInput = z.object({
    repo: z.string().max(128).optional(),
    source_kind: z.enum(AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS),
    snapshot_identity: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),
    collection: z.enum(AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS
      .map(({ collection }) => collection)).optional(),
    selector: selectorInput.optional(),
    cursor: z.string().max(64 * 1024).optional(),
    field_path: z.array(z.union([
      z.string().min(1).max(256),
      z.number().int().nonnegative()
    ])).min(1).max(32).optional(),
    offset: z.number().int().nonnegative().optional(),
    length: z.number().int().positive().max(8 * 1024).optional(),
    page_size: z.number().int().positive().max(64).optional()
  }).strict().superRefine((value, context) => {
    if (value.cursor !== undefined) {
      const incompatible = ["snapshot_identity", "collection", "selector", "field_path",
        "offset", "length", "page_size"].filter((field) => value[field] !== undefined);
      if (incompatible.length > 0) context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cursor is exclusive with ${incompatible.join(", ")}`
      });
      return;
    }
    for (const field of ["snapshot_identity", "collection"]) {
      if (value[field] === undefined) context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} is required without cursor`
      });
    }
    if ((value.offset === undefined) !== (value.length === undefined)) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "offset and length must be supplied together"
    });
    if (value.field_path === undefined &&
        (value.offset !== undefined || value.length !== undefined)) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "offset and length require field_path"
    });
    if (value.field_path !== undefined && value.selector?.id === undefined) context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "field_path requires selector.id"
    });
  });

  registerTool(AUTHORING_ERGONOMICS_REPORT_TOOL_NAME, {
    description: REPORT_DESCRIPTION,
    inputSchema: reportInput
  }, async (args) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const report = await buildAuthoringErgonomicsReport({
        dir: workspace.dir,
        source_kind: args.source_kind,
        ...(args.retained_smoke_evidence === undefined
          ? {}
          : { retained_smoke_evidence: args.retained_smoke_evidence })
      });
      const recoveryArgs = reportRecoveryArguments(args);
      const identity = snapshots.put({
        domain: "authoring_ergonomics",
        result: report,
        sourceIdentity: {
          workspace_repo: workspace.repo,
          source_kind: args.source_kind
        },
        recovery: {
          tool: AUTHORING_ERGONOMICS_REPORT_TOOL_NAME,
          arguments: recoveryArgs
        }
      });
      const metadata = snapshots.metadata(identity);
      const compact = projectAuthoringErgonomicsCompactReport(report, {
        snapshot: {
          identity,
          current: metadata.current,
          created_at: metadata.created_at,
          expires_at: metadata.expires_at
        },
        nextCalls: [queryNextCall(identity, args)]
      });
      return jsonContent({ workspaceRepo: workspace.repo, ...compact });
    } catch (error) {
      return errorContent(error);
    }
  });

  registerTool(AUTHORING_ERGONOMICS_REPORT_QUERY_TOOL_NAME, {
    description: QUERY_DESCRIPTION,
    inputSchema: queryInput
  }, async (args) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await snapshots.query({
        identity: args.snapshot_identity ?? null,
        domain: "authoring_ergonomics",
        collection: args.collection ?? null,
        selector: args.selector ?? null,
        cursor: args.cursor ?? null,
        fieldPath: args.field_path ?? null,
        offset: args.offset ?? null,
        length: args.length ?? null,
        maximumItems: args.page_size ?? 64,
        expectedSourceIdentity: {
          workspace_repo: workspace.repo,
          ...(args.source_kind === undefined ? {} : { source_kind: args.source_kind })
        },
        recovery: queryRecovery(args)
      });
      return jsonContent({ workspaceRepo: workspace.repo, ...result });
    } catch (error) {
      if (["authoring_ergonomics_snapshot_unavailable", "authoring_ergonomics_query_invalid"]
        .includes(error?.code)) {
        try {
          throwMechanicalRefusal(error, args);
        } catch (refusal) {
          return errorContent(refusal);
        }
      }
      return errorContent(error);
    }
  });
}

export { AUTHORING_ERGONOMICS_REPORT_AUTHORITY };
