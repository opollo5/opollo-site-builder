---
id: ADR-0001
title: Composer state model
status: Accepted
date: 2026-05-08
deciders: Build Proposal v2
---

## Decision

The social composer uses a **named state machine** (useReducer or Zustand — implementation choice at dev time). XState is explicitly rejected (bundle cost, no prior use in codebase).

## Required states

`idle` | `editing` | `saving` | `saved` | `publishing` | `published` | `failed` | `recovering`

## Constraint

Scattered boolean flags (`isSaving`, `hasError`, `isDirty`) are forbidden. All state transitions go through the named machine.

## Rationale

Named states make impossible-state bugs compile-time detectable. A boolean flag model requires 2^N combinations to reason about; a state machine has N. The `recovering` state is load-bearing for draft conflict resolution (ADR 0002).

## Consequences

- All new composer components derive display logic from the current state name, not from boolean combinations.
- Tests assert on state transitions, not on individual flag values.
