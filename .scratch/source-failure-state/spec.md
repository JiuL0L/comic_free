# Source failure state prototype

Status: confirmed scope

## Question

When a Source Plugin is installed, disabled, removed, restored, or unable to reach its Comic Provider, does the proposed state model preserve the Library Item, Last Known Snapshot, Source Binding, and Reading Progress while still preventing provider-dependent actions that cannot succeed?

## Prototype shape

- One self-contained HTML file that opens without installing dependencies.
- A pure reducer owns the state transitions; the page only dispatches actions and renders state.
- Free-play actions plus guided happy-path, disabled-source, provider-failure, and illegal-action walkthroughs.
- Full relevant state and the latest decision are visible after every action.

## Success criteria

- Disabling, removing, or losing a source never deletes local library identity, snapshot, binding, or reading progress.
- Provider-dependent reading is rejected while a binding is unavailable.
- Restoring a compatible source makes the binding refreshable without silently overwriting local state.
- Explicit deletion of a Library Item is distinguishable from source failure.
- A simulated restart retains durable domain state and clears only transient feedback.

## Non-goals

- Real SQLite persistence.
- Real Suwayomi or Mihon extension execution.
- REST or GraphQL integration.
- Production UI design.

## Capture

- Throwaway branch: `prototype/source-failure-state`
- Prototype artifact: `apps/core/prototypes/source-failure-state.prototype.html`
