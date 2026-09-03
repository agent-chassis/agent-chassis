

import test from "node:test";
import assert from "node:assert/strict";

import {
  refuseFindingsOnlyAdmission
} from "../../packages/wiki-mcp/src/lib/dispatch-tools/findings-only-admission.mjs";

const SUBJECT = "WK-2316#SLICE-006";
const INITIATIVE_SUBJECT_KIND = "initiative";

function reviewSubject(overrides = {}) {
  return {
    record_id: "WK-2316",
    slice_id: "SLICE-006",
    title: "Correct findings-only admission runtime-blocker classification",
    work_kind: "implementation",
    write_scope: ["packages/wiki-mcp/src/lib/dispatch-tools/findings-only-admission.mjs"],
    repo_paths: ["packages/wiki-mcp/src/lib/dispatch-tools/findings-only-admission.mjs"],
    acceptance: null,
    ...overrides
  };
}

async function admit({
  role = "reviewer",
  subject = reviewSubject(),
  subjectKind = "work_record_slice"
} = {}) {
  const envelopes = [];
  const result = await refuseFindingsOnlyAdmission({
    args: { role, subject: SUBJECT },
    subjectKind,
    initiativeSubjectKind: INITIATIVE_SUBJECT_KIND,
    workspace: { dir: "/dev/null/workspace" },
    dispatchBackend: {},
    loadSubject: async () => subject,
    buildBlocked: (input) => ({ accepted: false, blocker: input }),
    jsonContent: (value) => {
      envelopes.push(value);
      return { structuredContent: value };
    }
  });
  return { result, envelopes };
}

function refusalOf(result) {
  assert.ok(result, "admission must refuse");
  return result.structuredContent.blocker;
}

test("an empty write_scope findings-only unit is admitted", async () => {
  const { result } = await admit({ subject: reviewSubject({ write_scope: [] }) });
  assert.equal(result, null);
});

test("an empty-scope canonical findings unit with a SHA pair is admitted to target normalization", async () => {
  const envelopes = [];
  const result = await refuseFindingsOnlyAdmission({
    args: {
      role: "reviewer",
      subject: SUBJECT,
      reviewed_sha: "a".repeat(40),
      diff_base_sha: "b".repeat(40)
    },
    subjectKind: "work_record_slice",
    initiativeSubjectKind: INITIATIVE_SUBJECT_KIND,
    workspace: { dir: "/dev/null/workspace" },
    dispatchBackend: {},
    loadSubject: async () => reviewSubject({ write_scope: [] }),
    buildBlocked: (input) => ({ accepted: false, blocker: input }),
    jsonContent: (value) => {
      envelopes.push(value);
      return { structuredContent: value };
    }
  });
  assert.equal(result, null);
  assert.deepEqual(envelopes, []);
});

test("a write-bearing canonical implementation subject is delegated to the exact-target backend", async () => {
  const { result } = await admit();
  assert.equal(result, null);
});

test("a non-findings role and an initiative subject are both out of scope", async () => {
  assert.equal((await admit({ role: "worker" })).result, null);
  assert.equal((await admit({ subjectKind: INITIATIVE_SUBJECT_KIND })).result, null);
});

for (const role of ["reviewer", "redteam"]) {
  test(`an unresolvable ${role} subject names the exact resolution check and path`, async () => {
    const { result } = await admit({ role, subject: null });
    const blocker = refusalOf(result);

    assert.equal(blocker.blockerCode, "work_record_readiness_failure");
    assert.equal(blocker.reason, `${role}_subject_unreadable`);
    assert.equal(blocker.detail.named_defect.check, `${role}_subject_resolution`);
    assert.equal(blocker.detail.named_defect.status, "unresolved");
    assert.equal(blocker.detail.named_defect.path, "wiki/work-records/WK-2316.json");
    assert.equal(blocker.detail.subject, SUBJECT);
  });
}
