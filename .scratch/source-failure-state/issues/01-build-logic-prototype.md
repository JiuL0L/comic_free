# Build the source-failure state prototype

Status: resolved

## Objective

Create the single-file logic prototype described in `../spec.md` and capture it on the throwaway branch `prototype/source-failure-state`.

## Acceptance

- The prototype opens directly in a browser without a server or dependency installation.
- Domain actions are driven by buttons and guided walkthroughs.
- The complete relevant state is rendered after every action.
- The reducer contains no DOM access.
- The artifact is not committed to `main`.

## Answer

The user accepted the state model on 2026-09-03: source failure changes availability without deleting Comic Free-owned state; recovery requires an explicit binding refresh; a rejected online read leaves progress unchanged; a simulated restart retains domain state; and only explicit Library Item deletion removes the item, binding, and progress.

## Prototype evidence

- Throwaway branch: `prototype/source-failure-state`
- Interactive artifact commit: `360d6a9`
- Accepted-verdict commit: `69729c5`
- Artifact on that branch: `apps/core/prototypes/source-failure-state.prototype.html`
- The HTML artifact is intentionally absent from `main`.

## Comments

- 2026-09-03: Architecture scope was confirmed and prototype work was authorized by the user.
- 2026-09-03: Chrome walkthrough and direct reducer execution validated the proposed transitions.
- 2026-09-03: User verdict: `状态模型可以`.
