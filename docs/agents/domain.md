# Domain Docs

This repository uses a single-context domain documentation layout.

## Before exploring

Read:

- `CONTEXT.md`
- Relevant ADRs under `docs/adr/`

If these files do not exist, proceed silently. They are created lazily by the domain-modeling workflow.

## Layout

```text
/
├── CONTEXT.md
└── docs/
    └── adr/
```

## Rules

- Use terminology defined in `CONTEXT.md`.
- Do not invent synonyms for established domain concepts.
- Flag work that contradicts an existing ADR.
- Create glossary entries and ADRs only when real decisions are settled.
