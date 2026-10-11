package work.spotat.ingest;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Plays kit missions (default IMPROVED) as if Spot were working right now: every mission becomes a timeline of
 * events (MISSION_STARTED, ACTION_STARTED, READING_RECORDED, ANOMALY_DETECTED, ACTION_COMPLETED / ACTION_FAILED,
 * MISSION_COMPLETED) pushed to every dashboard over /events as they happen, with mission time sped up.
 *
 * A mission is written to the lakehouse in one go when it completes, through the same validation as
 * POST /ingest/missions. Alarm-level anomalies go to the backend the moment they are detected, so an operator can
 * decide on them mid-mission; with pause-on-alarm the feed then waits until every alarm has a decision.
 *
 * The event shapes match the backend's GET /live/script, which the dashboard's sandbox mode plays in the browser.
 */
final class LiveFeed {
    enum State { IDLE, RUNNING, PAUSED, WAITING_FOR_DECISION, SAVING, FINISHED, RESETTING }

    /** Longest real-time wait between two events, so quiet stretches of a mission don't stall the demo. */
    private static final long MAX_GAP_MS = 5_000;
    /** Real-time pause between missions. */
    private static final long MISSION_GAP_MS = 3_000;
    private static final List<String> ORDER = List.of("MISSION_STARTED", "ACTION_STARTED", "READING_RECORDED",
            "ANOMALY_DETECTED", "ACTION_COMPLETED", "ACTION_FAILED", "MISSION_COMPLETED");

    private final Sink sink;
    private final IngestService ingest;
    private final EventHub events;
    private final Webhook webhook;
    private final Path kitDir;
    private final Object lock = new Object();

    // Everything below is guarded by `lock`.
    private State state = State.IDLE;
    private double speed = 60;
    private boolean pauseOnAlarm = true;
    private String scenario = "IMPROVED";
    private String message = "Ready. Start the feed to stream the IMPROVED missions in.";
    private String missionId, locationId, alarmId;
    private Integer battery, actionSequence, actionCount;
    private int missionIndex, missionTotal, missionsSaved;
    private String startedAt;
    private boolean stopRequested;
    private Thread worker;

    LiveFeed(Sink sink, IngestService ingest, EventHub events, Webhook webhook, Path kitDir) {
        this.sink = sink;
        this.ingest = ingest;
        this.events = events;
        this.webhook = webhook;
        this.kitDir = kitDir;
    }

    // ---------- controls ----------

    Map<String, Object> start(double speed, boolean pauseOnAlarm, String scenario) {
        synchronized (lock) {
            if (worker != null && worker.isAlive()) throw new Conflict("the feed is already " + state.name().toLowerCase());
            this.speed = clampSpeed(speed);
            this.pauseOnAlarm = pauseOnAlarm;
            this.scenario = scenario;
            this.stopRequested = false;
            this.missionIndex = this.missionTotal = this.missionsSaved = 0;
            this.missionId = this.locationId = this.alarmId = null;
            this.battery = this.actionSequence = this.actionCount = null;
            this.startedAt = Instant.now().toString();
            setState(State.RUNNING, "Starting the " + scenario + " missions at x" + fmt(this.speed) + ".");
            worker = new Thread(this::run, "live-feed");
            worker.setDaemon(true);
            worker.start();
            return statusLocked();
        }
    }

    Map<String, Object> pause() {
        synchronized (lock) {
            if (state != State.RUNNING) throw new Conflict("the feed is not running");
            setState(State.PAUSED, "Paused by the presenter.");
            return statusLocked();
        }
    }

    Map<String, Object> resume() {
        synchronized (lock) {
            if (state != State.PAUSED && state != State.WAITING_FOR_DECISION) throw new Conflict("the feed is not paused");
            alarmId = null;
            setState(State.RUNNING, "Resumed.");
            lock.notifyAll();
            return statusLocked();
        }
    }

    Map<String, Object> setSpeed(double speed) {
        synchronized (lock) {
            this.speed = clampSpeed(speed);
            publishStatus();
            lock.notifyAll();
            return statusLocked();
        }
    }

    Map<String, Object> stop() {
        Thread running;
        synchronized (lock) {
            running = worker;
            if (running == null || !running.isAlive()) throw new Conflict("the feed is not running");
            stopRequested = true;
            lock.notifyAll();
        }
        join(running);
        synchronized (lock) {
            setState(State.IDLE, "Stopped. Missions already saved stay in the lakehouse; the one in progress was not saved.");
            return statusLocked();
        }
    }

    /** Stops the feed and puts the lakehouse back to reference data + BASELINE missions, in the background. */
    Map<String, Object> reset() {
        Thread running;
        synchronized (lock) {
            if (state == State.RESETTING) throw new Conflict("a reset is already running");
            running = worker;
            stopRequested = true;
            lock.notifyAll();
        }
        join(running);
        synchronized (lock) {
            missionId = locationId = alarmId = null;
            battery = actionSequence = actionCount = null;
            missionIndex = missionTotal = missionsSaved = 0;
            setState(State.RESETTING, "Resetting the lakehouse to the BASELINE missions...");
            worker = new Thread(() -> {
                try {
                    Seeder.seed(sink, KitData.load(kitDir), true, "BASELINE");
                    synchronized (lock) {
                        setState(State.IDLE, "Reset done: the lakehouse holds the BASELINE missions only.");
                    }
                    events.publish("live_reset", Map.of("at", Instant.now().toString()));
                    webhook.send("live_reset", Map.of());
                } catch (Exception e) {
                    Main.log("reset failed: " + e);
                    synchronized (lock) {
                        setState(State.IDLE, "Reset failed: " + e.getMessage());
                    }
                }
            }, "live-reset");
            worker.setDaemon(true);
            worker.start();
            return statusLocked();
        }
    }

    Map<String, Object> status() {
        synchronized (lock) {
            return statusLocked();
        }
    }

    // ---------- playback ----------

    private void run() {
        try {
            KitData kit = KitData.load(kitDir);
            Set<String> saved = new HashSet<>();
            for (Map<String, String> row : sink.rows(Schema.MISSIONS, "mission_id")) saved.add(row.get("mission_id"));
            List<Map<String, Object>> todo = new ArrayList<>();
            for (Map<String, Object> bundle : kit.bundles(scenario)) {
                if (!saved.contains(missionOf(bundle).get("mission_id"))) todo.add(bundle);
            }
            if (todo.isEmpty()) {
                synchronized (lock) {
                    setState(State.FINISHED, "Every " + scenario + " mission is already in the lakehouse. Reset to play them again.");
                }
                return;
            }
            synchronized (lock) {
                missionTotal = todo.size();
            }
            for (int i = 0; i < todo.size(); i++) {
                if (i > 0) waitScaled(MISSION_GAP_MS, false);
                synchronized (lock) {
                    missionIndex = i + 1;
                }
                play(todo.get(i));
            }
            synchronized (lock) {
                missionId = locationId = null;
                setState(State.FINISHED, "Feed finished: " + missionsSaved + " mission(s) saved.");
            }
        } catch (InterruptedException stopped) {
            // stop() or reset() asked us to end; they set the state.
        } catch (Exception e) {
            Main.log("live feed failed: " + e);
            synchronized (lock) {
                setState(State.IDLE, "The feed stopped with an error: " + e.getMessage());
            }
        }
    }

    private void play(Map<String, Object> bundle) throws Exception {
        List<Map<String, Object>> timeline = timeline(bundle);
        double previous = 0;
        Set<String> alarmed = new HashSet<>();
        for (Map<String, Object> event : timeline) {
            double offset = ((Number) event.get("offset_sec")).doubleValue();
            waitScaled((long) ((offset - previous) * 1000), true);
            previous = offset;
            String type = (String) event.get("type");
            Map<?, ?> details = (Map<?, ?>) event.get("details");
            Map<String, Object> out = new LinkedHashMap<>(event);
            out.put("live_at", Instant.now().toString());
            synchronized (lock) {
                track(type, details);
                out.put("speed", speed);
            }
            if (type.equals("MISSION_COMPLETED")) {
                events.publish("live", out);
                save(bundle, alarmed);
                continue;
            }
            events.publish("live", out);
            if (Boolean.TRUE.equals(event.get("alarm"))) {
                String anomalyId = String.valueOf(details.get("anomaly_id"));
                alarmed.add(anomalyId);
                webhook.send("live_alert", Map.of("mission_id", event.get("mission_id"), "alerts", List.of(details)));
                synchronized (lock) {
                    if (pauseOnAlarm && state == State.RUNNING) {
                        alarmId = anomalyId;
                        setState(State.WAITING_FOR_DECISION, "Waiting for an operator to decide on alarm " + anomalyId + ".");
                    }
                }
            }
        }
    }

    /** Writes the finished mission and tells the dashboards; alarms already raised live are not raised again. */
    private void save(Map<String, Object> bundle, Set<String> alarmed) throws Exception {
        State before;
        synchronized (lock) {
            before = state;
            setState(State.SAVING, "Saving " + missionId + " to the lakehouse...");
        }
        IngestService.Result result = ingest.ingest(bundle);
        synchronized (lock) {
            if (result.status() == 201) missionsSaved++;
            setState(before == State.SAVING ? State.RUNNING : before, result.status() == 201
                    ? missionId + " saved (" + missionsSaved + " of " + missionTotal + ")."
                    : missionId + " was not saved: HTTP " + result.status());
        }
        if (result.status() != 201) {
            Main.log("live mission rejected (" + result.status() + "): " + result.body());
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>(result.body());
        Main.log("live mission " + body.get("mission_id") + " saved, pushed to " + events.clientCount() + " dashboard(s)");
        webhook.send("mission_ingested", body);
        List<Object> fresh = new ArrayList<>();
        for (Object a : (List<?>) body.get("alerts")) {
            if (!alarmed.contains(String.valueOf(((Map<?, ?>) a).get("anomaly_id")))) fresh.add(a);
        }
        body.put("alerts", fresh);
        body.put("live", true);
        events.publish("mission_ingested", body);
    }

    private void track(String type, Map<?, ?> d) {
        switch (type) {
            case "MISSION_STARTED" -> {
                missionId = String.valueOf(d.get("mission_id"));
                battery = intOrNull(d.get("battery_pct"));
                actionCount = intOrNull(d.get("action_count"));
                actionSequence = 0;
                locationId = null;
                setState(state, missionId + " started (" + missionIndex + " of " + missionTotal + ").");
                return;
            }
            case "ACTION_STARTED" -> {
                locationId = String.valueOf(d.get("location_id"));
                actionSequence = intOrNull(d.get("sequence"));
                battery = intOrNull(d.get("battery_pct"));
            }
            case "MISSION_COMPLETED" -> battery = intOrNull(d.get("end_battery_pct"));
            default -> { }
        }
        publishStatus();
    }

    /**
     * Waits {@code ms} of mission time divided by the speed (or {@code ms} of real time when not scaled),
     * frozen while paused. Throws when the feed is stopped.
     */
    private void waitScaled(long ms, boolean scaled) throws InterruptedException {
        synchronized (lock) {
            double remaining = scaled ? Math.min(ms / speed, MAX_GAP_MS) : ms;
            while (true) {
                while (!stopRequested && (state == State.PAUSED || state == State.WAITING_FOR_DECISION)) lock.wait();
                if (stopRequested) throw new InterruptedException();
                if (remaining <= 0) return;
                long started = System.nanoTime();
                lock.wait(Math.max(1, (long) remaining));
                remaining -= (System.nanoTime() - started) / 1e6;
            }
        }
    }

    // ---------- timeline ----------

    /** One mission bundle as a list of timed events. {@code offset_sec} counts from the mission start. */
    static List<Map<String, Object>> timeline(Map<String, Object> bundle) {
        Map<String, String> mission = missionOf(bundle);
        List<Map<String, String>> actions = rowsOf(bundle, "actions");
        List<Map<String, String>> readings = rowsOf(bundle, "readings");
        List<Map<String, String>> anomalies = rowsOf(bundle, "anomalies");
        actions.sort(Comparator.comparingInt(a -> Integer.parseInt(a.get("sequence"))));
        String id = mission.get("mission_id");
        LocalDateTime start = time(mission.get("start_time"));
        List<Map<String, Object>> out = new ArrayList<>();

        Map<String, Object> started = details("mission_id", id, "mission_name", mission.get("mission_name"),
                "scenario", mission.get("scenario"), "configuration_version", mission.get("configuration_version"),
                "battery_pct", num(mission.get("start_battery_pct")), "action_count", actions.size(),
                "duration_min", num(mission.get("duration_min")));
        out.add(event("MISSION_STARTED", id, mission.get("start_time"), 0, started, false));

        double last = 0;
        for (int i = 0; i < actions.size(); i++) {
            Map<String, String> a = actions.get(i);
            String actionId = a.get("action_id");
            double begin = Math.max(last, seconds(start, a.get("timestamp")));
            double next = i + 1 < actions.size() ? seconds(start, actions.get(i + 1).get("timestamp")) : Double.MAX_VALUE;
            double end = Math.min(begin + Double.parseDouble(a.get("duration_sec")), next);
            out.add(event("ACTION_STARTED", id, a.get("timestamp"), begin, details("action_id", actionId,
                    "sequence", num(a.get("sequence")), "location_id", a.get("location_id"), "asset_id", a.get("asset_id"),
                    "action_type", a.get("action_type"), "battery_pct", num(a.get("battery_pct")),
                    "configuration_version", a.get("configuration_version")), false));
            double inside = begin;
            for (Map<String, String> r : readings) {
                if (!actionId.equals(r.get("action_id"))) continue;
                inside = Math.max(inside, Math.min(Math.max(seconds(start, r.get("timestamp")), begin), end));
                out.add(event("READING_RECORDED", id, r.get("timestamp"), inside, details("reading_id", r.get("reading_id"),
                        "action_id", actionId, "location_id", r.get("location_id"), "asset_id", r.get("asset_id"),
                        "measurement_type", r.get("measurement_type"), "value", num(r.get("value")), "unit", r.get("unit"),
                        "quality", r.get("quality")), false));
            }
            for (Map<String, String> an : anomalies) {
                if (!actionId.equals(an.get("action_id"))) continue;
                inside = Math.max(inside, Math.min(Math.max(seconds(start, an.get("timestamp")), begin), end));
                out.add(event("ANOMALY_DETECTED", id, an.get("timestamp"), inside,
                        new LinkedHashMap<>(IngestService.alert(an, readings)), IngestService.isAlarm(an)));
            }
            end = Math.max(end, inside);
            boolean failed = "FAILED".equals(a.get("status"));
            out.add(event(failed ? "ACTION_FAILED" : "ACTION_COMPLETED", id, a.get("timestamp"), end, details("action_id", actionId,
                    "sequence", num(a.get("sequence")), "location_id", a.get("location_id"), "asset_id", a.get("asset_id"),
                    "action_type", a.get("action_type"), "status", a.get("status"), "failure_type", a.get("failure_type"),
                    "duration_sec", num(a.get("duration_sec")), "battery_pct", num(a.get("battery_pct"))), false));
            last = end;
        }
        double finish = Math.max(last, seconds(start, mission.get("end_time")));
        out.add(event("MISSION_COMPLETED", id, mission.get("end_time"), finish, details("mission_id", id,
                "mission_status", mission.get("mission_status"), "end_battery_pct", num(mission.get("end_battery_pct"))), false));
        out.sort(Comparator.<Map<String, Object>>comparingDouble(e -> ((Number) e.get("offset_sec")).doubleValue())
                .thenComparingInt(e -> ORDER.indexOf((String) e.get("type"))));
        return out;
    }

    private static Map<String, Object> event(String type, String missionId, String at, double offset,
                                             Map<String, Object> details, boolean alarm) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("type", type);
        e.put("mission_id", missionId);
        e.put("at", at);
        e.put("offset_sec", Math.round(offset * 10) / 10.0);
        e.put("alarm", alarm);
        e.put("details", details);
        return e;
    }

    // ---------- helpers ----------

    private void setState(State next, String why) {
        state = next;
        message = why;
        publishStatus();
    }

    private void publishStatus() {
        events.publish("live_status", statusLocked());
    }

    private Map<String, Object> statusLocked() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("state", state.name().toLowerCase());
        s.put("message", message);
        s.put("scenario", scenario);
        s.put("speed", speed);
        s.put("pause_on_alarm", pauseOnAlarm);
        s.put("mission_id", missionId);
        s.put("mission_index", missionIndex);
        s.put("mission_total", missionTotal);
        s.put("missions_saved", missionsSaved);
        s.put("location_id", locationId);
        s.put("battery_pct", battery);
        s.put("action_sequence", actionSequence);
        s.put("action_count", actionCount);
        s.put("waiting_for", alarmId);
        s.put("started_at", startedAt);
        return s;
    }

    private static void join(Thread thread) {
        if (thread == null) return;
        try {
            thread.join(30_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static double clampSpeed(double speed) {
        return Double.isFinite(speed) ? Math.max(1, Math.min(600, speed)) : 60;
    }

    private static String fmt(double speed) {
        return speed == Math.rint(speed) ? String.valueOf((long) speed) : String.valueOf(speed);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> missionOf(Map<String, Object> bundle) {
        return (Map<String, String>) bundle.get("mission");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> rowsOf(Map<String, Object> bundle, String key) {
        return new ArrayList<>((List<Map<String, String>>) bundle.get(key));
    }

    private static LocalDateTime time(String iso) {
        return LocalDateTime.parse(iso.length() > 19 ? iso.substring(0, 19) : iso);
    }

    private static double seconds(LocalDateTime start, String iso) {
        return Duration.between(start, time(iso)).toMillis() / 1000.0;
    }

    private static Object num(String raw) {
        if (raw == null || raw.isBlank()) return null;
        double d = Double.parseDouble(raw);
        return d == Math.rint(d) ? (Object) (long) d : (Object) d;
    }

    private static Integer intOrNull(Object v) {
        return v instanceof Number n ? n.intValue() : null;
    }

    private static Map<String, Object> details(Object... pairs) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], pairs[i + 1]);
        return m;
    }

    /** A control that doesn't fit the current state (HTTP 409). */
    static final class Conflict extends RuntimeException {
        Conflict(String message) {
            super(message);
        }
    }
}
