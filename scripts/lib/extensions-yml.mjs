// Dependency-free reader for the `.specify/extensions.yml` layout that Spec Kit generates
// (`specify extension add`). It is not a general YAML parser: it accepts exactly that layout —
//
//   installed:            top-level keys at indent 0
//   - git                 installed ids as `- <id>` items
//   settings:             skipped
//     auto_execute_hooks: true
//   hooks:
//     before_specify:     one key per hook event at indent 2
//     - extension: git    one `- key: value` map per hook at indent 2 …
//       command: …        … with its remaining fields at indent 4
//
// and throws `extensions.yml:<line>: …` on anything else, so a layout change in a future Spec Kit
// fails the gate loudly instead of being misread. BELAY has no package.json, hence no `yaml`.

const scalar = (raw) => {
  const v = raw.trim();
  const q = v.match(/^(['"])(.*)\1$/);
  const s = q ? q[2] : v;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  return s;
};

// Fields are kept raw while a hook is open, so a wrapped value can be re-joined before conversion.
const finish = (raw) => {
  const item = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, scalar(v)]));
  return {
    extension: String(item.extension ?? ''),
    command: String(item.command ?? ''),
    // Spec Kit treats a hook without `enabled` as enabled.
    enabled: item.enabled === undefined || item.enabled === null ? true : item.enabled === true,
    optional: item.optional === true,
  };
};

/**
 * @param {string} text
 * @returns {{ installed: string[], hooks: Record<string, Array<{extension: string, command: string, enabled: boolean, optional: boolean}>> }}
 */
export function parseExtensionsYml(text) {
  const installed = [];
  const hooks = {};
  let section = null;
  let event = null;
  let item = null;
  let lastField = null;
  const fail = (n, why) => {
    throw new Error(`extensions.yml:${n}: ${why}`);
  };
  const flush = () => {
    if (item) hooks[event].push(finish(item));
    item = null;
  };

  text.split('\n').forEach((rawLine, i) => {
    const n = i + 1;
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();

    if (indent === 0 && !body.startsWith('- ')) {
      flush();
      const m = body.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) fail(n, `expected a top-level key, got "${body}"`);
      section = m[1];
      event = null;
      if (m[2] && m[2] !== '[]' && m[2] !== '{}') fail(n, `unexpected inline value for "${section}"`);
      return;
    }

    if (section === 'installed') {
      const m = body.match(/^-\s+(.+)$/);
      if (!m || indent > 2) fail(n, `expected an installed id item, got "${body}"`);
      installed.push(String(scalar(m[1])));
      return;
    }

    if (section === 'hooks') {
      if (indent === 2 && !body.startsWith('-')) {
        flush();
        const m = body.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!m) fail(n, `expected a hook event key, got "${body}"`);
        event = m[1];
        hooks[event] = [];
        if (m[2] && m[2] !== '[]') fail(n, `unexpected inline value for hook event "${event}"`);
        return;
      }
      const field = (s) => {
        const m = s.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!m) fail(n, `expected "key: value", got "${s}"`);
        item[m[1]] = m[2];
        lastField = m[1];
      };
      if (indent === 2 && body.startsWith('- ')) {
        if (!event) fail(n, 'hook item before any hook event');
        flush();
        item = {};
        field(body.slice(2).trim());
        return;
      }
      if (indent === 4 && item) {
        field(body);
        return;
      }
      // yaml.dump wraps a long plain scalar onto lines indented under its field: fold it back in.
      if (indent > 4 && item && lastField) {
        item[lastField] = `${item[lastField]} ${body}`;
        return;
      }
      fail(n, `unexpected line in hooks: "${body}"`);
    }

    // settings and any other top-level section: plain `key: value` lines are skipped, but a list
    // item there would mean a hook was misplaced.
    if (body.startsWith('- ')) fail(n, `list item outside hooks/installed: "${body}"`);
  });
  flush();
  return { installed, hooks };
}
