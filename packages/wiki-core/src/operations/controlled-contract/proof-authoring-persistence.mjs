
import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { ControlledContractToolError, controlledContractContentDigest,
  withCanonicalControlledContractSourceLease } from "../../lib/controlled-contract-tools.mjs";
import { assertObligationCoverageSourcePathIntegrity, readCanonicalObligationSource,
  resolveObligationCoverageFacts, exactObject } from "./acceptance-coverage-facts.mjs";
import { withOrderedCoverageLocks } from "./acceptance-coverage-rebase.mjs";

const OBLIGATION_COVERAGE_OPERATION_CURSOR_VERSION =
  "wiki-core-obligation-coverage-operation-cursor.v1";

function obligationCoverageResolutionInput(input) {
  return {
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null,
    selectedUnit: input.selectedUnit ?? null
  };
}

function obligationCoverageSnapshotIdentity(resolved) {
  return JSON.stringify({
    authoring_identity: resolved.authoringIdentity,
    source_content_digest: resolved.source?.content_digest ?? null,
    source_current: resolved.sourceCurrent,
    stale_reasons: resolved.staleReasons
  });
}

function assertObligationCoverageFinalCompare(expected, actual) {
  if (obligationCoverageSnapshotIdentity(expected) !==
      obligationCoverageSnapshotIdentity(actual)) {
    throw new ControlledContractToolError(
      "obligation_coverage_final_compare_stale",
      "a mutation-relevant canonical identity changed before persistence",
      { changed: false, phase: "final_compare" }
    );
  }
}

async function assertObligationCoverageTargetIntegrity(resolved, { requireSource }) {
  return (await assertObligationCoverageSourcePathIntegrity({
    repoRoot: resolved.repoRoot,
    wkId: resolved.wkId,
    focus: resolved.focus,
    selectedUnit: resolved.selectedUnit
  }, { requireSource })).file;
}

async function persistObligationCoverageCarrier({
  input,
  expectedSnapshot,
  content,
  bytes,
  write,
  resolveFacts = resolveObligationCoverageFacts,
  directorySync = false,
  classifyPostCommit = false,
  draftObligation = false,
  persistenceEffects = {},
  withSourceLease = withCanonicalControlledContractSourceLease
}) {
  const file = await assertObligationCoverageTargetIntegrity(expectedSnapshot, {
    requireSource: expectedSnapshot.source !== null
  });
  const temporaryFile = `${file}.tmp-${randomUUID()}`;
  let temporary;
  let renamed = false;
  let renameAttempted = false;
  const openFile = persistenceEffects.openFile ?? open;
  const renameFile = persistenceEffects.renameFile ?? rename;
  const unlinkFile = persistenceEffects.unlinkFile ?? unlink;
  const readCurrent = () => readCanonicalObligationSource({
    ...obligationCoverageResolutionInput(input), repoRoot: expectedSnapshot.repoRoot
  });
  const readReceipt = persistenceEffects.readReceipt ?? readCurrent;
  const resolveCommitted = persistenceEffects.resolveCommitted ?? readCurrent;
  const syncDirectory = persistenceEffects.syncDirectory ?? (async (target) => {
    const directory = await open(dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  });
  return withSourceLease({
    repoRoot: input.repoRoot,
    wkId: input.wkId,
    focus: input.focus ?? null,
    ...(draftObligation ? { draftObligation: {
      selectedUnit: input.selectedUnit ?? null,
      expectedContentDigest: expectedSnapshot.source?.content_digest ?? null
    } } : {})
  }, async ({ assertDraftLease } = {}) => withOrderedCoverageLocks(
    [`${file}.lock`],
    "obligation_coverage_persistence_busy",
    async () => {
      try {
    const finalSnapshot = await resolveFacts(
      obligationCoverageResolutionInput(input), { requireSource: expectedSnapshot.source !== null }
    );
    assertDraftLease?.();
    assertObligationCoverageFinalCompare(expectedSnapshot, finalSnapshot);
    await assertObligationCoverageTargetIntegrity(finalSnapshot, {
      requireSource: expectedSnapshot.source !== null
    });
    if (!write) {
      const unchangedSnapshot = await resolveFacts(
        obligationCoverageResolutionInput(input), { requireSource: true }
      );
      assertDraftLease?.();
      assertObligationCoverageFinalCompare(expectedSnapshot, unchangedSnapshot);
      await assertObligationCoverageTargetIntegrity(unchangedSnapshot, {
        requireSource: true
      });
      return Object.freeze({
        content_digest: controlledContractContentDigest(content),
        byte_length: bytes.byteLength,
        changed: false
      });
    }
    temporary = await openFile(temporaryFile, "wx", 0o644);
    await temporary.writeFile(bytes);
    await temporary.sync();
    await temporary.close();
    temporary = null;
    const renameSnapshot = await resolveFacts(
      obligationCoverageResolutionInput(input), { requireSource: expectedSnapshot.source !== null }
    );
    assertDraftLease?.();
    assertObligationCoverageFinalCompare(expectedSnapshot, renameSnapshot);
    await assertObligationCoverageTargetIntegrity(renameSnapshot, {
      requireSource: expectedSnapshot.source !== null
    });
    renameAttempted = true;
    await renameFile(temporaryFile, file);
    renamed = true;
    const expectedDigest = controlledContractContentDigest(content);
    if (directorySync) await syncDirectory(file);
    const persisted = await readReceipt();
    if (persisted?.content_digest !== expectedDigest) throw new ControlledContractToolError(
      "obligation_coverage_persistence_receipt_mismatch",
      "persisted source does not identify the exact canonical content",
      { phase: "receipt", expected_content_digest: expectedDigest,
        actual_content_digest: persisted?.content_digest ?? null });
        return Object.freeze({ content_digest: expectedDigest,
          byte_length: bytes.byteLength, changed: true });
      } finally {
        if (temporary) await temporary.close();
        try { await unlinkFile(temporaryFile); } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
  )).catch(async error => {
    if (!renamed && renameAttempted) {

      try {
        const current = await readCanonicalObligationSource({
          ...obligationCoverageResolutionInput(input), repoRoot: expectedSnapshot.repoRoot
        }, { optional: true });
        const digest = current?.content_digest ?? null;
        renamed = digest !== (expectedSnapshot.source?.content_digest ?? null);
      } catch {
        renamed = true;
      }
    }
    if (!renamed) {
      error.details = { ...error.details, changed: false,
        phase: error.details?.phase ?? "persistence", limb: "mechanical_failure" };
      throw error;
    }
    if (!classifyPostCommit) throw error;
    const expectedDigest = controlledContractContentDigest(content);
    let committed;
    try { committed = (await resolveCommitted())?.content_digest === expectedDigest; }
    catch { committed = false; }
    return Object.freeze({ status: "post_commit_failure",
      commit_state: committed ? "committed" : "indeterminate",
      content_digest: expectedDigest, byte_length: bytes.byteLength,
      failure_code: error?.code ?? "obligation_coverage_post_commit_failure" });
  });
}

function obligationCoverageProjectionCursor(selector, offset) {
  return Buffer.from(JSON.stringify({ selector, offset }), "utf8").toString("base64url");
}

function decodeObligationCoverageProjectionCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    exactObject(value, ["selector", "offset"], "obligation coverage projection cursor");
    if (!Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error(
      "cursor offset is invalid"
    );
    return value;
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    throw new ControlledContractToolError(
      "obligation_coverage_cursor_invalid", "continuation is malformed",
      { changed: false, cause: error.message }
    );
  }
}

function encodeObligationCoverageOperationCursor(projectionCursor, joinedDigest) {
  return Buffer.from(JSON.stringify({
    version: OBLIGATION_COVERAGE_OPERATION_CURSOR_VERSION,
    joined_source_digest: joinedDigest,
    projection_cursor: projectionCursor
  }), "utf8").toString("base64url");
}

function decodeObligationCoverageOperationCursor(cursor, joinedDigest) {
  if (cursor === undefined) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    exactObject(value, ["version", "joined_source_digest", "projection_cursor"],
      "obligation coverage continuation");
    if (value.version !== OBLIGATION_COVERAGE_OPERATION_CURSOR_VERSION ||
        typeof value.joined_source_digest !== "string" ||
        typeof value.projection_cursor !== "string") throw new Error(
      "continuation identity is invalid"
    );
    if (joinedDigest !== undefined && value.joined_source_digest !== joinedDigest) throw new ControlledContractToolError(
      "obligation_coverage_cursor_stale",
      "continuation belongs to different joined canonical sources",
      { changed: false }
    );
    return decodeObligationCoverageProjectionCursor(value.projection_cursor);
  } catch (error) {
    if (error instanceof ControlledContractToolError) throw error;
    throw new ControlledContractToolError(
      "obligation_coverage_cursor_invalid", "continuation is malformed",
      { changed: false, cause: error.message }
    );
  }
}

export { obligationCoverageResolutionInput, assertObligationCoverageFinalCompare, persistObligationCoverageCarrier, obligationCoverageProjectionCursor, encodeObligationCoverageOperationCursor, decodeObligationCoverageOperationCursor };

export async function prepareProofAuthoringSourceSettlement({ initial, content, assertCurrent, persistenceEffects = {} }) {
  const { readFile } = await import('node:fs/promises');
  const file = await assertObligationCoverageTargetIntegrity(initial, { requireSource: initial.source !== null });
  const prior = initial.source === null ? null : await readFile(file);
  const bytes = Buffer.from(`${JSON.stringify(content, null, 2)}\n`);
  const digest = controlledContractContentDigest(content);
  let attempted = false;
  const read = async () => {
    try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const equal = (a, b) => a === null ? b === null : b !== null && a.equals(b);
  const replace = async value => {
    const temp = `${file}.tmp-${randomUUID()}`;
    try {
      const handle = await open(temp, 'wx', 0o644);
      try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
      await (persistenceEffects.renameFile ?? rename)(temp, file);
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { try { await unlink(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  };
  return {
    commit: async () => {
      await assertCurrent();
      if (!equal(await read(), prior)) throw new ControlledContractToolError('obligation_coverage_final_compare_stale', 'Source bytes moved before settlement');
      if (equal(bytes, prior)) return { content_digest: digest, changed: false };
      attempted = true;
      await replace(bytes);
      if (!equal(await read(), bytes)) throw new ControlledContractToolError('obligation_coverage_persistence_receipt_mismatch', 'Committed obligation source differs');
      return { content_digest: digest, changed: true };
    },
    compensate: async () => {
      if (!attempted) return;
      const current = await read();
      if (equal(current, prior)) return;
      if (!equal(current, bytes)) throw new ControlledContractToolError('obligation_coverage_compensation_stale', 'Source compensation cannot replace unrelated bytes');
      if (prior === null) await unlink(file); else await replace(prior);
      if (!equal(await read(), prior)) throw new ControlledContractToolError('obligation_coverage_compensation_failed', 'Exact prior obligation bytes were not restored');
    }
  };
}
