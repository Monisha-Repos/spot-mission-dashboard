package work.spotat.ingest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The challenge kit CSVs in data/kit, regrouped into one bundle per mission. */
final class KitData {
    private final Map<Schema.Table, List<Map<String, String>>> tables = new LinkedHashMap<>();

    static KitData load(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) throw new IOException("kit data folder not found: " + dir.toAbsolutePath() + " (set KIT_DATA_DIR)");
        KitData kit = new KitData();
        for (Schema.Table table : Schema.ALL) kit.tables.put(table, Csv.read(dir.resolve(table.name() + ".csv")));
        return kit;
    }

    List<Map<String, String>> rows(Schema.Table table) {
        return tables.get(table);
    }

    /** Bundles in mission start order. {@code scenario} is BASELINE, IMPROVED or ALL. */
    List<Map<String, Object>> bundles(String scenario) {
        List<Map<String, Object>> bundles = new ArrayList<>();
        rows(Schema.MISSIONS).stream()
                .filter(m -> scenario.equalsIgnoreCase("ALL") || scenario.equalsIgnoreCase(m.get("scenario")))
                .sorted(Comparator.comparing(m -> m.get("start_time")))
                .forEach(mission -> {
                    String id = mission.get("mission_id");
                    Map<String, Object> bundle = new LinkedHashMap<>();
                    bundle.put("mission", mission);
                    bundle.put("actions", rows(Schema.ACTIONS).stream()
                            .filter(r -> id.equals(r.get("mission_id")))
                            .sorted(Comparator.comparingInt(r -> Integer.parseInt(r.get("sequence"))))
                            .toList());
                    bundle.put("readings", childrenOf(Schema.READINGS, id));
                    bundle.put("anomalies", childrenOf(Schema.ANOMALIES, id));
                    bundles.add(bundle);
                });
        return bundles;
    }

    private List<Map<String, String>> childrenOf(Schema.Table table, String missionId) {
        return rows(table).stream().filter(r -> missionId.equals(r.get("mission_id"))).toList();
    }
}
