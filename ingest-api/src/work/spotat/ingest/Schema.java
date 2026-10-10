package work.spotat.ingest;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Lakehouse tables. Columns match the challenge kit CSVs one for one, so readers can treat both the same way. */
public final class Schema {

    public enum Type { STRING, INT, DOUBLE, BOOLEAN, TIMESTAMP }

    /** {@code allowed} is empty when any value is accepted. */
    public record Column(String name, Type type, boolean required, Set<String> allowed) {}

    public record Table(String name, String key, List<Column> columns) {
        public List<String> columnNames() {
            return columns.stream().map(Column::name).toList();
        }
    }

    private static Column req(String name, Type type) { return new Column(name, type, true, Set.of()); }
    private static Column opt(String name, Type type) { return new Column(name, type, false, Set.of()); }
    private static Column oneOf(String name, String... values) { return new Column(name, Type.STRING, true, Set.of(values)); }

    public static final Table LOCATIONS = new Table("locations", "location_id", List.of(
            req("location_id", Type.STRING), req("location_name", Type.STRING), req("zone_type", Type.STRING),
            req("floor", Type.INT), req("x_coord", Type.DOUBLE), req("y_coord", Type.DOUBLE),
            req("environment", Type.STRING), req("synthetic", Type.BOOLEAN)));

    public static final Table ASSETS = new Table("assets", "asset_id", List.of(
            req("asset_id", Type.STRING), req("asset_name", Type.STRING), req("asset_type", Type.STRING),
            req("location_id", Type.STRING), req("criticality", Type.STRING), req("synthetic", Type.BOOLEAN)));

    public static final Table MISSIONS = new Table("missions", "mission_id", List.of(
            req("mission_id", Type.STRING), req("mission_name", Type.STRING), req("scenario", Type.STRING),
            req("configuration_version", Type.STRING), req("start_time", Type.TIMESTAMP), req("end_time", Type.TIMESTAMP),
            req("duration_min", Type.INT), req("start_battery_pct", Type.INT), req("end_battery_pct", Type.INT),
            req("mission_status", Type.STRING), req("operator_mode", Type.STRING), req("synthetic", Type.BOOLEAN)));

    public static final Table ACTIONS = new Table("actions", "action_id", List.of(
            req("action_id", Type.STRING), req("mission_id", Type.STRING), req("sequence", Type.INT),
            req("timestamp", Type.TIMESTAMP), req("location_id", Type.STRING), req("asset_id", Type.STRING),
            req("action_type", Type.STRING), req("battery_pct", Type.INT), oneOf("status", "SUCCESS", "FAILED"),
            opt("failure_type", Type.STRING), req("duration_sec", Type.INT), req("scenario", Type.STRING),
            req("configuration_version", Type.STRING), req("synthetic", Type.BOOLEAN)));

    public static final Table READINGS = new Table("readings", "reading_id", List.of(
            req("reading_id", Type.STRING), req("action_id", Type.STRING), req("mission_id", Type.STRING),
            req("asset_id", Type.STRING), req("location_id", Type.STRING), req("timestamp", Type.TIMESTAMP),
            req("measurement_type", Type.STRING), req("value", Type.DOUBLE), req("unit", Type.STRING),
            req("quality", Type.STRING), req("synthetic", Type.BOOLEAN)));

    public static final Table ANOMALIES = new Table("anomalies", "anomaly_id", List.of(
            req("anomaly_id", Type.STRING), req("action_id", Type.STRING), req("mission_id", Type.STRING),
            req("location_id", Type.STRING), req("asset_id", Type.STRING), req("timestamp", Type.TIMESTAMP),
            req("anomaly_type", Type.STRING), oneOf("severity", "LOW", "MEDIUM", "HIGH", "CRITICAL"),
            req("operator_review_required", Type.BOOLEAN), req("description", Type.STRING), req("synthetic", Type.BOOLEAN)));

    /** Reference tables first, then mission data in foreign-key order. */
    public static final List<Table> ALL = List.of(LOCATIONS, ASSETS, MISSIONS, ACTIONS, READINGS, ANOMALIES);

    /**
     * Converts a JSON or CSV value to the kit's CSV text form ("" for null, "True"/"False" for booleans).
     * Throws IllegalArgumentException with a message an API caller can act on.
     */
    public static String normalize(Column col, Object raw) {
        String s = raw == null ? "" : raw.toString().trim();
        if (s.isEmpty()) {
            if (col.required()) throw new IllegalArgumentException("is required");
            return "";
        }
        try {
            String value = switch (col.type()) {
                case STRING -> s;
                case INT -> Long.toString(new BigDecimal(s).longValueExact());
                case DOUBLE -> new BigDecimal(s).toPlainString();
                case BOOLEAN -> switch (s.toLowerCase(Locale.ROOT)) {
                    case "true" -> "True";
                    case "false" -> "False";
                    default -> throw new IllegalArgumentException();
                };
                case TIMESTAMP -> {
                    LocalDateTime.parse(s);
                    yield s;
                }
            };
            if (!col.allowed().isEmpty() && !col.allowed().contains(value)) {
                throw new IllegalArgumentException("must be one of " + col.allowed() + ", got \"" + s + "\"");
            }
            return value;
        } catch (NumberFormatException | ArithmeticException | DateTimeParseException e) {
            throw new IllegalArgumentException(expected(col.type()) + ", got \"" + s + "\"");
        } catch (IllegalArgumentException e) {
            throw e.getMessage() != null ? e : new IllegalArgumentException(expected(col.type()) + ", got \"" + s + "\"");
        }
    }

    private static String expected(Type type) {
        return switch (type) {
            case STRING -> "must be text";
            case INT -> "must be a whole number";
            case DOUBLE -> "must be a number";
            case BOOLEAN -> "must be true or false";
            case TIMESTAMP -> "must be a timestamp like 2026-09-07T18:00:00";
        };
    }

    private Schema() {}
}
