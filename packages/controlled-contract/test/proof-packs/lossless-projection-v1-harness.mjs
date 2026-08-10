

const canonicalKey = (member) => member.key;
const keySet = (members) => new Set(members.map(canonicalKey));
const sameKeys = (left, right) => {
  const a = keySet(left);
  const b = keySet(right);
  return a.size === b.size && [...a].every((key) => b.has(key));
};

const DOMAINS = Object.freeze({
  record: {
    createSource() {
      return {
        id: { key: "id", value: "DEC-0118", heavy: false },
        summary: { key: "summary", value: "lossless reads", heavy: false },
        body: { key: "body", value: "full decision body", heavy: true }
      };
    },
    project(source) {
      const values = Object.values(source);
      return {
        compact: values.filter(({ heavy }) => !heavy),
        omitted: values.filter(({ heavy }) => heavy),
        complete: values
      };
    }
  },
  graph: {
    createSource() {
      return new Map([
        ["node", { key: "node", value: "read.mjs#getWikiRecord", heavy: false }],
        ["summary", { key: "summary", value: "record read", heavy: false }],
        ["edges", { key: "edges", value: ["calls", "returns"], heavy: true }],
        ["evidence", { key: "evidence", value: ["index", "tests"], heavy: true }]
      ]);
    },
    project(source) {
      const compact = [];
      const omitted = [];
      for (const member of source.values()) (member.heavy ? omitted : compact).push(member);
      return { compact, omitted, complete: [...source.values()] };
    }
  },
  artifact: {
    createSource() {
      return [
        { key: "name", value: "run-17", heavy: false },
        { key: "status", value: "complete", heavy: false },
        { key: "manifest", value: { files: 120 }, heavy: true },
        { key: "logs", value: ["line-1", "line-2"], heavy: true },
        { key: "trace", value: { spans: 400 }, heavy: true }
      ];
    },
    project(source) {
      return source.reduce((result, member) => {
        result[member.heavy ? "omitted" : "compact"].push(member);
        result.complete.push(member);
        return result;
      }, { compact: [], omitted: [], complete: [] });
    }
  },
  archive: {
    createSource() {
      return new Set([
        { key: "payload", value: "large-payload", heavy: true },
        { key: "trace", value: "large-trace", heavy: true }
      ]);
    },
    project(source) {
      const complete = [...source];
      return { compact: [], omitted: [...complete], complete };
    }
  }
});

const MUTATIONS = Object.freeze({
  "drop-from-complete"(result) {
    result.complete = result.complete.filter(({ heavy }) => !heavy);
  },
  "silent-compact-loss"(result) {
    result.compact = result.compact.slice(1);
  },
  "drop-disclosure"(result) {
    result.disclosed = result.disclosed.slice(1);
  },
  "undercount-total"(result) {
    result.reported_total -= 1;
  },
  "undercount-omissions"(result) {
    result.reported_omissions = Math.max(0, result.reported_omissions - 1);
  },
  "break-recovery-route"(result) {
    result.recovery_path_operable = false;
  },
  "reason-outside-catalog"(result) {
    result.omission_reason = "arbitrary-truncation";
  },
  "omit-no-heavy-member"(result) {
    result.compact = [...result.source];
    result.omitted = [];
    result.disclosed = [];
    result.accounted = [...result.source];
    result.reported_omissions = 0;
  }
});

function executeProjection({ domain = "record", mutant = null } = {}) {
  const implementation = DOMAINS[domain];
  if (!implementation) throw new Error(`unknown projection domain: ${domain}`);
  const stored = implementation.createSource();
  const projected = implementation.project(stored);
  const source = [...projected.complete];
  const result = {
    domain,
    source,
    compact: [...projected.compact],
    omitted: [...projected.omitted],
    complete: [...projected.complete],
    disclosed: [...projected.omitted],
    accounted: [...projected.compact, ...projected.omitted],
    allowed_reasons: ["heavy-projection", "sensitive-redaction"],
    omission_reason: "heavy-projection",
    reported_total: source.length,
    reported_omissions: projected.omitted.length,
    recovery_path_operable: true,
    compact_status: 200
  };
  if (mutant) {
    const mutate = MUTATIONS[mutant];
    if (!mutate) throw new Error(`unknown projection mutant: ${mutant}`);
    mutate(result);
    if (mutant === "silent-compact-loss") {
      result.accounted = [...result.compact, ...result.omitted];
    }
  }
  return result;
}

function projectionGuaranteeSatisfied(result) {
  return result.omitted.length > 0 &&
    result.omitted.every(({ heavy }) => heavy) &&
    result.recovery_path_operable &&
    sameKeys(result.accounted, result.source) &&
    sameKeys(result.complete, result.source) &&
    sameKeys(result.disclosed, result.omitted) &&
    result.reported_total === result.source.length &&
    result.reported_omissions === result.omitted.length &&
    result.allowed_reasons.includes(result.omission_reason);
}

export {
  DOMAINS,
  MUTATIONS,
  executeProjection,
  projectionGuaranteeSatisfied,
  sameKeys
};
