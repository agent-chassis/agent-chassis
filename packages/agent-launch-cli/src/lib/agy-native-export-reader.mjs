

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

const fields = new Set(["event", "conversation_id", "result", "step_update",
  "result.status", "result.error", "result.conversation_id", "result.response", "result.denied_actions",
  "step_update.conversation_id", "step_update.step_index", "step_update.step_type", "step_update.state", "step_update.tool_name",
  "step_update.error", "step_update.tool_info.name", "step_update.tool_info.error",
  "step_update.tool_info.error.type", "step_update.tool_info.error.message",
  "step_update.tool_info", "step_update.tool_info.parameters",
  "step_update.tool_info.parameters.ServerName", "step_update.tool_info.parameters.ToolName"]);

export async function* readAgyNativeExport(file) {
  const source = createReadStream(file, { highWaterMark: 64 * 1024 });
  const iterator = source[Symbol.asyncIterator]();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let chunk = "", position = 0, ended = false, parameterHash = null;
  const invalid = () => { throw Object.assign(new Error("Malformed Agy stream-json export"), { code: "agy_result_malformed" }); };
  async function peek() {
    while (position === chunk.length && !ended) {
      const next = await iterator.next();
      ended = next.done;
      chunk = decoder.decode(next.value, { stream: !ended }); position = 0;
    }
    return chunk[position];
  }
  function consume(length = 1, hash = true) {
    const text = chunk.slice(position, position + length); position += length;
    if (hash) parameterHash?.update(text);
    return text;
  }
  async function whitespace(lines = false) {
    let newlines = 0;
    while ((lines ? /^[\t\r\n ]$/ : /^[\t\r ]$/).test(await peek() ?? "")) {
      if (consume(1, false) === "\n") newlines++;
    }
    return newlines;
  }
  async function expect(character) { if (await peek() !== character) invalid(); consume(); }
  async function string(keep, presence = false) {
    await expect('"');
    let prefix = "", nonempty = false, length = 0;
    const digest = keep ? createHash("sha256") : null;
    const observe = text => {
      if (!keep) return;
      digest.update(Buffer.from(text, "utf16le")); length += text.length;
      if (prefix.length < 4096) prefix += text.slice(0, 4096 - prefix.length);
      nonempty ||= /\S/u.test(text);
    };
    while (true) {
      const next = await peek();
      if (next === undefined) invalid();
      if (next === '"') { consume(); break; }
      if (next === "\\") {
        consume();
        const escape = await peek();
        if (!escape || !'"\\/bfnrtu'.includes(escape)) invalid();
        let encoded = "\\" + consume();
        if (escape === "u") for (let index = 0; index < 4; index++) {
          if (!/^[0-9a-f]$/i.test(await peek() ?? "")) invalid();
          encoded += consume();
        }
        observe(JSON.parse('"' + encoded + '"'));
      } else {
        const span = /^[^"\\\u0000-\u001f]+/u.exec(chunk.slice(position));
        if (!span) invalid();
        observe(consume(span[0].length));
      }
    }
    if (!keep) return undefined;
    if (presence) return nonempty ? "response present" : "";
    return length > 4096 ? `${prefix} [sha256:${digest.digest("hex")}]` : prefix;
  }
  async function value(field) {
    await whitespace();
    const next = await peek();
    const hashing = field === "step_update.tool_info.parameters";
    if (hashing) parameterHash = createHash("sha256");
    let result;
    if (next === '"') result = await string(field !== null, field === "result.response");
    else if (next === "{" || next === "[") {
      const object = next === "{";
      consume(); await whitespace();
      result = object ? {} : [];
      const close = object ? "}" : "]";
      if (await peek() !== close) while (true) {
        const key = object ? await string(field !== null) : null;
        if (object) { await whitespace(); await expect(":"); }
        const child = field === null || !object ? null : field ? `${field}.${key}` : key;
        const selected = child !== null && fields.has(child);
        const item = await value(selected ? child : null);
        if (object && selected) result[key] = item;
        if (!object && field === "result.denied_actions") result[0] = true;
        await whitespace();
        if (await peek() === close) break;
        await expect(","); await whitespace();
      }
      await expect(close);
    } else if (next && "tfn".includes(next)) {
      const literal = { t: "true", f: "false", n: "null" }[next];
      for (const letter of literal) await expect(letter);
      result = JSON.parse(literal);
    } else {
      let number = "", state = "start";
      const transitions = { start: [[/-/, "sign"], [/0/, "zero"], [/[1-9]/, "integer"]],
        sign: [[/0/, "zero"], [/[1-9]/, "integer"]], zero: [[/\./, "dot"], [/[eE]/, "exponent"]],
        integer: [[/[0-9]/, "integer"], [/\./, "dot"], [/[eE]/, "exponent"]], dot: [[/[0-9]/, "fraction"]],
        fraction: [[/[0-9]/, "fraction"], [/[eE]/, "exponent"]], exponent: [[/[+-]/, "exponentSign"], [/[0-9]/, "exponentDigits"]],
        exponentSign: [[/[0-9]/, "exponentDigits"]], exponentDigits: [[/[0-9]/, "exponentDigits"]] };
      while (await peek() !== undefined) {
        const transition = transitions[state].find(([pattern]) => pattern.test(chunk[position]));
        if (!transition) break;
        state = transition[1]; const digit = consume(); if (number.length < 1024) number += digit;
      }
      if (!["zero", "integer", "fraction", "exponentDigits"].includes(state)) invalid();
      result = Number(number);
    }
    if (hashing) {
      const digest = parameterHash.digest("hex"); parameterHash = null;
      result = { ...result, native_parameters_digest: digest };
    }
    return result;
  }
  try {
    await whitespace(true);
    while (await peek() !== undefined) {
      const event = await value("");

      while (/^[\t\r ]$/.test(await peek() ?? "")) consume();
      if (await peek() !== undefined) await expect("\n");
      yield event;
      if (await whitespace(true) > 0 && await peek() !== undefined) invalid();
    }
  } finally { source.destroy(); }
}
