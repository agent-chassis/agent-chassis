

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean", "null"]);
const isScalarValue = value => value === null || ["string", "number", "boolean"].includes(typeof value);

const SCALAR_KEYWORDS = new Set(["type", "enum", "const", "pattern", "format", "minLength", "maxLength", "minimum",
  "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "description", "title"]);

export function isScalarMemberDeclaration(node) {
  if (!isObject(node) || !Object.keys(node).every(keyword => SCALAR_KEYWORDS.has(keyword))) return false;
  const types = node.type === undefined ? [] : Array.isArray(node.type) ? node.type : [node.type];
  if (!types.every(type => SCALAR_TYPES.has(type))) return false;
  if (node.enum !== undefined && !(Array.isArray(node.enum) && node.enum.every(isScalarValue))) return false;
  if (node.const !== undefined && !isScalarValue(node.const)) return false;

  return types.length > 0 || node.enum !== undefined || node.const !== undefined;
}

const isSelfContainedConstraint = (keyword, value) => !keyword.startsWith("$") &&
  (isScalarValue(value) || (Array.isArray(value) && value.every(isScalarValue)));

export function compactInputSchemaAdvertisement(schema) {
  if (!isObject(schema) || !isObject(schema.properties)) {
    throw new TypeError("a compact advertisement projects a JSON Schema object with declared members");
  }
  return {
    ...Object.fromEntries(Object.entries(schema).filter(([keyword, value]) =>
      keyword !== "properties" && isSelfContainedConstraint(keyword, value))),
    properties: Object.fromEntries(Object.entries(schema.properties).map(([member, node]) => [member,
      isScalarMemberDeclaration(node) ? node
        : isObject(node) && typeof node.description === "string" ? { description: node.description } : {}]))
  };
}
