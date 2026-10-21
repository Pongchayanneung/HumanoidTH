# Baseline audit

These reports describe the inherited HumanoidTH application and the repairs proposed for Hack Day. The audits use upstream revision `bef80bdfe895f9403af910951fa251c9baacad2b`; source links point to that revision so the evidence remains traceable as the fork changes.

| Report | Contents |
| --- | --- |
| [Technical baseline audit](technical-baseline-audit.md) | Thirteen findings, T01–T13, covering authentication, authorization, privacy, startup, persistence, provider failures and release checks. |
| [Design and data-flow baseline audit](design-data-flow-baseline-audit.md) | Fourteen findings, D01–D14, covering publication, provenance, graph meaning, analytics, exports and the user journey. |
| [Incomplete functions](incomplete-functions.md) | A plain-language summary of the 27 findings, grouped by affected function and proposed finished behavior. |

The technical and design audits were reviewed on 20 October 2026; the function summary was prepared on 22 October. Each report distinguishes source observations, historical test results and checks still required. Supporting contest and fork research reports are maintained separately.

The [Hack Day fix plan](../Hack-day-planning/hack-day-fix-plan.md) assigns priorities, owners and acceptance checks. A finding remains open until its repair or temporary restriction has been tested and recorded.

[Back to Hackathon preparation](../README.md)
