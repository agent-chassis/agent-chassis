

export function nativeTestEvidence(text) {
  const tokens = text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/(?:\\[^\n]|[^/\\\n])+\/[a-z]*|[A-Za-z_$][\w$]*|[^\s]/gu) ?? [];
  const code = tokens.filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
  const literal = (token, value) => token === JSON.stringify(value) || token === `'${value}'`;
  let node = false;
  let deno = false;
  for (let index = 0; index < code.length; index += 1) {
    const token = code[index];
    if (literal(token, "node:test")) {
      node ||= code[index - 1] === "from" || code[index - 1] === "import" ||
        (code[index - 1] === "(" && ["require", "import"].includes(code[index - 2]));
    }
    deno ||= token === "Deno" && code[index + 1] === "." && code[index + 2] === "test" &&
      code[index + 3] === "(";

    deno ||= code[index - 1] === "from" && ["jsr:@std/testing/bdd", "@std/testing/bdd"]
      .some((specifier) => literal(token, specifier));
  }
  return { node, deno };
}
