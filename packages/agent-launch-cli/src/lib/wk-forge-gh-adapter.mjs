

import { WK_FORGE_HANDOFF_FAILURE_CATEGORIES } from "./trusted-operation-contracts.mjs";
import { captureDiagnosticEvidence, DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION } from "./diagnostic-evidence.mjs";
import {
  defaultRunGh,
  defaultRunGit,
  forgeCommandError,
  forgeCommandEvidence,
  sameForgeRepository
} from "./wk-forge-command.mjs";
import { OBJECT_ID_RE, isPlainObject, refuse } from "./wk-forge-handoff-refusal.mjs";

export const PULL_REQUEST_PAGE_LIMIT = 20;

export const PULL_REQUEST_PAGE_SIZE = 100;

export const PULL_REQUEST_URL_MAX_LENGTH = 2048;

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u;

const PULL_REQUEST_STATES = new Set(["open", "closed"]);

const PULL_REQUEST_MERGEABLE_STATES = new Set([
  "clean", "dirty", "unstable", "blocked", "behind", "has_hooks", "unknown", "draft"
]);

const PULL_REQUEST_URL_SECRET_SHAPE_RE =
  /(?:github_pat_|gh[pousr]_|x-access-token|(?:access[_-]?token|api[_-]?key|authorization|bearer|password|passwd|secret|credential)[=:@/])/iu;

export function buildGhForge({ repository, mainRepo, deps = {} }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const runGh = deps.runGh ?? defaultRunGh;
  const { host, owner, name, https_url: httpsUrl } = repository;
  const hostArgs = ["--hostname", host];

  return {
    repository,

    probe() {
      const operation = "probe";
      const auth = runGh({ args: ["auth", "status", ...hostArgs] });
      if (auth.spawn_error) {
        return { state: "unauthenticated", reason: "gh_absent",
          evidence: forgeCommandEvidence("gh auth status could not run", { operation, result: auth }) };
      }
      if (auth.ok !== true) {
        return { state: "unauthenticated", reason: "gh_not_authenticated_for_host",
          evidence: forgeCommandEvidence("gh auth status failed", { operation, result: auth }) };
      }
      const repoRes = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}`] });
      if (repoRes.spawn_error || repoRes.ok !== true) {
        return { state: "error", reason: "exact_repository_access_unproven",
          evidence: forgeCommandEvidence("gh repository read failed", { operation, result: repoRes }) };
      }
      let body;
      try {
        body = JSON.parse(repoRes.stdout);
      } catch (error) {
        return { state: "error", reason: "repository_api_response_unparseable",
          evidence: forgeCommandEvidence("gh repository response could not be parsed",
            { operation, result: repoRes, cause: error }) };
      }

      if (typeof body.full_name === "string" && body.full_name !== `${owner}/${name}`) {
        return { state: "error", reason: "repository_identity_mismatch" };
      }
      return { state: "authenticated" };
    },

    observeRemoteBranch({ branch }) {
      const operation = "observe_remote_branch";
      const res = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}/git/ref/heads/${branch}`] });
      if (res.spawn_error) {
        return { kind: "unprovable",
          evidence: forgeCommandEvidence("gh branch read could not run", { operation, result: res }) };
      }
      if (res.ok !== true) {

        if (/HTTP 404|Not Found/u.test(res.stderr ?? "")) return { kind: "absent" };
        return { kind: "unprovable",
          evidence: forgeCommandEvidence("gh branch read failed", { operation, result: res }) };
      }
      let body;
      try {
        body = JSON.parse(res.stdout);
      } catch (error) {
        return { kind: "unprovable", evidence: forgeCommandEvidence("gh branch response could not be parsed",
          { operation, result: res, cause: error }) };
      }
      const sha = body?.object?.sha;
      if (typeof sha !== "string" || !OBJECT_ID_RE.test(sha)) {
        return { kind: "unprovable", evidence: forgeCommandEvidence(
          "gh branch response carries no object id", { operation, result: res }) };
      }
      return { kind: "present", sha };
    },
    publishBranch({ branch, commit, expected }) {
      const ref = `refs/heads/${branch}`;
      if (expected !== null && !OBJECT_ID_RE.test(expected ?? "")) return { kind: "lease_failed" };

      const res = runGit({
        repo: mainRepo,
        args: [
          "-c", "core.hooksPath=/dev/null",
          "-c", "credential.helper=",
          "-c", `credential.https://${host}.helper=!gh auth git-credential`,
          "push", "--no-verify",
          `--force-with-lease=${ref}:${expected ?? ""}`,
          httpsUrl,
          `${commit}:${ref}`
        ],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      if (res && res.ok === true) return { kind: "published" };

      const evidence = captureDiagnosticEvidence(res);
      const stderr = typeof res?.stderr === "string" ? res.stderr : "";
      if (/stale info|fetch first|rejected/iu.test(stderr)) return { kind: "lease_failed", evidence };
      return { kind: "uncertain", evidence };
    },

    listPullRequestPage({ base, head, page, per_page: perPage }) {
      const operation = "list_pull_request_page";
      const headSelector = `${owner}:${head}`;
      const res = runGh({
        args: [
          "api", ...hostArgs,
          `repos/${owner}/${name}/pulls?state=all&base=${base}&head=${headSelector}&per_page=${perPage}&page=${page}`
        ]
      });
      if (res.spawn_error || res.ok !== true) {
        throw forgeCommandError("gh pull request list failed", { operation, result: res });
      }
      let items;
      try {
        items = JSON.parse(res.stdout);
      } catch (error) {
        return { kind: "unusable", evidence: forgeCommandEvidence(
          "gh pull request list response could not be parsed", { operation, result: res, cause: error }) };
      }
      if (!Array.isArray(items)) {
        return { kind: "unusable", evidence: forgeCommandEvidence(
          "gh pull request list response is not a list", { operation, result: res }) };
      }
      const mapped = items.map((item) => ({
        number: item?.number,
        state: typeof item?.state === "string" ? item.state : null,
        merged: item?.merged === true || typeof item?.merged_at === "string",
        url: typeof item?.html_url === "string" ? item.html_url : null,
        mergeable_state: typeof item?.mergeable_state === "string" ? item.mergeable_state : null,
        base_ref: item?.base?.ref ?? null,
        head_ref: item?.head?.ref ?? null,
        head_sha: item?.head?.sha ?? null,
        repository: { host, owner, name }
      }));

      return { kind: "ok", items: mapped, has_next: mapped.length >= perPage };
    },

    createPullRequest({ base, head, title, body }) {
      const operation = "create_pull_request";
      const res = runGh({
        args: [
          "api", ...hostArgs, "--method", "POST", `repos/${owner}/${name}/pulls`,
          "-f", `title=${title}`, "-f", `head=${head}`, "-f", `base=${base}`, "-f", `body=${body}`
        ]
      });
      if (res.spawn_error || res.ok !== true) {
        return { kind: "uncertain",
          evidence: forgeCommandEvidence("gh pull request create failed", { operation, result: res }) };
      }
      let item;
      try {
        item = JSON.parse(res.stdout);
      } catch (error) {
        return { kind: "uncertain", evidence: forgeCommandEvidence(
          "gh pull request create response could not be parsed", { operation, result: res, cause: error }) };
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
          head_sha: item?.head?.sha ?? null,
          repository: { host, owner, name }
        }
      };
    },

    async observeLandedPullRequest({ number }) {
      const operation = "observe_landed_pull_request";
      if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error("pull request number unavailable");
      }
      const response = await runGh({
        args: ["api", ...hostArgs, "--include", `repos/${owner}/${name}/pulls/${number}`]
      });
      const { body, etag } = parseIncludedJson(response, operation);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw forgeCommandError("landed pull request observation malformed", { operation, result: response });
      }
      const directRepository = body.repository && typeof body.repository === "object"
        ? { ...body.repository, host }
        : undefined;
      const baseRepository = body.base?.repo && typeof body.base.repo === "object"
        ? { ...body.base.repo, host }
        : undefined;
      return {
        ...body,
        ...(directRepository === undefined ? {} : { repository: directRepository }),
        base: { ...body.base, ...(baseRepository === undefined ? {} : { repo: baseRepository }) },
        forge_identity: body.node_id ?? body.id,
        observation_binding: etag
      };
    },
    async observeExactHeadLanding({ head, merge_commit_sha, observation_binding }) {
      const operation = "observe_exact_head_landing";
      if (!OBJECT_ID_RE.test(head ?? "") || !OBJECT_ID_RE.test(merge_commit_sha ?? "") ||
          typeof observation_binding !== "string" || observation_binding.length === 0) {
        return { ok: false, reason: "exact_head_landing_request_invalid" };
      }
      const result = runGh({ args: ["api", ...hostArgs, `repos/${owner}/${name}/compare/${head}...${merge_commit_sha}`] });
      if (!result?.ok) {
        return { ok: false, observation_binding, reason: "exact_head_comparison_failed",
          evidence: forgeCommandEvidence("gh exact-head comparison failed", { operation, result }) };
      }
      let body;
      try {
        body = JSON.parse(result.stdout);
      } catch (error) {
        return { ok: false, observation_binding, reason: "exact_head_comparison_unparseable",
          evidence: forgeCommandEvidence("gh exact-head comparison response could not be parsed",
            { operation, result, cause: error }) };
      }
      return {
        ok: true,
        ancestor: head,
        descendant: merge_commit_sha,
        relation: body.status === "ahead" || body.status === "identical" ? "ancestor" : "unrelated",
        observation_binding
      };
    }
  };
}

function parseIncludedJson(response, operation) {
  if (!response?.ok) throw forgeCommandError("gh observation command failed", { operation, result: response });
  const raw = String(response.stdout ?? "");
  const blocks = raw.split(/\r?\n\r?\n/gu);
  if (blocks.length < 2) {
    throw forgeCommandError("forge response headers unavailable", { operation, result: response });
  }
  const body = blocks.pop();
  const headerText = blocks.pop();
  const etag = headerText.match(/^etag:\s*(.+)$/imu)?.[1]?.trim();
  if (typeof etag !== "string" || etag.length === 0) {
    throw forgeCommandError("forge observation binding unavailable", { operation, result: response });
  }
  try {
    return { body: JSON.parse(body), etag };
  } catch (error) {
    throw forgeCommandError("forge response body could not be parsed",
      { operation, result: response, cause: error });
  }
}

const PULL_REQUEST_PROPERTIES = Object.freeze([
  "number", "repository", "base_ref", "head_ref", "state", "merged", "mergeable_state", "head_sha", "url"
]);

function validateObservedPullRequest({ item, repository, base, head }) {
  const unreadable = (property, error) => ({ ok: false, unreadable: { property, error } });
  const mismatch = { ok: false, mismatch: true };
  try {
    if (!isPlainObject(item)) return mismatch;
  } catch (error) {
    return unreadable(null, error);
  }
  const snapshot = {};
  for (const property of PULL_REQUEST_PROPERTIES) {
    try {
      snapshot[property] = item[property];
    } catch (error) {
      return unreadable(property, error);
    }
  }
  const { number, base_ref: baseRef, head_ref: headRef, state, merged, head_sha: headSha, url } = snapshot;
  let itemRepository = snapshot.repository;
  if (itemRepository !== null && typeof itemRepository === "object") {
    const coordinate = {};
    for (const field of ["host", "owner", "name"]) {
      try {
        coordinate[field] = itemRepository[field];
      } catch (error) {
        return unreadable(`repository.${field}`, error);
      }
    }
    itemRepository = coordinate;
  }

  if (!Number.isSafeInteger(number) || number <= 0) return mismatch;
  if (!sameForgeRepository(itemRepository, repository)) return mismatch;
  if (baseRef !== base || headRef !== head) return mismatch;
  if (!PULL_REQUEST_STATES.has(state) || typeof merged !== "boolean") return mismatch;
  if (merged === true && state !== "closed") return mismatch;
  const mergeableState = snapshot.mergeable_state === undefined ? null : snapshot.mergeable_state;
  if (mergeableState !== null && !PULL_REQUEST_MERGEABLE_STATES.has(mergeableState)) return mismatch;
  if (typeof headSha !== "string" || !OBJECT_ID_RE.test(headSha) || /^0+$/u.test(headSha)) {
    return mismatch;
  }
  if (typeof url !== "string" || url.length === 0 ||
      Buffer.byteLength(url, "utf8") > PULL_REQUEST_URL_MAX_LENGTH || url.includes("%") ||
      /[^\x21-\x7e]/u.test(url)) return mismatch;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {

    return mismatch;
  }
  const canonicalUrl = parsedUrl.href;
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.length === 0 ||
      parsedUrl.username !== "" || parsedUrl.password !== "" || parsedUrl.search !== "" ||
      parsedUrl.hash !== "" || canonicalUrl !== url || canonicalUrl.includes("%") ||
      /[^\x21-\x7e]/u.test(canonicalUrl) ||
      PULL_REQUEST_URL_SECRET_SHAPE_RE.test(url) ||
      PULL_REQUEST_URL_SECRET_SHAPE_RE.test(canonicalUrl)) return mismatch;
  return {
    ok: true,
    pullRequest: Object.freeze({
      number,
      state,
      merged,
      url,
      mergeable_state: mergeableState,
      head_sha: headSha
    })
  };
}

export function returnedOutcomeEvidence(returned) {
  return returned?.evidence?.schema_version === DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
    ? returned.evidence
    : captureDiagnosticEvidence(returned);
}

export async function observeExactPullRequests({ forge, repository, base, head }) {
  const matches = [];
  for (let page = 1; page <= PULL_REQUEST_PAGE_LIMIT; page += 1) {
    let response;
    try {
      response = await forge.listPullRequestPage({ base, head, page, per_page: PULL_REQUEST_PAGE_SIZE });
    } catch (error) {
      return { ok: false, reason: "pull_request_transport_failed", page,
        evidence: captureDiagnosticEvidence(error) };
    }
    let step = "response";
    try {
      if (!isPlainObject(response) || response.kind !== "ok" || !Array.isArray(response.items)) {
        return { ok: false, reason: "pull_request_observation_unusable", page,
          evidence: returnedOutcomeEvidence(response) };
      }
      step = "items";
      let index = -1;
      for (const item of response.items) {
        index += 1;
        const validated = validateObservedPullRequest({ item, repository, base, head });
        if (validated.unreadable !== undefined) {
          return { ok: false, reason: "observed_pull_request_unreadable", page, item: index,
            property: validated.unreadable.property,
            evidence: captureDiagnosticEvidence(validated.unreadable.error) };
        }
        if (validated.ok !== true) {
          return { ok: false, reason: "observed_pull_request_identity_mismatch", page, item: index };
        }
        matches.push(validated.pullRequest);
      }
      step = "has_next";
      if (response.has_next !== true) return { ok: true, matches };
    } catch (error) {
      return { ok: false, reason: "pull_request_observation_unusable", page, step,
        evidence: captureDiagnosticEvidence(error) };
    }
  }
  return { ok: false, reason: "pull_request_page_limit_exceeded" };
}

export function pullRequestObservationRefusal(observation, extra = {}) {
  const { ok: _ok, ...facts } = observation;
  const category = observation.reason === "observed_pull_request_identity_mismatch"
    ? WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT
    : WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE;
  return refuse(category, { stage: "pull_request", ...facts, ...extra });
}

export function authenticateExactProposal(matches, authenticatedHead) {
  if (matches.length > 1) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request", reason: "multiple_exact_pull_requests", matched: matches.length
    });
  }
  const pullRequest = matches[0];
  if (pullRequest.head_sha !== authenticatedHead) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request",
      reason: "pull_request_head_sha_disagrees",
      expected: authenticatedHead,
      observed: pullRequest.head_sha
    });
  }
  if (pullRequest.merged !== true && pullRequest.state !== "open") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      stage: "pull_request",
      reason: "closed_unmerged_or_unknown_pull_request_state",
      state: pullRequest.state
    });
  }
  return { ok: true, pullRequest };
}

export function forgeProbeDiagnostic(probe) {
  return {
    stage: "forge_probe",
    state: probe?.state ?? null,
    reason: probe?.reason ?? null,
    ...(probe?.evidence === undefined ? {} : { evidence: probe.evidence })
  };
}

export function branchObservationFacts(observation) {
  return {
    kind: observation?.kind ?? null,
    ...(observation?.sha === undefined ? {} : { sha: observation.sha }),
    ...(observation?.evidence === undefined ? {} : { evidence: observation.evidence })
  };
}

export function branchPublicationFacts(pushed) {
  const kind = pushed?.kind ?? null;
  return kind === "published"
    ? { publish_outcome: kind }
    : { publish_outcome: kind, publish_evidence: returnedOutcomeEvidence(pushed) };
}
