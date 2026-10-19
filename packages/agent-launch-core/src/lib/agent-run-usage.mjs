

export const AGENT_RUN_USAGE_INPUT_SEMANTICS = Object.freeze(["exclusive", "inclusive"]);
export const AGENT_RUN_USAGE_COUNTER_KINDS = Object.freeze(["cumulative", "incremental"]);
export const AGENT_RUN_USAGE_DESCENDANT_COVERAGES = Object.freeze(["root_only", "inclusive", "unknown"]);
export const AGENT_RUN_USAGE_TOKEN_QUANTITIES = Object.freeze([
  "input", "cache_read", "cache_creation", "output", "reasoning_output", "total"
]);
export const AGENT_RUN_USAGE_COST_KIND = "native_estimate";

const COUNTER_SLOTS = AGENT_RUN_USAGE_TOKEN_QUANTITIES.slice(0, 5);
const VECTOR_KEYS = [...AGENT_RUN_USAGE_TOKEN_QUANTITIES, "cost"];
const OPERAND_KEYS = [...COUNTER_SLOTS, "cost"];
const IDENTITY_KEYS = ["invocation_id", "session_id", "source_id", "population_id", "interval_id"];
const STREAM_KEYS = ["session_id", "source_id", "population_id"];
const BASELINE_KEYS = [...STREAM_KEYS, "interval_id"];

const unavailable = () => ({ value: null, observed: null, status: "unavailable" });
const complete = (value) => ({ value, observed: value, status: "complete" });
const partial = (observed) =>
  observed === null ? unavailable() : { value: null, observed, status: "partial" };
const demote = (quantity) => (quantity.status === "complete" ? partial(quantity.observed) : quantity);

const isTokenCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isCostAmount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validatorFor = (key) => (key === "cost" ? isCostAmount : isTokenCount);
const nonEmpty = (value) => typeof value === "string" && value !== "";
const asArray = (value) => (Array.isArray(value) ? value : []);
const sameIdentity = (fact, identity, keys) =>
  keys.every((key) => nonEmpty(fact?.[key]) && fact[key] === identity[key]);
const identityKey = (identity) =>
  sameIdentity(identity, identity ?? {}, IDENTITY_KEYS)
    ? JSON.stringify(IDENTITY_KEYS.map((key) => identity[key]))
    : null;
const costFacts = (fact) => [fact.cost?.amount ?? null, fact.cost?.currency ?? null, fact.cost?.source ?? null];
const costPrint = (fact) => JSON.stringify(costFacts(fact));
const fingerprint = (fact) => JSON.stringify([
  ...COUNTER_SLOTS.map((slot) => fact.counters?.[slot] ?? null),
  ...costFacts(fact)
]);

const operandsOf = (key, semantics) => {
  if (key === "total") return [...operandsOf("input", semantics), "output"];
  return key === "input" && semantics === "exclusive" ? ["input", "cache_read", "cache_creation"] : [key];
};

export function sumNativeUsageValues(values) {
  const valid = isTokenCount;
  if (!Array.isArray(values) || values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    if (!valid(value)) return value ?? null;
    total += value;
    if (!valid(total)) return null;
  }
  return total;
}

function readQuantity(quantity, isValid) {
  if (quantity?.status === "complete" && isValid(quantity.value)) return complete(quantity.value);
  return partial(isValid(quantity?.observed) ? quantity.observed : null);
}

function sumQuantities(quantities, isValid) {
  let observed = null;
  let allComplete = true;
  for (const quantity of quantities) {
    if (quantity.status !== "complete") allComplete = false;
    if (quantity.observed === null) continue;
    const next = observed === null ? quantity.observed : observed + quantity.observed;
    if (!isValid(next)) return { quantity: unavailable(), overflow: true };
    observed = next;
  }
  if (quantities.length === 0) return { quantity: unavailable(), overflow: false };
  return { quantity: allComplete ? complete(observed) : partial(observed), overflow: false };
}

function normalizeTokens(semantics, counters, note) {
  const slot = {};
  const tokens = {};
  for (const name of COUNTER_SLOTS) {
    const raw = counters?.[name];
    slot[name] = isTokenCount(raw) ? raw : null;
    if (raw !== null && raw !== undefined && slot[name] === null) note("invalid_token_value", name);
    tokens[name] = slot[name] === null ? unavailable() : complete(slot[name]);
  }
  const requireSlot = (name) => {
    if (counters?.[name] === null || counters?.[name] === undefined) note("missing_category", name);
  };
  const reject = (parent, names) => {
    note("subset_exceeds_parent", parent);
    for (const name of names) tokens[name] = unavailable();
  };
  if (semantics === "exclusive") {
    const parts = ["input", "cache_read", "cache_creation"];
    parts.forEach(requireSlot);
    const sum = sumQuantities(parts.map((name) => tokens[name]), isTokenCount);
    if (sum.overflow) note("unsafe_sum", "input");
    tokens.input = sum.quantity;
  } else {
    requireSlot("input");
    const caches = ["cache_read", "cache_creation"].filter((name) => slot[name] !== null);
    const cached = caches.reduce((sum, name) => sum + slot[name], 0);
    if (slot.input !== null && cached > slot.input) reject("input", ["input", ...caches]);
  }
  requireSlot("output");
  if (slot.output !== null && slot.reasoning_output !== null && slot.reasoning_output > slot.output) {
    reject("output", ["output", "reasoning_output"]);
  }
  const total = sumQuantities([tokens.input, tokens.output], isTokenCount);
  if (total.overflow) note("unsafe_sum", "total");
  tokens.total = total.quantity;
  return tokens;
}

export function normalizeTokenUsage({ input_semantics, counters, identity = null } = {}) {
  const causes = [];
  const note = (code, quantity) => causes.push({ code, quantity, identity, detail: null });
  if (!AGENT_RUN_USAGE_INPUT_SEMANTICS.includes(input_semantics)) {
    note("invalid_source_declaration", "input_semantics");
    return { tokens: unavailableTokens(), causes };
  }
  return { tokens: normalizeTokens(input_semantics, counters, note), causes };
}

function unavailableTokens() {
  return Object.fromEntries(AGENT_RUN_USAGE_TOKEN_QUANTITIES.map((name) => [name, unavailable()]));
}

function shapeCost(amount, labels, note) {
  if (labels.size > 1) {
    note("inconsistent_cost_label", "cost");
    return { amount: unavailable(), currency: null, source: null, kind: AGENT_RUN_USAGE_COST_KIND };
  }
  const [label] = labels.values();
  return {
    amount,
    currency: label?.currency ?? null,
    source: label?.source ?? null,
    kind: AGENT_RUN_USAGE_COST_KIND
  };
}

function observe(fact, ctx, detail) {
  const vector = normalizeTokens(ctx.semantics, fact.counters, (code, quantity) => ctx.note(code, quantity, detail));
  const cost = fact.cost;
  if (cost === null || cost === undefined) {
    vector.cost = unavailable();
  } else if (!isCostAmount(cost.amount) || !nonEmpty(cost.currency) || !nonEmpty(cost.source)) {
    ctx.note("invalid_cost", "cost", detail);
    vector.cost = unavailable();
  } else {
    ctx.labels.set(JSON.stringify([cost.currency, cost.source]), cost);
    vector.cost = complete(cost.amount);
  }
  return vector;
}

function sumVectors(vectors, ctx, blocked) {
  const result = {};
  for (const key of VECTOR_KEYS) {
    const sum = sumQuantities(vectors.map((vector) => vector[key]), validatorFor(key));
    if (sum.overflow) ctx.note("unsafe_sum", key, null);
    result[key] = blocked ? demote(sum.quantity) : sum.quantity;
  }
  return result;
}

function operandValues(fact, vector) {
  const raw = { cost: vector.cost.value };
  for (const slot of COUNTER_SLOTS) raw[slot] = isTokenCount(fact.counters?.[slot]) ? fact.counters[slot] : null;
  return raw;
}

function resolveBaseline(baseline, ctx, detail, resetAllowed) {
  const zero = () => ({
    vector: Object.fromEntries(VECTOR_KEYS.map((key) => [key, complete(0)])),
    raw: Object.fromEntries(OPERAND_KEYS.map((key) => [key, 0]))
  });
  if (baseline?.kind === "fresh_session") {
    if (baseline.session_created === true && baseline.session_id === ctx.identity.session_id) return zero();
    ctx.note("unproven_fresh_session", null, detail);
  } else if (baseline?.kind === "reset" && resetAllowed) {
    if (baseline.boundary_observed === true) return zero();
    ctx.note("reset_boundary_ambiguous", null, detail);
  } else if (baseline?.kind === "snapshot") {
    if (sameIdentity(baseline, ctx.identity, BASELINE_KEYS)) {
      const vector = observe(baseline, ctx, { ...detail, baseline: true });
      return { vector, raw: operandValues(baseline, vector) };
    }
    ctx.note("baseline_identity_mismatch", null, detail);
  } else {
    ctx.note("missing_baseline", null, detail);
  }
  return null;
}

function orderSegments(stream, block) {
  if (stream.segments === null || stream.segments === undefined) {
    return [{
      segment_id: null, first_sequence: -Infinity, last_sequence: Infinity, baseline: stream.baseline, implicit: true
    }];
  }
  const segments = asArray(stream.segments).slice();
  const bounded = segments.length > 0 && segments.every((segment) =>
    Number.isSafeInteger(segment?.first_sequence) && Number.isSafeInteger(segment?.last_sequence) &&
    segment.first_sequence <= segment.last_sequence);
  if (!bounded) {
    block("reset_boundary_ambiguous", null);
    return [];
  }
  segments.sort((left, right) => left.first_sequence - right.first_sequence);
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].first_sequence <= segments[index - 1].last_sequence) {
      block("overlapping_interval", { segment_id: segments[index].segment_id ?? null });
      return [];
    }
  }
  return segments;
}

function reconcileCumulative(stream, ctx) {
  let blocked = false;
  const block = (code, detail) => {
    blocked = true;
    ctx.note(code, null, detail);
  };
  const bySequence = new Map();
  let tokensConflicted = false;
  for (const snapshot of asArray(stream.snapshots)) {
    const sequence = snapshot?.sequence;
    if (!Number.isSafeInteger(sequence)) {
      block("missing_snapshot_order", null);
    } else if (!sameIdentity(snapshot, ctx.identity, STREAM_KEYS)) {
      block("population_changed", { sequence });
    } else if (!bySequence.has(sequence)) {
      const vector = observe(snapshot, ctx, { sequence });
      bySequence.set(sequence, {
        sequence, vector, raw: operandValues(snapshot, vector),
        print: fingerprint(snapshot), costPrint: costPrint(snapshot), conflicted: false
      });
    } else if (bySequence.get(sequence).print !== fingerprint(snapshot)) {
      const prior = bySequence.get(sequence);
      if (prior.costPrint !== costPrint(snapshot)) {
        block("conflicting_snapshot", { sequence });
      } else if (!prior.conflicted) {

        tokensConflicted = true;
        ctx.note("conflicting_snapshot", null, { sequence, scope: "tokens" });
        for (const key of AGENT_RUN_USAGE_TOKEN_QUANTITIES) prior.vector[key] = unavailable();
        for (const slot of COUNTER_SLOTS) prior.raw[slot] = null;
      }
      prior.conflicted = true;
    }
  }
  const ordered = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
  const latest = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  const sessionCumulative = latest !== null && !latest.conflicted ? latest : null;
  const deltas = [];
  let index = 0;
  for (const segment of orderSegments(stream, block)) {
    const detail = { segment_id: segment.segment_id ?? null };
    const base = resolveBaseline(segment.baseline, ctx, detail, segment.implicit !== true);
    const high = { ...base?.raw };
    const rolledBack = new Set();
    let last = null;
    for (; index < ordered.length && ordered[index].sequence <= segment.last_sequence; index += 1) {
      const snapshot = ordered[index];
      if (snapshot.sequence < segment.first_sequence) {
        block("reset_boundary_ambiguous", { sequence: snapshot.sequence });
        continue;
      }
      for (const operand of OPERAND_KEYS) {
        const value = snapshot.raw[operand];
        if (value === null) continue;
        if (typeof high[operand] === "number" && value < high[operand] && !rolledBack.has(operand)) {
          rolledBack.add(operand);
          ctx.note("rollback", operand, { ...detail, sequence: snapshot.sequence });
        }
        high[operand] = value;
      }
      last = snapshot;
    }
    if (last === null) {
      block("missing_snapshot", detail);
      continue;
    }
    const delta = {};
    for (const key of VECTOR_KEYS) {
      const end = last.vector[key];
      const start = base?.vector[key];
      const rolled = operandsOf(key, ctx.semantics).some((operand) => rolledBack.has(operand));
      if (end.status !== "complete" || rolled || base === null) {
        delta[key] = unavailable();
      } else if (start.status !== "complete") {
        ctx.note("missing_baseline", key, detail);
        delta[key] = unavailable();
      } else {
        const value = end.value - start.value;
        delta[key] = validatorFor(key)(value) ? complete(value) : unavailable();
      }
    }
    deltas.push(delta);
  }
  if (index < ordered.length) block("reset_boundary_ambiguous", { sequence: ordered[index].sequence });
  const vector = blocked
    ? Object.fromEntries(VECTOR_KEYS.map((key) => [key, unavailable()]))
    : sumVectors(deltas, ctx, false);
  if (tokensConflicted) for (const key of AGENT_RUN_USAGE_TOKEN_QUANTITIES) vector[key] = unavailable();
  return { vector, sessionCumulative };
}

function reconcileIncremental(stream, ctx) {
  let blocked = false;
  const block = (code, detail) => {
    blocked = true;
    ctx.note(code, null, detail);
  };
  const byId = new Map();
  for (const event of asArray(stream.events)) {
    const eventId = event?.event_id;
    if (!nonEmpty(eventId)) {
      block("missing_event_identity", null);
    } else if (!sameIdentity(event, ctx.identity, STREAM_KEYS)) {
      block("population_changed", { event_id: eventId });
    } else if (!byId.has(eventId)) {
      byId.set(eventId, { print: fingerprint(event), vector: observe(event, ctx, { event_id: eventId }), conflicted: false });
    } else if (byId.get(eventId).print !== fingerprint(event) && !byId.get(eventId).conflicted) {
      byId.get(eventId).conflicted = true;
      block("conflicting_event", { event_id: eventId });
    }
  }
  if (asArray(stream.gaps).length > 0) block("observed_gap", { gaps: stream.gaps.length });
  if (stream.interval_complete !== true) block("interval_completion_unobserved", null);
  const vectors = [];
  for (const event of byId.values()) if (!event.conflicted) vectors.push(event.vector);
  if (vectors.length === 0) {

    const empty = (key) => (blocked || key === "cost" ? unavailable() : complete(0));
    return { vector: Object.fromEntries(VECTOR_KEYS.map((key) => [key, empty(key)])), sessionCumulative: null };
  }
  return { vector: sumVectors(vectors, ctx, blocked), sessionCumulative: null };
}

function reconcilePeakContext(requests, ctx) {
  const byId = new Map();
  const relevant = operandsOf("input", ctx.semantics);
  let sound = requests?.coverage_complete === true;
  if (!sound) ctx.note("request_coverage_incomplete", "peak_context", null);
  for (const request of asArray(requests?.observations)) {
    const requestId = request?.request_id;
    if (!nonEmpty(requestId)) {
      sound = false;
      ctx.note("missing_request_identity", "peak_context", null);
    } else if (!byId.has(requestId)) {
      const detail = { request_id: requestId };
      const tokens = normalizeTokens(ctx.semantics, request.counters, (code, quantity) => {
        if (relevant.includes(quantity)) ctx.note(code, quantity, detail);
      });
      byId.set(requestId, { print: fingerprint(request), input: tokens.input, conflicted: false });
    } else if (byId.get(requestId).print !== fingerprint(request)) {
      byId.get(requestId).conflicted = true;
      ctx.note("conflicting_request", "peak_context", { request_id: requestId });
    }
  }
  let observed = null;
  for (const { input, conflicted } of byId.values()) {
    if (conflicted || input.status !== "complete") sound = false;
    else if (observed === null || input.value > observed) observed = input.value;
  }
  return sound && observed !== null ? complete(observed) : partial(observed);
}

function shapeUsage(identity, coverage, vector, peak, labels, causes, note) {
  const tokens = {};
  for (const name of AGENT_RUN_USAGE_TOKEN_QUANTITIES) tokens[name] = vector?.[name] ?? unavailable();
  return {
    identity,
    descendant_coverage: coverage,
    tokens,
    cost: shapeCost(vector?.cost ?? unavailable(), labels, note),
    peak_context: peak,
    causes
  };
}

export function reconcileInvocationUsage(stream = {}) {
  const causes = [];
  const source = stream.source ?? {};
  const identity = identityKey(stream.identity) === null
    ? null
    : Object.fromEntries(IDENTITY_KEYS.map((key) => [key, stream.identity[key]]));
  const ctx = {
    identity,
    semantics: source.input_semantics,
    labels: new Map(),
    note: (code, quantity, detail) => causes.push({ code, quantity, identity, detail: detail ?? null })
  };
  const noteCost = (code, quantity) => ctx.note(code, quantity, null);
  let coverage = source.descendant_coverage;
  if (!AGENT_RUN_USAGE_DESCENDANT_COVERAGES.includes(coverage)) {
    ctx.note("invalid_source_declaration", "descendant_coverage", null);
    coverage = "unknown";
  }
  if (identity === null) ctx.note("missing_identity", null, null);
  if (!AGENT_RUN_USAGE_INPUT_SEMANTICS.includes(source.input_semantics)) {
    ctx.note("invalid_source_declaration", "input_semantics", null);
  }
  if (!AGENT_RUN_USAGE_COUNTER_KINDS.includes(source.counter_kind)) {
    ctx.note("invalid_source_declaration", "counter_kind", null);
  }
  if (causes.some((cause) => cause.code === "missing_identity" ||
      (cause.code === "invalid_source_declaration" && cause.quantity !== "descendant_coverage"))) {
    return { ...shapeUsage(identity, coverage, null, unavailable(), ctx.labels, causes, noteCost), session_cumulative: null };
  }
  const { vector, sessionCumulative } = source.counter_kind === "cumulative"
    ? reconcileCumulative(stream, ctx)
    : reconcileIncremental(stream, ctx);
  const peak = reconcilePeakContext(stream.requests, ctx);
  const usage = shapeUsage(identity, coverage, vector, peak, ctx.labels, causes, noteCost);
  if (sessionCumulative === null) return { ...usage, session_cumulative: null };
  const { cost, ...tokens } = sessionCumulative.vector;
  return { ...usage, session_cumulative: { sequence: sessionCumulative.sequence, tokens, cost } };
}

export function combinePopulationUsage({ root, members = [], expected_native_children = [] } = {}) {
  const causes = [];
  const identity = root?.identity ?? null;
  let blocked = false;
  const block = (code, subject, detail) => {
    blocked = true;
    causes.push({ code, quantity: null, identity: subject ?? null, detail: detail ?? null });
  };
  const noteCost = (code, quantity) => causes.push({ code, quantity, identity, detail: null });
  const coverage = AGENT_RUN_USAGE_DESCENDANT_COVERAGES.includes(root?.descendant_coverage)
    ? root.descendant_coverage
    : "unknown";
  if (identityKey(identity) === null) {
    block("missing_identity", null, null);
    return { ...shapeUsage(null, coverage, null, unavailable(), new Map(), causes, noteCost), contributors: [] };
  }
  if (coverage === "unknown") block("unknown_descendant_coverage", identity, null);

  const classify = (entry) => {
    const child = entry.usage.identity;
    const sameInvocation = child.invocation_id === identity.invocation_id;
    if (entry.relation === "managed_invocation" && !sameInvocation) return "counted";
    if (entry.relation !== "native_descendant" || !sameInvocation) {
      block("unbound_contributor", child, { relation: entry.relation ?? null });
      return "unresolved";
    }
    if (coverage === "inclusive") return "included_in_root";
    if (coverage === "unknown") return "unresolved";
    if (entry.disjoint_proven === true && entry.root_population_id === identity.population_id) return "counted";
    block("unproven_disjoint_child", child, null);
    return "unresolved";
  };
  const seen = new Map();
  const counted = [];
  const contributors = [];
  const resolvedChildren = new Set();
  for (const entry of [{ relation: "root", usage: root }, ...asArray(members)]) {
    const usage = entry?.usage;
    const key = identityKey(usage?.identity);
    if (key === null) {
      block("missing_identity", null, { relation: entry?.relation ?? null });
      continue;
    }
    const print = JSON.stringify([usage.tokens, usage.cost, usage.peak_context]);
    let disposition = "duplicate";
    if (!seen.has(key)) {
      seen.set(key, print);
      disposition = entry.relation === "root" ? "counted" : classify(entry);
      if (disposition === "counted") counted.push(usage);
      if (disposition === "counted" && entry.relation !== "root" &&
          usage.descendant_coverage !== "root_only" && usage.descendant_coverage !== "inclusive") {
        block("unknown_descendant_coverage", usage.identity, { relation: entry.relation });
      }
      if (entry.relation === "native_descendant" && disposition !== "unresolved") {
        resolvedChildren.add(usage.identity.population_id);
      }
    } else if (seen.get(key) !== print) {
      block("conflicting_contributor", usage.identity, null);
      disposition = "unresolved";
    }
    contributors.push({ identity: usage.identity, relation: entry.relation, disposition });
  }
  if (coverage === "root_only") {
    for (const populationId of asArray(expected_native_children)) {
      if (!resolvedChildren.has(populationId)) block("unresolved_expected_child", identity, { population_id: populationId });
    }
  }

  const vector = {};
  for (const key of VECTOR_KEYS) {
    const isValid = validatorFor(key);
    const sum = sumQuantities(
      counted.map((usage) => readQuantity(key === "cost" ? usage.cost?.amount : usage.tokens?.[key], isValid)),
      isValid
    );
    if (sum.overflow) causes.push({ code: "unsafe_sum", quantity: key, identity, detail: null });
    vector[key] = blocked ? demote(sum.quantity) : sum.quantity;
  }
  const labels = new Map();
  let peakObserved = null;
  let peakComplete = !blocked;
  for (const usage of counted) {
    if (nonEmpty(usage.cost?.currency) && nonEmpty(usage.cost?.source)) {
      labels.set(JSON.stringify([usage.cost.currency, usage.cost.source]), usage.cost);
    }
    const peak = readQuantity(usage.peak_context, isTokenCount);
    if (peak.status !== "complete") peakComplete = false;
    if (peak.observed !== null && (peakObserved === null || peak.observed > peakObserved)) peakObserved = peak.observed;
  }
  const peak = peakComplete ? complete(peakObserved) : partial(peakObserved);
  return { ...shapeUsage(identity, coverage, vector, peak, labels, causes, noteCost), contributors };
}
