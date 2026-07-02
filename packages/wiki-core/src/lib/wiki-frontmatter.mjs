

export function extractFrontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return null;
  }
  return parseYamlLike(match[1].split("\n"));
}

export function extractMarkdownBody(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return markdown;
  }
  return markdown.slice(match[0].length);
}

function parseYamlLike(lines, startIndex = 0, indent = 0) {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndent(line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      index += 1;
      continue;
    }

    const content = line.trim();
    const separator = content.indexOf(":");
    if (separator === -1) {
      index += 1;
      continue;
    }

    const key = content.slice(0, separator).trim();
    const rawValue = content.slice(separator + 1).trim();

    if (rawValue) {
      result[key] = parseScalar(rawValue);
      index += 1;
      continue;
    }

    const { value, nextIndex } = parseNestedValue(lines, index + 1, indent + 2);
    result[key] = value;
    index = nextIndex;
  }

  return result;
}

function parseNestedValue(lines, startIndex, indent) {
  let index = startIndex;
  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }

  if (index >= lines.length || countIndent(lines[index]) < indent) {
    return { value: null, nextIndex: index };
  }

  const first = lines[index].trim();
  if (first.startsWith("- ")) {
    return parseListValue(lines, index, indent);
  }

  return parseObjectValue(lines, index, indent);
}

function parseListValue(lines, startIndex, indent) {
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndent(line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      index += 1;
      continue;
    }

    const content = line.trim();
    if (!content.startsWith("- ")) {
      break;
    }

    const itemContent = content.slice(2).trim();
    index += 1;

    if (!itemContent) {
      const nested = parseNestedValue(lines, index, indent + 2);
      items.push(nested.value);
      index = nested.nextIndex;
      continue;
    }

    if (looksLikeKeyValue(itemContent)) {
      const parsed = parseInlineObjectItem(lines, itemContent, index, indent + 2);
      items.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }

    items.push(parseScalar(itemContent));
  }

  return { value: items, nextIndex: index };
}

function parseInlineObjectItem(lines, firstContent, startIndex, indent) {
  const value = {};
  let index = assignKeyValue(value, firstContent, lines, startIndex, indent);

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const currentIndent = countIndent(line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      index += 1;
      continue;
    }

    const content = line.trim();
    if (!looksLikeKeyValue(content)) {
      break;
    }

    index = assignKeyValue(value, content, lines, index + 1, indent + 2);
  }

  return { value, nextIndex: index };
}

function parseObjectValue(lines, startIndex, indent) {
  const value = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const currentIndent = countIndent(line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      index += 1;
      continue;
    }

    const content = line.trim();
    if (!looksLikeKeyValue(content)) {
      index += 1;
      continue;
    }
    index = assignKeyValue(value, content, lines, index + 1, indent + 2);
  }

  return { value, nextIndex: index };
}

function parseScalar(value) {
  if (
    value.startsWith("[") &&
    value.endsWith("]") &&
    value.length > 2
  ) {
    return value
      .slice(1, -1)
      .split(",")
      .map((entry) => parseScalar(entry.trim()))
      .filter((entry) => entry !== "");
  }
  if (value === "[]") {
    return [];
  }
  if (value === "{}") {
    return {};
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function countIndent(line) {
  return line.length - line.trimStart().length;
}

function looksLikeKeyValue(content) {
  return /^[A-Za-z0-9_-]+:\s*(.*)$/.test(content);
}

function splitKeyValue(content) {
  const separator = content.indexOf(":");
  return {
    key: content.slice(0, separator).trim(),
    rawValue: content.slice(separator + 1).trim()
  };
}

function assignKeyValue(target, content, lines, nextIndex, nestedIndent) {
  const { key, rawValue } = splitKeyValue(content);
  if (rawValue) {
    target[key] = parseScalar(rawValue);
    return nextIndex;
  }

  const nested = parseNestedValue(lines, nextIndex, nestedIndent);
  target[key] = nested.value;
  return nested.nextIndex;
}
