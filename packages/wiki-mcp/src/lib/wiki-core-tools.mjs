

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
  readWikiPage,
  searchRepo,
  syncContract
} from "@agent-chassis/wiki-core";

import { buildLintFindingsResponse } from "@agent-chassis/wiki-core/src/operations/generate-and-lint.mjs";
import { autofixDocsBacklinks } from "@agent-chassis/wiki-core/src/operations/autofix-docs-backlinks.mjs";

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
  function isGraphEvidenceSidecarReadPath(value) {
    return (
      typeof value === "string" &&
      value.startsWith("wiki/work-records/evidence/") &&
      value.endsWith(".graph.json")
    );
  }

  function resolveWorkspaceReadPageRepo(args) {
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
        description:
          "Write-capable: regenerate the non-canonical wiki views, then lint the workspace repository. Only generated views are written; canonical records and docs are untouched. Use this (not workspace_lint_repo) when views should be refreshed before linting. Optional max_findings caps returned findings: omit for the bounded default, 0 for summary only, or a positive integer for a repair session — large caps can produce large responses.",
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
          "Read-only: validate the workspace repository against the shared wiki contract. Writes nothing; use workspace_generate_and_lint when the generated views must be refreshed first. Optional max_findings caps returned findings: omit for the bounded default, 0 for summary only, or a positive integer for a repair session — large caps can produce large responses.",
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
        description:
          "Write-capable: explicitly autofix missing docs backlink comments in canonical docs pages after recomputing fresh lint findings internally. Use optional path/id/comment filters only to narrow which fresh findings are applied; the route never accepts caller-supplied findings as write authority and does not change read-only lint behavior.",
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
        "Read a markdown page, JSON work-record, or graph-evidence sidecar from a workspace repository (no caller-supplied filesystem root). For tracker work-records, WK-level output is compact by default: detailed done, cancelled, and parked slice bodies are intentionally omitted, and record/slice agent note bodies are omitted. Included slice rows may expose agent_notes_bytes, the UTF-8 byte count of slice agent notes. Use selected_slice:<id> for one slice's full actionable details and notes. Full/debug opt-ins include include_body, include_raw, include_record, or verbose:true; complete payloads may spill. Graph-evidence sidecars are replay/debug data and never dispatch authority; use selected_slice or selected_record (mutually exclusive) to pull a single replay entry.",
      inputSchema: {
        path: z.string(),
        repo: z.string().optional(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema,
        verbose: z.boolean().optional(),
        include_body: z.boolean().optional(),
        include_raw: z.boolean().optional(),
        include_record: z.boolean().optional(),
        selected_slice: z.string().optional(),
        selected_record: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceReadPageRepo(args);
        const result = await readWikiPage({
          ...args,
          dir: workspace.dir
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
        "Read a canonical wiki record from a workspace repository (no caller-supplied filesystem root). For tracker work-records, WK-level output is compact by default: detailed done, cancelled, and parked slice bodies are intentionally omitted, and record/slice agent note bodies are omitted. Included slice rows may expose agent_notes_bytes, the UTF-8 byte count of slice agent notes. Use selected_slice:<id> for one slice's full actionable details and notes. Full/debug opt-ins include include_record, include_body, include_raw, or verbose:true; complete payloads may spill.",
      inputSchema: {
        id: z.string(),
        repo: z.string().optional(),
        profile: z.string().optional(),
        extensionNamespaces: extensionNamespacesSchema,
        verbose: z.boolean().optional(),
        include_record: z.boolean().optional(),
        include_body: z.boolean().optional(),
        include_raw: z.boolean().optional(),
        selected_slice: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await getWikiRecord({
          ...args,
          dir: workspace.dir
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
      description:
        "Create a new canonical wiki record in a workspace repository through the shared allocator/template path (no caller-supplied filesystem root). Output is compact by default; pass verbose:true for full allocator/template details.",
      inputSchema: {
        type: z.string(),
        title: z.string(),
        repo: z.string().optional(),
        id: z.string().optional(),
        verbose: z.boolean().optional()
      }
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
        "Search canonical wiki/docs content in a workspace repository (no caller-supplied filesystem root). Default compact output is bounded by limit, but reports complete total_count, returned_count, limit, offset, has_more, and next_offset metadata. Use offset/next_offset paging or unbounded:true to retrieve every ranked match; pass verbose:true for index/filter diagnostics and full result entries.",
      inputSchema: {
        query: z.string(),
        repo: z.string().optional(),
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
