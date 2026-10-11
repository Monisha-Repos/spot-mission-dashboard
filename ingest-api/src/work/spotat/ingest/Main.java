package work.spotat.ingest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * SPOT live-data ingest API.
 *
 *   serve                              start the API (PORT, default 8081)
 *   seed [--reset] [--scenario S]      create the lakehouse tables and load reference data + one scenario
 *                                      (default BASELINE) straight from the kit
 *   feed [--scenario S] [--delay SEC] [--url URL]
 *                                      replay kit missions (default IMPROVED) through the running API,
 *                                      one every SEC seconds (default 8), as if SPOT were sending them live
 *
 * For an event-by-event live demo, start `serve` and use POST /live/start (or the dashboard's Operator Console).
 */
public final class Main {

    public static void main(String[] args) throws Exception {
        String command = args.length > 0 ? args[0] : "serve";
        Map<String, String> options = options(args);
        Config config = Config.load();
        try {
            switch (command) {
                case "serve" -> serve(config);
                case "seed" -> seed(config, options);
                case "feed" -> feed(config, options);
                default -> {
                    System.err.println("usage: serve | seed [--reset] [--scenario BASELINE] | feed [--scenario IMPROVED] [--delay 8] [--url URL]");
                    System.exit(2);
                }
            }
        } catch (IllegalStateException e) {
            System.err.println("error: " + e.getMessage());
            System.exit(1);
        }
    }

    private static void serve(Config config) throws Exception {
        Sink sink = Sink.from(config);
        sink.createTables(false);
        int port = Integer.parseInt(config.get("PORT", "8081"));
        String apiKey = config.get("INGEST_API_KEY", "");
        IngestService ingest = new IngestService(sink);
        EventHub events = new EventHub();
        Webhook webhook = new Webhook(config.get("INGEST_WEBHOOK_URL", ""), apiKey);
        LiveFeed live = new LiveFeed(sink, ingest, events, webhook, kitDir(config));
        new ApiServer(sink, ingest, events, live, apiKey, webhook).start(port);
        log("SPOT ingest API listening on http://localhost:" + port + ", writing to " + sink.describe());
    }

    private static void seed(Config config, Map<String, String> options) throws Exception {
        Seeder.seed(Sink.from(config), KitData.load(kitDir(config)), options.containsKey("reset"),
                options.getOrDefault("scenario", "BASELINE"));
    }

    private static void feed(Config config, Map<String, String> options) throws Exception {
        String url = options.getOrDefault("url", "http://localhost:" + config.get("PORT", "8081")).replaceAll("/+$", "");
        String scenario = options.getOrDefault("scenario", "IMPROVED");
        long delayMs = (long) (Double.parseDouble(options.getOrDefault("delay", "8")) * 1000);
        String apiKey = config.get("INGEST_API_KEY", "");
        HttpClient http = HttpClient.newHttpClient();

        List<Map<String, Object>> bundles = KitData.load(kitDir(config)).bundles(scenario);
        waitForServer(http, url);
        log("feeding " + bundles.size() + " " + scenario + " mission(s) to " + url + ", one every " + delayMs / 1000.0 + " s");
        for (int i = 0; i < bundles.size(); i++) {
            if (i > 0) Thread.sleep(delayMs);
            Map<String, Object> bundle = bundles.get(i);
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url + "/ingest/missions"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(Json.write(bundle)));
            if (!apiKey.isEmpty()) request.header("X-API-Key", apiKey);
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());

            String missionId = Json.object(bundle.get("mission")).get("mission_id").toString();
            Map<String, Object> body = Json.object(Json.parse(response.body()));
            switch (response.statusCode()) {
                case 201 -> log(missionId + " sent: " + body.get("inserted") + ", " + ((List<?>) body.get("alerts")).size() + " alert(s)");
                case 409 -> log(missionId + " already in the lakehouse, skipped");
                default -> log(missionId + " FAILED (HTTP " + response.statusCode() + "): " + body);
            }
        }
        log("feed finished");
    }

    /** `serve` checks the lakehouse tables before it listens, which takes a few seconds on Databricks. */
    private static void waitForServer(HttpClient http, String url) throws InterruptedException {
        HttpRequest health = HttpRequest.newBuilder(URI.create(url + "/health")).GET().build();
        for (int attempt = 0; attempt < 60; attempt++) {
            try {
                if (http.send(health, HttpResponse.BodyHandlers.discarding()).statusCode() == 200) return;
            } catch (java.io.IOException notUpYet) {
                if (attempt == 0) log("waiting for the API at " + url + " (start it with: serve)");
            }
            Thread.sleep(1000);
        }
        throw new IllegalStateException("no API answering at " + url + " after 60 s; is `serve` running?");
    }

    private static Path kitDir(Config config) {
        return Path.of(config.get("KIT_DATA_DIR", "../data/kit"));
    }

    /** Parses {@code --name value} pairs; a flag with no value is "true". */
    private static Map<String, String> options(String[] args) {
        Map<String, String> options = new HashMap<>();
        for (int i = 1; i < args.length; i++) {
            if (!args[i].startsWith("--")) continue;
            boolean hasValue = i + 1 < args.length && !args[i + 1].startsWith("--");
            options.put(args[i].substring(2), hasValue ? args[++i] : "true");
        }
        return options;
    }

    static void log(String message) {
        System.out.println(LocalTime.now().withNano(0) + "  " + message);
    }

    private Main() {}
}
