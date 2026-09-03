import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  MCP_WRITE_SEMANTICS,
  MCP_WRITE_SEMANTICS_STATEMENTS,
  MCP_WRITE_SEMANTICS_VALUES,
  createRegisterTool
} from "../../packages/wiki-mcp/src/lib/register-tool.mjs";
import { registerWorkRecordWriteTools } from "../../packages/wiki-mcp/src/lib/work-record-write-tools.mjs";
import { registerWikiCoreTools } from "../../packages/wiki-mcp/src/lib/wiki-core-tools.mjs";
import { registerControlledContractTools } from "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import { registerKindRecordWriteTools } from "../../packages/wiki-mcp/src/lib/kind-record-write-tools.mjs";
import { errorContent, jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { loadToolDiscoveryDescriptor } from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import { WORK_RECORD_CONTRACT_LIST_FIELDS } from "../../packages/wiki-core/src/lib/work-record-contract-edit.mjs";
import { WORK_RECORD_STATUS_VALUES } from "../../packages/wiki-core/src/lib/work-record-schema-constants.mjs";

const REGISTRATION_MODULES = [
  "work-record-write-tools.mjs",
  "wiki-core-tools.mjs",
  "controlled-contract-tools.mjs",

  "kind-record-write-tools.mjs"
];

function registerAllModules(registerTool) {
  const registrations = [];
  const moduleDependencies = (module) => ({
    registerTool(name, config, handler) {
      registrations.push({ module, name, config });
      return registerTool(name, config, handler);
    },
    workspaceRepos: [{ repo: "demo", dir: "/tmp/wk2167-write-semantics" }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: (workspaceRepos) => workspaceRepos[0]
  });

  registerWorkRecordWriteTools({
    ...moduleDependencies("work-record-write-tools.mjs"),
    shapeWriteResponse: (response) => response,
    createCompactWorkRecordEditResponse: (_repo, result) => result,
    createCompactContractEditResponse: (_repo, result) => result,
    validateOptionalExpectedSourceDigest: () => ({ ok: true, value: null }),
    runWorkspaceWorkRecordAdmissionRefreshRoute() {
      throw new Error("unexpected admission refresh route invocation");
    },
    runWorkspaceWorkRecordCleanupDerivedEvidenceRoute() {
      throw new Error("unexpected cleanup route invocation");
    },
    constants: {
      WORK_RECORD_STATUS_VALUES,
      WORK_RECORD_CONTRACT_LIST_FIELDS,
      WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME: "workspace_work_record_set_status",
      WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME: "workspace_work_record_set_task",
      WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME:
        "workspace_work_record_refresh_admission_metrics",
      WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME:
        "workspace_work_record_refresh_target_resolution_evidence",
      WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME:
        "workspace_work_record_cleanup_derived_evidence"
    }
  });

  registerWikiCoreTools({
    ...moduleDependencies("wiki-core-tools.mjs"),
    emptySchema: z.object({}),
    extensionNamespacesSchema: z.array(z.string()).optional()
  });

  registerControlledContractTools({
    ...moduleDependencies("controlled-contract-tools.mjs"),
    resolveControlledContractGenerationBinding: () => {
      throw new Error("unexpected generation binding resolution");
    },
    persistControlledContractGeneration: () => {
      throw new Error("unexpected generation persistence");
    }
  });

  registerKindRecordWriteTools(moduleDependencies("kind-record-write-tools.mjs"));

  return registrations;
}

function captureRegistrations() {
  const authored = registerAllModules(() => {});
  const published = new Map();
  const descriptorToolNames = new Set(authored.map(({ name }) => name));
  const boundary = createRegisterTool({
    server: {
      registerTool(name, config) {
        published.set(name, config);
      }
    },
    toolProfile: "operator",
    registeredTier: "paid_cce",
    mcpToolTierRegistrationPolicy: {
      descriptorLoaded: true,
      descriptorToolNames,
      registrationEligibleToolNames: descriptorToolNames,
      freeLocalToolNames: descriptorToolNames,
      freeLocalFallbackToolNames: null
    },
    toolUsageAuditBoundary: { wrapHandler: (_name, handler) => handler },
    registeredToolNames: new Set(),
    structuredLog: () => {}
  });
  registerAllModules(boundary);
  return { authored, published };
}

async function loadWriteCapableToolNames() {
  const descriptor = await loadToolDiscoveryDescriptor();
  const writeCapable = new Set();
  for (const tool of descriptor.tools) {
    if (!Array.isArray(tool.side_effects)) continue;
    if (tool.side_effects.some((effect) => effect !== "read_only")) {
      writeCapable.add(tool.tool_name);
    }
  }
  return writeCapable;
}

function statementFor(writeSemantics) {
  return writeSemantics === undefined ? null : MCP_WRITE_SEMANTICS_STATEMENTS[writeSemantics];
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function inputPropertyNames(inputSchema) {
  if (!inputSchema || typeof inputSchema !== "object") {
    return [];
  }
  if (inputSchema._def?.typeName === "ZodObject") {
    return Object.keys(inputSchema.shape);
  }
  if (inputSchema._def) {
    return [];
  }
  return Object.keys(inputSchema);
}

test("WK-2167: every write-semantics statement is a single short sentence with one owner", () => {
  const statements = [];
  for (const value of MCP_WRITE_SEMANTICS_VALUES) {
    const statement = MCP_WRITE_SEMANTICS_STATEMENTS[value];
    if (value === MCP_WRITE_SEMANTICS.NONE) {
      assert.equal(
        statement,
        null,
        "the 'none' value must emit nothing; it declares that no statement applies"
      );
      continue;
    }
    assert.equal(typeof statement, "string", `${value} must declare a statement`);
    assert.ok(statement.trim().length > 0, `${value} must declare a non-empty statement`);
    assert.ok(
      statement.length < 100,
      `the ${value} statement is ${statement.length} chars; it must stay under 100 so the live ` +
        "duplicate-sentence budget guard never buckets it, letting one owner serve every route"
    );
    assert.equal(
      statement.trim(),
      statement,
      `${value} must declare its statement without surrounding whitespace`
    );
    statements.push(statement);
  }
  assert.equal(
    new Set(statements).size,
    statements.length,
    "two declared values must not emit the same sentence; that is the duplication this emitter removes"
  );
  assert.ok(
    statements.length >= 2,
    "the vocabulary must be able to express more than one write semantics, so a route that both " +
      "replaces and appends cannot be described as if it only replaced"
  );
});

test("WK-2167: every write-capable registration declares its write semantics", async () => {
  const writeCapable = await loadWriteCapableToolNames();
  const { authored } = captureRegistrations();
  const declaredByModule = new Map(REGISTRATION_MODULES.map((module) => [module, 0]));

  for (const { module, name, config } of authored) {
    if (!writeCapable.has(name)) continue;
    assert.ok(
      Object.prototype.hasOwnProperty.call(config, "writeSemantics"),
      `${name} (${module}) is write-capable but declares no writeSemantics; declare one of ` +
        `${MCP_WRITE_SEMANTICS_VALUES.join(", ")} so the boundary can publish (or deliberately omit) ` +
        "a statement instead of leaving callers to infer the route's semantics"
    );
    assert.ok(
      MCP_WRITE_SEMANTICS_VALUES.includes(config.writeSemantics),
      `${name} declares unknown writeSemantics ${JSON.stringify(config.writeSemantics)}`
    );
    declaredByModule.set(module, declaredByModule.get(module) + 1);
  }

  for (const module of REGISTRATION_MODULES) {
    assert.ok(
      declaredByModule.get(module) > 0,
      `${module} contributed no write-capable registration to the population; the emitter must ` +
        "cover every registration module in the population"
    );
  }
});

test("WK-2167: the boundary emits the declared statement exactly once and no route hand-repeats it", () => {
  const { authored, published } = captureRegistrations();
  const emitted = new Set();

  for (const { name, config } of authored) {
    const publishedConfig = published.get(name);
    assert.ok(publishedConfig, `${name} must reach the SDK through the registration boundary`);

    assert.equal(
      Object.prototype.hasOwnProperty.call(publishedConfig, "writeSemantics"),
      false,
      `${name} must not publish the raw writeSemantics declaration to the SDK`
    );

    const statement = statementFor(config.writeSemantics);
    const expected = statement
      ? `${config.description.trim()} ${statement}`
      : config.description;
    assert.equal(
      publishedConfig.description,
      expected,
      `${name} must publish its authored description plus exactly the emitted statement`
    );

    for (const value of MCP_WRITE_SEMANTICS_VALUES) {
      const candidate = MCP_WRITE_SEMANTICS_STATEMENTS[value];
      if (!candidate) continue;
      assert.equal(
        countOccurrences(config.description ?? "", candidate),
        0,
        `${name} hand-repeats the ${value} statement in its own description literal; the ` +
          "registration boundary is the single owner of that sentence"
      );
      assert.ok(
        countOccurrences(publishedConfig.description ?? "", candidate) <= 1,
        `${name} publishes the ${value} statement more than once`
      );
    }

    if (statement) emitted.add(config.writeSemantics);
  }

  assert.ok(
    emitted.size >= 2,
    "the population must exercise more than one emitted statement; a single statement across all " +
      "routes would be the flat carry-or-don't flag this WK exists to avoid"
  );
});

test("WK-2167: a route that publishes a write mode declares mode-dependent semantics", () => {
  const { authored, published } = captureRegistrations();
  for (const { name, config } of authored) {
    if (config.writeSemantics === undefined) continue;
    const properties = inputPropertyNames(published.get(name)?.inputSchema);
    const publishesMode = properties.includes("mode");
    assert.equal(
      config.writeSemantics === MCP_WRITE_SEMANTICS.REPLACE_OR_APPEND,
      publishesMode,
      publishesMode
        ? `${name} publishes a mode selector, so its declared semantics must be mode-dependent; a ` +
            "flat replacement statement on a route that also appends is exactly the defect this emitter fixes"
        : `${name} declares mode-dependent semantics but publishes no mode selector`
    );
  }
});
