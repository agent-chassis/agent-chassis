export const REVIEW_RESULT_LINEAGE_SCHEMA_VERSION = "review-result-lineage.v1";
export const REVIEW_RESULT_EVIDENCE_STATE_VALUES = Object.freeze(["not_applicable", "incomplete", "complete", "legacy", "operator_disposition"]);
export const REVIEW_RESULT_LINEAGE_AUTHORITY_EFFECTS = Object.freeze({ veto: false, dispatch: false, launch: false, waiver: false, mitigation: false, scope_expansion: false, next_action: false, closure: false, review_completion: false });
const isPlain = v => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const own = (v, keys) => isPlain(v) && Reflect.ownKeys(v).length === keys.length && keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d && d.enumerable && !d.get && !d.set; });
const text = v => typeof v === "string" && v.trim().length > 0 && v.length <= 512;
const digest = v => typeof v === "string" && /^sha256:[0-9a-f]{64}$/u.test(v);
const MAX_SAFE_TREE_NODES = 4096;
const MAX_SAFE_TREE_ENTRIES = 4096;
const captureTree = (value, arrays = false) => {
  const pending = [{ value, parent: null, key: null }];
  const seen = new WeakSet();
  let captured;
  let nodes = 0;
  let entries = 0;
  while (pending.length) {
    const item = pending.pop();
    const current = item.value;
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      if (item.parent) item.parent[item.key] = current;
      else captured = current;
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) return null;
      if (item.parent) item.parent[item.key] = current;
      else captured = current;
      continue;
    }
    if (typeof current !== "object" || seen.has(current)) return null;
    nodes += 1;
    if (nodes > MAX_SAFE_TREE_NODES) return null;
    const array = Array.isArray(current);
    if (array ? !arrays || Object.getPrototypeOf(current) !== Array.prototype : !isPlain(current)) return null;
    let keys;
    try { keys = Reflect.ownKeys(current); } catch { return null; }
    if (entries + keys.length > MAX_SAFE_TREE_ENTRIES) return null;
    entries += keys.length;
    let length;
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
      if (!lengthDescriptor || lengthDescriptor.enumerable || lengthDescriptor.get || lengthDescriptor.set || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || keys.length !== lengthDescriptor.value + 1) return null;
      length = lengthDescriptor.value;
      for (let index = 0; index < length; index += 1) if (!keys.includes(String(index))) return null;
    }
    const copy = array ? new Array(length) : {};
    if (item.parent) item.parent[item.key] = copy;
    else captured = copy;
    seen.add(current);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (array && key === "length") {
        if (!descriptor || descriptor.enumerable || descriptor.get || descriptor.set) return null;
        continue;
      }
      if (typeof key !== "string" || key === "__proto__" || !descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) return null;
      if (array && (!/^\d+$/u.test(key) || Number(key) >= length)) return null;
      pending.push({ value: descriptor.value, parent: copy, key });
    }
  }
  return captured;
};
const safeTree = (value, arrays = false) => captureTree(value, arrays) !== null;
const snapshotTree = (value, arrays = false) => captureTree(value, arrays);
const clone = v => { if (Array.isArray(v)) return v.map(clone); if (!isPlain(v)) return v; const out = {}; for (const k of Object.keys(v)) out[k] = clone(v[k]); return out; };
const freezeInPlace = v => {
  const pending = [v], seen = new WeakSet();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor && "value" in descriptor) pending.push(descriptor.value);
    }
    Object.freeze(current);
  }
  return v;
};
const treesEqual = (left, right) => {
  const pending = [{ left, right }];
  let entries = 0;
  while (pending.length) {
    const pair = pending.pop();
    const a = pair.left;
    const b = pair.right;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
      if (!Object.is(a, b)) return false;
      continue;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const aKeys = Reflect.ownKeys(a);
    const bKeys = Reflect.ownKeys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const [index, key] of aKeys.entries()) {
      entries += 1;
      if (entries > MAX_SAFE_TREE_ENTRIES || bKeys[index] !== key) return false;
      const aDescriptor = Object.getOwnPropertyDescriptor(a, key);
      const bDescriptor = Object.getOwnPropertyDescriptor(b, key);
      if (!aDescriptor || !bDescriptor || aDescriptor.enumerable !== bDescriptor.enumerable || aDescriptor.get !== bDescriptor.get || aDescriptor.set !== bDescriptor.set || !("value" in aDescriptor) || !("value" in bDescriptor)) return false;
      pending.push({ left: aDescriptor.value, right: bDescriptor.value });
    }
  }
  return true;
};
const snapshotIsStable = (value, canonical) => {
  let snapshot;
  try { snapshot = snapshotTree(value, true); } catch { return false; }
  return snapshot !== null && treesEqual(snapshot, canonical);
};
const immutable = v => { const f = x => { if (x && typeof x === "object") { for (const y of Object.values(x)) f(y); Object.freeze(x); } return x; }; return f(clone(v)); };
const result = (state, code, reasons, extra = {}, preserve = false) => (preserve ? freezeInPlace : immutable)({ schema_version: REVIEW_RESULT_LINEAGE_SCHEMA_VERSION, ok: state === "complete", valid: state === "complete", state, evidence_state: state, decision_code: `review_lineage.${code}.v1`, reasons, authority_effects: REVIEW_RESULT_LINEAGE_AUTHORITY_EFFECTS, ...extra });
const incomplete = (code, reasons = [code]) => result("incomplete", code, reasons);
const expectationKeys = ["repository", "unit_address", "target_address", "source_digest", "mode", "result_contract_version", "run_id", "action_generation", "prompt", "policy", "freshness", "replay"];
const projectionKeys = ["authority", "projection_version", "repository", "review_unit", "target", "mode", "result_contract_version", "run", "action", "prompt", "policy", "freshness", "replay"];
function validExpectation(e) { return own(e, expectationKeys) && text(e.repository) && text(e.unit_address) && text(e.target_address) && digest(e.source_digest) && text(e.mode) && e.result_contract_version === "agent-role-result.v1" && text(e.run_id) && Number.isSafeInteger(e.action_generation) && e.action_generation > 0 && e.freshness === "fresh" && e.replay === "not_replayed" && own(e.prompt, ["identity", "version", "digest"]) && text(e.prompt.identity) && text(e.prompt.version) && digest(e.prompt.digest) && own(e.policy, ["identity", "version"]) && text(e.policy.identity) && text(e.policy.version); }
function projectionError(p, e) {
  if (!own(p, projectionKeys) || p.authority !== "trusted_launcher" || p.projection_version !== REVIEW_RESULT_LINEAGE_SCHEMA_VERSION) return "untrusted_or_malformed_projection";
  if (!text(p.repository) || p.repository !== e.repository) return "wrong_repository";
  if (!own(p.review_unit, ["address"]) || !text(p.review_unit.address) || p.review_unit.address !== e.unit_address) return "wrong_review_unit";
  if (!own(p.target, ["address", "source_digest"]) || !text(p.target.address) || p.target.address !== e.target_address || !digest(p.target.source_digest) || p.target.source_digest !== e.source_digest) return "wrong_target";
  if (!text(p.mode) || p.mode !== e.mode) return "cross_mode";
  if (p.result_contract_version !== e.result_contract_version) return "result_contract_version_malformed";
  if (!own(p.run, ["run_id"]) || !text(p.run.run_id) || p.run.run_id !== e.run_id) return "run_binding_mismatch";
  if (!own(p.action, ["generation"]) || !Number.isSafeInteger(p.action.generation) || p.action.generation !== e.action_generation) return "action_generation_malformed";
  if (!own(p.prompt, ["identity", "version", "digest"]) || !text(p.prompt.identity) || !text(p.prompt.version) || !digest(p.prompt.digest) || p.prompt.identity !== e.prompt.identity || p.prompt.version !== e.prompt.version || p.prompt.digest !== e.prompt.digest) return "prompt_binding_mismatch";
  if (!own(p.policy, ["identity", "version"]) || !text(p.policy.identity) || !text(p.policy.version) || p.policy.identity !== e.policy.identity || p.policy.version !== e.policy.version) return "policy_binding_mismatch";
  if (p.freshness !== "fresh" || e.freshness !== "fresh") return "stale";
  if (p.replay !== "not_replayed" || e.replay !== "not_replayed") return "replayed_or_ambiguous";
  return null;
}
function validate(p, e, verifyLauncherProjection) {
  try {

    if (!isPlain(p) || !own(p, projectionKeys)) return incomplete("incomplete", ["untrusted_or_malformed_projection"]);
    if (!isPlain(e) || !own(e, expectationKeys)) return incomplete("incomplete", ["expectation_malformed"]);
    const projection = snapshotTree(p);
    const expectation = snapshotTree(e);
    if (projection === null || expectation === null) return incomplete("incomplete", ["expectation_malformed"]);
    if (!validExpectation(expectation)) return incomplete("incomplete", ["expectation_malformed"]);
    const projectionShapeError = projectionError(projection, expectation);
    if (projectionShapeError) return incomplete(projectionShapeError);
    freezeInPlace(p); freezeInPlace(expectation);
    if (!snapshotIsStable(p, projection)) return incomplete("malformed", ["input_malformed"]);
    let authenticated = false;
    try { authenticated = typeof verifyLauncherProjection === "function" && verifyLauncherProjection(p) === true; } catch { authenticated = false; }
    if (!authenticated) return incomplete("projection_not_authenticated", ["projection_not_authenticated"]);
    if (!snapshotIsStable(p, projection)) return incomplete("malformed", ["input_malformed"]);
    return result("complete", "complete", [], { lineage: projection, binding: expectation });
  } catch {
    return incomplete("malformed", ["input_malformed"]);
  }
}
function build(input, api) {
  try {
    if (!isPlain(input)) return incomplete("malformed", ["input_malformed"]);
    const sourceDescriptor = Object.getOwnPropertyDescriptor(input, "source");
    if (!sourceDescriptor || sourceDescriptor.get || sourceDescriptor.set || !sourceDescriptor.enumerable) return incomplete("ambiguous_state", ["ambiguous_state"]);
    const source = sourceDescriptor.value;
    if (source === "neutral_prose" || source === "not_applicable") return own(input, ["source"]) ? result("not_applicable", "not_applicable", []) : incomplete("ambiguous_state", ["ambiguous_state"]);
    if (source === "legacy") return own(input, ["source"]) ? result("legacy", "legacy", []) : incomplete("ambiguous_state", ["ambiguous_state"]);
    if (source === "operator_disposition") {
      if (!own(input, ["source", "disposition"])) return incomplete("malformed", ["input_malformed"]);
      const disposition = Object.getOwnPropertyDescriptor(input, "disposition");
      if (!disposition || disposition.get || disposition.set || (!isPlain(disposition.value) && !Array.isArray(disposition.value))) return incomplete("malformed", ["input_malformed"]);
      let canonical; try { canonical = snapshotTree(disposition.value, true); } catch { canonical = null; }
      if (canonical === null || Reflect.ownKeys(canonical).length === (Array.isArray(canonical) ? 1 : 0)) return incomplete("malformed", ["input_malformed"]);
      if (!api?.verifyOperatorDisposition) return incomplete("operator_authentication_missing", ["operator_authentication_missing"]);
      try { freezeInPlace(canonical); } catch { return incomplete("freeze", ["disposition_freeze_failed"]); }
      try { freezeInPlace(disposition.value); } catch { return incomplete("freeze", ["disposition_freeze_failed"]); }
      if (!snapshotIsStable(disposition.value, canonical)) return incomplete("malformed", ["input_malformed"]);
      let ok = false; try { ok = api.verifyOperatorDisposition(disposition.value) === true; } catch { ok = false; }
      if (!ok || !snapshotIsStable(disposition.value, canonical)) return incomplete("operator_authentication_missing", ["operator_authentication_missing"]);
      let serialized;
      try {
        serialized = JSON.stringify(canonical);
        if (serialized !== JSON.stringify(canonical)) return incomplete("malformed", ["input_malformed"]);
      } catch { return incomplete("malformed", ["input_malformed"]); }
      return result("operator_disposition", "operator_disposition", [], { disposition: canonical }, true);
    }
    if (source !== "cce") return incomplete("ambiguous_state", ["ambiguous_state"]);
    if (Object.hasOwn(input, "state") || Object.hasOwn(input, "reported_role") || Object.hasOwn(input, "child_result")) return incomplete("state_refused", ["caller_state_not_authoritative"]);
    if (!own(input, ["source", "trusted_launcher_projection", "expected"])) return incomplete("ambiguous_state", ["ambiguous_state"]);
    const projection = Object.getOwnPropertyDescriptor(input, "trusted_launcher_projection");
    const expected = Object.getOwnPropertyDescriptor(input, "expected");
    if (!projection || projection.get || projection.set || !expected || expected.get || expected.set) return incomplete("malformed", ["input_malformed"]);
    return api ? api.validateReviewerActionLineage(projection.value, expected.value) : incomplete("projection_not_authenticated", ["projection_not_authenticated"]);
  } catch {
    return incomplete("malformed", ["input_malformed"]);
  }
}
export function createReviewerLineageCapability({ verifyLauncherProjection, verifyOperatorDisposition } = {}) { const api = { verifyOperatorDisposition, validateReviewerActionLineage: (p, e) => validate(p, e, verifyLauncherProjection) }; return Object.freeze({ validateReviewerActionLineage: api.validateReviewerActionLineage, buildReviewerResultEvidenceState: input => build(input, api) }); }
export const validateReviewerActionLineage = () => incomplete("projection_not_authenticated", ["projection_not_authenticated"]);
export const buildReviewerResultEvidenceState = input => build(input, null);
export const validateReviewResultLineage = validateReviewerActionLineage;
export const buildReviewResultLineage = buildReviewerResultEvidenceState;
export const reviewerResultLineageAuthorityEffects = () => REVIEW_RESULT_LINEAGE_AUTHORITY_EFFECTS;
