# Data

| Folder | What's in it | In git? |
|---|---|---|
| `kit/` | The challenge kit's synthetic data, unchanged: `missions`, `actions`, `readings`, `anomalies`, `locations`, `assets` (CSV), `replay.ndjson`, `validation_results.json`, and `data_dictionary.csv` (field definitions) | Yes. Treat it as read-only source data. |
| `lakehouse/` | The **offline lakehouse**, written by `ingest-api` when `SINK=local`. One CSV per table, same columns as `kit/`. | No (generated) |

The live lakehouse is in Databricks at `workspace.spot`. Both lakehouses start with the BASELINE missions only; the IMPROVED missions arrive through the ingest API. See [../ingest-api/RUNBOOK.md](../ingest-api/RUNBOOK.md).

All data here is synthetic and fictional (see [../docs/challenge/Data_Assumptions.md](../docs/challenge/Data_Assumptions.md)).
