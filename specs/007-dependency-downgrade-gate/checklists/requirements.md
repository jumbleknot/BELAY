# Specification Quality Checklist: SAST dependency-downgrade gate

**Created**: 2026-11-23 · **Feature**: [spec.md](../spec.md)

- [x] No implementation details beyond the user-facing surfaces (the scanner report and allowlist are
  feature 006's existing surfaces)
- [x] Requirements testable; success criteria measurable
- [x] No [NEEDS CLARIFICATION] markers (decisions recorded under Clarifications, from item #43)
- [x] Scope bounded: pnpm lockfiles only; Cargo and uv lockfiles out of scope
- [x] Baseline stated: MCM `fc2b953`, `scripts/check-dependency-downgrade.mjs`
