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

export async function readBoundedJsonStdin(stream = process.stdin) {
  const maximum = 256 * 1024;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    bytes += buffer.length;
    if (bytes > maximum) {
      const { FeedbackError } = await import('@agent-chassis/wiki-core/src/lib/agent-feedback-schema.mjs');
      throw new FeedbackError('feedback_stdin_too_large', `Raw stdin exceeds ${maximum} UTF-8 bytes; minify the same lossless JSON`, { maximum_bytes: maximum });
    }
    chunks.push(buffer);
  }
  const { feedbackInvalid } = await import('@agent-chassis/wiki-core/src/lib/agent-feedback-schema.mjs');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text);
  } catch (cause) { throw feedbackInvalid(`stdin must contain valid UTF-8 JSON: ${cause.message}`); }
}
