# Cataract Lens Pipeline tracker

**Not medical advice.** This page lists facts from public records. It does
not tell you which lens to pick, and it does not tell you to wait for a new
one. Ask your eye surgeon.

A free web page that lists new cataract replacement lenses. A replacement
lens is an IOL (intraocular lens): the plastic lens a surgeon puts in the
eye after the cloudy lens comes out. Each row shows how far a lens has got:
in the lab, in a trial, or approved. Each fact links to its source.

Status: no site is built yet. The plan is in [docs/spec.md](docs/spec.md).

## Where the data comes from

- [ClinicalTrials.gov](https://clinicaltrials.gov/) API v2: trial records.
- [openFDA](https://open.fda.gov/apis/device/pma/) device PMA API: US
  approvals.
- Company press releases and papers, read by a person.

A script reads the two APIs each week and opens a pull request. A person
checks every change before it goes live.

## Fix a fact

Open a pull request or an issue. Give a source link for each fact.

## License

- Code (scripts, site): MIT. See [LICENSE](LICENSE).
- Data and text in `data/`: CC BY 4.0. See [LICENSE-DATA](LICENSE-DATA).
  You can reuse it if you give credit to this project.
