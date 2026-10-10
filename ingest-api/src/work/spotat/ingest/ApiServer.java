package work.spotat.ingest;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.Executors;

/**
 * Routes:
 *   GET  /health            liveness + which sink is in use
 *   GET  /ingest/status     row counts and missions per scenario
 *   POST /ingest/missions   add one mission bundle (X-API-Key required when INGEST_API_KEY is set)
 *   GET  /events            Server-Sent Events: mission_ingested, with the alerts that need an operator
 */
final class ApiServer {
    private static final int MAX_BODY_BYTES = 1 << 20;

    private final Sink sink;
    private final IngestService ingest;
    private final EventHub events = new EventHub();
    private final String apiKey;
    private final URI webhook;
    private final HttpClient http = HttpClient.newHttpClient();

    ApiServer(Sink sink, IngestService ingest, String apiKey, String webhookUrl) {
        this.sink = sink;
        this.ingest = ingest;
        this.apiKey = apiKey;
        this.webhook = webhookUrl.isEmpty() ? null : URI.create(webhookUrl);
    }

    void start(int port) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", this::handle);
        // Each open /events stream holds a thread, so leave room for several dashboards.
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
    }

    private void handle(HttpExchange exchange) {
        String method = exchange.getRequestMethod();
        String path = exchange.getRequestURI().getPath().replaceAll("/+$", "");
        Headers headers = exchange.getResponseHeaders();
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
        headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        try {
            switch (method + " " + path) {
                case "GET /health" -> send(exchange, 200, Map.of("status", "ok", "sink", sink.describe()));
                case "GET /ingest/status" -> send(exchange, 200, status());
                case "POST /ingest/missions" -> postMission(exchange);
                case "GET /events" -> {
                    events.subscribe(exchange);
                    return; // stays open; EventHub owns it now
                }
                default -> {
                    if (method.equals("OPTIONS")) exchange.sendResponseHeaders(204, -1);
                    else send(exchange, 404, Map.of("error", "no route for " + method + " " + path));
                }
            }
        } catch (Exception e) {
            Main.log("ERROR " + method + " " + path + ": " + e);
            try {
                send(exchange, 500, Map.of("error", String.valueOf(e.getMessage())));
            } catch (IOException ignored) {
                // Headers were already sent; the client sees a truncated response.
            }
        }
        exchange.close();
    }

    private void postMission(HttpExchange exchange) throws Exception {
        String given = exchange.getRequestHeaders().getFirst("X-API-Key");
        if (!apiKey.isEmpty() && (given == null || !MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8),
                given.getBytes(StandardCharsets.UTF_8)))) {
            send(exchange, 401, Map.of("error", "missing or wrong X-API-Key"));
            return;
        }
        byte[] body = exchange.getRequestBody().readNBytes(MAX_BODY_BYTES + 1);
        if (body.length > MAX_BODY_BYTES) {
            send(exchange, 413, Map.of("error", "body larger than 1 MB; send one mission per request"));
            return;
        }
        Object json;
        try {
            json = Json.parse(new String(body, StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) {
            send(exchange, 400, Map.of("error", "invalid JSON: " + e.getMessage()));
            return;
        }

        IngestService.Result result = ingest.ingest(json);
        send(exchange, result.status(), result.body());
        if (result.status() == 201) {
            List<?> alerts = (List<?>) result.body().get("alerts");
            Main.log("ingested " + result.body().get("mission_id") + " (" + result.body().get("scenario") + "), "
                    + alerts.size() + " alert(s), pushed to " + events.clientCount() + " dashboard(s)");
            events.publish("mission_ingested", result.body());
            notifyWebhook(result.body());
        } else {
            Main.log("rejected mission (" + result.status() + "): " + result.body());
        }
    }

    private Map<String, Object> status() throws Exception {
        List<Map<String, String>> missions = new ArrayList<>(sink.rows(Schema.MISSIONS, "mission_id", "scenario", "start_time"));
        missions.sort(Comparator.comparing(m -> m.get("start_time")));
        Map<String, Integer> byScenario = new TreeMap<>();
        for (Map<String, String> m : missions) byScenario.merge(m.get("scenario"), 1, Integer::sum);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("sink", sink.describe());
        body.put("tables", sink.counts());
        body.put("missions_by_scenario", byScenario);
        body.put("latest_mission", missions.isEmpty() ? null : missions.get(missions.size() - 1).get("mission_id"));
        body.put("mission_ids", missions.stream().map(m -> m.get("mission_id")).toList());
        return body;
    }

    /** Tells the Python backend to refresh its cache and open issues for the new anomalies. Best effort. */
    private void notifyWebhook(Map<String, Object> body) {
        if (webhook == null) return;
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("event", "mission_ingested");
        event.putAll(body);
        HttpRequest request = HttpRequest.newBuilder(webhook)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(event)))
                .build();
        http.sendAsync(request, HttpResponse.BodyHandlers.discarding()).whenComplete((response, error) -> {
            if (error != null) Main.log("webhook failed: " + error.getMessage());
            else if (response.statusCode() >= 300) Main.log("webhook returned HTTP " + response.statusCode());
        });
    }

    private static void send(HttpExchange exchange, int status, Map<String, ?> body) throws IOException {
        byte[] bytes = Json.write(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }
}
