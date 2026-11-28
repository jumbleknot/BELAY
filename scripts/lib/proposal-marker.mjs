// The proposal a spec came from (features 014 and 016): the `Proposal #<n>` on its **Input** line, the pick-up
// convention both routes write (forgejo-issues skill; spec FR-003). Shared by feature-merged.mjs and backlog.mjs
// record-tests. Only the Input line counts: a number mentioned anywhere else in the spec is not its source.

/** The distinct proposal numbers on a spec's **Input** line, in order. */
export function findProposalNumbers(specText) {
  const line = String(specText ?? '').split(/\r?\n/).find((l) => /^\s*\*\*Input\*\*:/.test(l)) ?? '';
  return [...new Set([...line.matchAll(/Proposal #(\d+)/g)].map((m) => Number(m[1])))];
}
