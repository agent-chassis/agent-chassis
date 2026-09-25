

import path from "node:path";

import {
  allocateId,
  bootstrapRepo,
  buildSearchIndex,
  checkContractSync,
  createWikiRecord,
  generateAndLint,
  generateViews,
  getWikiRecord,
  loadManifest,
  lintRepo,
  readWorkRecordById,
  readWikiPage,
  searchRepo,
  syncContract
} from "@agent-chassis/wiki-core";

import { buildLintFindingsResponse } from "@agent-chassis/wiki-core/src/operations/generate-and-lint.mjs";
import { autofixDocsBacklinks } from "@agent-chassis/wiki-core/src/operations/autofix-docs-backlinks.mjs";
import { getManifestRecordTypeVocabulary } from "@agent-chassis/wiki-core/src/lib/contract.mjs";
import { readSearchSource } from "@agent-chassis/wiki-core/src/operations/read-search-source.mjs";
import {
  buildNextCall,
  measureMcpInlineResultBytes,
  readSpilledMcpContentReference
} from "./mcp-response.mjs";

import {
  boundedEntryReadResult,
  createWorkRecordEntryReadSchema,
  projectEntryCallsForOrdinaryReader,
  workRecordEntryReadArguments
} from "./work-record-entry-tools.mjs";
import { readWorkRecordEntry } from "@agent-chassis/wiki-core";
import {
  createSelectedResponseSession,
  selectedResponseCollectionCounts,
  selectedResponseDetailSchema,
  selectedResponseQueryInvalidError,
  selectedResponseRequestSchema
} from "./selected-response-snapshot.mjs";
import {
  getSearchSelectedReadValidationIssues,
  getWorkspaceSearchValidationIssues,
  isSearchSelectedRead,
  searchSelectedReadSchemaShape
} from "./search-read-tools.mjs";

import {
  getReadSelectorValidationIssues,
  runWorkRecordReadWithCompactGate,
  selectedRecordMemberSchema,
  workRecordDetailSelectorSchemaShape
} from "./work-record-compact-read-gate.mjs";
import { isWorkRecordNavigationResult, toolVisibleToSession } from "./work-record-read-navigation.mjs";
import { canonicalProjectionReadRecoveryCall } from "./work-record-canonical-read-recovery.mjs";

import {
  createToolInputValidationError,
  MCP_CALLABLE_OWNER_PROJECTION_PARAM,
  MCP_WRITE_SEMANTICS,
  projectMcpCallableOwnerIssues
} from "./register-tool.mjs";

function selectorDeclaresSourceDigest(schema) {
  let current = schema;
  for (let depth = 0; depth < 8 && current?._def !== undefined; depth += 1) {
    if (current._def.typeName === "ZodObject") {
      return Object.hasOwn(current.shape, "expected_source_digest");
    }
    current = current._def.innerType ?? current._def.schema;
  }
  return false;
}

function isGraphEvidenceSidecarReadPath(value) {
  return (
    typeof value === "string" &&
    value.startsWith("wiki/work-records/evidence/") &&
    value.endsWith(".graph.json")
  );
}

export function createWorkspaceReadRepoResolver({ workspaceRepos, resolveWorkspaceRepo }) {
  return function resolveWorkspaceReadPageRepo(args) {
    const frozenReviewRoot = String(
      process.env.WIKI_MCP_REVIEW_MATERIALIZATION_DIR ?? ""
    ).trim();
    const role = String(process.env.WIKI_MCP_TOOL_PROFILE ?? "").trim();
    if (frozenReviewRoot !== "") {
      if ((role !== "reviewer" && role !== "redteam") ||
          !path.isAbsolute(frozenReviewRoot)) {
        throw new Error("launcher-frozen review materialization binding is invalid");
      }
      const frozenRepository = typeof workspaceRepos?.currentAlias === "string"
        ? workspaceRepos.currentAlias.trim()
        : "";
      if (frozenRepository === "") {
        throw new Error("launcher-frozen review repository binding is invalid");
      }
      const requestedRepository = typeof args.repo === "string"
        ? args.repo.trim()
        : frozenRepository;
      if (requestedRepository !== frozenRepository) {
        throw new Error(
          `workspace_read_page repository mismatch: requested ${requestedRepository || "(empty)"}; ` +
          `launcher-bound ${frozenRepository}`
        );
      }
      const canonical = resolveWorkspaceRepo(workspaceRepos, null);
      if (canonical.repo !== frozenRepository) {
        throw new Error("launcher-frozen review repository binding is invalid");
      }
      return { repo: frozenRepository, dir: path.resolve(frozenReviewRoot) };
    }
    if (args.repo || workspaceRepos?.currentAlias) {
      return resolveWorkspaceRepo(workspaceRepos, args.repo);
    }

    const defaultRepo = String(process.env.WIKI_MCP_DEFAULT_REPO || "").trim();
    if (
      isGraphEvidenceSidecarReadPath(args.path) &&
      defaultRepo &&
      workspaceRepos?.repos instanceof Map &&
      workspaceRepos.repos.has(defaultRepo)
    ) {
      return resolveWorkspaceRepo(workspaceRepos, defaultRepo);
    }

    return resolveWorkspaceRepo(workspaceRepos, args.repo);
  };
}

export function registerWikiCoreTools({
  registerTool,
  workspaceRepos,
  z,
  emptySchema,
  extensionNamespacesSchema,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  section = "all",
  isToolVisible = toolVisibleToSession,

  searchSelection = null
}) {
  const nonEmptyString = z.string().refine((value) => value.trim().length > 0, {
    message: "Expected a non-empty string"
  });
  const recordTypeVocabulary = getManifestRecordTypeVocabulary();
  const caseInsensitiveLiteral = (value) => [...value].map((character) => {
    if (/[a-z]/iu.test(character)) {
      return `[${character.toLowerCase()}${character.toUpperCase()}]`;
    }
    return character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
  }).join("");
  const acceptedRecordTypePattern = new RegExp(
    `^(?:${recordTypeVocabulary.accepted.map(caseInsensitiveLiteral).join("|")})$`,
    "u"
  );
  const createRecordTypeSchema = z.union([
    z.enum(recordTypeVocabulary.canonical).describe("Canonical manifest-owned record kinds."),
    z.enum(recordTypeVocabulary.aliases).describe("Canonical lowercase manifest-owned aliases."),
    z.string().regex(
      acceptedRecordTypePattern,
      "Expected a manifest-owned record kind or alias (case-insensitive)."
    ).describe("Case-insensitive record-kind or alias input normalized by wiki-core.")
  ]);
  function strictReadSchema(shape, toolFamily) {
    return z.object(shape).strict().superRefine((args, context) => {
      const issues = getReadSelectorValidationIssues(args, toolFamily);
      const ownerProjection = projectMcpCallableOwnerIssues({
        ownerId: "work-record-compact-read-gate",
        tool: toolFamily,
        issues
      });
      for (const issue of issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message,
          params: { [MCP_CALLABLE_OWNER_PROJECTION_PARAM]: ownerProjection }
        });
      }
    });
  }

  const ordinaryReadPageShape = {
    path: nonEmptyString.optional(),
    id: nonEmptyString.optional(),
    unit: nonEmptyString.optional(),
    repo: z.string().optional(),
    profile: z.string().optional(),
    extensionNamespaces: extensionNamespacesSchema,
    include_body: z.boolean().optional().describe(
      "Markdown page bodies only. A canonical WK/IN/DEC record or its generated page refuses it; read " +
        "record content with member:{path}, and one WK entry body with entry:{entry_id,include_body:true}. " +
        "Not combinable with member, entry or content_reference."
    ),
    member: selectedRecordMemberSchema(z),
    entry: createWorkRecordEntryReadSchema(z).optional(),
    content_reference: z.object({
      ref_id: nonEmptyString,
      offset: z.number().int().nonnegative().optional(),
      length: z.number().int().positive().optional()
    }).strict().optional(),
    ...workRecordDetailSelectorSchemaShape(z, "workspace_read_page")
  };
  const ordinaryReadPageFields = Object.keys(ordinaryReadPageShape)
    .filter((field) => !["path", "repo"].includes(field));
  const workspaceReadPageInputSchema = z.object({
    ...ordinaryReadPageShape,
    ...searchSelectedReadSchemaShape(z)
  }).strict().superRefine((args, context) => {
    const issues = isSearchSelectedRead(args)
      ? getSearchSelectedReadValidationIssues(args, ordinaryReadPageFields)
      : [...getSearchSelectedReadValidationIssues(args, ordinaryReadPageFields),
          ...getReadSelectorValidationIssues(args, "workspace_read_page")];
    const ownerProjection = projectMcpCallableOwnerIssues({
      ownerId: isSearchSelectedRead(args) ? "search-read-tools" : "work-record-compact-read-gate",
      tool: "workspace_read_page",
      issues
    });
    for (const issue of issues) context.addIssue({ code: z.ZodIssueCode.custom,
      path: issue.path, message: issue.message,
      params: { [MCP_CALLABLE_OWNER_PROJECTION_PARAM]: ownerProjection } });
  });

  const readPageDigestSelectors = Object.keys(ordinaryReadPageShape)
    .filter((field) => selectorDeclaresSourceDigest(ordinaryReadPageShape[field]));

  const projectReadPageInputFailure = async ({ args, validationError, tool }) => {
    const misplaced = validationError.issues.some((issue) => issue.code === "unrecognized_keys" &&
      issue.path.length === 0 && issue.keys.includes("expected_source_digest"));
    if (!misplaced) return projectCanonicalProjectionReadFailure({ args, validationError, tool });
    const selectedRead = readPageDigestSelectors.find((field) => args[field] !== undefined) ?? null;
    const { expected_source_digest: _misplaced, ...withoutDigest } = args;
    const retry = workspaceReadPageInputSchema.safeParse(withoutDigest).success
      ? [buildNextCall({ tool, arguments: withoutDigest, recommended: true })]
      : [];
    return {
      terminal_result: errorContent(createToolInputValidationError({
        tool,
        validationError,
        details: {
          digest_placement: {
            rejected_argument: "expected_source_digest",
            applied: false,
            selected_read: selectedRead,
            pinned_by: selectedRead === null ? null : `${selectedRead}.expected_source_digest`,
            accepted_placements: readPageDigestSelectors.map((field) =>
              `${field}.expected_source_digest`),
            statement: selectedRead === null
              ? "This read takes no source digest. A digest pins only a read selected through one of " +
                "accepted_placements, using the source_digest that kind of read returned."
              : `Pin this read with ${selectedRead}.expected_source_digest, using the source_digest ` +
                `a prior ${selectedRead} read returned.`
          }
        },
        nextCalls: retry
      }))
    };
  };

  const projectCanonicalProjectionReadFailure = async ({ args, validationError, tool }) => {
    const projection = validationError.issues.length === 1
      ? validationError.issues[0].params?.[MCP_CALLABLE_OWNER_PROJECTION_PARAM]
      : undefined;
    if (projection === undefined) return null;
    let workspace;
    try {
      workspace = resolveWorkspaceReadPageRepo(args);
    } catch {
      return null;
    }
    const call = await canonicalProjectionReadRecoveryCall({ toolFamily: tool, workspaceRepo: workspace.repo,
      workspaceDir: workspace.dir, args, diagnostics: projection.envelope?.diagnostics });
    return call === null ? null : { projection, next_calls: [call] };
  };

  const workspaceGetRecordInputSchema = strictReadSchema({
    id: nonEmptyString,
    repo: z.string().optional(),
    profile: z.string().optional(),
    extensionNamespaces: extensionNamespacesSchema,
    include_body: z.boolean().optional().describe(
      "Markdown page bodies only. A canonical WK/IN/DEC record or its generated page refuses it; read " +
        "record content with member:{path}. Not combinable with member."
    ),
    member: selectedRecordMemberSchema(z),
    ...workRecordDetailSelectorSchemaShape(z, "workspace_get_record")
  }, "workspace_get_record");

  const resolveWorkspaceReadPageRepo = createWorkspaceReadRepoResolver({
    workspaceRepos,
    resolveWorkspaceRepo
  });

  function registerWriteLintTools() {
    registerTool(
      "workspace_generate_and_lint",
      {
        writeSemantics: MCP_WRITE_SEMANTICS.NONE,
        description:
          "Regenerate non-canonical wiki views, then lint the workspace. Write-capable only for generated views; canonical records and docs are untouched. Use workspace_lint_repo when no refresh is wanted. max_findings bounds returned findings; 0 returns summary only.",
        inputSchema: {
          repo: z.string().optional(),
          profile: z.string().optional(),
          extensionNamespaces: extensionNamespacesSchema,
          max_findings: z.number().int().min(0).optional()
        }
      },
      async (args) => {
        try {
          const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
          const result = await generateAndLint({
            dir: workspace.dir,
            profile: args.profile,
            extensionNamespaces: args.extensionNamespaces,
            max_findings: args.max_findings
          });
          return jsonContent({ workspaceRepo: workspace.repo, ...result });
        } catch (error) {
          return errorContent(error);
        }
      }
    );

    registerTool(
      "workspace_lint_repo",
      {
        description:
          "Validate the workspace against the shared wiki contract. Read-only; use workspace_generate_and_lint to refresh generated views first. max_findings bounds returned findings; 0 returns summary only.",
        inputSchema: {
          repo: z.string().optional(),
          profile: z.string().optional(),
          extensionNamespaces: extensionNamespacesSchema,
          max_findings: z.number().int().min(0).optional()
        }
      },
      async (args) => {
        try {
          const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);

          const lint = await lintRepo({
            dir: workspace.dir,
            profile: args.profile,
            extensionNamespaces: args.extensionNamespaces,
            includeAllFindings: true
          });
          const result = buildLintFindingsResponse(lint, {
            maxFindings: args.max_findings
          });
          return jsonContent({ workspaceRepo: workspace.repo, ...result });
        } catch (error) {
          return errorContent(error);
        }
      }
    );

    registerTool(
      "workspace_autofix_docs_backlinks",
      {
        writeSemantics: MCP_WRITE_SEMANTICS.NONE,
        description:
          "Autofix missing docs backlink comments after recomputing fresh lint findings. Write-capable for matched canonical docs only; optional filters narrow fresh findings, and caller-supplied findings grant no write authority.",
        inputSchema: {
          repo: z.string().optional(),
          paths: z.array(z.string()).optional(),
          ids: z.array(z.string()).optional(),
          comments: z.array(z.string()).optional()
        }
      },
      async (args) => {
        try {
          const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
          const result = await autofixDocsBacklinks({
            dir: workspace.dir,
            paths: args.paths,
            ids: args.ids,
            comments: args.comments
          });
          return jsonContent({ workspaceRepo: workspace.repo, ...result });
        } catch (error) {
          return errorContent(error);
        }
      }
    );
  }

  if (section === "write-lint") {
    registerWriteLintTools();
    return;
  }

  registerTool(
    "get_contract_manifest",
    {
      description: "Read the shared wiki contract manifest.",
      inputSchema: emptySchema
    },
    async () => {
      try {
        return jsonContent(await loadManifest());
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "bootstrap_repo",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Create required wiki surfaces and sync the shared contract into a target repository.",
      inputSchema: {
        dir: z.string(),
        repo: z.string(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        return jsonContent(await bootstrapRepo(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "sync_contract",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Sync shared templates into a target repository or check for contract drift.",
      inputSchema: {
        dir: z.string(),
        check: z.boolean().optional(),
        repo: z.string().optional(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        const result = args.check
          ? await checkContractSync(args)
          : await syncContract(args);
        return jsonContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "allocate_id",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description: "Reserve the next identifier for a core wiki type.",
      inputSchema: {
        dir: z.string(),
        type: z.string(),
        repo: z.string().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(await allocateId(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "create_record",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Create a new wiki record from the shared template set, consuming the next reserved or sequential ID.",
      inputSchema: {
        dir: z.string(),
        type: z.string(),
        title: z.string(),
        id: z.string().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(await createWikiRecord(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "read_page",
    {
      description:
        "Read a markdown page from the target repository after search identifies its canonical path.",
      inputSchema: {
        dir: z.string(),
        path: z.string(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        return jsonContent(await readWikiPage(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_read_page",
    {
      description:
        "Read workspace Markdown, canonical records or graph sidecars. Address one page by path, or a canonical record by id or unit; entry reads one exact entry of that unit and content_reference reads one retained spill. Compact first; selected_slice narrows WKs, member:{path} pages one canonical WK/IN/DEC field, include_body reads Markdown bodies. No whole-record mode or caller root. Sidecars grant no dispatch authority.",
      inputSchema: workspaceReadPageInputSchema,
      inputValidationErrorProjector: projectReadPageInputFailure
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceReadPageRepo(args);
        if (isSearchSelectedRead(args)) {
          return jsonContent({
            workspaceRepo: workspace.repo,
            ...(await readSearchSource({
              dir: workspace.dir,
              repository: workspace.repo,
              path: args.path,
              searchMatch: args.search_match,
              length: args.length
            }))
          });
        }

        if (args.content_reference !== undefined) {
          return jsonContent({
            workspaceRepo: workspace.repo,
            ...readSpilledMcpContentReference({
              ref_id: args.content_reference.ref_id,
              offset: args.content_reference.offset ?? 0,
              length: args.content_reference.length ?? null
            })
          });
        }
        if (args.entry !== undefined) {
          const entryResult = boundedEntryReadResult(await readWorkRecordEntry(
            workRecordEntryReadArguments({ dir: workspace.dir, repository: workspace.repo,
              unit: args.unit ?? args.id, selector: args.entry })
          ));
          return jsonContent(projectEntryCallsForOrdinaryReader(entryResult, {
            tool: "workspace_read_page",
            identity: args.unit === undefined ? { id: args.id } : { unit: args.unit },
            repo: args.repo
          }));
        }
        const result = await runWorkRecordReadWithCompactGate({
          workspaceRepo: workspace.repo,
          workspaceDir: workspace.dir,
          args,
          toolFamily: "workspace_read_page",
          readCompact: readWikiPage,
          readExpensive: readWikiPage,
          readCompactById: getWikiRecord,
          readExpensiveById: getWikiRecord,
          readWorkRecordById,
          isToolVisible
        });
        if (isWorkRecordNavigationResult(result)) return jsonContent(result);
        return jsonContent({
          ...result,
          workspaceRepo: workspace.repo,
          id: result?.id ?? result?.record_id ?? null,
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "get_record",
    {
      description:
        "Read a canonical wiki record by its durable ID (work item, initiative, decision, source, or area slug).",
      inputSchema: {
        dir: z.string(),
        id: z.string(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        return jsonContent(await getWikiRecord(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_get_record",
    {
      description:
        "Read a canonical wiki record by ID. Compact first; selected_slice narrows WKs and member:{path} pages one canonical WK/IN/DEC field. No whole-record mode or caller root.",
      inputSchema: workspaceGetRecordInputSchema
    },
    async (args) => {
      try {

        const workspace = resolveWorkspaceReadPageRepo(args);
        const result = await runWorkRecordReadWithCompactGate({
          workspaceRepo: workspace.repo,
          workspaceDir: workspace.dir,
          args,
          toolFamily: "workspace_get_record",
          readCompact: getWikiRecord,
          readExpensive: getWikiRecord,
          readWorkRecordById
        });

        if (isWorkRecordNavigationResult(result)) return jsonContent(result);
        return jsonContent({
          workspaceRepo: workspace.repo,
          id: result?.id ?? result?.record_id ?? null,
          ...result
        });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_create_record",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Allocate a bare canonical inbox WK or other wiki record. No contract or lifecycle input; use obligation upsert for authoring. Writes records; verbose:true adds detail. No caller filesystem root.",
      inputSchema: z.object({
        type: createRecordTypeSchema,
        title: z.string(),
        repo: z.string().optional(),
        id: z.string().optional(),
        verbose: z.boolean().optional()
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await createWikiRecord({
          dir: workspace.dir,
          type: args.type,
          title: args.title,
          id: args.id ?? null
        });
        const verbose = Boolean(args.verbose);
        const nextCall = /^WK-[0-9]{4}$/u.test(result.id ?? "") ? {
          tool: "workspace_controlled_contract_obligation_coverage_query",
          arguments: { unit: result.id },
          follow_up_tool: "workspace_controlled_contract_obligation_coverage_upsert",
          recommended: true
        } : null;
        if (verbose) {
          return jsonContent({ workspaceRepo: workspace.repo, verbose: true, ...result,
            ...(nextCall === null ? {} : { next_call: nextCall }) });
        }
        const compactResult = {
          workspaceRepo: workspace.repo,
          id: result.id,
          created: result.created ?? true,
          ...(nextCall === null ? {} : { next_call: nextCall })
        };
        return jsonContent(compactResult);
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "lint_repo",
    {
      description: "Validate a repository against the shared wiki contract.",
      inputSchema: {
        dir: z.string(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        return jsonContent(await lintRepo(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "generate_views",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Generate the standard non-canonical wiki views from a repository wiki.",
      inputSchema: {
        dir: z.string(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        return jsonContent(await generateViews(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "generate_and_lint",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Generate standard wiki views, then validate the repository against the shared wiki contract.",
      inputSchema: {
        dir: z.string(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        return jsonContent(await generateAndLint(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "build_search_index",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Build or refresh the shared lexical wiki/docs search index for a repository.",
      inputSchema: {
        dir: z.string(),
        reindex: z.boolean().optional(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        return jsonContent(await buildSearchIndex(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "search_repo",
    {
      description:
        "Search canonical wiki/docs content in continuation pages.",
      inputSchema: z.object({
        dir: z.string(),
        query: nonEmptyString.optional(),
        continuation: z.string().min(1).optional(),
        limit: z.number().int().positive().max(50).optional(),
        history: z.boolean().optional(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema,
        kind: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        owner: z.string().optional(),
        area: z.string().optional(),
        initiative: z.string().optional(),
        retrieval_role: z.string().optional(),
        canonicality: z.string().optional(),
        maintenance_mode: z.string().optional(),
        knowledge_role: z.string().optional(),
        evidence_stage: z.string().optional(),
        retrieval_visibility: z.string().optional(),
        lifecycle: z.string().optional(),
        sensitivity: z.string().optional(),
        topic: z.string().optional()
      }).strict().superRefine((args, context) => {
        const issues = getWorkspaceSearchValidationIssues(args);
        const ownerProjection = projectMcpCallableOwnerIssues({ ownerId: "search-read-tools", tool: "search_repo", issues });
        for (const issue of issues) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message,
            params: { [MCP_CALLABLE_OWNER_PROJECTION_PARAM]: ownerProjection } });
        }
      })
    },
    async (args) => {
      try {
        return jsonContent(await searchRepo(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  const WORKSPACE_SEARCH_ROUTE = "workspace_search_repo";
  const selectedSearch = searchSelection ?? createSelectedResponseSession({
    route: WORKSPACE_SEARCH_ROUTE,
    requestSchema: selectedResponseRequestSchema(z.object({
      repo: z.string().optional(),
      detail: selectedResponseDetailSchema(z)
    }).strict()),
    buildDetailArguments: (binding, selection) => ({ repo: binding.repository, detail: selection })
  });
  const searchBinding = (repository, request) => ({ route: WORKSPACE_SEARCH_ROUTE, repository, unit: null,
    query_identity: request, observation_identity: null });

  function retainedSearchSummary(repository, request, carrier) {
    const binding = searchBinding(repository, request);
    const { source, snapshot_identity: snapshotIdentity } = selectedSearch.retain({ binding, carrier });
    return {
      workspaceRepo: repository,
      query_utf8_bytes: Buffer.byteLength(String(carrier.query ?? ""), "utf8"),
      total_count: carrier.total_count,
      returned_count: carrier.returned_count,
      limit: carrier.limit,
      has_more: carrier.has_more,
      selected_detail: {
        source,
        snapshot_identity: snapshotIdentity,
        omitted_members: ["query", "results", "next_calls", "diagnostics"],
        collections: selectedResponseCollectionCounts(carrier),
        next_calls: [selectedSearch.detailCall(binding, { source, snapshot_identity: snapshotIdentity,
          collection: carrier.results.length > 0 ? "results" : "next_calls" })]
      }
    };
  }

  function boundedSearchRefusal(error, repository, request) {
    const envelope = error?.envelope;
    if (repository === null || envelope === null || typeof envelope !== "object" ||
        measureMcpInlineResultBytes(envelope, { isError: true }) <= selectedSearch.maximumBytes) {
      return error;
    }
    const binding = searchBinding(repository, request);
    const { source, snapshot_identity: snapshotIdentity } = selectedSearch.retain({ binding, carrier: envelope });
    const bounded = new Error(error.message);
    bounded.code = error.code;
    bounded.envelope = {
      schema_version: envelope.schema_version,
      accepted: false,
      code: envelope.code,
      reason: envelope.reason,
      next_calls: [selectedSearch.detailCall(binding,
        { source, snapshot_identity: snapshotIdentity, collection: "next_calls" })],
      selected_detail: { source, snapshot_identity: snapshotIdentity, omitted_members: ["next_calls"],
        collections: selectedResponseCollectionCounts(envelope) }
    };
    return bounded;
  }

  registerTool(
    WORKSPACE_SEARCH_ROUTE,
    {
      description:
        "Search canonical workspace wiki/docs content in bounded ranked pages. next_calls continuations and selected-source read calls preserve complete traversal without caller offsets.",
      inputSchema: z.object({
        query: nonEmptyString.optional(),
        repo: z.string().optional(),
        continuation: z.string().min(1).optional(),
        limit: z.number().int().positive().max(50).optional(),
        history: z.boolean().optional(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema,
        kind: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        owner: z.string().optional(),
        area: z.string().optional(),
        initiative: z.string().optional(),
        retrieval_role: z.string().optional(),
        canonicality: z.string().optional(),
        maintenance_mode: z.string().optional(),
        knowledge_role: z.string().optional(),
        evidence_stage: z.string().optional(),
        retrieval_visibility: z.string().optional(),
        lifecycle: z.string().optional(),
        sensitivity: z.string().optional(),
        topic: z.string().optional(),
        detail: selectedResponseDetailSchema(z).optional()
      }).strict().superRefine((args, context) => {

        if (args.detail !== undefined) return;
        const issues = getWorkspaceSearchValidationIssues(args);
        const ownerProjection = projectMcpCallableOwnerIssues({ ownerId: "search-read-tools", tool: "workspace_search_repo", issues });
        for (const issue of issues) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message,
            params: { [MCP_CALLABLE_OWNER_PROJECTION_PARAM]: ownerProjection } });
        }
      })
    },
    async (args) => {
      let repository = null;
      const { repo: _repo, ...request } = args;
      try {
        const workspace = resolveWorkspaceReadPageRepo(args);
        repository = workspace.repo;
        if (args.detail !== undefined) {
          const searchArguments = Object.keys(request).filter((field) => field !== "detail").sort();
          if (searchArguments.length > 0) {
            throw selectedResponseQueryInvalidError(WORKSPACE_SEARCH_ROUTE, "detail_excludes_search_arguments",
              { arguments: searchArguments });
          }
          return jsonContent(await selectedSearch.detail({
            expected: { route: WORKSPACE_SEARCH_ROUTE, repository: workspace.repo },
            detail: args.detail
          }));
        }
        const frame = (result) => ({ workspaceRepo: workspace.repo, ...result });
        const fits = (payload) => measureMcpInlineResultBytes(payload) <= selectedSearch.maximumBytes;
        const result = await searchRepo({
          ...args,
          repository: workspace.repo,
          dir: workspace.dir,
          fits: (candidate) => fits(frame(candidate))
        });
        if (fits(frame(result))) return jsonContent(frame(result));
        return jsonContent(retainedSearchSummary(workspace.repo, request, frame(result)));
      } catch (error) {
        return errorContent(boundedSearchRefusal(error, repository, request));
      }
    }
  );

  registerTool(
    "workspace_build_search_index",
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Build or refresh the lexical wiki/docs search index for a configured workspace repository without accepting a caller-supplied filesystem root.",
      inputSchema: {
        repo: z.string().optional(),
        reindex: z.boolean().optional(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await buildSearchIndex({
          ...args,
          dir: workspace.dir
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  if (section !== "primary") {
    registerWriteLintTools();
  }
}
