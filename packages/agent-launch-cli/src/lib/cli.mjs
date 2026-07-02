export function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const next = argv[index + 1];
    const value =
      inlineValue !== undefined
        ? inlineValue
        : next && !next.startsWith("--")
          ? next
          : true;

    if (inlineValue === undefined && value !== true) {
      index += 1;
    }

    options[rawKey] = value;
  }

  return { positionals, options };
}

