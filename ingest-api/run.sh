#!/usr/bin/env sh
# Compiles and runs the ingest API. Needs only JDK 17+.
#   ./run.sh seed --reset      lakehouse = reference data + BASELINE missions
#   ./run.sh serve             start the API on PORT (default 8081)
#   ./run.sh feed --delay 8    stream the IMPROVED missions in through the API
set -e
cd "$(dirname "$0")"
rm -rf out
javac -d out $(find src -name '*.java')
exec java -cp out work.spotat.ingest.Main "$@"
