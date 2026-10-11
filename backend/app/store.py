"""Holds the current dataset in memory and reloads it from the lakehouse on demand."""
from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from typing import Callable

from .config import Settings
from .lakehouse import load_kit_tables, load_tables
from .records import Dataset, build_dataset
from .risk import RiskModel

log = logging.getLogger(__name__)


class DataStore:
    """The data is small (hundreds of rows), so the whole lakehouse is cached and rebuilt on refresh.
    That keeps the Databricks warehouse asleep between missions instead of querying it per request."""

    def __init__(self, settings: Settings, risk_model: RiskModel | None):
        self.settings = settings
        self.risk_model = risk_model
        self._dataset: Dataset | None = None
        self._tables: dict[str, list[dict]] | None = None
        self._kit: dict[str, list[dict]] | None = None
        self._with: OrderedDict[tuple, Dataset] = OrderedDict()
        self._lock = threading.Lock()
        self.on_refresh: list[Callable[[Dataset], None]] = []

    @property
    def dataset(self) -> Dataset:
        if self._dataset is None:
            self.refresh()
        return self._dataset

    def refresh(self) -> Dataset:
        with self._lock:
            tables, source = load_tables(self.settings)
            dataset = build_dataset(tables, source, self.risk_model)
            self._dataset, self._tables = dataset, tables
            self._with.clear()
        log.info("loaded %d missions / %d actions from %s", len(dataset.missions), len(dataset.records), source)
        for listener in self.on_refresh:
            listener(dataset)
        return dataset

    def dataset_with(self, mission_ids: tuple[str, ...]) -> Dataset:
        """The current data plus kit missions a visitor has replayed in the sandbox, as if they had arrived.
        Built in memory for that request only: nothing is written and no one else sees it. Missions already in the
        lakehouse, or not IMPROVED missions in the kit, are ignored."""
        base = self.dataset
        with self._lock:
            if self._kit is None:
                self._kit = load_kit_tables(self.settings)
            present = {m["mission_id"] for m in self._tables["missions"]}
            wanted = {m["mission_id"] for m in self._kit["missions"]
                      if m["mission_id"] in mission_ids and m["scenario"] == "IMPROVED" and m["mission_id"] not in present}
            if not wanted:
                return base
            key = (base.loaded_at, tuple(sorted(wanted)))
            if key in self._with:
                self._with.move_to_end(key)
                return self._with[key]
            tables = {t: rows + [r for r in self._kit[t] if r.get("mission_id") in wanted] if t not in ("locations", "assets") else rows
                      for t, rows in self._tables.items()}
            dataset = build_dataset(tables, f"{base.source} + sandbox {','.join(sorted(wanted))}", self.risk_model)
            dataset.loaded_at = base.loaded_at
            self._with[key] = dataset
            while len(self._with) > 8:
                self._with.popitem(last=False)
            return dataset
