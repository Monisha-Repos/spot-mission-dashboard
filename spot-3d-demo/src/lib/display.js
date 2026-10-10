export function batteryState(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "number" ||
    !Number.isFinite(value)
  )
    return { percent: null, tone: "unknown" };
  const percent = Math.max(0, Math.min(100, value));
  return {
    percent,
    tone: percent <= 30 ? "low" : percent <= 60 ? "medium" : "full",
  };
}

export function waypointFindings(actions, locationId) {
  return actions
    .filter((action) => action.location_id === locationId)
    .sort(
      (a, b) =>
        b.classification.rank - a.classification.rank ||
        String(b.timestamp).localeCompare(String(a.timestamp)),
    );
}

export function shortType(value) {
  return (
    {
      NAVIGATION: "Navigation",
      THERMAL_INSPECTION: "Thermal",
      VISUAL_INSPECTION: "Visual",
      ACOUSTIC_INSPECTION: "Acoustic",
      GAUGE_READING: "Gauge",
    }[value] ||
    String(value || "Inspection")
      .replaceAll("_", " ")
      .toLowerCase()
  );
}

export function readingLabel(reading) {
  return (
    {
      TEMPERATURE_C: "Temperature",
      SOUND_DB: "Acoustic level",
      ACOUSTIC_DB: "Acoustic level",
      PRESSURE_PSI: "Pressure",
      VISUAL_SCORE: "Visual score",
      LOCALIZATION_CONFIDENCE_PCT: "Localization confidence",
    }[reading.measurement_type] ||
    String(reading.measurement_type || "Reading")
      .replaceAll("_", " ")
      .toLowerCase()
  );
}

export function unitLabel(unit) {
  return { C: "°C", degC: "°C", pct: "%" }[unit] || unit;
}
export function number(value) {
  return value == null
    ? "—"
    : Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}
