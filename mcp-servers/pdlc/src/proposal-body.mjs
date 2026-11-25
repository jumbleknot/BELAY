// The proposal body, exactly as the forge renders the proposal form (contracts/proposal-body.md; spec
// FR-010, FR-011). A session-filed proposal and a web-form one are the same text, so both parse alike.
//
// The headings ARE the master form's field labels (contract/proposal.yaml); a test fails if they
// disagree. Changing one is a breaking change for every target repository's form copy.
import { SECTION_IDS } from './tool-contract.mjs';

const HEADING_OF = {
  feature_name: 'Proposed feature name',
  problem: 'Problem',
  proposed_value: 'Proposed value',
  personas: 'Personas involved',
  goals_success: 'Goals and success definition',
  rough_scope: 'Rough scope',
  open_questions: 'Open questions',
  out_of_scope: 'Out of scope',
  priority: 'Priority',
};

export const SECTIONS = Object.freeze(SECTION_IDS.map((id) => Object.freeze({ id, heading: HEADING_OF[id] })));
export const HEADINGS = Object.freeze(SECTIONS.map((s) => s.heading));

/** What the forge writes for an empty form field. */
export const NO_RESPONSE = '_No response_';

const trimBlankLines = (s) => String(s ?? '').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '').replace(/^[ \t]+$/, '');

/** @param {Record<string, string|undefined>} sections */
export function renderBody(sections) {
  return SECTIONS.map(({ id, heading }) => {
    const content = trimBlankLines(sections[id]);
    return `### ${heading}\n\n${content === '' ? NO_RESPONSE : content}\n\n`;
  }).join('');
}

/**
 * Rule 1: a `### <H>` line starts a section only when <H> is the next heading still to come. Usually that
 * is the very next one in order. A later heading may skip ahead only when every heading it skips is
 * absent from the rest of the body, so a deleted heading does not swallow the sections after it, while a
 * user's own `### …` line inside a textarea (or a known heading typed out of place) stays content.
 * Nothing is dropped silently: text before the first section and headings that never appear are
 * returned as warnings.
 * @returns {{sections: Record<string, string>, warnings: string[]}}
 */
export function parseBody(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const headingAt = lines.map((line) => {
    const t = line.replace(/[ \t]+$/, '');
    return t.startsWith('### ') ? HEADINGS.indexOf(t.slice(4)) : -1;
  });
  // lastSeen[k] = the last line index holding heading k, so "does heading k appear after line i" is O(1).
  const lastSeen = HEADINGS.map(() => -1);
  headingAt.forEach((k, i) => { if (k >= 0) lastSeen[k] = i; });

  const collected = Object.fromEntries(SECTION_IDS.map((id) => [id, null]));
  const warnings = [];
  let current = -1;
  let buffer = [];
  const preamble = [];
  const flush = () => { if (current >= 0) collected[SECTIONS[current].id] = buffer.join('\n'); buffer = []; };

  lines.forEach((line, i) => {
    const k = headingAt[i];
    const skipsOnlyAbsent = (from, to) => { for (let j = from; j < to; j++) if (lastSeen[j] > i) return false; return true; };
    if (k > current && skipsOnlyAbsent(current + 1, k)) {
      flush();
      current = k;
      return;
    }
    (current < 0 ? preamble : buffer).push(line);
  });
  flush();

  if (preamble.some((l) => l.trim() !== '')) warnings.push('text before first section');
  const sections = {};
  for (const { id, heading } of SECTIONS) {
    if (collected[id] === null) warnings.push(`missing section: ${heading}`);
    const content = trimBlankLines(collected[id]);
    sections[id] = content === NO_RESPONSE ? '' : content;
  }
  return { sections, warnings };
}
