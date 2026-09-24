#!/usr/bin/env bash
# Driver for TLA+ model checks. See SKILL.md next to this file.
#
#   tlc.sh install                        download + check tla2tools.jar
#   tlc.sh parse  <Spec.tla>              syntax + semantic check (SANY)
#   tlc.sh check  <Spec.tla> [Model.cfg]  model check one config
#   tlc.sh all    [dir]                   check every *.cfg under dir (default specs/tla)
#   tlc.sh trace  <cfg-name> [var ...]    show the last trace, one line per state
#
# A .cfg whose first line contains "EXPECT: violation" must FAIL.
# Use that for counterfactual configs that prove the invariant has teeth.
# A spec with "--algorithm" (PlusCal) is translated before the check.
set -uo pipefail

TLA_VERSION="1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
TLA_DIR="${TLA_TOOLS_DIR:-$HOME/.cache/tla}"
JAR="$TLA_DIR/tla2tools-$TLA_VERSION.jar"
LOG_DIR="${TLC_LOG_DIR:-${TMPDIR:-/tmp}/tlc-logs}"
# The container sets JAVA_TOOL_OPTIONS; the JVM echoes it on stderr. Hide it.
JAVA=(java -XX:+UseParallelGC -cp "$JAR")

die() { echo "tlc.sh: $*" >&2; exit 2; }
quiet() { grep -v '^Picked up JAVA_TOOL_OPTIONS'; }

install() {
  [ -f "$JAR" ] && echo "$TLA_SHA256  $JAR" | sha256sum -c --quiet - 2>/dev/null && return 0
  command -v java >/dev/null || die "java not found. Install: apt-get install -y openjdk-21-jre-headless"
  mkdir -p "$TLA_DIR"
  curl -sSfL -o "$JAR.part" \
    "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar" \
    || die "download failed"
  echo "$TLA_SHA256  $JAR.part" | sha256sum -c --quiet - || { rm -f "$JAR.part"; die "sha256 mismatch"; }
  mv "$JAR.part" "$JAR"
  echo "installed $JAR"
}

parse() {
  local spec="$1" out rc
  out="$(cd "$(dirname "$spec")" && "${JAVA[@]}" tla2sany.SANY "$(basename "$spec")" 2>&1 | quiet)"
  rc=$?
  echo "$out"
  # SANY exits 0 on semantic errors (for example "Unknown operator"). Read the text too.
  [ "$rc" -eq 0 ] && ! grep -qE '^\*\*\* Errors|Parse Error|Lexical error' <<<"$out"
}

# check <spec> <cfg> -> prints a summary line, returns 0 when the result matches EXPECT.
check() {
  local spec="$1" cfg="${2:-${1%.tla}.cfg}"
  [ -f "$spec" ] || die "no spec: $spec"
  [ -f "$cfg" ] || die "no config: $cfg"
  local dir; dir="$(cd "$(dirname "$spec")" && pwd)"
  cfg="$(cd "$(dirname "$cfg")" && pwd)/$(basename "$cfg")"   # absolute: TLC runs from $dir
  local expect="pass"
  head -1 "$cfg" | grep -q 'EXPECT: violation' && expect="violation"

  if grep -q -- '--algorithm' "$spec"; then
    ( cd "$dir" && "${JAVA[@]}" pcal.trans -nocfg "$(basename "$spec")" 2>&1 | quiet | grep -iE 'error|translation completed' )
    rm -f "$dir/$(basename "${spec%.tla}").old"
  fi

  mkdir -p "$LOG_DIR"
  local name; name="$(basename "${cfg%.cfg}")"
  local log="$LOG_DIR/$name.log" meta; meta="$(mktemp -d)"
  ( cd "$dir" && "${JAVA[@]}" tlc2.TLC -workers auto -metadir "$meta" \
      -config "$cfg" "$(basename "$spec")" ) \
      2>&1 | quiet > "$log"
  local rc=${PIPESTATUS[0]}
  rm -rf "$meta"

  # TLC exit codes: 0 pass, 10-14 property violation, 75+ spec/config/tool error.
  local got
  case "$rc" in
    0) got="pass" ;;
    1[0-4]) got="violation" ;;
    *) got="error" ;;
  esac
  local states; states="$(grep -oE '[0-9,]+ distinct states found' "$log" | tail -1)"
  if [ "$got" = "$expect" ]; then
    echo "OK    $name: $got (expected $expect; ${states:-no state count}) log=$log"
    return 0
  fi
  echo "FAIL  $name: $got (expected $expect; tlc exit $rc) log=$log"
  # Show the error and the counterexample trace (or the parse error).
  if [ "$got" = "error" ]; then tail -30 "$log"
  else sed -n '/^Error:/,/^[0-9,]* states generated/p' "$log" | head -200; fi
  return 1
}

all() {
  local root="${1:-specs/tla}" fail=0 n=0 cfg spec
  while IFS= read -r cfg; do
    # Model.cfg or Model_<Variant>.cfg checks Model.tla in the same dir.
    spec="$(dirname "$cfg")/$(basename "$cfg" .cfg | sed 's/_.*//').tla"
    n=$((n + 1))
    check "$spec" "$cfg" || fail=$((fail + 1))
  done < <(find "$root" -name '*.cfg' | sort)
  echo "---- $((n - fail))/$n configs matched their EXPECT"
  [ "$fail" -eq 0 ]
}

# trace <cfg-name> [var ...] -> one line per state, only the named variables.
trace() {
  local log="$LOG_DIR/${1%.cfg}.log"; shift
  [ -f "$log" ] || die "no log: $log (run check first)"
  local pat='[a-zA-Z_]+'
  [ $# -gt 0 ] && pat="($(IFS='|'; echo "$*"))"
  grep -E '^Error: (Invariant|Action|Temporal|Deadlock)' "$log"
  grep -E "^State [0-9]+|^/\\\\ $pat = " "$log" \
    | sed -E 's/ line [0-9]+, col [0-9]+ to line [0-9]+, col [0-9]+ of module [A-Za-z0-9]+//' \
    | awk '/^State/ { if (row) print row; row = $0; next } { row = row "  " substr($0, 4) } END { print row }'
}

cmd="${1:-}"; shift || true
case "$cmd" in
  install) install ;;
  parse)   install >/dev/null && parse "$@" ;;
  check)   install >/dev/null && check "$@" ;;
  all)     install >/dev/null && all "$@" ;;
  trace)   trace "$@" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
