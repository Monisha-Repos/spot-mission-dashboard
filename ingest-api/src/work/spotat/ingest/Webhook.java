package work.spotat.ingest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Tells the Python backend what happened (INGEST_WEBHOOK_URL, e.g. its /ops/ingest-hook). Best effort:
 * a slow or missing backend never holds up ingestion.
 *
 * Events: mission_ingested (refresh, open issues, snapshot), live_alert (open an alarm issue mid-mission),
 * live_reset (the lakehouse went back to baseline).
 */
final class Webhook {
    private final URI url;
    private final String apiKey;
    private final HttpClient http = HttpClient.newHttpClient();

    Webhook(String url, String apiKey) {
        this.url = url.isEmpty() ? null : URI.create(url);
        this.apiKey = apiKey;
    }

    void send(String event, Map<String, ?> body) {
        if (url == null) return;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("event", event);
        payload.putAll(body);
        HttpRequest.Builder request = HttpRequest.newBuilder(url)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(payload)));
        // The backend checks the same shared key, so only this service can raise alarms there.
        if (!apiKey.isEmpty()) request.header("X-API-Key", apiKey);
        http.sendAsync(request.build(), HttpResponse.BodyHandlers.discarding()).whenComplete((response, error) -> {
            if (error != null) Main.log("webhook " + event + " failed: " + error.getMessage());
            else if (response.statusCode() >= 300) Main.log("webhook " + event + " returned HTTP " + response.statusCode());
        });
    }
}
