

export const ZOD_REQUEST_CONSTRAINT_DECLARATION_SCHEMA_VERSION =
  "zod-request-constraint-declaration.v1";

const declarations = new WeakMap();

export function declaredRequestConstraints(schema) {
  return declarations.get(schema) ?? null;
}

export function declareRequestConstraints(schema, list) {
  declarations.set(schema, Object.freeze(list.map((entry) => Object.freeze({ ...entry }))));
  return schema;
}

export function withDeclaredCrossFieldRules(objectSchema, rules) {
  const refined = objectSchema.superRefine((value, context) => {
    for (const rule of rules) rule.enforce(value, context);
  });
  return declareRequestConstraints(refined, rules.map((rule) => rule.declaration));
}

export function declaredConstraintStatement(rules) {
  return rules.map((rule) => rule.declaration.statement).join(" ");
}

const list = (fields) => fields.length < 2
  ? fields.join("")
  : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;

function objectShapeOf(schema) {
  let current = schema;
  for (let depth = 0; depth < 32 && current?._def; depth += 1) {
    const typeName = current._def.typeName;
    if (typeName === "ZodEffects") { current = current._def.schema; continue; }
    if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault") {
      current = current._def.innerType;
      continue;
    }
    break;
  }
  if (current?._def?.typeName !== "ZodObject") return null;
  const shape = current._def.shape;
  return typeof shape === "function" ? shape() : current.shape;
}

function operationFields(schema) {
  const shape = objectShapeOf(schema) ?? {};
  const required = [];
  const optional = [];
  for (const [key, value] of Object.entries(shape)) {
    (typeof value?.isOptional === "function" && value.isOptional() ? optional : required)
      .push(key);
  }
  const nested = declaredRequestConstraints(schema);
  return Object.freeze({
    required: Object.freeze(required),
    optional: Object.freeze(optional),
    ...(nested === null ? {} : { constraints: nested })
  });
}

export function exactlyOneOperation({ operations, noun = "operation" }) {
  const entries = Object.entries(operations);
  const shapes = entries.map(([name, schema]) => [name, operationFields(schema)]);
  const nestedStatements = shapes.flatMap(([name, fields]) =>
    (fields.constraints ?? []).map((constraint) => `Within ${name}: ${constraint.statement}`));
  const statement = [
    `One ${noun} per request: ${shapes.map(([name, fields]) =>
      `${name} = ${list(fields.required)}${fields.optional.length === 0
        ? "" : ` (optional ${list(fields.optional)})`}`).join("; ")}.`,
    `A request matching none of them is refused.`,
    ...nestedStatements
  ].join(" ");
  return {
    declaration: Object.freeze({
      constraint: "one_of_operations",
      operations: Object.freeze(Object.fromEntries(shapes)),
      statement
    }),
    enforce(value, context) {
      if (entries.some(([, schema]) => schema.safeParse(value).success)) return;
      context.addIssue({
        code: "custom",
        message: `request must match exactly one supported ${noun}`
      });
    }
  };
}

export function modeVariants({ field, variants, noun = field }) {
  const variantFields = [...new Set(Object.values(variants).flat())];
  const statement =
    `Exactly one ${noun} ${field}: ${Object.entries(variants)
      .map(([mode, fields]) => `${mode} requires ${list(fields)}`).join("; ")}. ` +
    `A field belonging to another ${field} is refused.`;
  return {
    declaration: Object.freeze({
      constraint: "mode_variants",
      field,
      variants: Object.freeze(Object.fromEntries(
        Object.entries(variants).map(([mode, fields]) => [mode, Object.freeze([...fields])]))),
      statement
    }),
    enforce(value, context) {
      const required = variants[value[field]];
      if (required === undefined) return;
      for (const name of required) {
        if (!Object.hasOwn(value, name) || value[name] === undefined) {
          context.addIssue({ code: "custom", path: [name],
            message: `${name} is required for ${value[field]} ${noun}` });
        }
      }
      for (const name of variantFields) {
        if (!required.includes(name) && Object.hasOwn(value, name) &&
            value[name] !== undefined) {
          context.addIssue({ code: "custom", path: [name],
            message: `${name} is not accepted for ${value[field]} ${noun}` });
        }
      }
    }
  };
}

export function requiredWithout({ field, require }) {
  const statement =
    `${list(require)} ${require.length > 1 ? "are" : "is"} required without ${field}.`;
  return {
    declaration: Object.freeze({
      constraint: "required_without", field, require: Object.freeze([...require]), statement
    }),
    enforce(value, context) {
      if (value[field] !== undefined) return;
      if (require.every((name) => value[name] !== undefined)) return;
      context.addIssue({ code: "custom", message: statement });
    }
  };
}

export function exclusiveWith({ field, others }) {
  const statement = `${field} is exclusive with ${list(others)}.`;
  return {
    declaration: Object.freeze({
      constraint: "exclusive_with", field, others: Object.freeze([...others]), statement
    }),
    enforce(value, context) {
      if (value[field] === undefined) return;
      if (!others.some((name) => value[name] !== undefined)) return;
      context.addIssue({ code: "custom", path: [field], message: statement });
    }
  };
}

export function allOrNone({ fields }) {
  const statement = `${list(fields)} must be supplied together.`;
  return {
    declaration: Object.freeze({
      constraint: "all_or_none", fields: Object.freeze([...fields]), statement
    }),
    enforce(value, context) {
      const supplied = fields.filter((name) => value[name] !== undefined);
      if (supplied.length === 0 || supplied.length === fields.length) return;
      context.addIssue({ code: "custom", message: statement });
    }
  };
}

export function requiresPath({ field, path }) {
  const statement = `${field} requires ${path.join(".")}.`;
  return {
    declaration: Object.freeze({
      constraint: "requires_path", field, path: Object.freeze([...path]), statement
    }),
    enforce(value, context) {
      if (value[field] === undefined) return;
      let current = value;
      for (const segment of path) {
        current = current === null || current === undefined ? undefined : current[segment];
      }
      if (current !== undefined) return;
      context.addIssue({ code: "custom", path: [field], message: statement });
    }
  };
}
