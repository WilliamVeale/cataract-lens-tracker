# Spec: Cataract Lens Pipeline tracker

Status: draft spec. No site is built. Written 2026-11-19. Moved to this
repo on 2026-11-21.

## The short version

Build one free web page that lists every new cataract replacement lens.
A replacement lens is an IOL (intraocular lens): the plastic lens a
surgeon puts in the eye after the cloudy lens comes out.

The page copies the idea of <https://hairloss.pages.dev>: one table, one
row for each product, a stage badge, and a detail panel with sources.
"No blogspam, just data."

The data is the hard part, not the page. Two free public registries give
most of it. A script reads them. A person checks every change before it
goes live.

This project has its own repo (this one, made 2026-11-21) and its own
agent box.

## Who it is for

- A person who will have cataract surgery and asks "which lens?" or
  "should I wait for a better one?".
- A person who wants to know if drops can replace surgery.
- Not surgeons. They have trade press.

## What the model site does

Read on 2026-11-19 from <https://hairloss.pages.dev>.

- One page. Title, one-line tagline, "Last updated" date.
- A count for each stage: Approved, Phase 3, Phase 2, Phase 1,
  Preclinical.
- Two filter buttons (AA and AGA, the two kinds of hair loss).
- One table. Columns: Compound, Company, Phase, Type, Est. Release,
  Status.
- Click a row to open a panel: Mechanism, Summary, Latest (dated news),
  a ClinicalTrials.gov link, and a short list of Reddit threads.
- A second section for "Established treatments".
- Footer: where the data comes from, and "Not medical advice."
- Light and dark theme. Works on a phone.
- Tone: direct and skeptical. It says what is not proven.
- Tech seen in the page source: Astro (a static site builder), Tailwind
  (a CSS kit), hosted on Cloudflare Pages. The page is plain HTML with
  about 20 lines of script.

## What we change for lenses

### Stages

Lenses are devices. Devices do not have Phase 1, 2 and 3. Use these:

| Stage | Meaning |
|---|---|
| Approved (US) | The FDA approved it. A US surgeon can use it. |
| Approved elsewhere | On sale in Europe or other places. Not in the US. |
| Pivotal trial | The large trial that the FDA needs for approval. |
| Early trial | A small first test in people. |
| Lab | No test in people yet. |

Status stays the same as the model site: active, approved, stalled,
discontinued. "Stalled" is new. Use it when a trial record is out of
date and the company is silent.

### Filter buttons

Three buttons, by what the lens does for the patient:

- **Fixed focus**: monofocal, "monofocal plus", EDOF (extended depth of
  focus), trifocal. The lens does not move.
- **Changes focus**: accommodating lenses (they change shape like a
  young eye) and adjustable lenses (the doctor tunes them after
  surgery).
- **No surgery**: drugs that try to slow or clear a cataract.

### Table columns

Lens, Company, Stage, Type, Where you can get it, Status.

"Where you can get it" replaces "Est. Release". Values: "US now",
"Europe now", a year range, or "Unknown". Show an estimate only when a
source gives one. Do not guess a year.

### Two lists (owner's choice, 2026-11-23)

The page tracks new lenses, so the pipeline comes first.

- **In the pipeline**: the main list, with the stage counts, the filter
  buttons and the columns above.
- **Approved and available now**: each lens with stage `approved-us`
  and "Where you can get it" = "US now". Columns: Lens, Company, Type,
  FDA approved (the first date in its `fda` list). No filter buttons.

An approved lens that is not on sale yet stays in the pipeline. The
approval date is not the launch date. The code is `isAvailableNow` in
`scripts/lib/site.js`. The list titles are in `data/site.yaml`.

### Detail panel

- **How it works**: one plain sentence.
- **Summary**: 2 to 4 sentences. Say what it does not do.
- **Trade-offs**: glare, halos, loss of contrast, need for glasses. Each
  lens type has a cost. This field is the main public health value.
- **Latest**: the newest dated fact.
- **Sources**: links to the trial record and the FDA record. Each link
  shows the date we read it.
- **Evidence tag**: one of "Regulator", "Peer-reviewed paper",
  "Company claim". Show it next to every result number.

### Second section

"What surgeons use today": standard monofocal, toric (fixes
astigmatism), monovision. Short and plain. It tells the reader that the
basic lens is good and that new is not the same as better.

## Where the data comes from

Both main sources are free and need no key. Both were tested on
2026-11-19.

### 1. ClinicalTrials.gov API v2

`https://clinicaltrials.gov/api/v2/studies`

This query found 112 industry lens trials that started after 2021-01-01:

```
query.term   = intraocular lens   (also: IOL, accommodating lens, EDOF, trifocal)
query.cond   = cataract OR presbyopia OR aphakia
filter.advanced = AREA[StartDate]RANGE[2021-01-01,MAX]
fields = NCTId,BriefTitle,OverallStatus,LeadSponsorName,LeadSponsorClass,
         PrimaryCompletionDate,StartDate,InterventionName,LocationCountry,
         Phase,StudyType,EnrollmentCount
pageSize = 200   (follow nextPageToken)
```

Then keep `LeadSponsorClass = INDUSTRY` and `StudyType = INTERVENTIONAL`.

Traps:

- The list has noise: glaucoma stents, gels for surgery, eye drops for
  pain, contact lenses. A person must pick the real lens trials.
- Free-text search for a rare word gives junk. A search for
  "lanosterol" returned statin and antifungal trials. Always add the
  cataract condition filter.
- Some records are stale. Example: NCT05364983 (Juvene) still says "not
  yet recruiting" with a start date of 2023-05. Mark these "stalled".
- Companies hide the product behind a code (for example "Model C0002",
  "LPYWT0"). The site shows the code until a name is public.

### 2. openFDA device PMA API

`https://api.fda.gov/device/pma.json`

PMA (premarket approval) is the FDA path for these lenses. This is the
proof that a lens is approved in the US.

```
search = trade_name:<name> AND advisory_committee:OP AND decision_code:APPR
sort   = decision_date:asc
```

Traps:

- **Most new lenses are not new PMAs.** They are "supplements" to an old
  PMA. PanOptix Pro is P190018 S029. PureSee is P980040 S176. A search
  for original PMAs only will miss them.
- Supplements are mostly paperwork (shelf life, factory moves). Keep the
  ones where `supplement_reason` is a design change or a labeling
  change, and read the `ao_statement` text.
- The approval date is not the launch date. A lens can be approved a
  year or more before a surgeon can order it.
- Product codes seen: HQL (monofocal), MFK (multifocal), POE (EDOF),
  MJP (toric), PZK (light adjustable), NAA (accommodating). Codes are
  not used in a strict way. FineVision HP, a trifocal, is filed under
  HQL. Search by name, not by code.

### 3. Sources that a person must read by hand

- Europe: no good public list of CE-marked lenses was found. Use company
  press releases. Tag them "Company claim".
- Papers: PubMed, for result numbers.
- Company news pages, for lab-stage products that have no trial record.
- Patient forums (the model site links Reddit threads). Not checked for
  this spec. Decide later. See open questions.

## How the data is kept

One YAML file for each product in `data/lenses/`. Git history is the
change log.

```yaml
id: tecnis-puresee
name: TECNIS PureSee
code_names: [DEN00V]
company: Johnson & Johnson Surgical Vision
group: fixed            # fixed | changes | no-surgery
type: EDOF
stage: approved-us      # approved-us | approved-elsewhere | pivotal | early | lab
status: approved        # active | approved | stalled | discontinued
availability: "US now"
how_it_works: "..."
summary: "..."
trade_offs: "..."
results:                # every result number goes here, with its tag
  - text: "..."
    evidence: paper     # regulator | paper | company
    source: "https://..."   # one of the urls in sources
latest:
  date: 2026-03-11
  text: "FDA approved the lens and its toric models."
  evidence: regulator   # regulator | paper | company
trials: [NCT05574959, NCT06377514]
fda: [{pma: P980040, supplement: S176, date: 2026-03-11}]
sources:
  - {url: "https://...", read: 2026-11-19}
reviewed: 2026-11-19
```

Rules the build must enforce. The build fails if one is broken:

1. Every entry has at least one source with a `read` date.
2. Every NCT number exists in ClinicalTrials.gov.
3. `stage: approved-us` needs an `fda` record that the API confirms.
4. Every result number has an evidence tag.
5. No drug is approved to treat a cataract, as the page says (see
   "Content rules"). The check reads openFDA drug labels whose
   indications name "cataract". It fails on an approved label (NDA,
   ANDA or BLA number) that does not only mean cataract surgery.

The checks are `npm run check` (`scripts/check.js`). The `prebuild`
script runs them before every `npm run build`. Rules 2, 3 and 5 ask
the live APIs. The file must also be
valid (known keys, allowed values, `id` the same as the file name).

How the build checks rule 4: a result number (a percent, a vision score
like 20/25, diopters, "9 of 10", and so on) goes in `results` or in
`latest`. Both carry an evidence tag. Summary, Trade-offs, How it works
and "Where you can get it" must not hold one. The check finds these
numbers by pattern, so a person still reads each change.

## How it stays up to date

1. A script runs each week (GitHub Actions, on a timer).
2. It pulls both APIs again.
3. It compares the result with the YAML files.
4. It opens a pull request with: changed trial status, changed dates,
   new trials from known companies, new FDA approvals, and trials that
   match no entry.
5. A person reads the pull request and merges it. Nothing goes live
   without a person.
6. The page shows "Last updated" and, per entry, "Last reviewed".

The script updates facts only (status, dates, counts). A person writes
the Summary and Trade-offs text.

Files (made 2026-11-21):

- `npm run refresh` (`scripts/refresh.js`), run by
  `.github/workflows/refresh.yml`.
- It writes `data/registry/trials.json`: status, dates, counts and
  countries for each trial that an entry lists. The page reads trial
  facts from this file. It never changes `data/lenses/`.
- It writes `data/registry/unmatched.json`: search hits that no entry
  lists. Add each one to an entry, or to `data/ignore.yaml` with a
  reason. Then the refresh stops reporting it.
- The FDA search: lens product codes, decisions from 2021-01-01, plus a
  search by the name and code names of each entry. It keeps original
  PMAs and supplements for a design or labeling change.
- The refresh also reports trials that look stale.

## How it is built and hosted

- Astro and Tailwind, the same as the model site. One page of static
  HTML. No database. No server.
- Cloudflare Pages, free plan. A push to `main` deploys the site.
- No tracking cookies. No ads. No affiliate links. No login.
- The repo is public, with a license, so other people can fix data with
  a pull request. This is how it can help public health.

## Content rules

These matter more here than on a hair site. People make an eye surgery
choice.

- "Not medical advice" at the top and the bottom, not only the footer.
- Do not rank lenses. Do not say "best".
- Do not tell a reader to wait for a lens or to delay surgery.
- Say clearly, in the "No surgery" group, that no drop is approved to
  treat a cataract. Check this fact again at build time.
- A company number is a company claim until a paper or a regulator
  confirms it.
- Plain words. Explain each term once (IOL, EDOF, toric, halo).

## Starter list

Facts below come from the two APIs, read 2026-11-19. They are a start,
not a full list. All need a second check before launch.

Checked again 2026-11-21. The record is now `data/lenses/`. Some rows
below were wrong (for example, AT ELANA 841P is a trifocal, and the FDA
approved Clareon Vivity Pro on 2026-10-30). The files have the fixes.

### Approved in the US (openFDA PMA records)

| Lens | Company | Type | FDA record | Date |
|---|---|---|---|---|
| Light Adjustable Lens | RxSight | Adjustable | P160055 | 2017-11-22 |
| AcrySof IQ Vivity | Alcon | EDOF | P930014 S126 | 2020-02-26 |
| Clareon PanOptix | Alcon | Trifocal | P190018 S002 | 2020-07-20 |
| TECNIS Eyhance | Johnson & Johnson | Monofocal plus | P980040 S117 | 2020-12-29 |
| RayOne EMV | Rayner | Monofocal plus | P060011 S025 | 2021-03-26 |
| TECNIS Synergy | Johnson & Johnson | Multifocal | P980040 S124 | 2021-04-28 |
| Clareon Vivity | Alcon | EDOF | P190018 S013 | 2022-01-26 |
| IC-8 Apthera | AcuFocus (Bausch + Lomb runs the follow-up study) | Small aperture EDOF | P210005 | 2022-07-22 |
| ClearView 3 (was SBL-3) | Lenstec | Multifocal | P200020 | 2022-07-22 |
| Clareon PanOptix Pro | Alcon | Trifocal | P190018 S029 | 2023-12-18 |
| TECNIS Odyssey Toric II | Johnson & Johnson | Multifocal | P980040 S159 | 2023-12-22 |
| enVista Envy | Bausch + Lomb | Multifocal | P240005 | 2024-10-10 |
| FineVision HP | BVI | Trifocal | P240038 | 2025-09-10 |
| RayOne EMV Toric | Rayner | Monofocal plus | P060011 S039 | 2025-10-09 |
| TECNIS PureSee | Johnson & Johnson | EDOF | P980040 S176 | 2026-03-11 |
| RayOne Galaxy | Rayner | Multifocal | P060011 S045 | 2026-09-24 |

Note: the Odyssey record found is for the toric model. The record for
the non-toric model was not found yet.

### In trials (ClinicalTrials.gov records)

| Lens | Company | Type | Trial | Trial status | Where |
|---|---|---|---|---|---|
| enVista Beyond | Bausch + Lomb | EDOF | NCT06333015 | Completed 2026-06, 304 people | US |
| AT ELANA 841P | Carl Zeiss Meditec | Multifocal | NCT06264232 | Completed 2025-11, 284 people | US |
| KI-362-US1 | Kowa | Not stated | NCT07650201 | Recruiting, 340 people | US |
| Clareon TruPlus | Alcon | Monofocal | NCT07502456 | Recruiting | US |
| Clareon Vivity Pro | Alcon | EDOF | NCT07484191 | Active | Australia |
| LPYWT0 "novel trifocal" | Alcon | Trifocal | NCT07587138 | Recruiting | Australia, India, Philippines |
| Fluid accommodating IOL | Alcon | Accommodating | NCT05317728 | Active, 175 people | Central America |
| Fluid accommodating IOL, second design | Alcon | Accommodating | NCT07147192 | Terminated 2026-10, 17 people | Central America |
| Juvene | LensGen | Accommodating | NCT05364983 | Not started, record is stale | None listed |
| Adaptilens | Adaptilens | Accommodating | NCT07607860 | Not started, 100 people planned | None listed |
| Opira | FSV6 | Accommodating | NCT04756908 | Unknown | Costa Rica, Mexico |
| Omega Refractive Capsule | Omega Ophthalmics | Lens holder | NCT04574115 | Unknown | Costa Rica |
| FG-80030.1 "virtual aperture" | Z Optics | EDOF | NCT05955846 | Recruiting | Portugal, Spain, Switzerland |
| Perfector (laser reshapes a lens in the eye) | Perfect Lens | Adjustable | NCT07384182 | Completed 2024-11, 19 people | Czechia |
| SpyGlass IOL with drug implant | SpyGlass Pharma | Lens that gives glaucoma drug | NCT07218783, NCT07218796 | Recruiting, 400 people each | US |
| Lux HighAdd, LuxBoost | Cutting Edge | Multifocal, monofocal plus | NCT06446817, NCT06258707 | Recruiting | France |
| LENTIS MAX LS-313 MF80 | Teleon | Multifocal | NCT07915076 | Not started | None listed |

No FDA record was found for enVista Beyond or AT ELANA on 2026-11-19.

### No surgery (ClinicalTrials.gov records)

| Product | Sponsor | Trial | Trial status |
|---|---|---|---|
| NPI-002 implant, to slow cataract growth | Nacuity | NCT05026632 | Completed 2026-09, 24 people, Australia |
| Taurine drops | University of Anbar | NCT06639711 | Active, 50 people, Iraq |

No registered trial for lanosterol drops was found.

### Names to check, no source read yet

These came from memory, not from a source. Do not publish them before a
check: Atia Vision OmniVu, JelliSee, Ocumetics Bionic Lens, VP1-001
(ViewPoint Therapeutics), N-acetylcarnosine drops.

LAL+ (RxSight) is checked: FDA P160055 S024, in `rxsight-lal`.

## Open questions

1. **Include the "No surgery" group?**
   - Yes: people search for "cataract drops" a lot, and a clear "nothing
     is approved" helps them. More work to keep right.
   - No: lenses only. Simpler.
   - Pick: yes.

2. **Link patient forum threads, as the model site does?**
   - Yes: it shows real experience. It also carries bad advice next to
     our data.
   - No: sources stay registries, regulators and papers.
   - Pick: no for the first version.

3. **Europe: full row or a flag?**
   - Full "Approved elsewhere" rows: useful outside the US, but the
     source is company press only.
   - US first, with a "also sold in Europe" note: less to check.
   - Pick: US first.

## First steps for the new repo

1. Make the repo (done 2026-11-21) and the agent box (laptop).
2. Done 2026-11-21: move this spec here. The old spec folder in the
   notebook repo is now a one-line pointer.
3. Done 2026-11-21: the refresh script and the four build checks.
4. Done 2026-11-21: the facts in the YAML files, each one checked.
   A person still writes How it works, Summary and Trade-offs.
5. Done 2026-11-21: the page (`src/pages/index.astro`). Its text is in
   `data/site.yaml`. Empty texts there are for a person to write.
6. Done 2026-11-22: the page is online at
   <https://cataract-lens.pages.dev> (Cloudflare Pages).
