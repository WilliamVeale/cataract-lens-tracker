# Cataract Lens Pipeline tracker: notes for Claude Code

This repo is public. Write nothing private here.

## What this is

A one-page static site that lists new cataract lenses (IOLs) and their
stage: lab, trial, or approved. The plan is `docs/spec.md`. Read the part
the task needs, not all of it.

## Status (2026-11-21)

No code yet. Repo made, spec moved here from the notebook repo.
Next: spec "First steps" step 3, the refresh script and the four build
checks. Then the YAML data (step 4). The page comes last (step 5).

## Rules that are easy to break

- Health facts: every fact has a source with a `read` date. Do not write
  a fact from memory. The spec's "Names to check" list is not checked.
- Do not rank lenses. Do not say "best". Do not tell a reader to wait.
- A company number is a "Company claim" until a paper or a regulator
  confirms it.
- The script changes facts only (status, dates, counts). A person writes
  Summary and Trade-offs.
- Code is MIT. Data and text in `data/` are CC BY 4.0.
