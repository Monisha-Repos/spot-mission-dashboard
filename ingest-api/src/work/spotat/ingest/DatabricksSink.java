package work.spotat.ingest;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Writes to Delta tables through the Databricks SQL Statement Execution API
 * (POST /api/2.0/sql/statements), so no JDBC driver is needed. Values are always sent as
 * parameters, never concatenated into SQL: each is passed as text and CAST to the column type.
 */
final class DatabricksSink implements Sink {
    private static final int MAX_PARAMS_PER_STATEMENT = 250;
    private static final Duration STATEMENT_TIMEOUT = Duration.ofMinutes(5);

    private final String host;
    private final String token;
    private final String warehouseId;
    private final String catalog;
    private final String schema;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    DatabricksSink(Config config) {
        // Accepts "adb-123.azuredatabricks.net" or a URL pasted from the browser, e.g. "https://dbc-1.cloud.databricks.com/?o=42#".
        String h = config.require("DATABRICKS_HOST").trim();
        URI uri = URI.create(h.contains("://") ? h : "https://" + h);
        host = uri.getScheme() + "://" + uri.getAuthority();
        token = config.require("DATABRICKS_TOKEN");
        // The warehouse's "HTTP path" (/sql/1.0/warehouses/<id>) ends with its ID, and the Python connector needs that path anyway.
        String httpPath = config.get("DATABRICKS_HTTP_PATH", "");
        warehouseId = config.get("DATABRICKS_WAREHOUSE_ID", httpPath.isEmpty() ? null : httpPath.replaceAll("/+$", "").replaceAll(".*/", ""));
        if (warehouseId == null) throw new IllegalStateException("set DATABRICKS_HTTP_PATH or DATABRICKS_WAREHOUSE_ID (see .env.example)");
        catalog = config.get("DATABRICKS_CATALOG", "workspace");
        schema = config.get("DATABRICKS_SCHEMA", "spot");
    }

    @Override
    public String describe() {
        return "databricks " + catalog + "." + schema;
    }

    @Override
    public void createTables(boolean reset) throws Exception {
        execute("CREATE SCHEMA IF NOT EXISTS " + ident(catalog) + "." + ident(schema), List.of());
        for (Schema.Table table : Schema.ALL) {
            String columns = table.columns().stream()
                    .map(c -> ident(c.name()) + " " + c.type().name())
                    .collect(Collectors.joining(", "));
            String create = reset ? "CREATE OR REPLACE TABLE " : "CREATE TABLE IF NOT EXISTS ";
            execute(create + name(table) + " (" + columns + ")", List.of());
        }
    }

    @Override
    public void append(Schema.Table table, List<Map<String, String>> rows) throws Exception {
        String columns = table.columnNames().stream().map(DatabricksSink::ident).collect(Collectors.joining(", "));
        int rowsPerInsert = Math.max(1, MAX_PARAMS_PER_STATEMENT / table.columns().size());
        for (int start = 0; start < rows.size(); start += rowsPerInsert) {
            List<String> tuples = new ArrayList<>();
            List<Map<String, Object>> params = new ArrayList<>();
            for (Map<String, String> row : rows.subList(start, Math.min(rows.size(), start + rowsPerInsert))) {
                List<String> markers = new ArrayList<>();
                for (Schema.Column column : table.columns()) {
                    String paramName = "p" + params.size();
                    markers.add("CAST(:" + paramName + " AS " + column.type().name() + ")");
                    Map<String, Object> param = new LinkedHashMap<>();
                    param.put("name", paramName);
                    String value = row.getOrDefault(column.name(), "");
                    // An omitted value is NULL in the Statement Execution API.
                    if (!value.isEmpty()) {
                        param.put("value", column.type() == Schema.Type.BOOLEAN ? value.toLowerCase(Locale.ROOT) : value);
                    }
                    params.add(param);
                }
                tuples.add("(" + String.join(", ", markers) + ")");
            }
            execute("INSERT INTO " + name(table) + " (" + columns + ") VALUES " + String.join(", ", tuples), params);
        }
    }

    @Override
    public void deleteMission(String missionId) throws Exception {
        for (Schema.Table table : List.of(Schema.ANOMALIES, Schema.READINGS, Schema.ACTIONS, Schema.MISSIONS)) {
            execute("DELETE FROM " + name(table) + " WHERE mission_id = :mission_id",
                    List.of(Map.of("name", "mission_id", "value", missionId)));
        }
    }

    @Override
    public List<Map<String, String>> rows(Schema.Table table, String... columns) throws Exception {
        String select = Arrays.stream(columns).map(DatabricksSink::ident).collect(Collectors.joining(", "));
        List<Map<String, String>> rows = new ArrayList<>();
        for (List<?> values : dataArray(execute("SELECT " + select + " FROM " + name(table), List.of()))) {
            Map<String, String> row = new LinkedHashMap<>();
            for (int i = 0; i < columns.length; i++) row.put(columns[i], values.get(i) == null ? "" : values.get(i).toString());
            rows.add(row);
        }
        return rows;
    }

    @Override
    public Map<String, Long> counts() throws Exception {
        String sql = Schema.ALL.stream()
                .map(t -> "SELECT '" + t.name() + "', COUNT(*) FROM " + name(t))
                .collect(Collectors.joining(" UNION ALL "));
        Map<String, Long> counts = new LinkedHashMap<>();
        for (List<?> values : dataArray(execute(sql, List.of()))) {
            counts.put(values.get(0).toString(), Long.parseLong(values.get(1).toString()));
        }
        return counts;
    }

    private Map<String, Object> execute(String sql, List<Map<String, Object>> params) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("warehouse_id", warehouseId);
        body.put("statement", sql);
        if (!params.isEmpty()) body.put("parameters", params);
        body.put("wait_timeout", "30s");
        body.put("on_wait_timeout", "CONTINUE");
        Map<String, Object> response = send(HttpRequest.newBuilder(URI.create(host + "/api/2.0/sql/statements"))
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(body))));

        long deadline = System.nanoTime() + STATEMENT_TIMEOUT.toNanos();
        while (true) {
            Map<String, Object> status = Json.object(response.get("status"));
            String state = String.valueOf(status.get("state"));
            switch (state) {
                case "SUCCEEDED":
                    return response;
                case "PENDING":
                case "RUNNING":
                    break;
                default:
                    Object error = status.get("error");
                    String message = error instanceof Map<?, ?> m ? String.valueOf(m.get("message")) : "no details";
                    throw new IOException("Databricks statement " + state + ": " + message);
            }
            if (System.nanoTime() > deadline) {
                throw new IOException("Databricks statement still " + state + " after " + STATEMENT_TIMEOUT.toMinutes()
                        + " min. Is the SQL warehouse running?");
            }
            Thread.sleep(1000);
            response = send(HttpRequest.newBuilder(URI.create(host + "/api/2.0/sql/statements/" + response.get("statement_id"))).GET());
        }
    }

    private Map<String, Object> send(HttpRequest.Builder request) throws Exception {
        HttpResponse<String> response = http.send(request
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(60))
                .build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 401 || response.statusCode() == 403) {
            throw new IOException("Databricks rejected the token (HTTP " + response.statusCode()
                    + "). Check DATABRICKS_TOKEN and that it may use the SQL warehouse.");
        }
        if (response.statusCode() / 100 != 2) {
            throw new IOException("Databricks HTTP " + response.statusCode() + ": " + response.body());
        }
        return Json.object(Json.parse(response.body()));
    }

    private static List<List<?>> dataArray(Map<String, Object> response) {
        if (!(response.get("result") instanceof Map<?, ?> result)) return List.of();
        if (!(result.get("data_array") instanceof List<?> data)) return List.of();
        List<List<?>> rows = new ArrayList<>();
        for (Object row : data) rows.add((List<?>) row);
        return rows;
    }

    private String name(Schema.Table table) {
        return ident(catalog) + "." + ident(schema) + "." + ident(table.name());
    }

    private static String ident(String name) {
        return "`" + name.replace("`", "``") + "`";
    }
}
