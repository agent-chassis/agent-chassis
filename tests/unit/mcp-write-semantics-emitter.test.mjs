import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  MCP_WRITE_SEMANTICS,
  MCP_WRITE_SEMANTICS_STATEMENTS,
  MCP_WRITE_SEMANTICS_VALUES,
  createRegisterTool
} from "../../packages/wiki-mcp/src/lib/register-tool.mjs";
import { registerSaveRecordTools } from "../../packages/wiki-mcp/src/lib/task-save-record-tools.mjs";
import { registerCreateRecordTools } from "../../packages/wiki-mcp/src/lib/task-create-record.mjs";
import { loadToolDiscoveryDescriptor } from "../../packages/wiki-core/src/lib/tool-discovery.mjs";

const REGISTRATION_MODULES = ["task-save-record-tools.mjs", "task-create-record.mjs"];

function registerAllModules(registerTool) {
  const registrations = [];
  for (const [module, register] of [[REGISTRATION_MODULES[0], registerSaveRecordTools],
    [REGISTRATION_MODULES[1], registerCreateRecordTools]]) {
    register({ registerTool(name, config, handler) {
      registrations.push({ module, name, config });
      return registerTool(name, config, handler);
    }, z, workspace: { repo: "demo", dir: "/tmp/wk2167-write-semantics" }, registeredTier: "paid_cce",
      sessionEnv: { WIKI_MCP_TOOL_PROFILE: "operator" }, responseEnv: {} });
  }
  return registrations;
}

function captureRegistrations() {
  const authored = registerAllModules(() => {});
  const published = new Map();
  const descriptorToolNames = new Set(authored.map(({ name }) => name));
  for (const toolProfile of ["operator", "orchestrator", "reviewer", "worker", "redteam"]) {
    const boundary = createRegisterTool({
      server: {
        registerTool(name, config) {
          published.set(name, config);
        }
      },
      toolProfile,
      registeredTier: "paid_cce",
      mcpToolTierRegistrationPolicy: {
        descriptorLoaded: true,
        descriptorToolNames,
        registrationEligibleToolNames: descriptorToolNames,
        toolDescriptors: new Map([...descriptorToolNames].map(name => [name, { tool_name: name, kind: "mcp_tool", tier_visibility: ["free_local", "paid_cce"] }]))
      },
      toolUsageAuditBoundary: { wrapHandler: (_name, handler) => handler },
      registeredToolNames: new Set(),
      structuredLog: () => {}
    });
    registerAllModules(boundary);
  }
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

  assert.equal(emitted.size, 0, "current coherent authoring declares no generic replacement sentence");
});

test("current authoring routes publish their coherent changes contract without retired mode/action envelopes", () => {
  const { authored, published } = captureRegistrations();
  assert.deepEqual(authored.map(row => row.name), ["save_record", "workspace_create_record"]);
  for (const { name, config } of authored) {
    assert.equal(config.writeSemantics, MCP_WRITE_SEMANTICS.NONE);
    assert.equal(published.get(name).description, config.description);
    assert.equal(inputPropertyNames(config.advertisedInputSchema).includes("mode"), false);
    assert.equal(inputPropertyNames(config.advertisedInputSchema).includes("action"), false);
  }
});

test("the registrar emits every declared semantics once and consumes the declaration", () => {
  for (const writeSemantics of MCP_WRITE_SEMANTICS_VALUES) {
    let published;
    const name = "save_record";
    const boundary = createRegisterTool({ server: { registerTool(_name, config) { published = config; } },
      toolProfile: "operator", registeredTier: "paid_cce", mcpToolTierRegistrationPolicy: {
        descriptorLoaded: true, descriptorToolNames: new Set([name]), registrationEligibleToolNames: new Set([name]),
        toolDescriptors: new Map([[name, { kind: "mcp_tool", tier_visibility: ["paid_cce"] }]]) },
      registeredToolNames: new Set(), structuredLog() {}, toolUsageAuditBoundary: { wrapHandler: (_name, fn) => fn } });
    boundary(name, { description: "Authored intent.", inputSchema: z.object({}), writeSemantics }, async () => ({ content: [] }));
    const statement = statementFor(writeSemantics);
    assert.equal(published.description, `Authored intent.${statement ? ` ${statement}` : ""}`);
    assert.equal(Object.hasOwn(published, "writeSemantics"), false);
  }
});
