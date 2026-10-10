package work.spotat.ingest;

import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Server-Sent Events for GET /events. The dashboard opens one EventSource and gets a
 * {@code mission_ingested} event (with its alerts) the moment a mission lands.
 */
final class EventHub {
    private final List<HttpExchange> clients = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sse-heartbeat");
        t.setDaemon(true);
        return t;
    });

    EventHub() {
        // Comment lines keep proxies and load balancers from closing idle streams.
        heartbeat.scheduleAtFixedRate(() -> write(": heartbeat\n\n"), 15, 15, TimeUnit.SECONDS);
    }

    /** Keeps the exchange open; the HTTP handler must not close it. */
    void subscribe(HttpExchange exchange) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
        exchange.getResponseHeaders().set("Cache-Control", "no-cache");
        exchange.sendResponseHeaders(200, 0);
        OutputStream out = exchange.getResponseBody();
        out.write(": connected\n\n".getBytes(StandardCharsets.UTF_8));
        out.flush();
        clients.add(exchange);
    }

    void publish(String event, Object data) {
        write("event: " + event + "\ndata: " + Json.write(data) + "\n\n");
    }

    int clientCount() {
        return clients.size();
    }

    private void write(String message) {
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        for (HttpExchange client : clients) {
            try {
                OutputStream out = client.getResponseBody();
                synchronized (client) {
                    out.write(bytes);
                    out.flush();
                }
            } catch (IOException e) {
                clients.remove(client);
                client.close();
            }
        }
    }
}
