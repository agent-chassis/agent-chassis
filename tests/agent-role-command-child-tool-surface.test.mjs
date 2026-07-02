

import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_CHILD_TOOL_SURFACE_FORBIDDEN_STOCK_TOOLS,
  AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES,
  AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION,
  buildScopedChildToolSurfaceDescriptor,
  matchHandshakeToolSurface,
  refuseStockToolsInChildArgv
} from "../packages/agent-launch-cli/src/lib/agent-child-tool-surface.mjs";

test("buildScopedChildToolSurfaceDescriptor refuses raw_exec_enabled=true", () => {
  const refusal = buildScopedChildToolSurfaceDescriptor({
    role: "worker",
    raw_exec_enabled: true,
    read_scope: ["packages/x"],
    write_scope: ["packages/x"],
    validation_policy: { commands: [{ form: "argv", argv: ["node", "--check", "packages/x.mjs"] }] },
    provenance_destination: { kind: "launcher_owned" }
  });
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.refusal_code, AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.RAW_EXEC_FORBIDDEN);
});

test("buildScopedChildToolSurfaceDescriptor refuses non-empty write_scope for reviewer/redteam roles", () => {
  for (const role of ["reviewer", "redteam"]) {
    const refusal = buildScopedChildToolSurfaceDescriptor({
      role,
      raw_exec_enabled: false,
      read_scope: ["packages/x"],
      write_scope: ["packages/x"],
      validation_policy: { commands: [{ form: "argv", argv: ["node", "--check", "packages/x.mjs"] }] },
      provenance_destination: { kind: "launcher_owned" }
    });
    assert.equal(refusal.accepted, false);
    assert.equal(
      refusal.refusal_code,
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.WRITE_FORBIDDEN_FOR_ROLE,
      `expected WRITE_FORBIDDEN_FOR_ROLE for ${role}`
    );
  }
});

test("buildScopedChildToolSurfaceDescriptor never exposes stock Edit/Write/MultiEdit/NotebookEdit/Bash as scoped tool names", () => {
  const descriptor = buildScopedChildToolSurfaceDescriptor({
    role: "worker",
    raw_exec_enabled: false,
    read_scope: ["packages/x"],
    write_scope: ["packages/x"],
    validation_policy: { commands: [{ form: "argv", argv: ["node", "--check", "packages/x.mjs"] }] },
    provenance_destination: { kind: "launcher_owned" }
  });
  assert.equal(descriptor.accepted, true);
  assert.equal(descriptor.schema_version, AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION);
  for (const stockTool of AGENT_CHILD_TOOL_SURFACE_FORBIDDEN_STOCK_TOOLS) {
    assert.ok(!descriptor.scoped_tool_names.includes(stockTool));
    assert.ok(descriptor.disallowed_tools.includes(stockTool));
  }
  for (const scopedTool of descriptor.scoped_tool_names) {
    assert.match(scopedTool, /^filesystem_mcp\./);
  }
});

test("refuseStockToolsInChildArgv refuses child argv that re-introduce stock tools or bypass permissions", () => {
  for (const stockTool of AGENT_CHILD_TOOL_SURFACE_FORBIDDEN_STOCK_TOOLS) {
    const refusal = refuseStockToolsInChildArgv({
      argv: ["claude", "--allowedTools", `Read,${stockTool}`, "--print"]
    });
    assert.equal(refusal.accepted, false);
    assert.equal(refusal.refusal_code, AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.STOCK_TOOL_IN_ARGV);
  }
  const bypass = refuseStockToolsInChildArgv({
    argv: ["claude", "--dangerously-skip-permissions"]
  });
  assert.equal(bypass.accepted, false);
  assert.equal(bypass.refusal_code, AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.STOCK_TOOL_IN_ARGV);
  const accepted = refuseStockToolsInChildArgv({
    argv: ["claude", "--allowedTools", "Read,Grep,Glob", "--print"]
  });
  assert.equal(accepted.accepted, true);
});

test("matchHandshakeToolSurface refuses a handshake tool_surface that disagrees with the descriptor", () => {
  const descriptor = buildScopedChildToolSurfaceDescriptor({
    role: "worker",
    raw_exec_enabled: false,
    read_scope: ["packages/x"],
    write_scope: ["packages/x"],
    validation_policy: { commands: [{ form: "argv", argv: ["node", "--check", "packages/x.mjs"] }] },
    provenance_destination: { kind: "launcher_owned" }
  });
  assert.equal(descriptor.accepted, true);
  for (const key of ["read", "write", "structured_validation", "final_report"]) {
    const handshake = { ...descriptor.tool_surface, [key]: !descriptor.tool_surface[key] };
    const refusal = matchHandshakeToolSurface({ descriptor, handshakeToolSurface: handshake });
    assert.equal(refusal.accepted, false);
    assert.equal(
      refusal.refusal_code,
      AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH
    );
  }
  const refusalExtra = matchHandshakeToolSurface({
    descriptor,
    handshakeToolSurface: { ...descriptor.tool_surface, raw_exec: true }
  });
  assert.equal(refusalExtra.accepted, false);
  assert.equal(
    refusalExtra.refusal_code,
    AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.HANDSHAKE_TOOL_SURFACE_MISMATCH
  );
});
