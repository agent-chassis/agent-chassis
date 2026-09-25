

import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";

export const HANDOFF_DESTINATION_CONFIG_KEY = "agent-launch.handoffDestination";

export const HANDOFF_TRANSPORTS = Object.freeze({
  LOCAL: "local",
  GIT: "git",
  HOSTED: "hosted"
});

const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const OBJECT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const NON_INTERACTIVE_ENV = Object.freeze({ GIT_TERMINAL_PROMPT: "0" });

export function git(runGit, repo, args, env = null) {
  const res = runGit({ repo, args, env });
  if (!res || res.ok !== true) {
    const err = new Error(`git ${args[0]} failed`, { cause: res });
    err.git = { repo, args: [...args], status: res?.status ?? null, stderr: res?.stderr ?? null };
    throw err;
  }
  return res.stdout.trim();
}

function isGitNoMatch(error) {
  const res = error?.cause;
  return res?.status === 1 && res?.error == null;
}

function lines(output) {
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function transportEnv() {
  return { ...process.env, ...NON_INTERACTIVE_ENV };
}

function wkHandoffRefPrefix({ initiative, wk, candidate }) {
  return `refs/agent-launch/wk-handoffs/${initiative}/${wk}/${candidate}/`;
}

export function wkHandoffRef({ initiative, wk, candidate, destination }) {
  return wkHandoffRefPrefix({ initiative, wk, candidate }) +
    (destination.transport === HANDOFF_TRANSPORTS.GIT ? `git/${destination.remote}` : "local");
}

function recordedDestination(suffix) {
  if (suffix === "local") return Object.freeze({ transport: HANDOFF_TRANSPORTS.LOCAL });
  const match = /^git\/(.+)$/u.exec(suffix);
  return match !== null && REMOTE_NAME_RE.test(match[1])
    ? Object.freeze({ transport: HANDOFF_TRANSPORTS.GIT, remote: match[1] })
    : Object.freeze({ transport: null, ref_suffix: suffix });
}

export function listRecordedHandoffs({ repo, initiative, wk, candidate, runGit }) {
  const prefix = wkHandoffRefPrefix({ initiative, wk, candidate });
  let output;
  try {
    output = git(runGit, repo, ["for-each-ref", "--format=%(refname) %(objectname)", prefix]);
  } catch (error) {
    return { ok: false, evidence: captureDiagnosticEvidence(error) };
  }
  return {
    ok: true,
    handoffs: lines(output).map((line) => {
      const [ref, sha] = line.split(" ");
      return Object.freeze({ ref, sha, destination: recordedDestination(ref.slice(prefix.length)) });
    })
  };
}

export function resolveRemoteUrl({ repo, remoteName, runGit }) {
  if (typeof repo !== "string" || repo.length === 0) {
    return { ok: false, reason: "repo_missing" };
  }
  let fetchUrls;
  let pushUrls;
  let rewrites;
  try {
    fetchUrls = lines(git(runGit, repo, ["remote", "get-url", "--all", remoteName]));
    pushUrls = lines(git(runGit, repo, ["remote", "get-url", "--push", "--all", remoteName]));
  } catch (error) {
    return { ok: false, reason: "remote_unreadable", evidence: captureDiagnosticEvidence(error) };
  }
  try {
    rewrites = lines(git(runGit, repo, ["config", "--get-regexp", "^url\\."]));
  } catch (error) {
    if (!isGitNoMatch(error)) {
      return {
        ok: false,
        reason: "remote_rewrite_config_unreadable",
        evidence: captureDiagnosticEvidence(error)
      };
    }
    rewrites = [];
  }
  if (rewrites.length > 0) return { ok: false, reason: "url_rewrite_configured" };
  if (fetchUrls.length !== 1) return { ok: false, reason: "remote_fetch_url_not_unique" };
  if (pushUrls.length !== 1) return { ok: false, reason: "remote_push_url_not_unique" };
  if (fetchUrls[0] !== pushUrls[0]) return { ok: false, reason: "remote_push_url_diverges" };
  return { ok: true, url: fetchUrls[0] };
}

function selected(transport, selection, remote = null) {
  return {
    ok: true,
    destination: Object.freeze({
      transport,
      ...(remote === null ? {} : { remote }),
      selection
    })
  };
}

export function resolveHandoffDestination({ repo, runGit }) {
  let selectors;
  try {
    selectors = lines(git(runGit, repo, ["config", "--get-all", HANDOFF_DESTINATION_CONFIG_KEY]));
  } catch (error) {
    if (!isGitNoMatch(error)) {
      return {
        ok: false,
        reason: "handoff_destination_config_unreadable",
        evidence: captureDiagnosticEvidence(error)
      };
    }
    selectors = [];
  }
  if (selectors.length > 1) {
    return { ok: false, reason: "handoff_destination_selector_ambiguous", selectors };
  }
  if (selectors.length === 1) {
    const [selector] = selectors;
    if (selector === HANDOFF_TRANSPORTS.LOCAL) return selected(HANDOFF_TRANSPORTS.LOCAL, "configured");
    const match = /^(git|hosted):(.*)$/u.exec(selector);
    if (match === null || !REMOTE_NAME_RE.test(match[2])) {
      return { ok: false, reason: "handoff_destination_selector_invalid", selector };
    }
    return selected(match[1], "configured", match[2]);
  }
  let remotes;
  try {
    remotes = lines(git(runGit, repo, ["remote"]));
  } catch (error) {
    return { ok: false, reason: "remote_list_unreadable", evidence: captureDiagnosticEvidence(error) };
  }
  if (remotes.length === 0) return selected(HANDOFF_TRANSPORTS.LOCAL, "remote_free_repository");
  if (remotes.includes("origin")) return selected(HANDOFF_TRANSPORTS.HOSTED, "origin_default", "origin");
  return { ok: false, reason: "handoff_destination_unselected", remotes };
}

export function readLocalRef({ repo, ref, runGit }) {
  try {
    const sha = git(runGit, repo, ["rev-parse", "--verify", "--quiet", ref]);
    return OBJECT_ID_RE.test(sha)
      ? { kind: "present", sha }
      : { kind: "unobservable", evidence: captureDiagnosticEvidence({ ref, observed: sha }) };
  } catch (error) {
    if (isGitNoMatch(error) && String(error.cause?.stdout ?? "").trim() === "") return { kind: "absent" };
    return { kind: "unobservable", evidence: captureDiagnosticEvidence(error) };
  }
}

export function createLocalRefIfAbsent({ repo, ref, commit, message, runGit }) {
  try {
    git(runGit, repo, ["update-ref", "-m", message, ref, commit, ""]);
    return { kind: "created" };
  } catch (error) {
    return { kind: "failed", evidence: captureDiagnosticEvidence(error) };
  }
}

export function observeRemoteRef({ repo, remote, ref, runGit }) {
  let output;
  try {
    output = git(runGit, repo, ["ls-remote", "--refs", remote, ref], transportEnv());
  } catch (error) {
    return { kind: "unobservable", evidence: captureDiagnosticEvidence(error) };
  }
  const matches = lines(output).map((line) => line.split(/\s+/u)).filter((parts) => parts[1] === ref);
  if (matches.length === 0) return { kind: "absent" };
  if (matches.length !== 1 || !OBJECT_ID_RE.test(matches[0][0])) {
    return { kind: "unobservable", evidence: captureDiagnosticEvidence({ ref, output }) };
  }
  return { kind: "present", sha: matches[0][0] };
}

export function publishRemoteRefIfAbsent({ repo, remote, ref, commit, runGit }) {
  try {
    git(runGit, repo, [
      "-c", "core.hooksPath=/dev/null",
      "push", "--no-verify", "--porcelain",
      `--force-with-lease=${ref}:`,
      remote,
      `${commit}:${ref}`
    ], transportEnv());
    return { kind: "published" };
  } catch (error) {
    return { kind: "failed", evidence: captureDiagnosticEvidence(error) };
  }
}

export function observeLandingBaseTip({ repo, transport, remote = null, baseBranch, runGit }) {
  const ref = `refs/heads/${baseBranch}`;
  if (transport === HANDOFF_TRANSPORTS.LOCAL) {
    const local = readLocalRef({ repo, ref, runGit });
    return { ...local, ref };
  }
  const observed = observeRemoteRef({ repo, remote, ref, runGit });
  if (observed.kind !== "present") return { ...observed, ref };
  if (!hasCommit({ repo, commit: observed.sha, runGit })) {
    try {
      git(runGit, repo, [
        "fetch", "--no-write-fetch-head", "--refmap=", "--no-tags", "--no-recurse-submodules",
        "--quiet", remote, ref
      ], transportEnv());
    } catch (error) {
      return { kind: "unobservable", ref, evidence: captureDiagnosticEvidence(error) };
    }
    if (!hasCommit({ repo, commit: observed.sha, runGit })) {
      return {
        kind: "unobservable",
        ref,
        evidence: captureDiagnosticEvidence({ reason: "destination_base_moved_during_observation", ref })
      };
    }
  }
  return { kind: "present", ref, sha: observed.sha };
}

function hasCommit({ repo, commit, runGit }) {
  try {
    git(runGit, repo, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export function isAncestor({ repo, ancestor, descendant, runGit }) {
  try {
    git(runGit, repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (isGitNoMatch(error)) return false;
    throw error;
  }
}
