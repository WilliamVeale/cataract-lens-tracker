# Cataract Lens Pipeline tracker: notes for Claude Code

This repo is public. Write nothing private here.

## What this is

A one-page static site that lists new cataract lenses (IOLs) and their
stage: lab, trial, or approved. The plan is `docs/spec.md`. Read the part
the task needs, not all of it.

## Status (2026-11-22)

Step 3 is done: the four build checks and the weekly refresh (PR #1).
Step 4 facts are done: 41 files in `data/lenses/`, and every refresh hit
is in a file or in `data/ignore.yaml`. All facts were read 2026-11-21
(PR #2).
Step 5 is done: the page (PR #3). `src/pages/index.astro` reads `data/`
through `scripts/lib/site.js`. Page text is in `data/site.yaml`. Rule 5
of the checks: no drug is approved to treat a cataract (openFDA drug
labels). The owner checked the layout in a browser on 2026-11-21
(`npm run dev`).
The page has two lists (2026-11-23): "In the pipeline" first, then
"Approved and available now". A lens moves to the second list when its
stage is `approved-us` and `availability` is "US now" (spec, "Two
lists").
A "Dark mode" button is at the top (2026-11-28). Without a choice, the
page follows the system setting. The choice is `data-theme` on `<html>`,
saved in `localStorage` (`src/styles/global.css` has the `dark` variant).
Online since 2026-11-22: <https://cataract-lens.pages.dev> (Cloudflare
Pages project `cataract-lens`; each push to `main` builds it again).
Next: a person writes `how_it_works`, `summary` and `trade_offs` in each
lens file, and the empty texts in `data/site.yaml` (terms, "What
surgeons use today").

How the refresh hits were sorted. Use the same rules for new hits:

- Out: plain monofocal and toric lenses. The page covers them in "What
  surgeons use today". Monofocal plus, EDOF and up are in. (Owner's
  choice, 2026-11-21.)
- Out: lenses sold only outside the US (spec, open question 3). Trial
  lenses anywhere are in.
- Out: older lenses we do not track (AcrySof IQ PanOptix, TECNIS
  Symfony, TECNIS ZMT, Trulign), phakic lenses, add-on lenses for an eye
  that already had surgery, and withdrawn trials.
- `fda` lists only an approval of a lens, a model (toric too) or a new
  name. Power ranges, packaging, injectors, shelf life, software and
  label text go in `data/ignore.yaml`.
- Stage: `pivotal` is Phase 3, or a US trial of 150 or more people that
  tests safety and effectiveness. Other trials are `early`.
- A fact from a trial record has `evidence: company`: the sponsor
  writes the record. Its source link is the study page.

## Commands

- `npm test`: unit tests. No network.
- `npm run check`: the build checks (rules 0 to 5). They ask the live APIs.
- `npm run build`: the checks, then the page into `dist/`. `npm run dev`
  serves the page while you edit; it skips the checks.
- `npm run refresh -- --report report.md`: the weekly refresh.
- Both take `--data <dir>`, to test on a copy of `data/`.

## Rules that are easy to break

- Health facts: every fact has a source with a `read` date. Do not write
  a fact from memory. The spec's "Names to check" list is not checked.
- Do not rank lenses. Do not say "best". Do not tell a reader to wait.
- A company number is a "Company claim" until a paper or a regulator
  confirms it.
- The script changes facts only (status, dates, counts). A person writes
  Summary and Trade-offs.
- `data/registry/` belongs to the refresh script. Do not edit it by hand.
- Code is MIT. Data and text in `data/` are CC BY 4.0.
