

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_RESULT_KINDS,
  WK_FORGE_HANDOFF_BROKER_CATEGORIES
} from "./request-envelopes-wk-forge-handoff.mjs";

export { WK_FORGE_HANDOFF_BROKER_CATEGORIES };

export const WK_FORGE_HANDOFF_IDENTITY = Object.freeze({
  name: "agent-launch forge handoff",
  email: "forge-handoff@agent-launch.local"
});

export const FORGE_LANDING_BRANCH_ENV_VAR = "AGENT_LAUNCH_FORGE_LANDING_BRANCH";

export const PULL_REQUEST_PAGE_LIMIT = 20;
export const PULL_REQUEST_PAGE_SIZE = 100;

const WK_RECORD_RE = /^WK-\d{4}$/u;
const INITIATIVE_RE = /^IN-\d{4}$/u;
const OBJECT_ID_RE = /^[0-9a-f]{40}$/u;
const FORGE_HOST_RE = /^[a-z0-9.-]+$/u;
const FORGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;

const NON_ADVANCING_IMPLEMENTATION_STATUSES = new Set(["review", "done", "cancelled"]);

const INTEGRATED_IMPLEMENTATION_STATUSES = new Set(["review", "done"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuse(category, detail) {
  return { ok: false, category, detail: detail ?? null };
}

export function defaultRunGit({ repo, args, env = null }) {
  let res;
  try {
    res = spawnSync("git", ["-C", repo, "-c", "core.quotePath=false", ...args], {
      encoding: "utf8",
      env: env === null ? process.env : env,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (res.error) return { ok: false, error: res.error.message ?? String(res.error) };
  if (res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",

      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

export function defaultRunGh({ args, cwd = null }) {
  let res;
  try {
    res = spawnSync("gh", [...args], {
      encoding: "utf8",
      cwd: cwd ?? undefined,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, spawn_error: err?.message ?? String(err) };
  }
  if (res.error) return { ok: false, spawn_error: res.error.message ?? String(res.error) };
  return {
    ok: res.status === 0,
    status: res.status ?? null,
    stdout: typeof res.stdout === "string" ? res.stdout : "",
    stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : ""
  };
}

function git(runGit, repo, args, env = null) {
  const res = runGit({ repo, args, env });
  if (!res || res.ok !== true) {
    const err = new Error(`git ${args[0]} failed`);
    err.git = { args: args.slice(0, 2), status: res?.status ?? null, stderr: res?.stderr ?? null };
    throw err;
  }
  return res.stdout.trim();
}

function gitSucceeds(runGit, repo, args) {
  const res = runGit({ repo, args, env: null });
  return Boolean(res && res.ok === true);
}

export function parseHttpsForgeRepositoryUrl(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  const host = parsed.hostname.toLowerCase();
  if (!FORGE_HOST_RE.test(host)) return null;
  const segments = parsed.pathname.replace(/^\/+/u, "").split("/");
  if (segments.length !== 2) return null;
  const owner = segments[0];
  const name = segments[1].replace(/\.git$/u, "");
  if (!FORGE_SEGMENT_RE.test(owner) || !FORGE_SEGMENT_RE.test(name)) return null;
  return Object.freeze({ host, owner, name, https_url: `https://${host}/${owner}/${name}.git` });
}

export function resolveCanonicalForgeRepository({ repo, remoteName = "origin", deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  if (typeof repo !== "string" || repo.length === 0) {
    return { ok: false, reason: "repo_missing" };
  }
  let fetchUrls;
  let pushUrls;
  let rewrites;
  try {
    fetchUrls = git(runGit, repo, ["remote", "get-url", "--all", remoteName])
      .split("\n").map((line) => line.trim()).filter(Boolean);
    pushUrls = git(runGit, repo, ["remote", "get-url", "--push", "--all", remoteName])
      .split("\n").map((line) => line.trim()).filter(Boolean);

    const res = runGit({ repo, args: ["config", "--get-regexp", "^url\\."], env: null });
    rewrites = res?.ok === true
      ? res.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
  } catch {
    return { ok: false, reason: "remote_unreadable" };
  }
  if (rewrites.length > 0) return { ok: false, reason: "url_rewrite_configured" };
  if (fetchUrls.length !== 1) return { ok: false, reason: "remote_fetch_url_not_unique" };
  if (pushUrls.length !== 1) return { ok: false, reason: "remote_push_url_not_unique" };
  if (fetchUrls[0] !== pushUrls[0]) return { ok: false, reason: "remote_push_url_diverges" };
  const identity = parseHttpsForgeRepositoryUrl(fetchUrls[0]);
  if (identity === null) return { ok: false, reason: "remote_url_not_canonical_https" };
  return { ok: true, repository: identity };
}

export function sameForgeRepository(a, b) {
  return Boolean(a && b && a.host === b.host && a.owner === b.owner && a.name === b.name);
}

export function readCanonicalRecord({ mainRepo, wk, deps = {} }) {
  const read = deps.readRecord ?? ((repo, id) => {
    const file = path.join(repo, "wiki", "work-records", `${id}.json`);
    return readFileSync(file, "utf8");
  });
  let raw;
  try {
    raw = read(mainRepo, wk);
  } catch (err) {
    return { ok: false, reason: "canonical_record_unreadable", message: err?.message ?? String(err) };
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "canonical_record_unparseable" };
  }
  if (!isPlainObject(record) || record.id !== wk) {
    return { ok: false, reason: "canonical_record_identity_mismatch" };
  }
  return { ok: true, record };
}

export function assertTerminalQuiescentWk({ record, wk, wkTip, deps = {}, repo }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const initiativeRaw = typeof record.initiative === "string" ? record.initiative.trim() : "";
  if (!INITIATIVE_RE.test(initiativeRaw)) {
    return { reason: "initiative_unassigned" };
  }
  const slices = Array.isArray(record.slices) ? record.slices : [];
  for (const slice of slices) {
    if (!isPlainObject(slice) || slice.work_kind !== "implementation") continue;
    if (!NON_ADVANCING_IMPLEMENTATION_STATUSES.has(slice.status)) {
      return { reason: "implementation_slice_can_still_advance", slice_id: slice.id ?? null };
    }
    if (INTEGRATED_IMPLEMENTATION_STATUSES.has(slice.status) &&
        typeof slice.id === "string" && /^SLICE-\d{3}$/u.test(slice.id)) {
      const sliceRef = `refs/heads/slice/${initiativeRaw}/${wk}/${slice.id}`;

      if (gitSucceeds(runGit, repo, ["rev-parse", "--verify", "--quiet", sliceRef])) {
        if (!gitSucceeds(runGit, repo, ["merge-base", "--is-ancestor", sliceRef, wkTip])) {
          return { reason: "integrated_contribution_not_represented", slice_id: slice.id };
        }
      }
    }
  }
  return { ok: true, initiative: initiativeRaw };
}

export function deriveForgeBranchName({ initiative, wk }) {
  return `handoff/wk/${initiative}/${wk}`;
}

export function deriveSquashCommitMessage({ initiative, wk, title }) {
  const subject = typeof title === "string" && title.trim().length > 0
    ? `${wk}: ${title.trim()}`
    : `${wk}: accumulated work-record change`;
  return `${subject}\n\nInitiative: ${initiative}\nWork-record: ${wk}\n`;
}

function resolveUniqueMergeBase(runGit, repo, landingRef, wkTip) {
  const res = runGit({ repo, args: ["merge-base", "--all", landingRef, wkTip], env: null });
  if (!res || res.ok !== true) return { ok: false, reason: "merge_base_unresolvable" };
  const bases = res.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (bases.length === 0) return { ok: false, reason: "no_merge_base" };
  if (bases.length > 1) return { ok: false, reason: "multiple_merge_bases", count: bases.length };
  if (!OBJECT_ID_RE.test(bases[0])) return { ok: false, reason: "merge_base_non_canonical" };
  return { ok: true, base: bases[0] };
}

export function buildSquashCommit({ repo, base, wkTip, message, deps = {} }) {
  const runGit = deps.runGit ?? defaultRunGit;
  try {
    if (!gitSucceeds(runGit, repo, ["merge-base", "--is-ancestor", base, wkTip])) {
      return { error: { reason: "base_not_ancestor_of_tip" } };
    }
    const baseTree = git(runGit, repo, ["rev-parse", `${base}^{tree}`]);
    const tipTree = git(runGit, repo, ["rev-parse", `${wkTip}^{tree}`]);
    if (baseTree === tipTree) {
      return { kind: WK_FORGE_HANDOFF_RESULT_KINDS.NO_CHANGES, tree: tipTree };
    }

    const tipDate = git(runGit, repo, ["show", "-s", "--format=%cI", wkTip]);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: WK_FORGE_HANDOFF_IDENTITY.name,
      GIT_AUTHOR_EMAIL: WK_FORGE_HANDOFF_IDENTITY.email,
      GIT_AUTHOR_DATE: tipDate,
      GIT_COMMITTER_NAME: WK_FORGE_HANDOFF_IDENTITY.name,
      GIT_COMMITTER_EMAIL: WK_FORGE_HANDOFF_IDENTITY.email,
      GIT_COMMITTER_DATE: tipDate
    };

    const commit = git(runGit, repo, ["commit-tree", tipTree, "-p", base, "-m", message], env);
    if (!OBJECT_ID_RE.test(commit)) {
      return { error: { reason: "commit_object_id_invalid" } };
    }
    return { kind: WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF, commit, tree: tipTree, parent: base };
  } catch (err) {
    return { error: { reason: "git_failed", git: err?.git ?? { message: err?.message ?? String(err) } } };
  }
}

export function buildGhForge({ repository, mainRepo, deps = {} }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const runGh = deps.runGh ?? defaultRunGh;
  const { host, owner, name, https_url: httpsUrl } = repository;
  const hostArgs = ["--hostname", host];

  return {
    repository,

    probe() {
      const auth = runGh({ args: ["auth", "status", ...hostArgs] });
      if (auth.spawn_error) return { state: "unauthenticated", reason: "gh_absent" };
      if (auth.ok !== true) return { state: "unauthenticated", reason: "gh_not_authenticated_for_host" };
      const repoRes = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}`] });
      if (repoRes.spawn_error || repoRes.ok !== true) {
        return { state: "error", reason: "exact_repository_access_unproven" };
      }
      let body;
      try {
        body = JSON.parse(repoRes.stdout);
      } catch {
        return { state: "error", reason: "repository_api_response_unparseable" };
      }
      const defaultBranch = body?.default_branch;
      if (typeof defaultBranch !== "string" || !BRANCH_RE.test(defaultBranch)) {
        return { state: "error", reason: "default_branch_unobservable" };
      }

      if (typeof body.full_name === "string" && body.full_name !== `${owner}/${name}`) {
        return { state: "error", reason: "repository_identity_mismatch" };
      }
      return { state: "authenticated", default_branch: defaultBranch };
    },
    observeRemoteBranch({ branch }) {
      const res = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}/git/ref/heads/${branch}`] });
      if (res.spawn_error) return { kind: "unprovable" };
      if (res.ok !== true) {

        if (/HTTP 404|Not Found/u.test(res.stderr ?? "")) return { kind: "absent" };
        return { kind: "unprovable" };
      }
      let body;
      try {
        body = JSON.parse(res.stdout);
      } catch {
        return { kind: "unprovable" };
      }
      const sha = body?.object?.sha;
      if (typeof sha !== "string" || !OBJECT_ID_RE.test(sha)) return { kind: "unprovable" };
      return { kind: "present", sha };
    },
    publishBranchIfAbsent({ branch, commit }) {
      const ref = `refs/heads/${branch}`;

      const res = runGit({
        repo: mainRepo,
        args: [
          "-c", "core.hooksPath=/dev/null",
          "-c", "credential.helper=",
          "-c", `credential.https://${host}.helper=!gh auth git-credential`,
          "push", "--no-verify",
          `--force-with-lease=${ref}:`,
          httpsUrl,
          `${commit}:${ref}`
        ],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      if (res && res.ok === true) return { kind: "published" };
      const stderr = typeof res?.stderr === "string" ? res.stderr : "";
      if (/stale info|fetch first|rejected/iu.test(stderr)) return { kind: "lease_failed" };
      return { kind: "uncertain" };
    },
    listPullRequestPage({ base, head, page, per_page: perPage }) {
      const headSelector = `${owner}:${head}`;
      const res = runGh({
        args: [
          "api", ...hostArgs,
          `repos/${owner}/${name}/pulls?state=all&base=${base}&head=${headSelector}&per_page=${perPage}&page=${page}`
        ]
      });
      if (res.spawn_error || res.ok !== true) throw new Error("pull_request_list_transport_failed");
      let items;
      try {
        items = JSON.parse(res.stdout);
      } catch {
        return { kind: "unusable" };
      }
      if (!Array.isArray(items)) return { kind: "unusable" };
      const mapped = items.map((item) => ({
        number: item?.number,
        state: typeof item?.state === "string" ? item.state : null,
        merged: item?.merged === true || typeof item?.merged_at === "string",
        url: typeof item?.html_url === "string" ? item.html_url : null,
        mergeable_state: typeof item?.mergeable_state === "string" ? item.mergeable_state : null,
        base_ref: item?.base?.ref ?? null,
        head_ref: item?.head?.ref ?? null,
        repository: { host, owner, name }
      }));

      return { kind: "ok", items: mapped, has_next: mapped.length >= perPage };
    },
    createPullRequest({ base, head, title, body }) {
      const res = runGh({
        args: [
          "api", ...hostArgs, "--method", "POST", `repos/${owner}/${name}/pulls`,
          "-f", `title=${title}`, "-f", `head=${head}`, "-f", `base=${base}`, "-f", `body=${body}`
        ]
      });
      if (res.spawn_error || res.ok !== true) return { kind: "uncertain" };
      let item;
      try {
        item = JSON.parse(res.stdout);
      } catch {
        return { kind: "uncertain" };
      }
      return {
        kind: "created",
        pull_request: {
          number: item?.number,
          state: typeof item?.state === "string" ? item.state : null,
          merged: item?.merged === true,
          url: typeof item?.html_url === "string" ? item.html_url : null,
          mergeable_state: typeof item?.mergeable_state === "string" ? item.mergeable_state : null,
          base_ref: item?.base?.ref ?? null,
          head_ref: item?.head?.ref ?? null,
          repository: { host, owner, name }
        }
      };
    }
  };
}

function validateObservedPullRequest({ item, repository, base, head }) {
  if (!isPlainObject(item)) return null;
  if (typeof item.number !== "number" || !Number.isInteger(item.number) || item.number <= 0) return null;
  if (!sameForgeRepository(item.repository, repository)) return null;
  if (item.base_ref !== base || item.head_ref !== head) return null;
  return Object.freeze({
    number: item.number,
    state: typeof item.state === "string" ? item.state : null,
    merged: item.merged === true,
    url: typeof item.url === "string" ? item.url : null,
    mergeable_state: typeof item.mergeable_state === "string" ? item.mergeable_state : null
  });
}

async function observeExactPullRequests({ forge, repository, base, head }) {
  const matches = [];
  for (let page = 1; page <= PULL_REQUEST_PAGE_LIMIT; page += 1) {
    let response;
    try {
      response = await forge.listPullRequestPage({ base, head, page, per_page: PULL_REQUEST_PAGE_SIZE });
    } catch {
      return { ok: false, reason: "pull_request_transport_failed" };
    }
    if (!isPlainObject(response) || response.kind !== "ok" || !Array.isArray(response.items)) {
      return { ok: false, reason: "pull_request_observation_unusable" };
    }
    for (const item of response.items) {
      const validated = validateObservedPullRequest({ item, repository, base, head });
      if (validated === null) {
        return { ok: false, reason: "observed_pull_request_identity_mismatch" };
      }
      matches.push(validated);
    }
    if (response.has_next !== true) return { ok: true, matches };
  }
  return { ok: false, reason: "pull_request_page_limit_exceeded" };
}

async function publishBranchObserveFirst({ forge, branch, commit, guard }) {
  const observed = await forge.observeRemoteBranch({ branch });
  if (observed.kind === "present") {
    if (observed.sha === commit) {
      const moved = await guard();
      if (moved !== null) return moved;
      return { state: "recovered" };
    }
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "branch", branch, expected: commit, observed: observed.sha
    });
  }
  if (observed.kind !== "absent") {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.INDETERMINATE, {
      stage: "branch", branch, reason: "remote_branch_state_unprovable"
    });
  }
  const movedBeforePublish = await guard();
  if (movedBeforePublish !== null) return movedBeforePublish;
  const published = await forge.publishBranchIfAbsent({ branch, commit });
  if (published.kind === "published") return { state: "published" };

  const reobserved = await forge.observeRemoteBranch({ branch });
  if (reobserved.kind === "present" && reobserved.sha === commit) {
    const moved = await guard();
    if (moved !== null) return moved;
    return { state: "recovered" };
  }
  if (reobserved.kind === "present") {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "branch", branch, expected: commit, observed: reobserved.sha
    });
  }
  return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.INDETERMINATE, {
    stage: "branch", branch,
    reason: published.kind === "lease_failed"
      ? "publication_lease_lost_and_branch_absent"
      : "publication_not_observable_after_uncertain_push"
  });
}

async function createOrObservePullRequest({ forge, repository, base, head, title, body, guard }) {
  const existing = await observeExactPullRequests({ forge, repository, base, head });
  if (existing.ok !== true) {
    const category = existing.reason === "observed_pull_request_identity_mismatch"
      ? WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT
      : WK_FORGE_HANDOFF_BROKER_CATEGORIES.INDETERMINATE;
    return refuse(category, { stage: "pull_request", base, head, reason: existing.reason });
  }
  if (existing.matches.length > 1) {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request", base, head, matched: existing.matches.length
    });
  }
  if (existing.matches.length === 1) {
    const moved = await guard();
    if (moved !== null) return moved;
    return { state: "recovered", pull_request: existing.matches[0] };
  }
  const movedBeforeCreate = await guard();
  if (movedBeforeCreate !== null) return movedBeforeCreate;
  const created = await forge.createPullRequest({ base, head, title, body });
  if (created.kind === "created") {
    const validated = validateObservedPullRequest({ item: created.pull_request, repository, base, head });
    if (validated === null) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT, {
        stage: "pull_request", base, head, reason: "created_pull_request_identity_mismatch"
      });
    }
    const moved = await guard();
    if (moved !== null) return moved;
    return { state: "created", pull_request: validated };
  }

  const after = await observeExactPullRequests({ forge, repository, base, head });
  if (after.ok !== true) {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.INDETERMINATE, {
      stage: "pull_request", base, head, reason: after.reason
    });
  }
  if (after.matches.length === 1) {
    const moved = await guard();
    if (moved !== null) return moved;
    return { state: "recovered", pull_request: after.matches[0] };
  }
  if (after.matches.length > 1) {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request", base, head, matched: after.matches.length
    });
  }
  return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.INDETERMINATE, {
    stage: "pull_request", base, head, reason: "pull_request_not_observable_after_uncertain_create"
  });
}

function resolveManualLandingBranch({ runGit, repo, wkTip, envConstraint }) {
  if (typeof envConstraint === "string" && envConstraint.length > 0) {
    if (!BRANCH_RE.test(envConstraint)) return { ok: false, reason: "landing_branch_constraint_invalid" };
    if (!gitSucceeds(runGit, repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${envConstraint}`])) {
      return { ok: false, reason: "configured_landing_branch_absent" };
    }
    return { ok: true, landing: envConstraint };
  }

  const headRes = runGit({ repo, args: ["symbolic-ref", "--quiet", "HEAD"], env: null });
  if (!headRes || headRes.ok !== true) return { ok: false, reason: "head_detached_or_ambiguous" };
  const ref = headRes.stdout.trim();
  const m = /^refs\/heads\/(.+)$/u.exec(ref);
  if (m === null) return { ok: false, reason: "head_not_a_branch" };
  const branch = m[1];
  if (!BRANCH_RE.test(branch)) return { ok: false, reason: "head_branch_non_canonical" };
  if (/^(?:wk|slice|handoff)\//u.test(branch)) return { ok: false, reason: "head_in_reserved_namespace" };
  if (!gitSucceeds(runGit, repo, ["merge-base", "--is-ancestor", ref, wkTip])) {
    return { ok: false, reason: "head_not_ancestor_of_wk_tip" };
  }
  return { ok: true, landing: branch };
}

export async function defaultWkForgeHandoff({ mainRepo, assignedUnit, deps = {} } = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  if (typeof mainRepo !== "string" || mainRepo.length === 0) {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.REQUEST_INVALID, { issue: "main_repo_missing" });
  }
  if (typeof assignedUnit !== "string" || !WK_RECORD_RE.test(assignedUnit)) {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.REQUEST_INVALID, { issue: "assigned_unit_invalid" });
  }
  const wk = assignedUnit;

  const readResult = () => readCanonicalRecord({ mainRepo, wk, deps });
  const initial = readResult();
  if (initial.ok !== true) {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, { reason: initial.reason });
  }
  const record = initial.record;

  let wkTip;
  try {
    const initiativeRaw = typeof record.initiative === "string" ? record.initiative.trim() : "";
    if (!INITIATIVE_RE.test(initiativeRaw)) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, { reason: "initiative_unassigned" });
    }
    const wkRef = `refs/heads/wk/${initiativeRaw}/${wk}`;
    if (!gitSucceeds(runGit, mainRepo, ["rev-parse", "--verify", "--quiet", wkRef])) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, { reason: "wk_ref_missing", wk_ref: wkRef });
    }
    wkTip = git(runGit, mainRepo, ["rev-parse", wkRef]);
    if (!OBJECT_ID_RE.test(wkTip)) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED, { reason: "wk_tip_non_canonical" });
    }
    const eligibility = assertTerminalQuiescentWk({ record, wk, wkTip, deps, repo: mainRepo });
    if (eligibility.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, eligibility);
    }

    const initiative = eligibility.initiative;
    const wkRefFrozen = wkRef;
    const tipFrozen = wkTip;
    const guard = async () => {
      const now = readResult();
      if (now.ok !== true) {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, { reason: "canonical_record_moved" });
      }
      const recheck = assertTerminalQuiescentWk({ record: now.record, wk, wkTip: tipFrozen, deps, repo: mainRepo });
      if (recheck.ok !== true) return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, recheck);
      let currentTip;
      try {
        currentTip = git(runGit, mainRepo, ["rev-parse", wkRefFrozen]);
      } catch {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, { reason: "wk_ref_unreadable" });
      }
      if (currentTip !== tipFrozen) {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.ELIGIBILITY, {
          reason: "wk_ref_moved", expected: tipFrozen, observed: currentTip
        });
      }
      return null;
    };

    const remote = resolveCanonicalForgeRepository({ repo: mainRepo, remoteName: "origin", deps });
    if (remote.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.REMOTE_INVALID, { reason: remote.reason });
    }
    const repository = remote.repository;
    const branch = deriveForgeBranchName({ initiative, wk });
    const envConstraint = (deps.env ?? process.env)[FORGE_LANDING_BRANCH_ENV_VAR];
    const message = deriveSquashCommitMessage({ initiative, wk, title: record.title });

    const forge = deps.forge ?? buildGhForge({ repository, mainRepo, deps });
    if (!sameForgeRepository(forge.repository, repository)) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.REMOTE_INVALID, {
        reason: "git_rest_repository_disagreement"
      });
    }
    const probe = forge.probe();
    if (probe.state === "error") {

      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.INDETERMINATE, { stage: "forge_probe", reason: probe.reason });
    }

    if (probe.state === "authenticated") {

      const landing = probe.default_branch;
      if (typeof envConstraint === "string" && envConstraint.length > 0 && envConstraint !== landing) {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.REMOTE_INVALID, {
          reason: "configured_landing_branch_disagrees_with_default", configured: envConstraint, observed: landing
        });
      }
      const landingRef = `refs/heads/${landing}`;
      if (!gitSucceeds(runGit, mainRepo, ["rev-parse", "--verify", "--quiet", landingRef])) {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED, {
          reason: "local_landing_ref_missing", landing_ref: landingRef
        });
      }
      const baseResult = resolveUniqueMergeBase(runGit, mainRepo, landingRef, wkTip);
      if (baseResult.ok !== true) {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED, baseResult);
      }
      const squash = buildSquashCommit({ repo: mainRepo, base: baseResult.base, wkTip, message, deps });
      if (squash.error) {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED, squash.error);
      }
      if (squash.kind === WK_FORGE_HANDOFF_RESULT_KINDS.NO_CHANGES) {
        const moved = await guard();
        if (moved !== null) return moved;
        return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.NO_CHANGES, {
          assigned_unit: wk, initiative, tree: squash.tree
        }) };
      }
      const publication = await publishBranchObserveFirst({ forge, branch, commit: squash.commit, guard });
      if (publication.ok === false) return publication;
      const pr = await createOrObservePullRequest({
        forge, repository, base: landing, head: branch,
        title: `${wk}: ${typeof record.title === "string" && record.title.trim().length > 0 ? record.title.trim() : "accumulated work-record change"}`,
        body: `Squashed handoff of the complete accumulated change for ${wk} (${initiative}).\n\nReview, approvals, checks, and merge are owned by this repository's forge and organization policy.\n`,
        guard
      });
      if (pr.ok === false) return pr;
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF, {
        assigned_unit: wk, initiative,
        branch, branch_state: publication.state,
        commit: squash.commit, tree: squash.tree, parent: squash.parent,
        base_branch: landing,
        repository: { host: repository.host, owner: repository.owner, name: repository.name },
        pull_request_state: pr.state,
        pull_request: {
          number: pr.pull_request.number,
          state: pr.pull_request.state ?? null,
          merged: pr.pull_request.merged ?? false,
          url: pr.pull_request.url ?? null,
          mergeable_state: pr.pull_request.mergeable_state ?? null
        }
      }) };
    }

    const manual = resolveManualLandingBranch({ runGit, repo: mainRepo, wkTip, envConstraint });
    if (manual.ok !== true) {
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_RECONCILIATION_REQUIRED, {
        assigned_unit: wk, initiative, reason: manual.reason
      }) };
    }
    const landing = manual.landing;
    const landingRef = `refs/heads/${landing}`;
    const landingTip = git(runGit, mainRepo, ["rev-parse", landingRef]);
    const baseResult = resolveUniqueMergeBase(runGit, mainRepo, landingRef, wkTip);
    if (baseResult.ok !== true) {
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_RECONCILIATION_REQUIRED, {
        assigned_unit: wk, initiative, reason: baseResult.reason
      }) };
    }
    const squash = buildSquashCommit({ repo: mainRepo, base: baseResult.base, wkTip, message, deps });
    if (squash.error) {
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED, squash.error);
    }
    if (squash.kind === WK_FORGE_HANDOFF_RESULT_KINDS.NO_CHANGES) {
      const moved = await guard();
      if (moved !== null) return moved;
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.NO_CHANGES, {
        assigned_unit: wk, initiative, tree: squash.tree
      }) };
    }

    const handoffRef = `refs/heads/handoff/wk/${initiative}/${wk}`;
    const casResult = casLocalHandoffRef({ runGit, repo: mainRepo, ref: handoffRef, commit: squash.commit });
    if (casResult.ok !== true) {
      if (casResult.reason === "handoff_ref_disagrees") {
        return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.PUBLICATION_DISAGREEMENT, {
          stage: "local_handoff_ref", ref: handoffRef, expected: squash.commit, observed: casResult.observed
        });
      }
      return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED, casResult);
    }

    if (landingTip !== squash.parent) {
      return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_RECONCILIATION_REQUIRED, {
        assigned_unit: wk, initiative, reason: "landing_tip_not_squash_parent"
      }) };
    }
    const moved = await guard();
    if (moved !== null) return moved;
    return { ok: true, result: buildResult(WK_FORGE_HANDOFF_RESULT_KINDS.HUMAN_ACTION_REQUIRED, {
      assigned_unit: wk, initiative,
      repository: { host: repository.host, owner: repository.owner, name: repository.name },
      landing_branch: landing,
      expected_landing_sha: landingTip,
      local_handoff_ref: handoffRef,
      squash_sha: squash.commit,

      merge_command: { program: "git", argv: ["merge", "--ff-only", handoffRef] }
    }) };
  } catch (err) {
    return refuse(WK_FORGE_HANDOFF_BROKER_CATEGORIES.GIT_FAILED, {
      reason: "forge_handoff_executor_threw", message: err?.message ?? String(err)
    });
  }
}

function casLocalHandoffRef({ runGit, repo, ref, commit }) {
  const existing = runGit({ repo, args: ["rev-parse", "--verify", "--quiet", ref], env: null });
  if (existing && existing.ok === true) {
    const observed = existing.stdout.trim();
    if (observed === commit) return { ok: true, state: "recovered" };
    return { ok: false, reason: "handoff_ref_disagrees", observed };
  }

  const created = runGit({ repo, args: ["update-ref", ref, commit, ""], env: null });
  if (created && created.ok === true) return { ok: true, state: "created" };
  return { ok: false, reason: "handoff_ref_create_failed" };
}

function buildResult(kind, fields) {
  return Object.freeze({
    schema_version: WK_FORGE_HANDOFF_RESULT_SCHEMA_VERSION,
    kind,
    ...fields,
    ...(fields.repository ? { repository: Object.freeze({ ...fields.repository }) } : {}),
    ...(fields.pull_request ? { pull_request: Object.freeze({ ...fields.pull_request }) } : {}),
    ...(fields.merge_command
      ? { merge_command: Object.freeze({ program: fields.merge_command.program, argv: Object.freeze([...fields.merge_command.argv]) }) }
      : {})
  });
}
