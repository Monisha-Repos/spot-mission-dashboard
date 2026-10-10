"""Holds the current dataset in memory and reloads it from the lakehouse on demand."""
from __future__ import annotations

import logging
import threading
from typing import Callable

from .config import Settings
from .lakehouse import load_tables
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
            self._dataset = dataset
        log.info("loaded %d missions / %d actions from %s", len(dataset.missions), len(dataset.records), source)
        for listener in self.on_refresh:
            listener(dataset)
        return dataset
