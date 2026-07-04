# Domain Docs

This is a single-context repo.

## Before exploring, read these

- `CONTEXT.md` at the repo root, if it exists.
- ADRs under `docs/adr/`, if relevant to the area being changed.

If these files do not exist, proceed silently. The `/domain-modeling` skill creates them lazily when terms or decisions are resolved.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, PRD, test name, hypothesis, or architecture note, use the term as defined in `CONTEXT.md`.

If the concept needed for the work is not in the glossary yet, either reconsider whether the term belongs to the project language or note it for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
