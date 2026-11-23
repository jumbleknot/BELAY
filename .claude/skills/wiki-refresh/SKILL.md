---
name: wiki-refresh
description: Refresh an openwiki/ summary page in the same PR as the change to its source. Use when you changed a file that is some openwiki page's `resource`, or when the OKF gate (V17) reports a page stale or without a fingerprint.
compatibility: Offline and free; no credential, no model call
user-invocable: true
---

# Refreshing a derived wiki page

A **derived** page under `openwiki/` summarises exactly one file, named by its `resource:` front
matter, and records that file's fingerprint in `resource-sha256:`. The OKF gate's rule **V17**
(`node scripts/check-openwiki-okf.mjs`, run by `scripts:lint` in the required `guardrails` check)
fails a PR when a recorded fingerprint no longer matches the file. The coding session that changed
the source refreshes the summary **in the same PR**. Authoritative pages (no `resource`) are
hand-maintained and V17 never checks them. Background: `openwiki/process/wiki-maintenance.md` and
`openwiki/INSTRUCTIONS.md` §7.

## When to use

- You changed a file that some page names as its `resource`. For example, an edit to
  `docs/runbooks/devcontainer.md` makes `openwiki/runbooks/devcontainer.md` stale.
- `node scripts/check-openwiki-okf.mjs` printed a `V17` line.

## Steps

1. **Find what is stale**: `node scripts/wiki-refresh.mjs --stale`.
   Each line is `<page> ← <resource>  (<reason>)`. It exits 1 when anything is listed.
2. **For each page, read the source change**: `node scripts/wiki-refresh.mjs --diff <page>`.
   This prints the diff since the page was last recorded. The `base:` line says which commit it
   diffed from.
3. **Edit only what the diff invalidates**, following `openwiki/INSTRUCTIONS.md`: what a page
   covers, its tone, its redaction rules. Do not rewrite the page or "tidy" unrelated sections.
4. **Record the fingerprint**: `node scripts/wiki-refresh.mjs --record <page>`.
   This writes `resource-sha256` and `timestamp` into the front matter and never touches the body.
5. **Commit the page in the same PR** as the source change. Then re-run `--stale`, which should
   print nothing.

## Things to know

- **A fingerprint-only refresh is correct** when the diff changes nothing the page says, for
  example a reworded sentence or a section the page does not summarise. Run `--record` with no
  body edit. That is visible in review, and it is the honest result.
- **Several pages can share one source.** `--stale` lists every page whose source changed, so refresh
  each one it names.
- **The brief is a source too.** `openwiki/quickstart.md` cites `openwiki/INSTRUCTIONS.md`, so an
  edit to the brief makes the quickstart stale.
- **Never hand-type a hash** or copy one from another page. Only `--record` writes
  `resource-sha256`, and it hashes the file as it is in your working tree (CRLF normalised to LF).
- **`resource missing`** means the source was renamed or deleted. Re-point `resource:` at the file
  that now holds the subject and then `--record`, or retire the page (and its index entry).
- **`forbidden field: sources` / `verified`**: these openwiki Claims fields are retired. `--record`
  strips them.
- **Unknown flags are rejected** (exit 2). `--help` only prints usage.
