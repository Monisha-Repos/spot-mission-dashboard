# Compiles and runs the ingest API. Needs only JDK 17+.
#   .\run.ps1 seed --reset      lakehouse = reference data + BASELINE missions
#   .\run.ps1 serve             start the API on PORT (default 8081)
#   .\run.ps1 feed --delay 8    stream the IMPROVED missions in through the API
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (Test-Path out) { Remove-Item -Recurse -Force out }
    javac -d out (Get-ChildItem -Recurse src -Filter *.java).FullName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    java -cp out work.spotat.ingest.Main @args
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
