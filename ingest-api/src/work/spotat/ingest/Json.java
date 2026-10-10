package work.spotat.ingest;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Minimal JSON reader/writer so the service needs nothing beyond the JDK. Numbers parse to BigDecimal. */
public final class Json {

    public static Object parse(String text) {
        Parser p = new Parser(text);
        try {
            p.ws();
            Object value = p.value();
            p.ws();
            if (p.i != text.length()) throw p.error("unexpected trailing characters");
            return value;
        } catch (IndexOutOfBoundsException e) {
            throw p.error("unexpected end of input");
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value) {
        if (value instanceof Map<?, ?> m) return (Map<String, Object>) m;
        throw new IllegalArgumentException("expected a JSON object");
    }

    public static String write(Object value) {
        StringBuilder b = new StringBuilder();
        write(b, value);
        return b.toString();
    }

    private static void write(StringBuilder b, Object v) {
        if (v == null) {
            b.append("null");
        } else if (v instanceof Number || v instanceof Boolean) {
            b.append(v);
        } else if (v instanceof Map<?, ?> m) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) b.append(',');
                first = false;
                quote(b, String.valueOf(e.getKey()));
                b.append(':');
                write(b, e.getValue());
            }
            b.append('}');
        } else if (v instanceof Collection<?> c) {
            b.append('[');
            boolean first = true;
            for (Object item : c) {
                if (!first) b.append(',');
                first = false;
                write(b, item);
            }
            b.append(']');
        } else {
            quote(b, v.toString());
        }
    }

    private static void quote(StringBuilder b, String s) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
                }
            }
        }
        b.append('"');
    }

    private static final class Parser {
        private final String s;
        private int i;

        Parser(String s) { this.s = s; }

        Object value() {
            return switch (s.charAt(i)) {
                case '{' -> object();
                case '[' -> array();
                case '"' -> string();
                case 't' -> literal("true", Boolean.TRUE);
                case 'f' -> literal("false", Boolean.FALSE);
                case 'n' -> literal("null", null);
                default -> number();
            };
        }

        private Map<String, Object> object() {
            Map<String, Object> map = new LinkedHashMap<>();
            i++;
            ws();
            if (s.charAt(i) == '}') { i++; return map; }
            while (true) {
                ws();
                if (s.charAt(i) != '"') throw error("expected a quoted key");
                String key = string();
                ws();
                expect(':');
                ws();
                map.put(key, value());
                ws();
                if (s.charAt(i) == ',') { i++; continue; }
                expect('}');
                return map;
            }
        }

        private List<Object> array() {
            List<Object> list = new ArrayList<>();
            i++;
            ws();
            if (s.charAt(i) == ']') { i++; return list; }
            while (true) {
                ws();
                list.add(value());
                ws();
                if (s.charAt(i) == ',') { i++; continue; }
                expect(']');
                return list;
            }
        }

        private String string() {
            StringBuilder b = new StringBuilder();
            i++;
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c != '\\') { b.append(c); continue; }
                char e = s.charAt(i++);
                switch (e) {
                    case '"', '\\', '/' -> b.append(e);
                    case 'b' -> b.append('\b');
                    case 'f' -> b.append('\f');
                    case 'n' -> b.append('\n');
                    case 'r' -> b.append('\r');
                    case 't' -> b.append('\t');
                    case 'u' -> {
                        try {
                            b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        } catch (NumberFormatException ex) {
                            throw error("bad \\u escape");
                        }
                        i += 4;
                    }
                    default -> throw error("bad escape \\" + e);
                }
            }
        }

        private BigDecimal number() {
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            try {
                return new BigDecimal(s.substring(start, i));
            } catch (NumberFormatException e) {
                throw error("unexpected character '" + s.charAt(start) + "'");
            }
        }

        private Object literal(String word, Object value) {
            if (!s.startsWith(word, i)) throw error("unexpected token");
            i += word.length();
            return value;
        }

        private void expect(char c) {
            if (s.charAt(i) != c) throw error("expected '" + c + "'");
            i++;
        }

        void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        IllegalArgumentException error(String message) {
            return new IllegalArgumentException(message + " at position " + i);
        }
    }

    private Json() {}
}
