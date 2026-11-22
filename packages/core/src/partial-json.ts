/** Returned by the parsing steps when a value has not fully arrived yet. */
const INCOMPLETE = Symbol("incomplete");

/** Nesting deeper than this is treated as malformed input. */
const MAX_DEPTH = 32;

const LITERALS: [string, unknown][] = [
  ["true", true],
  ["false", false],
  ["null", null],
];

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Reads as much of a JSON document as has arrived so far.
 *
 * A model streams its JSON answer in pieces. This returns the value those
 * pieces describe up to now, so a UI can show an answer while it is still
 * being written:
 *
 * - A string that is still open is returned with the text it has so far.
 * - An object or array that is still open is returned with the members that
 *   are complete, plus the last one if it is itself a partial string, object,
 *   or array.
 * - A key without a value, and a number or literal cut off by the end of the
 *   input, are left out until they are complete.
 *
 * Anything before the first `{` or `[` is skipped, which covers a Markdown
 * code fence around the document. Returns `undefined` when there is no object
 * or array at all.
 */
export function parsePartialJson(text: string): unknown {
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;

  let pos = start;
  const atEnd = () => pos >= text.length;
  /** Stops reading: everything after malformed input is ignored. */
  const giveUp = () => {
    pos = text.length;
  };

  function skipWhitespace(): void {
    while (!atEnd() && /\s/.test(text.charAt(pos))) pos += 1;
  }

  function parseValue(depth: number): unknown {
    if (depth > MAX_DEPTH) {
      giveUp();
      return INCOMPLETE;
    }
    const char = text.charAt(pos);
    if (char === "{") return parseObject(depth);
    if (char === "[") return parseArray(depth);
    if (char === '"') return parseString().value;
    if (char === "-" || (char >= "0" && char <= "9")) return parseNumber();
    return parseLiteral();
  }

  function parseObject(depth: number): Record<string, unknown> {
    const object: Record<string, unknown> = {};
    pos += 1;
    while (true) {
      skipWhitespace();
      if (atEnd()) return object;
      if (text.charAt(pos) === "}") {
        pos += 1;
        return object;
      }
      if (text.charAt(pos) !== '"') {
        giveUp();
        return object;
      }

      const key = parseString();
      skipWhitespace();
      if (!key.complete || text.charAt(pos) !== ":") {
        if (!atEnd()) giveUp();
        return object;
      }
      pos += 1;
      skipWhitespace();
      if (atEnd()) return object;

      const value = parseValue(depth + 1);
      if (value === INCOMPLETE) return object;
      // Defined rather than assigned, so a "__proto__" key stays plain data.
      Object.defineProperty(object, key.value, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });

      skipWhitespace();
      if (text.charAt(pos) === ",") {
        pos += 1;
      } else if (text.charAt(pos) !== "}") {
        if (!atEnd()) giveUp();
        return object;
      }
    }
  }

  function parseArray(depth: number): unknown[] {
    const array: unknown[] = [];
    pos += 1;
    while (true) {
      skipWhitespace();
      if (atEnd()) return array;
      if (text.charAt(pos) === "]") {
        pos += 1;
        return array;
      }

      const value = parseValue(depth + 1);
      if (value === INCOMPLETE) return array;
      array.push(value);

      skipWhitespace();
      if (text.charAt(pos) === ",") {
        pos += 1;
      } else if (text.charAt(pos) !== "]") {
        if (!atEnd()) giveUp();
        return array;
      }
    }
  }

  /** Reads a string. `complete` is false when the closing quote has not arrived. */
  function parseString(): { value: string; complete: boolean } {
    let value = "";
    pos += 1;
    while (!atEnd()) {
      const char = text.charAt(pos);
      if (char === '"') {
        pos += 1;
        return { value, complete: true };
      }
      if (char !== "\\") {
        value += char;
        pos += 1;
        continue;
      }

      const code = text.charAt(pos + 1);
      if (code === "u") {
        const hex = text.slice(pos + 2, pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          // Cut off in the middle of the escape, or malformed.
          if (pos + 6 <= text.length) giveUp();
          break;
        }
        value += String.fromCharCode(Number.parseInt(hex, 16));
        pos += 6;
      } else if (code in ESCAPES) {
        value += ESCAPES[code];
        pos += 2;
      } else {
        if (code !== "") giveUp();
        break;
      }
    }
    pos = text.length;
    return { value: withoutDanglingSurrogate(value), complete: false };
  }

  function parseNumber(): unknown {
    const token = /^[-+.\deE]+/.exec(text.slice(pos))?.[0] ?? "";
    pos += token.length;
    // At the end of the input more of the number may still be coming.
    if (atEnd()) return INCOMPLETE;
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) {
      giveUp();
      return INCOMPLETE;
    }
    return Number(token);
  }

  function parseLiteral(): unknown {
    const rest = text.slice(pos);
    for (const [word, value] of LITERALS) {
      if (rest.startsWith(word)) {
        pos += word.length;
        return value;
      }
    }
    giveUp();
    return INCOMPLETE;
  }

  return parseValue(0);
}

/** Drops the first half of a surrogate pair whose second half has not arrived. */
function withoutDanglingSurrogate(value: string): string {
  const last = value.charCodeAt(value.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? value.slice(0, -1) : value;
}
