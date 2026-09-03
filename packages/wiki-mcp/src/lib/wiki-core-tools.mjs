

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

import {
  getReadSelectorValidationIssues,
  runWorkRecordReadWithCompactGate,
  workRecordDetailSelectorSchemaShape
} from "./work-record-compact-read-gate.mjs";

import {
  MCP_CALLABLE_OWNER_PROJECTION_PARAM,
  MCP_WRITE_SEMANTICS,
  projectMcpCallableOwnerIssues
} from "./register-tool.mjs";

export function registerWikiCoreTools({
  registerTool,
  workspaceRepos,
  z,
  emptySchema,
  extensionNamespacesSchema,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  section = "all"
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

  const workspaceReadPageInputSchema = strictReadSchema({
    path: nonEmptyString,
    repo: z.string().optional(),
    profile: z.string().optional(),
    extensionNamespaces: extensionNamespacesSchema,
    verbose: z.boolean().optional(),
    include_body: z.boolean().optional(),
    include_raw: z.boolean().optional(),
    include_record: z.boolean().optional(),
    accept_full_read: z.literal(true).optional(),
    compact_read_token: z.string().optional(),
    ...workRecordDetailSelectorSchemaShape(z, "workspace_read_page")
  }, "workspace_read_page");

  const workspaceGetRecordInputSchema = strictReadSchema({
    id: nonEmptyString,
    repo: z.string().optional(),
    profile: z.string().optional(),
    extensionNamespaces: extensionNamespacesSchema,
    verbose: z.boolean().optional(),
    include_record: z.boolean().optional(),
    include_body: z.boolean().optional(),
    include_raw: z.boolean().optional(),
    accept_full_read: z.literal(true).optional(),
    compact_read_token: z.string().optional(),
    ...workRecordDetailSelectorSchemaShape(z, "workspace_get_record")
  }, "workspace_get_record");

  function isGraphEvidenceSidecarReadPath(value) {
    return (
      typeof value === "string" &&
      value.startsWith("wiki/work-records/evidence/") &&
      value.endsWith(".graph.json")
    );
  }

  function resolveWorkspaceReadPageRepo(args) {
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
  }

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
        "Read a workspace Markdown page, canonical JSON work/kind record, or graph-evidence sidecar. Read-only; no caller filesystem root. Canonical records are compact-first; selected_slice returns only a work-record slice, while accept_full_read:true enables an unscoped full read. Sidecars are replay/debug data without dispatch authority; select at most one slice or record entry.",
      inputSchema: workspaceReadPageInputSchema
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceReadPageRepo(args);
        const result = await runWorkRecordReadWithCompactGate({
          workspaceRepo: workspace.repo,
          workspaceDir: workspace.dir,
          args,
          toolFamily: "workspace_read_page",
          readCompact: readWikiPage,
          readExpensive: readWikiPage,
          readWorkRecordById
        });
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
        "Read a canonical workspace wiki record by durable ID, including registered initiative and decision records. Read-only; no caller filesystem root. Canonical records are compact-first; selected_slice returns only a work-record slice, while accept_full_read:true enables an unscoped full read.",
      inputSchema: workspaceGetRecordInputSchema
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await runWorkRecordReadWithCompactGate({
          workspaceRepo: workspace.repo,
          workspaceDir: workspace.dir,
          args,
          toolFamily: "workspace_get_record",
          readCompact: getWikiRecord,
          readExpensive: getWikiRecord,
          readWorkRecordById
        });
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
        "Create a canonical workspace wiki record through the shared allocator and template path. Write-capable; no caller filesystem root. Compact by default; verbose:true adds allocator/template detail.",
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
        if (verbose) {
          return jsonContent({ workspaceRepo: workspace.repo, verbose: true, ...result });
        }
        const compactResult = {
          workspaceRepo: workspace.repo,
          id: result.id,
          created: result.created ?? true
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
        "Search canonical wiki/docs content with structured filters.",
      inputSchema: {
        dir: z.string(),
        query: z.string(),
        limit: z.number().optional(),
        offset: z.number().int().min(0).optional(),
        unbounded: z.boolean().optional(),
        reindex: z.boolean().optional(),
        verbose: z.boolean().optional(),
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
      }
    },
    async (args) => {
      try {
        return jsonContent(await searchRepo(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_search_repo",
    {
      description:
        "Search canonical workspace wiki/docs content. Read-only; no caller filesystem root. Compact results are limit/offset paged with complete counts and next_offset; unbounded:true returns every ranked match, and verbose:true adds full entries and diagnostics.",
      inputSchema: z.object({
        query: z.string(),
        repo: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().int().min(0).optional(),
        unbounded: z.boolean().optional(),
        verbose: z.boolean().optional(),
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
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await searchRepo({
          ...args,
          verbose: Boolean(args.verbose),
          dir: workspace.dir
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
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
