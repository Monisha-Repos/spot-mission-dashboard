package work.spotat.ingest;

import java.util.List;
import java.util.Map;

/** Loads reference data and one scenario straight from the kit. Used by `seed` and by the live feed's reset. */
final class Seeder {

    static void seed(Sink sink, KitData kit, boolean reset, String scenario) throws Exception {
        Main.log((reset ? "resetting " : "preparing ") + sink.describe());
        sink.createTables(reset);
        Map<String, Long> counts = sink.counts();
        for (Schema.Table reference : List.of(Schema.LOCATIONS, Schema.ASSETS)) {
            if (counts.getOrDefault(reference.name(), 0L) == 0) {
                sink.append(reference, kit.rows(reference));
                Main.log("loaded " + kit.rows(reference).size() + " " + reference.name());
            }
        }
        IngestService ingest = new IngestService(sink);
        int added = 0;
        for (Map<String, Object> bundle : kit.bundles(scenario)) {
            IngestService.Result result = ingest.ingest(bundle);
            if (result.status() == 201) added++;
            else if (result.status() != 409) throw new IllegalStateException("kit mission rejected: " + result.body());
        }
        Main.log("seeded " + added + " " + scenario + " mission(s); lakehouse now has " + sink.counts());
    }

    private Seeder() {}
}
