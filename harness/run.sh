#!/bin/bash
# usage: [JAVA=/path/to/java] ./harness/run.sh [scenario glob]
# Requires: Java 21, ../rhino/rhino-1.9.1.jar, fonts in harness/fonts (see harness/README.md).
cd "$(dirname "$0")/.."
JAVA="${JAVA:-java}"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) SEP=';' ;;
  *) SEP=':' ;;
esac
CP="harness${SEP}../rhino/rhino-1.9.1.jar"
SCEN="${1:-harness/scenarios/*.json}"
mkdir -p harness/out
for f in $SCEN; do
  name=$(basename "$f" .json)
  "$JAVA" -cp "$CP" RhinoPids harness/prelude.js assets/jsblock/scripts/hklcd.js "$f" "harness/out/$name.png" || echo "FAIL $name"
done
