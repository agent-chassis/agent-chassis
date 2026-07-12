import { runAdoption } from "./commands/adoption.mjs";
import { runAllocateId } from "./commands/allocate-id.mjs";
import { runBootstrap } from "./commands/bootstrap.mjs";
import { runCreate } from "./commands/create.mjs";
import { runDecision } from "./commands/decision.mjs";
import { runDocsPolicy } from "./commands/docs-policy.mjs";
import { runGenerate } from "./commands/generate.mjs";
import { runLint } from "./commands/lint.mjs";
import { runNodeEngine } from "./commands/node-engine.mjs";
import { runBuildSearchIndex } from "./commands/build-search-index.mjs";
import { runGetRecord, runRead } from "./commands/read.mjs";
import { runSearch } from "./commands/search.mjs";
import { runSidecar } from "./commands/sidecar.mjs";
import { runValidateDispatch } from "./commands/validate-dispatch.mjs";
import { runWorkRecordMigration } from "./commands/work-record-migration.mjs";
import { runWorkRecordEscalations } from "./commands/work-record-escalations.mjs";
import { runWorkRecordRender } from "./commands/work-record-render.mjs";
import { runWorkRecords } from "./commands/work-records.mjs";
import { runWorkReportIngestion } from "./commands/work-report-ingestion.mjs";
import { runSyncContract } from "./commands/sync-contract.mjs";
import { runToolsDescribe } from "./commands/tools-describe.mjs";
import { runAgentFaq } from "./commands/agent-faq.mjs";

const HELP_TEXT = `wiki <command> [options]

Commands:
  bootstrap          Seed wiki surfaces and static IN-0001 adoption work into a target repo (operator shell only; no MCP/dispatch/preflight against the target)
  adoption           Structured first-run adoption readiness checks (read-only; adoption verify)
  sync-contract      Sync shared templates and contract metadata into a repo
  allocate-id        Reserve the next identifier for a core wiki type
  create             Create a new wiki record
  decision           Human-only DEC ratification (ratify/unratify a proposed<->accepted; operator shell only)
  lint               Validate a repository against the shared contract
  generate           Generate standard non-canonical wiki views
  build-search-index Build the shared lexical wiki/docs search index
  search             Search canonical wiki/docs content with structured filters
  read               Read one markdown page by repo-relative path
  get-record         Read one canonical wiki record by durable ID
  work-records       Inspect canonical JSON work-records with load, validate, digest, and summary
  docs-policy        Validate agent-facing docs for non-MCP role-dispatch authority drift
  agent-faq          Serve the read-only agent-faq.v1 known-issues corpus (symptom -> structured route, actor)
  work-record-migration  Migrate one legacy Markdown WK into canonical JSON
  work-record-escalations  Author trusted proposed and accepted escalation records
  work-record-render  Render Markdown or agent brief projections from canonical work records
  work-report-ingestion  Ingest trusted work-report.v1 worker closure evidence
  tools-describe      Describe discoverable tools and commands
  validate-dispatch   Validate a unit address against the dispatch-readiness contract
  node-engine        Consumer-facing Node Engine API-key checks (structural-only; validate-smoke)
  code-index         Repo code index status, build, impact, graph impact, symbol navigation, call graph, and context surfaces
  sidecar            Legacy alias for code-index
  help               Show this help text

Examples:
  wiki bootstrap --repo org/repo --profile research --extensions organizations,people,themes --dir /path/to/repo
  wiki adoption verify --dir /path/to/repo --json
  wiki sync-contract --dir /path/to/repo --check
  wiki allocate-id issue --repo org/repo --dir /path/to/repo
  wiki create decision "Standardize cross-repo links" --dir /path/to/repo
  wiki create issue "Honor reserved IDs during record creation" --id WK-0005 --dir /path/to/repo
  wiki create issue "Emit canonical JSON work records" --dir /path/to/repo
  wiki decision ratify --id DEC-0001 --dir /path/to/repo
  wiki decision unratify --id DEC-0001 --dir /path/to/repo
  wiki lint --dir /path/to/repo
  wiki generate --dir /path/to/repo --profile research --extensions organizations,people,themes
  wiki build-search-index --dir /path/to/repo
  wiki search --query "request lane hangs" --kind docs --dir /path/to/repo
  wiki read --path wiki/issues/WK-0001.md --dir /path/to/repo
  wiki get-record --id WK-0001 --dir /path/to/repo
  wiki work-records load --id WK-0001 --json --dir /path/to/repo
  wiki work-records validate --id WK-0001 --json --dir /path/to/repo
  wiki work-records digest --id WK-0001 --json --dir /path/to/repo
  wiki work-record-migration --id WK-0001 --dir /path/to/repo --json
  wiki work-record-escalations propose --record-id WK-0001 --id ESC-0001 --reason "Trusted proposal" --dir /path/to/repo
  wiki work-record-render markdown --id WK-0001 --dir /path/to/repo
  wiki work-report-ingestion --unit WK-0001 --report-path /path/to/work-report.json --dir /path/to/repo
  wiki tools-describe --task dispatch-worker --json --dir /path/to/repo
  wiki agent-faq --json
  wiki agent-faq --id read-scope-missing-or-unfamiliar --json
  wiki validate-dispatch --unit WK-0001 --dir /path/to/repo --json
  wiki node-engine validate-smoke --json
  wiki code-index build --json --dir /path/to/repo
  wiki code-index graph-impact-paths --json --paths packages/app/src/service.mjs --dir /path/to/repo
  wiki code-index find-references --json --symbol "<scip-symbol>" --dir /path/to/repo
  wiki code-index definition --json --path packages/app/src/service.mjs --line 12 --dir /path/to/repo
  wiki code-index callers --json --symbol "<scip-symbol>" --dir /path/to/repo
  wiki code-index callees --json --path packages/app/src/service.mjs --line 12 --dir /path/to/repo
  wiki code-index impact-paths --json --paths packages/app/src/service.mjs --dir /path/to/repo
  wiki code-index context-for-path --json --path packages/app/src/service.mjs --dir /path/to/repo
  wiki code-index status --json --dir /path/to/repo
`;

export async function run(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP_TEXT);
      return;
    case "bootstrap":
      await runBootstrap(rest);
      return;
    case "adoption":
      await runAdoption(rest);
      return;
    case "sync-contract":
      await runSyncContract(rest);
      return;
    case "allocate-id":
      await runAllocateId(rest);
      return;
    case "create":
      await runCreate(rest);
      return;
    case "decision":
      await runDecision(rest);
      return;
    case "lint":
      await runLint(rest);
      return;
    case "generate":
      await runGenerate(rest);
      return;
    case "build-search-index":
      await runBuildSearchIndex(rest);
      return;
    case "search":
      await runSearch(rest);
      return;
    case "read":
      await runRead(rest);
      return;
    case "get-record":
      await runGetRecord(rest);
      return;
    case "work-records":
      await runWorkRecords(rest);
      return;
    case "docs-policy":
      await runDocsPolicy(rest);
      return;
    case "agent-faq":
      await runAgentFaq(rest);
      return;
    case "work-record-migration":
      await runWorkRecordMigration(rest);
      return;
    case "work-record-escalations":
      await runWorkRecordEscalations(rest);
      return;
    case "work-record-render":
      await runWorkRecordRender(rest);
      return;
    case "work-report-ingestion":
      await runWorkReportIngestion(rest);
      return;
    case "tools-describe":
      await runToolsDescribe(rest);
      return;
    case "validate-dispatch":
      await runValidateDispatch(rest);
      return;
    case "node-engine":
      await runNodeEngine(rest);
      return;
    case "code-index":
      await runSidecar(rest, { surfaceName: "code-index" });
      return;
    case "sidecar":
      await runSidecar(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
  }
}
