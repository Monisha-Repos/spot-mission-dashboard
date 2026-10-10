package work.spotat.ingest;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Validates a mission bundle ({mission, actions, readings, anomalies}) and appends it to the lakehouse.
 * A bundle is all-or-nothing at validation time: nothing is written unless every row passes.
 */
final class IngestService {

    /** Anomalies at these severities, or flagged for operator review, raise an alarm on the dashboard. */
    static final Set<String> ALARM_SEVERITIES = Set.of("HIGH", "CRITICAL");

    record Result(int status, Map<String, Object> body) {}

    private final Sink sink;
    private final Object writeLock = new Object();
    private volatile Set<String> locationIds = Set.of();
    private volatile Set<String> assetIds = Set.of();

    IngestService(Sink sink) {
        this.sink = sink;
    }

    Result ingest(Object payload) throws Exception {
        if (!(payload instanceof Map<?, ?> bundle)) {
            return invalid(List.of("body must be a JSON object with mission, actions, readings and anomalies"));
        }

        List<String> errors = new ArrayList<>();
        Map<String, String> mission = row(Schema.MISSIONS, bundle.get("mission"), "mission", errors);
        List<Map<String, String>> actions = rows(Schema.ACTIONS, bundle.get("actions"), "actions", errors);
        List<Map<String, String>> readings = rows(Schema.READINGS, bundle.get("readings"), "readings", errors);
        List<Map<String, String>> anomalies = rows(Schema.ANOMALIES, bundle.get("anomalies"), "anomalies", errors);
        if (!errors.isEmpty()) return invalid(errors);
        if (actions.isEmpty()) return invalid(List.of("actions: a mission needs at least one action"));

        String missionId = mission.get("mission_id");
        Set<String> actionIds = new HashSet<>();
        for (int i = 0; i < actions.size(); i++) {
            Map<String, String> action = actions.get(i);
            String at = "actions[" + i + "]";
            if (!actionIds.add(action.get("action_id"))) errors.add(at + ".action_id: duplicate " + action.get("action_id"));
            if (!action.get("scenario").equals(mission.get("scenario"))
                    || !action.get("configuration_version").equals(mission.get("configuration_version"))) {
                errors.add(at + ": scenario and configuration_version must match the mission");
            }
            checkLinks(action, at, missionId, null, errors);
        }
        checkChildren(Schema.READINGS, readings, missionId, actionIds, errors);
        checkChildren(Schema.ANOMALIES, anomalies, missionId, actionIds, errors);
        if (!errors.isEmpty()) return invalid(errors);

        synchronized (writeLock) {
            boolean exists = sink.rows(Schema.MISSIONS, "mission_id").stream()
                    .anyMatch(r -> missionId.equals(r.get("mission_id")));
            if (exists) return new Result(409, Map.of("error", "mission " + missionId + " is already in the lakehouse"));
            sink.append(Schema.MISSIONS, List.of(mission));
            sink.append(Schema.ACTIONS, actions);
            sink.append(Schema.READINGS, readings);
            sink.append(Schema.ANOMALIES, anomalies);
        }

        Map<String, Object> inserted = new LinkedHashMap<>();
        inserted.put("missions", 1);
        inserted.put("actions", actions.size());
        inserted.put("readings", readings.size());
        inserted.put("anomalies", anomalies.size());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("mission_id", missionId);
        body.put("scenario", mission.get("scenario"));
        body.put("configuration_version", mission.get("configuration_version"));
        body.put("mission_status", mission.get("mission_status"));
        body.put("inserted", inserted);
        body.put("alerts", alerts(anomalies, readings));
        return new Result(201, body);
    }

    /** The anomalies that should sound the dashboard alarm, with the reading that triggered each one. */
    private static List<Map<String, Object>> alerts(List<Map<String, String>> anomalies, List<Map<String, String>> readings) {
        List<Map<String, Object>> alerts = new ArrayList<>();
        for (Map<String, String> anomaly : anomalies) {
            if (!ALARM_SEVERITIES.contains(anomaly.get("severity")) && !"True".equals(anomaly.get("operator_review_required"))) {
                continue;
            }
            Map<String, Object> alert = new LinkedHashMap<>(anomaly);
            alert.remove("synthetic");
            alert.put("readings", readings.stream()
                    .filter(r -> r.get("action_id").equals(anomaly.get("action_id")))
                    .map(r -> Map.of("measurement_type", r.get("measurement_type"), "value", r.get("value"),
                            "unit", r.get("unit"), "quality", r.get("quality")))
                    .toList());
            alerts.add(alert);
        }
        return alerts;
    }

    private void checkChildren(Schema.Table table, List<Map<String, String>> rows, String missionId,
                               Set<String> actionIds, List<String> errors) throws Exception {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < rows.size(); i++) {
            Map<String, String> row = rows.get(i);
            String at = table.name() + "[" + i + "]";
            if (!seen.add(row.get(table.key()))) errors.add(at + "." + table.key() + ": duplicate " + row.get(table.key()));
            checkLinks(row, at, missionId, actionIds, errors);
        }
    }

    /** Checks mission_id, action_id (when {@code actionIds} is given), location_id and asset_id references. */
    private void checkLinks(Map<String, String> row, String at, String missionId, Set<String> actionIds,
                            List<String> errors) throws Exception {
        if (!missionId.equals(row.get("mission_id"))) errors.add(at + ".mission_id: must be " + missionId);
        if (actionIds != null && !actionIds.contains(row.get("action_id"))) {
            errors.add(at + ".action_id: " + row.get("action_id") + " is not one of this mission's actions");
        }
        if (!locationIds.contains(row.get("location_id")) || !assetIds.contains(row.get("asset_id"))) {
            locationIds = ids(Schema.LOCATIONS);
            assetIds = ids(Schema.ASSETS);
        }
        if (!locationIds.contains(row.get("location_id"))) errors.add(at + ".location_id: unknown location " + row.get("location_id"));
        if (!assetIds.contains(row.get("asset_id"))) errors.add(at + ".asset_id: unknown asset " + row.get("asset_id"));
    }

    private Set<String> ids(Schema.Table table) throws Exception {
        Set<String> ids = new HashSet<>();
        for (Map<String, String> row : sink.rows(table, table.key())) ids.add(row.get(table.key()));
        return ids;
    }

    private static List<Map<String, String>> rows(Schema.Table table, Object raw, String field, List<String> errors) {
        if (raw == null) return List.of();
        if (!(raw instanceof List<?> list)) {
            errors.add(field + ": must be an array");
            return List.of();
        }
        List<Map<String, String>> rows = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            Map<String, String> row = row(table, list.get(i), field + "[" + i + "]", errors);
            if (row != null) rows.add(row);
        }
        return rows;
    }

    private static Map<String, String> row(Schema.Table table, Object raw, String at, List<String> errors) {
        if (!(raw instanceof Map<?, ?> fields)) {
            errors.add(at + ": must be an object");
            return null;
        }
        Map<String, String> row = new LinkedHashMap<>();
        for (Schema.Column column : table.columns()) {
            try {
                row.put(column.name(), Schema.normalize(column, fields.get(column.name())));
            } catch (IllegalArgumentException e) {
                errors.add(at + "." + column.name() + ": " + e.getMessage());
            }
        }
        return row;
    }

    private static Result invalid(List<String> errors) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", "validation failed, nothing was written");
        body.put("details", errors);
        return new Result(400, body);
    }
}
