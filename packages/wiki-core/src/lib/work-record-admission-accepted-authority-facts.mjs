

import { isObject, normalizeStringEntry } from "./work-record-admission-shared.mjs";

function normalizeAcceptedAuthorityId(authorityRef, repo) {
  if (!authorityRef) {
    return null;
  }
  if (authorityRef.includes(":")) {
    return authorityRef;
  }
  return repo ? `${repo}:${authorityRef}` : authorityRef;
}

function createAcceptedAuthorityControls(authority) {
  const controls = [];
  const seen = new Set();
  const pushControl = (control) => {
    if (typeof control !== "string") {
      return;
    }
    const normalizedControl = control.trim();
    if (
      normalizedControl === "write_scope_total_loc" ||
      normalizedControl === "max_write_file_loc"
    ) {
      if (!seen.has(normalizedControl)) {
        seen.add(normalizedControl);
        controls.push(normalizedControl);
      }
    }
  };

  const maxWriteFileLoc = Number.isInteger(authority.max_write_file_loc)
    ? authority.max_write_file_loc
    : null;
  const largeFileThreshold = Number.isInteger(authority.large_file_threshold)
    ? authority.large_file_threshold
    : null;

  if (maxWriteFileLoc !== null) {
    pushControl("max_write_file_loc");
  }
  if (maxWriteFileLoc !== null || largeFileThreshold !== null) {
    pushControl("write_scope_total_loc");
  }

  return controls.length > 0 ? controls : null;
}

function createAcceptedAuthorityUnit(authority) {
  if (!isObject(authority.unit)) {
    return null;
  }

  return {
    record_id: normalizeStringEntry(authority.unit.record_id) ?? null,
    slice_id: normalizeStringEntry(authority.unit.slice_id) ?? null,
    address: normalizeStringEntry(authority.unit.address) ?? null
  };
}

function createAcceptedAuthorityPaths(_authority) {

  return {
    path_scoped: false
  };
}

export function createAcceptedAuthorityFacts(normalizedRequest, { sourceDigest } = {}) {
  const authorityEntries = Array.isArray(normalizedRequest?.evidence?.large_file_dec_authority)
    ? normalizedRequest.evidence.large_file_dec_authority
    : [];
  if (authorityEntries.length === 0) {
    return [];
  }

  const repo = normalizeStringEntry(normalizedRequest?.subject?.repo) ?? null;
  const facts = [];
  for (const authority of authorityEntries) {
    if (!isObject(authority)) {
      continue;
    }

    const authorityRef = normalizeStringEntry(authority.authority_ref);
    const authorityId = normalizeAcceptedAuthorityId(authorityRef, repo);
    const authorityRepo = repo;
    const authorityStatus = normalizeStringEntry(authority.status)?.toLowerCase() ?? null;
    const authorizedUnit = createAcceptedAuthorityUnit(authority);
    const authorizedControls = createAcceptedAuthorityControls(authority);
    const expiresAt = normalizeStringEntry(authority.expires_at);
    const digest = normalizeStringEntry(sourceDigest);
    const authorityClass =
      normalizeStringEntry(authority.authority_class)?.toLowerCase() ?? "decision";
    const projectedAuthorityClass =
      authorityClass === "escalation" ? "escalation" : "decision";
    const projectedPaths = createAcceptedAuthorityPaths(authority);

    if (
      authorityStatus !== "accepted" ||
      !authorityId ||
      !authorityRepo ||
      !authorizedUnit ||
      !authorizedControls ||
      !expiresAt ||
      !digest
    ) {
      continue;
    }

    const fact = {
      schema_version: "worker_admission.accepted_authority.v1",
      authority_id: authorityId,
      authority_repo: authorityRepo,
      authority_status: "accepted",
      authority_class: projectedAuthorityClass,
      authorized_unit: authorizedUnit,
      authorized_controls: authorizedControls,
      path_scoped: projectedPaths.path_scoped,
      expires_at: expiresAt,
      source_digest: digest
    };

    if (projectedPaths.authorized_paths) {
      fact.authorized_paths = projectedPaths.authorized_paths;
    }

    facts.push(fact);
  }

  return facts;
}
