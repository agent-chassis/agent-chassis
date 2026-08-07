import assert from "node:assert/strict";
import test from "node:test";
import { REVIEW_RESULT_EVIDENCE_STATE_VALUES, REVIEW_RESULT_LINEAGE_AUTHORITY_EFFECTS, createReviewerLineageCapability, buildReviewerResultEvidenceState } from "../packages/wiki-core/src/lib/work-record-review-result-lineage.mjs";
const digest = `sha256:${"a".repeat(64)}`;
const expected = { repository: "agent-chassis/agent-chassis", unit_address: "WK-1#SLICE-1", target_address: "WK-2", source_digest: digest, mode: "neutral", result_contract_version: "agent-role-result.v1", run_id: "run-1", action_generation: 1, prompt: { identity: "p", version: "1", digest }, policy: { identity: "q", version: "1" }, freshness: "fresh", replay: "not_replayed" };
const projection = () => ({ authority: "trusted_launcher", projection_version: "review-result-lineage.v1", repository: expected.repository, review_unit: { address: expected.unit_address }, target: { address: expected.target_address, source_digest: digest }, mode: expected.mode, result_contract_version: expected.result_contract_version, run: { run_id: expected.run_id }, action: { generation: 1 }, prompt: expected.prompt, policy: expected.policy, freshness: "fresh", replay: "not_replayed" });
const operator = { verifyOperatorDisposition: () => true };
const cap = createReviewerLineageCapability(operator);
const trusted = () => createReviewerLineageCapability({ ...operator, verifyLauncherProjection: value => value.authority === "trusted_launcher" });
test("closed evidence states remain distinct", () => {
  assert.deepEqual(REVIEW_RESULT_EVIDENCE_STATE_VALUES, ["not_applicable", "incomplete", "complete", "legacy", "operator_disposition"]);
  for (const [source, state] of [["neutral_prose", "not_applicable"], ["legacy", "legacy"]]) assert.equal(buildReviewerResultEvidenceState({ source }).state, state);
  assert.equal(cap.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: { authenticated: true } }).state, "operator_disposition"); assert.equal(cap.buildReviewerResultEvidenceState({ source: "neutral_prose", expected }).state, "incomplete");
});
test("complete lineage is verifier-bound and restart-safe", () => {
  const p = projection(), verifier = value => value === p, r = createReviewerLineageCapability({ verifyLauncherProjection: verifier }).validateReviewerActionLineage(p, expected); assert.equal(r.state, "complete"); assert.deepEqual(r.authority_effects, REVIEW_RESULT_LINEAGE_AUTHORITY_EFFECTS);
  assert.equal(createReviewerLineageCapability({ verifyLauncherProjection: verifier }).validateReviewerActionLineage(JSON.parse(JSON.stringify(r.lineage)), expected).state, "incomplete"); assert.equal(buildReviewerResultEvidenceState({ trusted_launcher_projection: p, expected }).state, "incomplete");
  assert.equal(Object.isFrozen(r), true); assert.equal(Object.isFrozen(r.lineage), true); assert.equal(r.lineage.mode, "neutral"); assert.equal(r.binding.mode, "neutral"); assert.throws(() => { r.state = "complete"; }, TypeError);
  const cyclicProjection = projection(); cyclicProjection.cycle = cyclicProjection; assert.equal(trusted(cyclicProjection).validateReviewerActionLineage(cyclicProjection, expected).state, "incomplete"); const e = { ...expected }; e.cycle = e; assert.equal(cap.validateReviewerActionLineage(projection(), e).state, "incomplete");
  const disposition = {}; disposition.cycle = disposition; assert.equal(cap.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition }).state, "incomplete");
});
test("launcher verifier observes the immutable persisted projection snapshot", () => {
  let observed;
  const original = projection();
  const capability = createReviewerLineageCapability({ verifyLauncherProjection: value => {
    observed = value;
    assert.equal(Object.isFrozen(value), true);
    assert.throws(() => { value.mode = "blueteam"; }, TypeError);
    return value.mode === "neutral";
  }});
  const result = capability.validateReviewerActionLineage(original, expected);
  assert.equal(result.state, "complete");
  assert.equal(observed, original);
  assert.notEqual(result.lineage, observed);
  assert.equal(result.lineage.mode, "neutral");
});

test("launcher verifier receives the exact original and copied substitutes are refused", () => {
  const original = projection();
  let observed;
  const capability = createReviewerLineageCapability({ verifyLauncherProjection: value => {
    observed = value;
    return value === original;
  }});
  assert.equal(capability.validateReviewerActionLineage(original, expected).state, "complete");
  assert.equal(observed, original);
  assert.equal(capability.validateReviewerActionLineage({ ...original }, expected).state, "incomplete");
  assert.equal(capability.validateReviewerActionLineage(JSON.parse(JSON.stringify(original)), expected).state, "incomplete");
});
test("launcher-admitted mode vocabulary is not revalidated locally", () => {
  const admittedMode = "newly-ratified-launcher-mode";
  const p = projection();
  p.mode = admittedMode;
  const e = { ...expected, mode: admittedMode };
  const result = createReviewerLineageCapability({ verifyLauncherProjection: value => value.authority === "trusted_launcher" }).validateReviewerActionLineage(p, e);
  assert.equal(result.state, "complete");
  assert.equal(result.lineage.mode, admittedMode);
  assert.equal(result.binding.mode, admittedMode);
});
test("revoked proxies and deep JSON input refuse safely", () => {
  const revoked = Proxy.revocable(projection(), {}); revoked.revoke(); const r = cap.validateReviewerActionLineage(revoked.proxy, expected);
  assert.equal(r.state, "incomplete"); assert.deepEqual(r.reasons, ["input_malformed"]); assert.match(r.decision_code, /^review_lineage\.malformed\.v1$/u);
  let nestedObject = { value: true }, nestedArray = [nestedObject];
  for (let index = 0; index < 12000; index += 1) { nestedObject = { value: nestedObject }; nestedArray = [nestedArray]; }
  for (const disposition of [nestedObject, nestedArray]) { const r = cap.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition }); assert.equal(r.state, "incomplete"); assert.deepEqual(r.reasons, ["input_malformed"]); assert.doesNotMatch(JSON.stringify(r), /Maximum call stack|RangeError/u); }
});
for (const [name, key, value, reason] of [["missing", "prompt", undefined, "untrusted_or_malformed_projection"], ["stale", "freshness", "stale", "stale"], ["target", "target", { address: "WK-3", source_digest: digest }, "wrong_target"], ["mode", "mode", "blueteam", "cross_mode"], ["ambiguous", "replay", "ambiguous", "replayed_or_ambiguous"], ["mixed-version", "result_contract_version", "agent-role-result.v2", "result_contract_version_malformed"]]) test(`typed refusal: ${name}`, () => { const p = projection(); if (value === undefined) delete p[key]; else p[key] = value; const r = cap.validateReviewerActionLineage(p, expected); assert.equal(r.state, "incomplete"); assert.equal(r.reasons[0], reason); });
test("whitespace-only lineage identities are incomplete", () => {
  for (const key of ["repository", "unit_address", "target_address", "run_id"]) assert.equal(cap.validateReviewerActionLineage(projection(), { ...expected, [key]: "   " }).state, "incomplete");
  for (const key of ["identity", "version"]) assert.equal(cap.validateReviewerActionLineage(projection(), { ...expected, prompt: { ...expected.prompt, [key]: "\t" } }).state, "incomplete");
  const e = { ...expected, policy: { identity: " ", version: "1" } };
  assert.equal(cap.validateReviewerActionLineage(projection(), e).state, "incomplete");
  let p = projection(); p.extra = true; assert.equal(cap.validateReviewerActionLineage(p, expected).state, "incomplete"); p = Object.create(projection()); assert.equal(cap.validateReviewerActionLineage(p, expected).state, "incomplete");
  p = projection(); Object.defineProperty(p, "mode", { get: () => "neutral", enumerable: true }); assert.equal(cap.validateReviewerActionLineage(p, expected).state, "incomplete"); p = projection(); p[Symbol("x")] = 1; assert.equal(cap.validateReviewerActionLineage(p, expected).state, "incomplete");
  assert.equal(cap.buildReviewerResultEvidenceState({ state: "complete", reported_role: "reviewer", child_result: projection() }).state, "incomplete");
});
test("operator disposition authenticates the exact original and persists a stable snapshot", () => {
  let received;
  const capability = createReviewerLineageCapability({ verifyOperatorDisposition: d => {
    received = d;
    assert.equal(Object.isFrozen(d), true);
    assert.throws(() => { d.authenticated = false; }, TypeError);
    return true;
  }});
  const disposition = { decision: "approved", details: [{ note: "ok" }] };
  const r = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
  assert.equal(r.state, "operator_disposition"); assert.equal(received, disposition); assert.notEqual(r.disposition, disposition); assert.deepEqual(r.disposition, disposition); assert.equal(Object.isFrozen(r.disposition), true); assert.equal(JSON.stringify(r.disposition), JSON.stringify(r.disposition));
  assert.throws(() => { disposition.details[0].note = "mutated"; }, TypeError); assert.equal(r.disposition.details[0].note, "ok");
  for (const bad of [undefined, 1n, Symbol("x"), () => {}, NaN, Infinity, -0]) {
    assert.equal(capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: bad }).state, "incomplete");
  }
  const sparse = []; sparse.length = 1; const sparseWithCustomProperty = []; sparseWithCustomProperty.length = 1; sparseWithCustomProperty.extra = "malformed";
  for (const disposition of [sparse, sparseWithCustomProperty, JSON.parse('{"__proto__":{"authenticated":true}}')]) assert.equal(capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition }).state, "incomplete");
});
test("operator dispositions retain repeated and pre-frozen array identity", () => {
  const seen = [];
  const capability = createReviewerLineageCapability({ verifyOperatorDisposition: d => { seen.push(d); return true; } });
  const disposition = [{ code: "LOW-1" }, { code: "LOW-2" }];
  const first = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
  const second = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
  assert.equal(first.state, "operator_disposition"); assert.equal(second.state, "operator_disposition");
  assert.equal(seen[0], disposition); assert.equal(seen[1], disposition); assert.notEqual(first.disposition, disposition); assert.notEqual(second.disposition, disposition); assert.equal(Object.isFrozen(disposition[0]), true);
  const frozen = Object.freeze([{ code: "LOW-3" }]);
  const result = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: frozen });
  assert.equal(result.state, "operator_disposition"); assert.equal(seen[2], frozen); assert.notEqual(result.disposition, frozen); assert.deepEqual(result.disposition, frozen);
});
test("changing original enumeration cannot destabilize completed evidence", () => {
  const target = { first: "one", second: "two" };
  let reverse = false;
  const disposition = new Proxy(target, { ownKeys: value => reverse ? ["second", "first"] : Reflect.ownKeys(value) });
  const capability = createReviewerLineageCapability({ verifyOperatorDisposition: value => { reverse = true; return value === disposition; } });
  const result = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
  assert.equal(result.state, "incomplete"); assert.deepEqual(result.reasons, ["operator_authentication_missing"]);
});
test("frozen proxy without canonical own data cannot authenticate", () => {
  const target = Object.freeze({});
  const disposition = Object.freeze(new Proxy(target, { get: Reflect.get }));
  const capability = createReviewerLineageCapability({ verifyOperatorDisposition: () => true });
  const result = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.reasons, ["input_malformed"]);
});

test("non-marker own data disappearing during freezing is refused", () => {
  const target = { decision: "approved", audit: "present" };
  let reads = 0;
  const disposition = new Proxy(target, {
    ownKeys: value => Reflect.ownKeys(value),
    getOwnPropertyDescriptor(value, key) {
      if (key === "audit" && reads++ > 0) return undefined;
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
  });
  let verifierCalls = 0;
  const capability = createReviewerLineageCapability({ verifyOperatorDisposition: () => { verifierCalls += 1; return true; } });
  const result = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
  assert.equal(result.state, "incomplete");
  assert.equal(verifierCalls, 0);
});
test("disposition own authentication must survive freezing", () => {
  const target = { authenticated: true };
  let ownReads = 0;
  const disposition = new Proxy(target, {
    getOwnPropertyDescriptor(value, key) {
      if (key === "authenticated" && ownReads++ > 0) return undefined;
      return Reflect.getOwnPropertyDescriptor(value, key);
    },
    ownKeys: value => Reflect.ownKeys(value),
  });
  let verifierCalls = 0;
  const capability = createReviewerLineageCapability({ verifyOperatorDisposition: () => { verifierCalls += 1; return true; } });
  const result = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.reasons, ["disposition_freeze_failed"]);
  assert.equal(verifierCalls, 0);
});
test("hostile expectation accessors are not observed before validation", () => {
  const p = projection(); p.prompt = { ...expected.prompt }; let observed = false;
  Object.defineProperty(p.prompt, "identity", { get: () => { observed = true; return "p"; }, enumerable: true });
  const result = trusted().validateReviewerActionLineage(p, expected);
  assert.equal(result.state, "incomplete"); assert.equal(observed, false);
});
test("operator scalar dispositions and CCE caller state are typed refusals", () => {
  const verifierCalls = [];
  const capability = createReviewerLineageCapability({ verifyLauncherProjection: () => { verifierCalls.push(true); return true; } });
  for (const disposition of [null, "text", true, 7]) {
    const result = capability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition });
    assert.equal(result.state, "incomplete"); assert.deepEqual(result.reasons, ["input_malformed"]);
  }
  assert.equal(capability.buildReviewerResultEvidenceState({ source: "cce", state: undefined, trusted_launcher_projection: projection(), expected }).reasons[0], "caller_state_not_authoritative");
  assert.equal(capability.buildReviewerResultEvidenceState({ source: "other", trusted_launcher_projection: projection(), expected }).reasons[0], "ambiguous_state");
  assert.deepEqual(verifierCalls, []);
});
test("source discriminator accessors refuse before verifier invocation", () => {
  let verifierCalls = 0;
  const input = {};
  Object.defineProperty(input, "source", { enumerable: true, get: () => "cce" });
  const result = createReviewerLineageCapability({ verifyLauncherProjection: () => { verifierCalls += 1; return true; } }).buildReviewerResultEvidenceState(input);
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.reasons, ["ambiguous_state"]);
  assert.equal(verifierCalls, 0);
});
test("CCE lineage refuses a source transition observed by the verifier", () => {
  const source = projection();
  let modeReads = 0;
  const hostile = new Proxy(source, { get(target, key, receiver) {
    if (key === "mode") return modeReads++ === 0 ? "neutral" : "blueteam";
    return Reflect.get(target, key, receiver);
  }});
  let observed;
  const capability = createReviewerLineageCapability({ verifyLauncherProjection: value => { observed = value; return value.mode === "neutral" && value.mode === "neutral"; } });
  const result = capability.validateReviewerActionLineage(hostile, expected);
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.reasons, ["projection_not_authenticated"]);
  assert.equal(modeReads, 2);
  assert.equal(observed, hostile);
});
test("lineage tree inspection has a property and element ceiling", () => {
  const wide = { authenticated: true };
  for (let index = 0; index < 4096; index += 1) wide[`property_${index}`] = true;
  const result = cap.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: wide });
  assert.equal(result.state, "incomplete"); assert.deepEqual(result.reasons, ["input_malformed"]);
  const wideArray = { authenticated: true, findings: Array.from({ length: 4095 }, () => true) };
  const arrayResult = cap.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: wideArray });
  assert.equal(arrayResult.state, "incomplete"); assert.deepEqual(arrayResult.reasons, ["input_malformed"]);
});
test("lineage distinguishes review-unit and target mismatches", () => {
  const p = projection();
  p.review_unit.address = "WK-other#SLICE-1";
  assert.deepEqual(cap.validateReviewerActionLineage(p, expected).reasons, ["wrong_review_unit"]);
  const target = projection();
  target.target.address = "WK-other";
  assert.deepEqual(cap.validateReviewerActionLineage(target, expected).reasons, ["wrong_target"]);
});
test("strict trees reject hidden plain properties and shared references", () => {
  const hidden = { authenticated: true };
  Object.defineProperty(hidden, "length", { value: 1 });
  assert.deepEqual(cap.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: hidden }).reasons, ["input_malformed"]);
  const shared = { authenticated: true };
  const dag = { first: shared, second: shared };
  assert.deepEqual(cap.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: dag }).reasons, ["input_malformed"]);
  const array = [{ authenticated: true }];
  const arrayCapability = createReviewerLineageCapability({ verifyOperatorDisposition: d => d[0]?.authenticated === true });
  assert.equal(arrayCapability.buildReviewerResultEvidenceState({ source: "operator_disposition", disposition: array }).state, "operator_disposition");
});
