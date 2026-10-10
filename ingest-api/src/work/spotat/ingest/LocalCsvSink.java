package work.spotat.ingest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** One CSV per table, same layout as the kit files in data/kit, so the Python backend can read either. */
final class LocalCsvSink implements Sink {
    private final Path dir;

    LocalCsvSink(Path dir) {
        this.dir = dir;
    }

    @Override
    public String describe() {
        return "local " + dir.toAbsolutePath().normalize();
    }

    @Override
    public synchronized void createTables(boolean reset) throws IOException {
        Files.createDirectories(dir);
        for (Schema.Table table : Schema.ALL) {
            Path file = file(table);
            if (reset) Files.deleteIfExists(file);
            if (Files.notExists(file)) Files.writeString(file, Csv.line(table.columnNames()) + "\n");
        }
    }

    @Override
    public synchronized void append(Schema.Table table, List<Map<String, String>> rows) throws IOException {
        if (rows.isEmpty()) return;
        StringBuilder b = new StringBuilder();
        for (Map<String, String> row : rows) {
            b.append(Csv.line(table.columnNames().stream().map(c -> row.getOrDefault(c, "")).toList())).append('\n');
        }
        Files.writeString(file(table), b, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }

    @Override
    public synchronized void deleteMission(String missionId) throws IOException {
        for (Schema.Table table : List.of(Schema.MISSIONS, Schema.ACTIONS, Schema.READINGS, Schema.ANOMALIES)) {
            if (Files.notExists(file(table))) continue;
            List<Map<String, String>> kept = Csv.read(file(table)).stream()
                    .filter(r -> !missionId.equals(r.get("mission_id"))).toList();
            Files.writeString(file(table), Csv.line(table.columnNames()) + "\n");
            append(table, kept);
        }
    }

    @Override
    public synchronized List<Map<String, String>> rows(Schema.Table table, String... columns) throws IOException {
        if (Files.notExists(file(table))) return List.of();
        return Csv.read(file(table)).stream().map(row -> {
            Map<String, String> picked = new LinkedHashMap<>();
            for (String c : columns) picked.put(c, row.getOrDefault(c, ""));
            return picked;
        }).toList();
    }

    @Override
    public synchronized Map<String, Long> counts() throws IOException {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (Schema.Table table : Schema.ALL) counts.put(table.name(), (long) rows(table, table.key()).size());
        return counts;
    }

    private Path file(Schema.Table table) {
        return dir.resolve(table.name() + ".csv");
    }
}
