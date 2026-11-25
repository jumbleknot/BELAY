# Contract: proposal body, labels and the form

**Normative**, shared with every target repository (spec FR-005 to FR-011, MCM PRD §4). The master files live in
`mcp-servers/pdlc/contract/`:

| File | Is |
| --- | --- |
| `proposal.yaml` | The master issue form. Each target carries a byte-identical copy at `.forgejo/issue_template/proposal.yaml` |
| `proposal-labels.json` | `[{name, color, description}]` for the labels in [data-model.md](../data-model.md#proposal-labels-contractproposal-labelsjson) |

The master form is the one in `docs/proposals/claude-desktop-proposal-intake/proposal.yaml`, unchanged. Its field
labels **are** the headings below, and a test fails if they disagree.

## Body format

The forge renders a submitted form as one `### <label>` block per field, in form order, and an empty field as
`_No response_`. The server writes exactly that:

```text
### Proposed feature name

<feature_name>

### Problem

<problem>

### Proposed value

<proposed_value>

### Personas involved

<personas>

### Goals and success definition

<goals_success>

### Rough scope

<rough_scope>

### Open questions

<open_questions or _No response_>

### Out of scope

<out_of_scope or _No response_>

### Priority

<p1|p2|p3>
```

| Section id | Heading |
| --- | --- |
| `feature_name` | Proposed feature name |
| `problem` | Problem |
| `proposed_value` | Proposed value |
| `personas` | Personas involved |
| `goals_success` | Goals and success definition |
| `rough_scope` | Rough scope |
| `open_questions` | Open questions |
| `out_of_scope` | Out of scope |
| `priority` | Priority |

## Parsing rules

1. Scan line by line. A line equal to `### <H>` (trailing spaces trimmed) starts a section **only if** `<H>` is the
   next heading not yet seen, in the order above. Otherwise the line is content. *Clarified during implementation
   (2026-11-25):* a later heading may skip ahead only when every heading it skips is absent from the rest of the
   body. A deleted heading therefore does not swallow every section after it (rule 3: "neither is fatal"), while a
   user's own `### …` line, or a known heading typed out of place, stays content.
2. Section content is the text between its heading and the next recognised heading, with surrounding blank lines
   trimmed. `_No response_` reads back as the empty string.
3. Text before the first recognised heading produces the warning `text before first section`. A heading that never
   appears produces `missing section: <H>`. Neither is fatal.
4. Round trip: for every input, `parse(render(sections)).sections` deep-equals `sections`, with empties normalised to
   `""`. The unit tests check this, alongside a fixture captured from a real web-form submission.

## Labels and states

| State | Labels | Issue state |
| --- | --- | --- |
| Draft | `type/proposal` + `status/proposal-draft` + one `priority/*` | open |
| Ready | `type/proposal` + `status/needs-spec` + one `priority/*` | open |
| Superseded by a spec | unchanged | closed, with a comment linking `specs/NNN-*/` |

The title is `Proposal: <feature name>`.

## Copies and compatibility

- A target repository's form copy is **byte-identical** to the master, after normalising CRLF to LF. `check_setup`
  reports `out_of_step` otherwise.
- **Changing a heading or a section id is breaking** for the server, the skill and every target copy. Adding an
  optional section at the end is additive, but still needs the server, the skill and the copies updated in step.
