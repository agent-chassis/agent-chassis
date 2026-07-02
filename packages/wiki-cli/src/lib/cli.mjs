export function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const optionText = token.slice(2);
    const equalsIndex = optionText.indexOf("=");
    const rawKey =
      equalsIndex === -1 ? optionText : optionText.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : optionText.slice(equalsIndex + 1);
    const next = argv[index + 1];
    const value =
      inlineValue !== undefined
        ? inlineValue
        : next && !next.startsWith("-")
          ? next
          : true;

    if (inlineValue === undefined && value !== true) {
      index += 1;
    }

    options[rawKey] = value;
  }

  return { positionals, options };
}

export function requireOption(options, key, message) {
  const value = options[key];
  if (!value || value === true) {
    throw new Error(message);
  }
  return String(value);
}

export function optionalOption(options, key) {
  const value = options[key];
  if (!value || value === true) {
    return null;
  }
  return String(value);
}

export function parseListOption(options, key) {
  const value = optionalOption(options, key);
  if (!value) {
    return [];
  }

  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function optionalListOption(options, key) {
  if (!(key in options)) {
    return null;
  }

  return parseListOption(options, key);
}
