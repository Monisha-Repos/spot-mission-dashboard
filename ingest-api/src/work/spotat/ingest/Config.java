package work.spotat.ingest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** Settings from a {@code .env} file in the working directory, overridden by real environment variables. */
final class Config {
    private final Map<String, String> values = new HashMap<>();

    static Config load() throws IOException {
        Config config = new Config();
        Path dotenv = Path.of(".env");
        if (Files.exists(dotenv)) {
            for (String line : Files.readAllLines(dotenv)) {
                line = line.trim();
                int eq = line.indexOf('=');
                if (line.isEmpty() || line.startsWith("#") || eq < 1) continue;
                String value = line.substring(eq + 1).trim();
                if (value.length() >= 2 && (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length() - 1);
                }
                config.values.put(line.substring(0, eq).trim(), value);
            }
        }
        config.values.putAll(System.getenv());
        return config;
    }

    String get(String key, String fallback) {
        String value = values.get(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    String require(String key) {
        String value = get(key, null);
        if (value == null) throw new IllegalStateException(key + " is not set (see .env.example)");
        return value;
    }
}
