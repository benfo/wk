---
id: bj2h
kind: decision
created: 2026-11-19
updated: 2026-11-19
was: D-001
---
# Build v2 in src/v2 beside v1; swap and delete v1 at migration

## Why

Keeps the linked wk binary and v1 tests working while v2 is half built.
Each v2 task stays testable on its own.

## Rejected

Rewriting v1 in place on the v2 branch
