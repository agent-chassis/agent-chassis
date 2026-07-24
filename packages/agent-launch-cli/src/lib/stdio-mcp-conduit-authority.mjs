

import path from "node:path";

import {
  STDIO_MCP_CONDUIT_ALLOWED_FAMILIES,
  STDIO_MCP_CONDUIT_ALLOWED_ROLES,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  failStdioMcpConduit as fail,
  normalizeStdioMcpConduitRole
} from "./stdio-mcp-conduit-contract.mjs";

export const STDIO_MCP_CONDUIT_AUTHORITY_SCHEMA_VERSION =
  "launcher-stdio-mcp-conduit-authority.v1";

export const STDIO_MCP_CONDUIT_AUTHORITY_MODES = Object.freeze({
  ASSIGNED: "assigned",
  READ_ONLY: "read_only",
  COORDINATION: "coordination"
});

const ORCHESTRATOR_PROFILE = Object.freeze({
  source: "launcher-orchestrator-profile",
  readScope: Object.freeze(["."]),
  writeScope: Object.freeze(["docs", "wiki"])
});

const TRUSTED_AUTHORITIES = new WeakSet();

function refuse(message, detail = null) {
  fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID, message, detail);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}

function normalizeScopeArray(label, value) {
  if (value === null || value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    refuse(`${label} must be an array of repository-relative scope entries`);
  }
  const entries = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      refuse(`${label} contains a non-string or empty scope entry`);
    }
    if (entry.includes("\0")) {
      refuse(`${label} contains a scope entry with an embedded NUL`);
    }
    if (path.isAbsolute(entry)) {
      refuse(`${label} contains an absolute scope entry`, { entry });
    }
    const segments = entry.split("/");
    if (segments.includes("..")) {
      refuse(`${label} contains a scope entry that escapes the repository`, { entry });
    }
    entries.push(entry);
  }
  return Object.freeze([...new Set(entries)].sort());
}

function sameScope(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function freezeIdentityValue(value, label, depth = 0) {
  if (depth > 12) refuse(`${label} is too deeply nested`);
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezeIdentityValue(entry, label, depth + 1)));
  }
  if (!isPlainObject(value)) {
    refuse(`${label} must be launcher-resolved plain data`);
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!/^[A-Za-z0-9_]+$/u.test(key)) {
      refuse(`${label} contains an invalid field`, { field: key });
    }
    result[key] = freezeIdentityValue(value[key], label, depth + 1);
  }
  return Object.freeze(result);
}

function provisionedUnitMatches(provisionedUnit, assignedUnit) {
  return provisionedUnit.endsWith(`/${assignedUnit.replace("#", "/")}`);
}

function allNull(identity) {
  return identity !== null &&
    Object.values(identity).every((value) => value === null);
}

function resolveCrossRunIdentity({ sliceBinding, commitTuple }) {
  const fromBinding = sliceBinding === null
    ? null
    : {
        launch_ref: typeof sliceBinding.launch_ref === "string" ? sliceBinding.launch_ref : null,
        run_id: typeof sliceBinding.run_id === "string" ? sliceBinding.run_id : null,
        retry_id: sliceBinding.retry_id === undefined || sliceBinding.retry_id === null
          ? null
          : String(sliceBinding.retry_id)
      };
  const fromCommit = commitTuple === null || commitTuple === undefined
    ? null
    : {
        launch_ref: typeof commitTuple.launchRef === "string" ? commitTuple.launchRef : null,
        run_id: typeof commitTuple.runId === "string" ? commitTuple.runId : null,
        retry_id: commitTuple.retryId === undefined || commitTuple.retryId === null
          ? null
          : String(commitTuple.retryId)
      };
  if (fromBinding === null || allNull(fromBinding)) {
    return fromCommit === null || allNull(fromCommit) ? null : Object.freeze(fromCommit);
  }
  if (fromCommit === null || allNull(fromCommit)) return Object.freeze(fromBinding);

  for (const field of ["launch_ref", "run_id", "retry_id"]) {
    if (fromBinding[field] !== null && fromCommit[field] !== null &&
        fromBinding[field] !== fromCommit[field]) {
      refuse("worktree identity and commit tuple disagree on the run identity", {
        field,
        worktree_identity: fromBinding[field],
        commit_tuple: fromCommit[field]
      });
    }
  }
  return Object.freeze({
    launch_ref: fromBinding.launch_ref ?? fromCommit.launch_ref,
    run_id: fromBinding.run_id ?? fromCommit.run_id,
    retry_id: fromBinding.retry_id ?? fromCommit.retry_id
  });
}

export function mintTrustedStdioMcpConduitAuthority({
  family,
  role,
  assignedUnit,
  workspaceDir,
  workerScopeAuthority = null,
  canonicalWriteScope = null,
  provisioning = null,
  commitTuple = null
} = {}) {
  const conduitRole = normalizeStdioMcpConduitRole(role);
  if (!STDIO_MCP_CONDUIT_ALLOWED_FAMILIES.has(family)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FAMILY_UNSUPPORTED,
      "conduit authority supports only the Claude and Codex families", { family });
  }
  if (!STDIO_MCP_CONDUIT_ALLOWED_ROLES.has(conduitRole)) {
    refuse("conduit authority requires a launcher-derived role", { role: String(role) });
  }
  if (typeof assignedUnit !== "string" || assignedUnit.length === 0) {
    refuse("conduit authority requires a launcher-resolved assigned unit");
  }
  if (typeof workspaceDir !== "string" || !path.isAbsolute(workspaceDir)) {
    refuse("conduit authority requires an absolute launcher-resolved workspace");
  }
  const workspace = path.resolve(workspaceDir);

  if (provisioning !== null && provisioning !== undefined && !isPlainObject(provisioning)) {
    refuse("managed worktree provisioning carrier is malformed");
  }
  const carrier = provisioning ?? null;
  const provisionedUnit = typeof carrier?.unit_address === "string" ? carrier.unit_address : null;
  if (provisionedUnit !== null && !provisionedUnitMatches(provisionedUnit, assignedUnit)) {
    refuse("assigned unit does not match the managed provisioning unit binding", {
      canonical: provisionedUnit,
      requested: assignedUnit
    });
  }
  if (carrier !== null && typeof carrier.main_repo === "string" &&
      path.resolve(carrier.main_repo) !== workspace) {
    refuse("conduit workspace does not match the managed provisioning main repo", {
      canonical: carrier.main_repo,
      requested: workspace
    });
  }

  const sliceBinding = carrier?.slice_binding ?? null;
  if (sliceBinding !== null && !isPlainObject(sliceBinding)) {
    refuse("managed provisioning carries a malformed worktree identity");
  }
  const worktreeIdentity = sliceBinding === null
    ? Object.freeze({ kind: "launcher-workspace", workspace_dir: workspace })
    : freezeIdentityValue(sliceBinding, "worktree identity");
  if (sliceBinding !== null) {
    const boundUnit = typeof worktreeIdentity.unit_address === "string"
      ? worktreeIdentity.unit_address
      : null;
    if (boundUnit !== null && !provisionedUnitMatches(boundUnit, assignedUnit)) {
      refuse("worktree identity is bound to a different unit than the assigned unit", {
        canonical: boundUnit,
        requested: assignedUnit
      });
    }
  }

  let mode;
  let source;
  let readScope;
  let writeScope;
  let unitAddress = null;
  let sourceDigest = null;

  if (conduitRole === "worker" && !isPlainObject(workerScopeAuthority)) {

    if (carrier !== null) {
      refuse("a managed worker conduit requires its launcher-minted frozen scope authority");
    }

    if (canonicalWriteScope === null || canonicalWriteScope === undefined) {
      refuse("a confined worker conduit requires a launcher-resolved write-scope carrier");
    }
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED;
    source = "launcher-canonical-write-scope";
    readScope = Object.freeze([]);
    writeScope = normalizeScopeArray("write scope", canonicalWriteScope);
  } else if (conduitRole === "worker") {
    const selectedAddress = typeof workerScopeAuthority.selected_unit?.address === "string"
      ? workerScopeAuthority.selected_unit.address
      : null;
    if (selectedAddress !== null && selectedAddress !== assignedUnit) {
      refuse("assigned unit does not match the frozen scope-authority selected unit", {
        canonical: selectedAddress,
        requested: assignedUnit
      });
    }
    readScope = normalizeScopeArray("read scope", [
      ...(workerScopeAuthority.read_scope ?? []),
      ...(workerScopeAuthority.repo_paths ?? [])
    ]);
    writeScope = normalizeScopeArray("write scope", workerScopeAuthority.write_scope);

    if (carrier !== null && carrier.write_scope !== undefined && carrier.write_scope !== null) {
      const provisionedWriteScope = normalizeScopeArray(
        "provisioned write scope", carrier.write_scope);
      if (!sameScope(writeScope, provisionedWriteScope)) {
        refuse("frozen scope authority and managed provisioning disagree on the write scope", {
          scope_authority_write_scope: [...writeScope],
          provisioning_write_scope: [...provisionedWriteScope]
        });
      }
    }
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED;
    source = "launcher-frozen-scope-authority";
    unitAddress = typeof workerScopeAuthority.unit_address === "string"
      ? workerScopeAuthority.unit_address
      : null;
    sourceDigest = typeof workerScopeAuthority.source_digest === "string"
      ? workerScopeAuthority.source_digest
      : null;
  } else if (conduitRole === "orchestrator") {
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.COORDINATION;
    source = ORCHESTRATOR_PROFILE.source;
    readScope = ORCHESTRATOR_PROFILE.readScope;
    writeScope = ORCHESTRATOR_PROFILE.writeScope;
  } else {

    if (workerScopeAuthority !== null && workerScopeAuthority !== undefined) {
      refuse("a findings-only conduit role must not carry a worker scope authority",
        { role: conduitRole });
    }
    if (canonicalWriteScope !== null && canonicalWriteScope !== undefined) {
      refuse("a findings-only conduit role must not carry a write-scope carrier",
        { role: conduitRole });
    }
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.READ_ONLY;
    source = "launcher-role-policy";
    readScope = Object.freeze([]);
    writeScope = Object.freeze([]);
  }
  if (mode !== STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED && writeScope.length > 0 &&
      conduitRole !== "orchestrator") {
    refuse("only an assigned-mode conduit authority may carry a write scope");
  }

  const authority = Object.freeze({
    schemaVersion: STDIO_MCP_CONDUIT_AUTHORITY_SCHEMA_VERSION,
    family,
    role: conduitRole,
    assignedUnit,
    workspaceDir: workspace,
    mode,
    source,
    unitAddress,
    sourceDigest,
    readScope,
    writeScope,
    worktreeIdentity,
    crossRunIdentity: resolveCrossRunIdentity({ sliceBinding: worktreeIdentity, commitTuple })
  });
  TRUSTED_AUTHORITIES.add(authority);
  return authority;
}

export function assertTrustedStdioMcpConduitAuthority(authority, expected = {}) {
  if (!authority || typeof authority !== "object" || !Object.isFrozen(authority) ||
      !TRUSTED_AUTHORITIES.has(authority) ||
      authority.schemaVersion !== STDIO_MCP_CONDUIT_AUTHORITY_SCHEMA_VERSION) {
    refuse("stdio MCP conduit requires one launcher-minted trusted authority object");
  }
  const checks = [
    ["family", expected.family],
    ["role", expected.role],
    ["assignedUnit", expected.assignedUnit]
  ];
  for (const [field, value] of checks) {
    if (value !== undefined && value !== null && authority[field] !== value) {
      refuse("stdio MCP conduit authority was minted for a different launch", {
        field, authority: authority[field], launch: value
      });
    }
  }
  if (typeof expected.workspaceDir === "string" && expected.workspaceDir.length > 0 &&
      authority.workspaceDir !== path.resolve(expected.workspaceDir)) {
    refuse("stdio MCP conduit authority was minted for a different workspace", {
      field: "workspaceDir",
      authority: authority.workspaceDir,
      launch: path.resolve(expected.workspaceDir)
    });
  }
  return authority;
}

export function isTrustedStdioMcpConduitAuthority(value) {
  return typeof value === "object" && value !== null && TRUSTED_AUTHORITIES.has(value);
}
