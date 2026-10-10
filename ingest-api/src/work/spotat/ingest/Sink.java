package work.spotat.ingest;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/** Where ingested rows land: Databricks Delta tables, or a folder of CSVs for offline demos. */
interface Sink {

    String describe();

    /** Creates any missing tables. With {@code reset}, existing tables are emptied first. */
    void createTables(boolean reset) throws Exception;

    /** Appends rows already normalized by {@link Schema#normalize}. */
    void append(Schema.Table table, List<Map<String, String>> rows) throws Exception;

    /** Returns the requested columns of every row, as text. */
    List<Map<String, String>> rows(Schema.Table table, String... columns) throws Exception;

    /** Row count per table name. */
    Map<String, Long> counts() throws Exception;

    static Sink from(Config config) {
        String kind = config.get("SINK", config.get("DATABRICKS_HOST", null) != null ? "databricks" : "local");
        return switch (kind) {
            case "databricks" -> new DatabricksSink(config);
            case "local" -> new LocalCsvSink(Path.of(config.get("LAKEHOUSE_DIR", "../data/lakehouse")));
            default -> throw new IllegalStateException("SINK must be databricks or local, got " + kind);
        };
    }
}
