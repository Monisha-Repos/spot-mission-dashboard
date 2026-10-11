# Backend container for Render: the Java ingest API, the FastAPI backend and Caddy (the one public port)
# in one service, so both APIs share the lakehouse CSVs and ops.db on one persistent disk. See deploy/README.md.
FROM eclipse-temurin:17-jdk AS java
WORKDIR /build
COPY ingest-api/src ./src
RUN javac -d out $(find src -name '*.java')

FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:$PATH \
    JAVA_TOOL_OPTIONS="-Xmx160m -XX:+UseSerialGC"
COPY --from=eclipse-temurin:17-jre /opt/java/openjdk /opt/java/openjdk
COPY --from=caddy:2.8 /usr/bin/caddy /tmp/caddy
# The caddy image's binary carries a file capability (bind ports < 1024), which hosts running with
# no-new-privileges (Render) refuse to exec. A plain copy drops it; we listen on PORT (10000) anyway.
RUN cp /tmp/caddy /usr/local/bin/caddy && rm /tmp/caddy \
    && apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY ml ml
COPY data/kit data/kit
COPY assets assets
COPY docs/challenge docs/challenge
COPY docs/spot-user-guide docs/spot-user-guide
COPY --from=java /build/out ingest-api/out
COPY deploy deploy

EXPOSE 10000
CMD ["bash", "/app/deploy/start.sh"]
