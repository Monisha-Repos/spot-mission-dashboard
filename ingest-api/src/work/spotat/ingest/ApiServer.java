package work.spotat.ingest;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
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
 *   GET  /events            Server-Sent Events: mission_ingested (with the alerts that need an operator),
 *                           live (one mission event as it happens), live_status, live_reset
 *   GET  /live/status       what the live feed is doing
 *   POST /live/start        {"speed": 60, "pause_on_alarm": true, "scenario": "IMPROVED"}
 *   POST /live/pause | /live/resume | /live/stop | /live/reset    POST /live/speed {"speed": 120}
 * Every POST needs X-API-Key when INGEST_API_KEY is set (the backend sends it for signed-in operators).
 */
final class ApiServer {
    private static final int MAX_BODY_BYTES = 1 << 20;

    private final Sink sink;
    private final IngestService ingest;
    private final EventHub events;
    private final LiveFeed live;
    private final String apiKey;
    private final Webhook webhook;

    ApiServer(Sink sink, IngestService ingest, EventHub events, LiveFeed live, String apiKey, Webhook webhook) {
        this.sink = sink;
        this.ingest = ingest;
        this.events = events;
        this.live = live;
        this.apiKey = apiKey;
        this.webhook = webhook;
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
            if (method.equals("POST") && !authorized(exchange)) {
                send(exchange, 401, Map.of("error", "missing or wrong X-API-Key"));
                exchange.close();
                return;
            }
            switch (method + " " + path) {
                case "GET /health" -> send(exchange, 200, Map.of("status", "ok", "sink", sink.describe()));
                case "GET /ingest/status" -> send(exchange, 200, status());
                case "POST /ingest/missions" -> postMission(exchange);
                case "GET /live/status" -> send(exchange, 200, live.status());
                case "POST /live/start" -> {
                    Map<String, Object> body = jsonBody(exchange);
                    send(exchange, 200, live.start(number(body.get("speed"), 60), !Boolean.FALSE.equals(body.get("pause_on_alarm")),
                            String.valueOf(body.getOrDefault("scenario", "IMPROVED")).toUpperCase()));
                }
                case "POST /live/speed" -> send(exchange, 200, live.setSpeed(number(jsonBody(exchange).get("speed"), 60)));
                case "POST /live/pause" -> send(exchange, 200, live.pause());
                case "POST /live/resume" -> send(exchange, 200, live.resume());
                case "POST /live/stop" -> send(exchange, 200, live.stop());
                case "POST /live/reset" -> send(exchange, 202, live.reset());
                case "GET /events" -> {
                    events.subscribe(exchange);
                    return; // stays open; EventHub owns it now
                }
                default -> {
                    if (method.equals("OPTIONS")) exchange.sendResponseHeaders(204, -1);
                    else send(exchange, 404, Map.of("error", "no route for " + method + " " + path));
                }
            }
        } catch (LiveFeed.Conflict e) {
            try {
                send(exchange, 409, Map.of("error", e.getMessage(), "status", live.status()));
            } catch (IOException ignored) {
                // The client went away.
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

    private boolean authorized(HttpExchange exchange) {
        if (apiKey.isEmpty()) return true;
        String given = exchange.getRequestHeaders().getFirst("X-API-Key");
        return given != null && MessageDigest.isEqual(apiKey.getBytes(StandardCharsets.UTF_8), given.getBytes(StandardCharsets.UTF_8));
    }

    /** A small JSON object body for the live controls; an empty body is {}. */
    private static Map<String, Object> jsonBody(HttpExchange exchange) throws IOException {
        byte[] body = exchange.getRequestBody().readNBytes(10_000);
        if (body.length == 0) return Map.of();
        try {
            return Json.object(Json.parse(new String(body, StandardCharsets.UTF_8)));
        } catch (IllegalArgumentException e) {
            return Map.of();
        }
    }

    private static double number(Object value, double fallback) {
        if (value instanceof Number n) return n.doubleValue();
        try {
            return value == null ? fallback : Double.parseDouble(value.toString());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private void postMission(HttpExchange exchange) throws Exception {
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
            webhook.send("mission_ingested", result.body());
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

    private static void send(HttpExchange exchange, int status, Map<String, ?> body) throws IOException {
        byte[] bytes = Json.write(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }
}
