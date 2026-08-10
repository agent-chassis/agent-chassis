const DOMAINS = Object.freeze({
  invoice: {
    required: ["id:string", "total:number"],
    optional: ["note:string"],
    forbidden: ["password:string", "total:string"],
    allowed_shapes: ["object"],
    forbidden_shapes: ["array", "scalar"],
    execute() {
      const value = { id: "inv-7", total: 42, note: "settled" };
      return Object.entries(value).map(([key, item]) =>
        `${key}:${typeof item}`);
    }
  },
  telemetry: {
    required: ["timestamp:number", "reading:number"],
    optional: ["unit:string"],
    forbidden: ["secret:string", "reading:string"],
    allowed_shapes: ["map"],
    forbidden_shapes: ["scalar", "tuple"],
    execute() {
      const value = new Map([
        ["timestamp", 1720000000],
        ["reading", 19.5]
      ]);
      return [...value].map(([key, item]) => `${key}:${typeof item}`);
    }
  },
  command: {
    required: ["index-0:string", "index-1:number"],
    optional: ["index-2:boolean"],
    forbidden: ["index-3:object", "index-1:string"],
    allowed_shapes: ["tuple"],
    forbidden_shapes: ["object", "scalar"],
    execute() {
      const value = ["deploy", 3, true];
      return value.map((item, index) => `index-${index}:${typeof item}`);
    }
  }
});

const MUTATIONS = Object.freeze({
  "missing-required"(result) {
    result.members = result.members.filter(
      (descriptor) => descriptor !== result.required[0]
    );
  },
  "extra-member"(result) {
    result.members.push("debug:boolean");
  },
  "wrong-type"(result) {
    const [name] = result.required[1].split(":");
    result.members = result.members.filter(
      (descriptor) => descriptor !== result.required[1]
    );
    result.members.push(`${name}:string`);
  },
  "forbidden-member"(result) {
    result.members.push(result.forbidden[0]);
  },
  "forbidden-shape"(result) {
    result.shape = result.forbidden_shapes[0];
  },
  "wrong-count"(result) {
    result.reported_count = Math.max(0, result.reported_count - 1);
  }
});

function executeResultShape({ domain = "invoice", mutant = null } = {}) {
  const implementation = DOMAINS[domain];
  if (!implementation) throw new Error(`unknown result-shape domain: ${domain}`);
  const members = implementation.execute();
  const result = {
    domain,
    required: [...implementation.required],
    optional: [...implementation.optional],
    allowed: [...implementation.required, ...implementation.optional],
    forbidden: [...implementation.forbidden],
    members,
    shape: implementation.allowed_shapes[0],
    allowed_shapes: [...implementation.allowed_shapes],
    forbidden_shapes: [...implementation.forbidden_shapes],
    reported_count: members.length,
    status: 200
  };
  if (mutant) {
    const mutate = MUTATIONS[mutant];
    if (!mutate) throw new Error(`unknown result-shape mutant: ${mutant}`);
    mutate(result);
  }
  return result;
}

function setContains(container, candidate) {
  const available = new Set(container);
  return candidate.every((item) => available.has(item));
}

function resultShapeGuaranteeSatisfied(result) {
  return setContains(result.members, result.required) &&
    setContains(result.allowed, result.members) &&
    !result.members.some((member) => result.forbidden.includes(member)) &&
    result.allowed_shapes.includes(result.shape) &&
    !result.forbidden_shapes.includes(result.shape) &&
    result.reported_count === result.members.length;
}

export {
  DOMAINS,
  MUTATIONS,
  executeResultShape,
  resultShapeGuaranteeSatisfied
};
