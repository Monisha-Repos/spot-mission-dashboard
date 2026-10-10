package work.spotat.ingest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** RFC 4180 CSV, enough for the kit files and the local lakehouse. */
final class Csv {

    static List<Map<String, String>> read(Path file) throws IOException {
        List<List<String>> lines = parse(Files.readString(file, StandardCharsets.UTF_8));
        if (lines.isEmpty()) return List.of();
        List<String> header = new ArrayList<>(lines.get(0));
        header.set(0, header.get(0).replace("﻿", ""));
        List<Map<String, String>> rows = new ArrayList<>();
        for (List<String> line : lines.subList(1, lines.size())) {
            if (line.size() == 1 && line.get(0).isEmpty()) continue;
            Map<String, String> row = new LinkedHashMap<>();
            for (int c = 0; c < header.size(); c++) row.put(header.get(c), c < line.size() ? line.get(c) : "");
            rows.add(row);
        }
        return rows;
    }

    static String line(List<String> fields) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < fields.size(); i++) {
            if (i > 0) b.append(',');
            String f = fields.get(i);
            if (f.indexOf(',') >= 0 || f.indexOf('"') >= 0 || f.indexOf('\n') >= 0 || f.indexOf('\r') >= 0) {
                b.append('"').append(f.replace("\"", "\"\"")).append('"');
            } else {
                b.append(f);
            }
        }
        return b.toString();
    }

    private static List<List<String>> parse(String text) {
        List<List<String>> lines = new ArrayList<>();
        List<String> line = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c != '"') field.append(c);
                else if (i + 1 < text.length() && text.charAt(i + 1) == '"') { field.append('"'); i++; }
                else quoted = false;
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                line.add(field.toString());
                field.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                line.add(field.toString());
                field.setLength(0);
                lines.add(line);
                line = new ArrayList<>();
            } else {
                field.append(c);
            }
        }
        if (field.length() > 0 || !line.isEmpty()) {
            line.add(field.toString());
            lines.add(line);
        }
        return lines;
    }

    private Csv() {}
}
