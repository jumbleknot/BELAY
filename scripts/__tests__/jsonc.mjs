// Minimal JSONC reader for the dev-container guard tests.
//
// NOT named `*.test.mjs`: `node --test scripts/__tests__/*.test.mjs` would collect it.
//
// devcontainer.json is JSON with comments. Stripping comments with a regex is the trap this helper
// exists to avoid: `//` also occurs INSIDE strings (`unix:///var/run/docker-host.sock`,
// `https://github.com/...`), and a naive `//.*$` turns those values into truncated ones, so a guard
// that "parses fine" asserts against a value the file never contained. This walks the text and
// only treats `//` and `/* */` as comments outside a string literal. Trailing commas, which JSONC
// also allows, are removed the same way.

import { readFileSync } from 'node:fs';

export function stripJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  // Trailing commas before } or ], outside strings (strings no longer contain comments, and a
  // `,\s*}` sequence cannot occur inside a JSON string without quotes around it).
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function readJsonc(path) {
  return JSON.parse(stripJsonc(readFileSync(path, 'utf8')));
}
