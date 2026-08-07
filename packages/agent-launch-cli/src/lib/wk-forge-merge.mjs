import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, renameSync, rmSync, mkdtempSync, lstatSync, openSync, closeSync, statSync, fstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
  verifyTerminalWkCandidateObjectBinding
} from "./terminal-wk-candidate.mjs";
import { authenticateTerminalCloseoutProjection } from "./wk-forge-terminal-closeout-authentication.mjs";
import { localId as localSliceId } from "./wk-forge-handoff-recovery.mjs";
import { canonicalizeWorkRecordJson, projectSliceReviewReceiptContracts } from "../../../wiki-core/src/index.mjs";

export function defaultRunGit({ repo, args, env = null }) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8", env: env === null ? process.env : { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024
  });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function defaultRunGh({ args, cwd = null }) {
  const result = spawnSync("gh", args, { cwd: cwd ?? undefined, encoding: "utf8", env: process.env, maxBuffer: 32 * 1024 * 1024 });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function computeWorkRecordSourceDigest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function resolveCanonicalForgeRepository({ repo, deps = {} }) {
  const runGit = deps.runGit ?? defaultRunGit;
  try {
    const fetchUrls = runGit({ repo, args: ["remote", "get-url", "--all", "origin"] }).stdout.trim().split("\n").filter(Boolean);
    const pushUrls = runGit({ repo, args: ["remote", "get-url", "--push", "--all", "origin"] }).stdout.trim().split("\n").filter(Boolean);
    const rewrites = runGit({ repo, args: ["config", "--get-regexp", "^url\\." ] });
    if (fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== pushUrls[0] || rewrites?.stdout?.trim()) return { ok: false, reason: "remote_identity_unproven" };
    const parsed = new URL(fetchUrls[0]);
    const parts = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/u, "").split("/");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
        !/^\/[^/]+\/[^/]+(?:\.git)?$/u.test(parsed.pathname) || parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, reason: "remote_not_canonical" };
    }
    return { ok: true, repository: { host: parsed.hostname, owner: parts[0], name: parts[1], https_url: fetchUrls[0] } };
  } catch { return { ok: false, reason: "remote_unreadable" }; }
}

function readCandidateBoundRecord({ mainRepo, wk, binding, deps = {} }) {
  try {
    const raw = run(deps.runGit ?? defaultRunGit, mainRepo, ["show", `${binding.candidate}:wiki/work-records/${wk}.json`]);
    const record = jsonRecord(raw, "candidate record unreadable");
    return record.id === wk ? { ok: true, record } : { ok: false, reason: "candidate_record_identity_mismatch" };
  } catch {

    if (binding.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) return { ok: true, record: null };
    return { ok: false, reason: "candidate_record_unreadable" };
  }
}

export const WK_FORGE_MERGE_RESULT_SCHEMA_VERSION = "agent_launch.wk_forge_merge_result.v1";
export const WK_FORGE_MERGE_FAILURE_CATEGORIES = Object.freeze({
  REQUEST_INVALID: "request_invalid",
  ELIGIBILITY: "eligibility",
  IDENTITY: "identity_disagreement",
  CAS: "branch_compare_and_swap_failed",
  FORGE: "forge_merge_failed",
  RECONCILIATION: "local_reconciliation_failed",
  INDETERMINATE: "indeterminate"
});

const WK_RE = /^WK-\d{4}$/u;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FILE = (wk) => `wiki/work-records/${wk}.json`;
function sameForgeRepository(a, b) {
  return Boolean(a && b && a.host === b.host && a.owner === b.owner && a.name === b.name);
}

function refuse(category, reason, detail = null) {
  return { ok: false, category, detail: { reason, ...(detail ?? {}) } };
}

function run(runGit, repo, args, env = null) {
  const result = runGit({ repo, args, env });
  if (!result || result.ok !== true) throw new Error(`git ${args[0]} failed`);
  return String(result.stdout ?? "").trim();
}

function jsonRecord(raw, reason) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(reason);
  }
}

function terminalReviewComplete(record) {
  const slices = Array.isArray(record.slices) ? record.slices : [];
  const terminal = slices.filter((slice) => slice?.review_purpose === "terminal_whole_wk");
  return terminal.length === 1 && terminal[0].work_kind === "review" && terminal[0].status === "review";
}

function validateWorkRecordShape(record, wk, { terminalComplete = false } = {}) {
  const requiredArrays = ["read_scope", "repo_paths", "write_scope", "depends_on", "blocks", "related", "children"];
  const requiredStrings = ["repo", "title", "record_kind", "work_kind", "priority", "owner", "created", "updated"];
  const statuses = ["todo", "in_progress", "review", "blocked", "done"];
  const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
  const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
  return record?.schema_version === "work-record.v1" && record.id === wk &&
    requiredStrings.every((key) => typeof record[key] === "string" && record[key].length > 0) &&
    typeof record.initiative === "string" && /^IN-\d{4}$/u.test(record.initiative) && date(record.created) && date(record.updated) &&
    statuses.includes(record.status) && ["low", "medium", "high", "critical"].includes(record.priority) &&
    requiredArrays.every((key) => stringArray(record[key])) &&
    record.record_kind === "work_item" && record.work_kind === "implementation" &&
    record.acceptance && Array.isArray(record.acceptance.criteria) && Array.isArray(record.acceptance.validation) &&
    record.sections && typeof record.sections === "object" &&
    Array.isArray(record.slices) && record.slices.length > 0 && record.slices.every((slice) => slice &&
      typeof slice.id === "string" && /^SLICE-\d{3}$/u.test(slice.id) &&
      typeof slice.title === "string" && typeof slice.work_kind === "string" &&
      typeof slice.owner === "string" && slice.owner.length > 0 && ["low", "medium", "high", "critical"].includes(slice.priority) &&
      typeof slice.status === "string" && statuses.includes(slice.status) &&
      ["implementation", "review", "redteam"].includes(slice.work_kind) && Array.isArray(slice.depends_on) &&
      stringArray(slice.read_scope) && stringArray(slice.repo_paths) &&
      stringArray(slice.write_scope) && slice.acceptance &&
      stringArray(slice.acceptance.criteria) && stringArray(slice.acceptance.validation) &&
      (slice.review_purpose === undefined ||
        (slice.review_purpose === "terminal_whole_wk" && slice.work_kind === "review"))) &&
    (!terminalComplete || (record.status === "review" && terminalReviewComplete(record)));
}

function validWorkRecord(record, wk, options = {}, deps = {}) {
  if (typeof deps.validateWorkRecord === "function") {
    try {
      const result = deps.validateWorkRecord(record, { id: wk, ...options });
      return result === true || result?.ok === true;
    } catch {
      return false;
    }
  }
  return deps.allowCompatibilityValidator === true && validateWorkRecordShape(record, wk, options);
}

function terminalReviewMatchesBinding(record, binding) {
  if (binding?.schema_version !== TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) return true;
  const review = Array.isArray(record?.slices)
    ? record.slices.filter((slice) => slice?.review_purpose === "terminal_whole_wk")
    : [];
  if (review.length !== 1 || review[0].status !== "review" || record.status !== "review") return false;
  const contracts = projectSliceReviewReceiptContracts(record, review[0].id);
  if (contracts.slice_review_contract === null) return false;
  const subject = `${record.id}#${review[0].id}`;
  const contractBinding = {
    schema_version: "agent_launch.terminal_review_contract_binding.v1",
    record_id: record.id,
    initiative: record.initiative,
    review_slice_id: review[0].id,
    review_subject: subject,
    review_unit_contract: contracts.slice_review_contract
  };
  const digest = `sha256:${createHash("sha256")
    .update(canonicalizeWorkRecordJson(contractBinding))
    .digest("hex")}`;
  return subject === binding.terminal_review_subject && digest === binding.terminal_review_contract_digest;
}

function localReviewProjectionMatchesCandidate(candidateRecord, localRecord, binding) {
  const candidateReview = candidateRecord.slices.filter((slice) => slice.review_purpose === "terminal_whole_wk");
  const localReview = localRecord.slices.filter((slice) => slice.review_purpose === "terminal_whole_wk");
  if (candidateReview.length > 1 || localReview.length !== 1) return false;
  if (binding?.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) {
    const [subjectWk, subjectSlice] = String(binding.terminal_review_subject ?? "").split("#");
    const digest = localReview[0].review_unit_contract_digest ?? localReview[0].terminal_review_contract_digest;
    return subjectWk === localRecord.id && subjectSlice === localReview[0].id &&
      (digest === undefined || digest === binding.terminal_review_contract_digest) &&
      localRecord.status === "review" && localReview[0].status === "review";
  }
  if (candidateReview.length === 1 && canonical({ ...candidateReview[0], status: "review" }) !== canonical(localReview[0])) return false;
  const strip = (record) => ({ ...record, slices: record.slices.filter((slice) => slice.review_purpose !== "terminal_whole_wk") });
  return canonical(strip(candidateRecord)) === canonical({ ...strip(localRecord), status: candidateRecord.status });
}

function terminalUnitDeclaresSlice(localRecord, sliceId) {
  const terminal = (localRecord?.slices ?? []).filter((item) => item?.review_purpose === "terminal_whole_wk");
  if (terminal.length !== 1) return false;
  return (terminal[0].depends_on ?? [])
    .map((entry) => localSliceId(entry, localRecord?.id))
    .some((entry) => entry !== null && entry === sliceId);
}

function v3UnrelatedContentMatchesCandidate(candidateRecord, localRecord) {
  const GOVERNED = ["id", "schema_version", "repo", "title", "record_kind", "work_kind", "initiative",
    "priority", "owner", "created", "read_scope", "repo_paths", "write_scope", "depends_on",
    "blocks", "related", "children", "acceptance"];
  if (GOVERNED.some((key) => canonical(candidateRecord[key]) !== canonical(localRecord[key]))) return false;

  const sections = (record) => {
    const copy = { ...(record?.sections ?? {}) };
    delete copy.closure;
    return copy;
  };
  if (canonical(candidateRecord?.sections?.closure) !== canonical(localRecord?.sections?.closure)) return false;
  if (canonical(sections(candidateRecord)) !== canonical(sections(localRecord))) return false;

  const ordinary = (record) => (record?.slices ?? []).filter((item) => item?.review_purpose !== "terminal_whole_wk");
  const beforeSlices = ordinary(candidateRecord);
  const afterSlices = ordinary(localRecord);
  if (beforeSlices.length !== afterSlices.length) return false;
  const liveById = new Map(afterSlices.map((item) => [item?.id, item]));
  if (liveById.size !== afterSlices.length) return false;

  const sameSliceExceptCloseout = (before, after) => {
    const left = { ...before, sections: { ...(before?.sections ?? {}) } };
    const right = { ...after, sections: { ...(after?.sections ?? {}) } };
    delete left.status; delete right.status;
    delete left.updated; delete right.updated;
    delete left.sections.closure; delete right.sections.closure;
    return canonical(left) === canonical(right);
  };
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
  const canonicalFirstClosure = (before, after) => {
    if (before?.sections?.closure !== undefined) return false;
    const closure = after?.sections?.closure;
    if (!closure || typeof closure !== "object" || Array.isArray(closure) ||
        Object.keys(closure).sort().join("\0") !== "follow_ups\0summary\0validation") return false;
    return typeof closure.summary === "string" && Array.isArray(closure.validation) &&
      Array.isArray(closure.follow_ups) && closure.validation.every((item) => typeof item === "string") &&
      closure.follow_ups.every((item) => typeof item === "string");
  };
  let closeoutCount = 0;
  let closeoutSliceId = null;
  for (const before of beforeSlices) {
    const after = liveById.get(before?.id);
    if (!after || after.review_purpose === "terminal_whole_wk") return false;
    if (canonical(before) === canonical(after)) continue;
    if (closeoutCount > 0 || before?.status === "done" || after?.status !== "done" ||
        !validDate(before?.updated) || !validDate(after?.updated) || before.updated === after.updated ||
        !canonicalFirstClosure(before, after) || !sameSliceExceptCloseout(before, after)) return false;
    closeoutCount += 1;
    closeoutSliceId = before.id;
  }
  if (closeoutCount === 0) return true;
  return closeoutCount === 1 && terminalUnitDeclaresSlice(localRecord, closeoutSliceId);
}

function soleParent(runGit, repo, child, parent) {
  const fields = run(runGit, repo, ["rev-list", "--parents", "-n", "1", child]).split(/\s+/u);
  return fields.length === 2 && fields[0] === child && fields[1] === parent;
}

function onlyWkDelta(runGit, repo, parent, child, wk) {
  const names = run(runGit, repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", parent, child])
    .split("\n").filter(Boolean);
  return names.length === 1 && names[0] === FILE(wk);
}

function commitOnlyWk({ runGit, repo, parent, recordBytes, wk, message, tempRoot }) {
  const index = path.join(tempRoot, `index-${createHash("sha256").update(message).digest("hex")}`);
  const file = path.join(tempRoot, `record-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  writeFileSync(file, recordBytes, "utf8");
  try {
    const env = { GIT_INDEX_FILE: index };
    run(runGit, repo, ["read-tree", parent], env);
    const blob = run(runGit, repo, ["hash-object", "-w", "--path", FILE(wk), file], env);
    run(runGit, repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${FILE(wk)}`], env);
    const tree = run(runGit, repo, ["write-tree"], env);
    const commit = run(runGit, repo, ["commit-tree", tree, "-p", parent, "-m", message], env);
    if (!OID_RE.test(commit) || !soleParent(runGit, repo, commit, parent) || !onlyWkDelta(runGit, repo, parent, commit, wk)) {
      throw new Error("closeout commit changes more than the WK record");
    }
    return commit;
  } finally {
    try { unlinkSync(file); } catch {   }
    try { unlinkSync(index); } catch {   }
  }
}

function commitChain(runGit, repo, head, wk, { deps = {}, binding = null } = {}) {
  try {
    const parent1 = run(runGit, repo, ["rev-parse", `${head}^`]);
    const parent2 = run(runGit, repo, ["rev-parse", `${parent1}^`]);
    if (!soleParent(runGit, repo, parent1, parent2) || !soleParent(runGit, repo, head, parent1) ||
        !onlyWkDelta(runGit, repo, parent2, parent1, wk) || !onlyWkDelta(runGit, repo, parent1, head, wk)) return null;
    const firstRecord = jsonRecord(run(runGit, repo, ["show", `${parent1}:${FILE(wk)}`]), "review commit record unreadable");
    const doneRecord = jsonRecord(run(runGit, repo, ["show", `${head}:${FILE(wk)}`]), "completion commit record unreadable");
    let candidateRecord = null;
    try {
      candidateRecord = jsonRecord(run(runGit, repo, ["show", `${parent2}:wiki/work-records/${wk}.json`]), "candidate record unreadable");
    } catch {
      if (binding?.schema_version !== TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) return null;
    }
    if ((candidateRecord !== null && !validWorkRecord(candidateRecord, wk, {}, deps)) ||
        !validWorkRecord(firstRecord, wk, { terminalComplete: true }, deps) ||
        !validWorkRecord(doneRecord, wk, {}, deps) || firstRecord.status !== "review" || doneRecord.status !== "done") return null;
    const reviewSlices = firstRecord.slices.filter((slice) => slice.review_purpose === "terminal_whole_wk");
    if (reviewSlices.length !== 1) return null;
    if (!terminalReviewMatchesBinding(firstRecord, binding)) return null;
    const candidateReviewSlices = candidateRecord?.slices.filter((slice) => slice.review_purpose === "terminal_whole_wk") ?? [];
    if (candidateRecord !== null && candidateReviewSlices.length > 1) return null;
    if (candidateRecord !== null && candidateReviewSlices.length === 1) {
      const expectedCandidateSlice = { ...reviewSlices[0], status: candidateReviewSlices[0].status };
      if (canonical(expectedCandidateSlice) !== canonical(candidateReviewSlices[0])) return null;
    }
    if (candidateRecord !== null && binding?.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) {

      if (!v3UnrelatedContentMatchesCandidate(candidateRecord, firstRecord)) return null;
    } else if (candidateRecord !== null) {
      const projection = authenticateTerminalCloseoutProjection({ candidateRecord, liveRecord: firstRecord });
      if (!projection.ok) return null;
    } else if (!terminalReviewMatchesBinding(firstRecord, binding)) return null;
    if (canonical({ ...doneRecord, status: "review" }) !== canonical(firstRecord)) return null;
    return { candidate: parent2, review: parent1, completion: head, reviewRecord: firstRecord, doneRecord };
  } catch { return null; }
}

function normalizePullRequest(pr, repository) {
  if (!pr || typeof pr !== "object") return null;
  const fullName = pr.repository?.full_name ?? pr.base?.repo?.full_name;
  const [owner, name] = typeof fullName === "string" ? fullName.split("/") : [pr.repository?.owner, pr.repository?.name];

  return { number: pr.number, state: pr.state,
    merged: pr.merged === true || typeof pr.merged_at === "string",
    base_ref: pr.base_ref ?? pr.base?.ref, head_ref: pr.head_ref ?? pr.head?.ref,
    head_sha: pr.head_sha ?? pr.head?.sha,
    repository: { host: pr.repository?.host ?? repository.host, owner, name } };
}

function exactPullRequest(pr, { repository, base, branch, head, openOnly = false }) {
  const normalized = normalizePullRequest(pr, repository);
  const stateKnown = normalized?.state === "open" || normalized?.state === "closed";
  const lifecycleValid = normalized?.state === "open" ? normalized.merged !== true :
    normalized?.state === "closed" && normalized.merged === true;
  return normalized && stateKnown && lifecycleValid && normalized.repository && normalized.repository.host === repository.host &&
    normalized.repository.owner === repository.owner && normalized.repository.name === repository.name &&
    normalized.base_ref === base && normalized.head_ref === branch && normalized.head_sha === head &&
    Number.isSafeInteger(normalized.number) && normalized.number > 0 &&
    (!openOnly || normalized.state === "open")
    ? normalized : null;
}

function safeLocalWkPath(mainRepo, localPath) {
  let current = mainRepo;
  const relative = path.relative(mainRepo, localPath).split(path.sep).filter(Boolean);
  for (const part of relative) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("unsafe local WK path");
  }
  const stat = lstatSync(localPath);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error("unsafe local WK path");
}

function readLocalWkAtomically(localPath) {
  const fd = openSync(localPath, "r");
  try {
    const before = statSync(localPath);
    const bytes = readFileSync(fd, "utf8");
    const after = statSync(localPath);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs) throw new Error("local WK changed while reading");
    return bytes;
  } finally { closeSync(fd); }
}

function reconcileLocalWk(mainRepo, localPath, expectedDigest, mergedBytes) {
  safeLocalWkPath(mainRepo, localPath);
  const currentBytes = readLocalWkAtomically(localPath);
  if (computeWorkRecordSourceDigest(jsonRecord(currentBytes, "local WK record unreadable")) !== expectedDigest) {
    throw new Error("local WK changed after operation");
  }
  const fd = openSync(localPath, "r");
  let replacement = null;
  try {
    const pathStat = statSync(localPath);
    const fdStat = fstatSync(fd);
    const current = readFileSync(fd, "utf8");
    if (pathStat.dev !== fdStat.dev || pathStat.ino !== fdStat.ino ||
        computeWorkRecordSourceDigest(jsonRecord(current, "local WK record unreadable")) !== expectedDigest) {
      throw new Error("local WK changed before reconciliation");
    }
    replacement = `${localPath}.codex-reconcile-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeFileSync(replacement, mergedBytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(replacement, localPath);
    replacement = null;
  } finally {
    closeSync(fd);
    if (replacement !== null) {
      try { unlinkSync(replacement); } catch {   }
    }
  }
}

async function observePr(forge, args) {
  if (typeof forge.observePullRequest === "function") return normalizePullRequest(await forge.observePullRequest(args), args.repository);
  if (typeof forge.listPullRequestPage !== "function") return null;

  const response = await forge.listPullRequestPage({ ...args, page: 1, per_page: 100 });
  const items = response?.items;
  return Array.isArray(items) && items.length === 1 ? normalizePullRequest(items[0], args.repository) : null;
}

function makeForge({ repository, mainRepo, deps, runGit }) {
  if (deps.forge) return deps.forge;
  const host = repository.host;
  const runGh = deps.runGh ?? defaultRunGh;
  const { owner, name } = repository;
  const api = (args) => runGh({ args: ["api", "--hostname", host, ...args] });
  return {
    repository,
    probe() {
      const auth = runGh({ args: ["auth", "status", "--hostname", host] });
      if (!auth?.ok) return { state: "unauthenticated" };
    const result = api([`repos/${owner}/${name}`]);
      try {
        const body = JSON.parse(result.stdout);
        return result.ok && body.full_name === `${owner}/${name}` && typeof body.default_branch === "string"
          ? { state: "authenticated", default_branch: body.default_branch } : { state: "error" };
      } catch { return { state: "error" }; }
    },
    observeRemoteBranch({ branch }) {
      const result = api([`repos/${owner}/${name}/git/ref/heads/${branch}`]);
      if (!result?.ok) return { kind: "unprovable" };
      try {
        const sha = JSON.parse(result.stdout)?.object?.sha;
        return OID_RE.test(sha) ? { kind: "present", sha } : { kind: "unprovable" };
      } catch { return { kind: "unprovable" }; }
    },
    publishAndCompareAndSwapBranch({ branch, expected, next }) {

      const url = repository.https_url;
      if (typeof url !== "string" || !url) return { ok: false };
      const ref = `refs/heads/${branch}`;
      const result = runGit({ repo: mainRepo, args: [
        "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=",
        `-c`, `credential.https://${host}.helper=!gh auth git-credential`,
        "push", "--no-verify",

        `--force-with-lease=${ref}:${expected}`,
        url, `${next}:${ref}`
      ], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      return result?.ok === true ? { ok: true } : { ok: false };
    },
    async listPullRequestPage({ base, branch, page, per_page }) {
      if (typeof branch !== "string" || branch.length === 0) throw new Error("pull request branch selector unavailable");
      const result = api([`repos/${owner}/${name}/pulls?state=all&base=${base}&head=${owner}:${branch}&page=${page}&per_page=${per_page}`]);
      if (!result?.ok) throw new Error("pull request observation failed");
      const items = JSON.parse(result.stdout);
      return { items, has_next: Array.isArray(items) && items.length >= per_page };
    },
    compareAndSwapBranch({ branch, expected, next }) {

      const result = runGh({ args: ["api", "--hostname", host, "--method", "PATCH",
        `repos/${owner}/${name}/git/refs/heads/${branch}`, "--header", `If-Match: ${expected}`,
        "-f", `sha=${next}`, "-F", "force=false"] });
      return result?.ok === true ? { ok: true } : { ok: false };
    },
    mergePullRequest({ number, expectedHead }) {
      const result = runGh({ args: ["api", "--hostname", host, "--method", "PUT",
        `repos/${owner}/${name}/pulls/${number}/merge`, "-f", "merge_method=merge",
        "-f", `sha=${expectedHead}`] });
      if (!result || result.ok !== true) return { ok: false };
      try { return { ok: true, merged: JSON.parse(result.stdout).merged === true }; } catch { return { ok: false }; }
    },
    async readMergedWk({ branch, wk }) {
      const result = api([`repos/${owner}/${name}/contents/${FILE(wk)}?ref=${branch}`]);
      if (!result?.ok) throw new Error("merged record unavailable");
      const body = JSON.parse(result.stdout);
      if (typeof body.content !== "string") throw new Error("merged record content unavailable");
      return Buffer.from(body.content.replace(/\s+/gu, ""), "base64").toString("utf8");
    }
  };
}

export async function defaultWkForgeMerge({ mainRepo, assignedUnit, deps = {} } = {}) {
  if (typeof mainRepo !== "string" || !WK_RE.test(assignedUnit ?? "")) {
    return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.REQUEST_INVALID, "invalid_request");
  }
  const wk = assignedUnit;
  const runGit = deps.runGit ?? defaultRunGit;
  let candidateState;
  try {
    if (typeof deps.resolveTerminalCandidatePublicationState !== "function") {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "candidate_resolver_unavailable");
    }
    candidateState = await deps.resolveTerminalCandidatePublicationState(wk);
    const binding = candidateState?.binding;
    if (!binding || binding.canonical_wk_id !== wk || !OID_RE.test(binding.candidate)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "exact_terminal_candidate_unavailable");
    }
    if (binding.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3) {
      const subject = candidateState.terminal_review_subject ?? candidateState.review_subject ?? null;
      const contract = candidateState.terminal_review_contract_digest ?? candidateState.review_contract_digest ?? null;
      if ((subject !== null && subject !== binding.terminal_review_subject) ||
          (contract !== null && contract !== binding.terminal_review_contract_digest)) {
        return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "terminal_review_target_binding_disagrees");
      }
    }
    if (binding.main_repo !== undefined && binding.main_repo !== mainRepo) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "terminal_candidate_repository_disagrees");
    }
    try {
      const verify = deps.verifyTerminalCandidateBinding ?? verifyTerminalWkCandidateObjectBinding;
      verify({ binding, runGit });
    } catch {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "terminal_candidate_binding_unverified");
    }
    const candidate = binding.candidate;
    const candidateRecord = readCandidateBoundRecord({ mainRepo, wk, binding, deps });
    if (!candidateRecord.ok) return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, candidateRecord.reason);
    const localPath = path.join(mainRepo, FILE(wk));
    try { safeLocalWkPath(mainRepo, localPath); } catch {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "unsafe_local_WK_path");
    }
    const localBytes = readLocalWkAtomically(localPath);
    const localDigest = computeWorkRecordSourceDigest(jsonRecord(localBytes, "local WK record unreadable"));
    const localRecord = jsonRecord(localBytes, "local WK record unreadable");
    const localAlreadyDone = localRecord.status === "done";
    if (!localAlreadyDone && !validWorkRecord(localRecord, wk, { terminalComplete: true }, deps)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_review_complete");
    }
    const v3Binding = binding.schema_version === TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3;
    const remote = resolveCanonicalForgeRepository({ repo: mainRepo, deps });
    if (!remote.ok) return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, remote.reason);
    const forge = makeForge({ repository: remote.repository, mainRepo, deps, runGit });
    if (!sameForgeRepository(forge.repository, remote.repository)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "forge_repository_identity_disagrees");
    }
    const probe = typeof forge.probe === "function" ? forge.probe() : { state: "authenticated", default_branch: deps.baseBranch };
    if (probe?.state !== "authenticated" || typeof probe.default_branch !== "string") {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "forge_unauthenticated_or_base_unknown");
    }

    const configuredBase = candidateState.base_branch ?? candidateState.baseBranch;
    const base = typeof configuredBase === "string" && configuredBase.length > 0 ? configuredBase : probe.default_branch;
    if (base !== probe.default_branch && typeof configuredBase !== "string") {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "configured_base_branch_untrusted");
    }
    const initiative = candidateRecord.record?.initiative ?? candidateState.initiative ??
      binding.initiative ?? String(binding.wk_ref ?? "").split("/")[3];
    if (typeof initiative !== "string" || !/^IN-\d{4}$/u.test(initiative)) {
      return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "terminal_candidate_initiative_unavailable");
    }
    const branch = candidateState.branch ?? `handoff/wk/${initiative}/${wk}/${candidate}`;
    const observation = typeof forge.observeRemoteBranch === "function"
      ? forge.observeRemoteBranch({ branch }) : null;
    let completion = observation?.kind === "present" && OID_RE.test(observation.sha) ? observation.sha : null;
    let chain = completion && completion !== candidate ? commitChain(runGit, mainRepo, completion, wk, { deps, binding }) : null;
    let pr = await observePr(forge, { repository: remote.repository, base, branch });
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "wk-forge-merge-"));
    try {
      if (completion === null) {
        if (pr?.merged === true && OID_RE.test(pr.head_sha)) completion = pr.head_sha;
        else if (exactPullRequest(pr, { repository: remote.repository, base, branch, head: candidate, openOnly: true })) completion = candidate;
        else return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "handoff_branch_unobservable");
        chain = completion === candidate ? null : commitChain(runGit, mainRepo, completion, wk, { deps, binding });
      }
      if (completion === candidate) {

        if (!localAlreadyDone && !v3Binding && candidateRecord.record !== null) {
          const projection = authenticateTerminalCloseoutProjection({ candidateRecord: candidateRecord.record, liveRecord: localRecord });
          if (!projection.ok) return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_authenticated_against_candidate", { projection: projection.reason });
        }
        if (!localAlreadyDone && v3Binding) {
          if (candidateRecord.record !== null && !v3UnrelatedContentMatchesCandidate(candidateRecord.record, localRecord)) {
            return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_authenticated_against_candidate",
              { projection: "unrelated_candidate_content_drift" });
          }
          if (!localReviewProjectionMatchesCandidate(candidateRecord.record ?? localRecord, localRecord, binding) ||
              !terminalReviewMatchesBinding(localRecord, binding)) {
            return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_authenticated_against_terminal_review_target");
          }
        }
        if (localAlreadyDone) {
          return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_review_complete");
        }
        if (!exactPullRequest(pr, { repository: remote.repository, base, branch, head: candidate, openOnly: true })) {
          return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "exact_open_pull_request_unavailable");
        }

        const projection = (v3Binding || candidateRecord.record === null) ? { ok: true, reviewRecord: localRecord } :
          authenticateTerminalCloseoutProjection({ candidateRecord: candidateRecord.record, liveRecord: localRecord });
        if (!projection.ok) return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_authenticated_against_candidate");
        const reviewRecordObject = projection.reviewRecord;
        const reviewRecord = JSON.stringify(reviewRecordObject, null, 2) + "\n";
        const review = commitOnlyWk({ runGit, repo: mainRepo, parent: candidate, recordBytes: reviewRecord, wk,
          message: `${wk}: record terminal review`, tempRoot });
        const done = { ...localRecord, status: "done" };
        const finish = commitOnlyWk({ runGit, repo: mainRepo, parent: review, recordBytes: JSON.stringify(done, null, 2) + "\n", wk,
          message: `${wk}: complete`, tempRoot });
        chain = { candidate, review, completion: finish, reviewRecord: reviewRecordObject, doneRecord: done };
        const cas = typeof forge.publishAndCompareAndSwapBranch === "function"
          ? await forge.publishAndCompareAndSwapBranch({ branch, expected: candidate, next: finish })
          : await forge.compareAndSwapBranch({ branch, expected: candidate, next: finish });
        if (!cas || cas.ok !== true) return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.CAS, "handoff_branch_compare_and_swap_failed");
        completion = finish;
      } else if (!chain || chain.candidate !== candidate) {

        const mergedPr = await observePr(forge, { repository: remote.repository, base, branch });
        if (mergedPr?.merged === true && OID_RE.test(mergedPr.head_sha)) {
          completion = mergedPr.head_sha;
          chain = commitChain(runGit, mainRepo, completion, wk, { deps, binding });
        }
      }
      if (!chain || chain.candidate !== candidate) {
        return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "handoff_head_is_not_authenticated_closeout_chain");
      }
      pr = await observePr(forge, { repository: remote.repository, base, branch });
      const exact = exactPullRequest(pr, { repository: remote.repository, base, branch, head: completion, openOnly: pr?.merged !== true });
      if (!exact) {
        return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.IDENTITY, "pull_request_head_or_state_disagrees");
      }
      if (localAlreadyDone && exact.merged !== true) {
        return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.ELIGIBILITY, "local_WK_not_review_complete");
      }

      if (!localAlreadyDone && (!chain.reviewRecord || computeWorkRecordSourceDigest(chain.reviewRecord) !== localDigest)) {
        return { ok: false, category: WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION,
          partial: true, detail: { reason: "local_reconciliation_failed", completion } };
      }
      if (exact.merged !== true) {
        const merged = await forge.mergePullRequest({ number: exact.number, expectedHead: completion });
        if (!merged || merged.ok !== true || merged.merged !== true) {
          return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.FORGE, "exact_head_merge_refused", { completion });
        }
      }
      if (localAlreadyDone) {
        if (!chain.doneRecord || computeWorkRecordSourceDigest(chain.doneRecord) !== localDigest) {
          return { ok: false, category: WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION,
            partial: true, detail: { reason: "local_reconciliation_failed", completion } };
        }
        return { ok: true, result: { schema_version: WK_FORGE_MERGE_RESULT_SCHEMA_VERSION, wk, candidate,
          review: chain.review, completion, base_branch: base, pull_request: exact, already_reconciled: true } };
      }
      let currentLocalDigest;
      try {
        safeLocalWkPath(mainRepo, localPath);
        currentLocalDigest = computeWorkRecordSourceDigest(jsonRecord(readFileSync(localPath, "utf8"), "local WK record unreadable"));
      } catch {
        return { ok: false, category: WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION,
          partial: true, detail: { reason: "local_reconciliation_unsafe_or_unreadable", completion } };
      }
      if (currentLocalDigest !== localDigest) {
        return { ok: false, category: WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION,
          partial: true, detail: { reason: "local_WK_changed_after_operation", completion } };
      }
      let mergedBytes;
      try {
        if (typeof forge.readMergedWk !== "function") throw new Error("merged WK reader unavailable");
        mergedBytes = await forge.readMergedWk({ branch: base, wk });
        const mergedRecord = jsonRecord(mergedBytes, "merged WK record unreadable");
        if (!validWorkRecord(mergedRecord, wk, {}, deps) || mergedRecord.status !== "done") throw new Error("merged WK record is not done");
        reconcileLocalWk(mainRepo, localPath, localDigest, mergedBytes);
      } catch {
        return { ok: false, category: WK_FORGE_MERGE_FAILURE_CATEGORIES.RECONCILIATION,
          partial: true, detail: { reason: "local_reconciliation_failed", completion } };
      }
      return { ok: true, result: { schema_version: WK_FORGE_MERGE_RESULT_SCHEMA_VERSION, wk, candidate, review: chain.review, completion, base_branch: base, pull_request: exact } };
    } finally {
      try { rmSync(tempRoot, { recursive: true, force: true }); } catch {   }
    }
  } catch {
    return refuse(WK_FORGE_MERGE_FAILURE_CATEGORIES.INDETERMINATE, "forge_merge_operation_failed");
  }
}

export const trustedWkForgeMerge = defaultWkForgeMerge;
