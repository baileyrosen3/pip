#!/usr/bin/env bash
# Run only inside Docker: see README.md for the local invocation.
set -euo pipefail

if [[ ! -f /.dockerenv || ! -f /etc/arch-release ]]; then
  printf '%s\n' 'clean-install: run this script inside archlinux:latest, not on your desktop.' >&2
  exit 1
fi
case "${1:-}" in
  '') from_github=false ;;
  --from-github) from_github=true ;;
  *) printf '%s\n' 'Usage: clean-install.sh [--from-github]' >&2; exit 2 ;;
esac

work=$(mktemp -d /tmp/pip-clean-install.XXXXXX)
server_pid=''
stop_server() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" || true
    server_pid=''
  fi
}
cleanup() {
  stop_server
  rm -rf "$work"
}
trap cleanup EXIT

printf '%s\n' '== Updating clean Arch and installing bootstrap tools =='
pacman -Syu --noconfirm
pacman -S --needed --noconfirm git curl python tar
if $from_github; then
  git clone https://github.com/baileyrosen3/pip.git "$work/repo"
else
  source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  git -c safe.directory="$source_dir" clone --no-local "$source_dir" "$work/repo"
  # Test exactly the checkout on disk, including uncommitted local changes.
  tar -C "$source_dir" --exclude=.git --exclude=node_modules -cf - . | tar -C "$work/repo" -xf -
fi
cd "$work/repo"

# README's dependency code block is the single source of truth.
mapfile -t packages < <(python - <<'PY'
from pathlib import Path
import re
text = Path('README.md').read_text()
commands = re.findall(r'^```bash\nomarchy pkg add ([a-z0-9+_. -]+)\n```$', text, re.MULTILINE)
if len(commands) != 1:
    raise SystemExit('clean-install: expected exactly one README dependency command')
print('\n'.join(commands[0].split()))
PY
)
[[ ${#packages[@]} -gt 0 ]] || { echo 'clean-install: README package list is empty' >&2; exit 1; }
printf '%s\n' '== Installing README dependencies =='
pacman -S --needed --noconfirm "${packages[@]}"

export PIPCTL_PORT=17319
export PIPCTL_CONFIG_DIR="$work/config"
export PIPCTL_NOTES_DIR="$work/notes"
export PIPCTL_SHELL_SOCKET="$work/shell.sock"
export XDG_RUNTIME_DIR="$work/runtime"
mkdir -p "$XDG_RUNTIME_DIR" "$work/no-tailscale"
unset HYPRLAND_INSTANCE_SIGNATURE WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS

printf '%s\n' '== Running tests and building server =='
bun test tests/
bun build --target=bun server/main.ts --outdir "$work/build"

start_server() {
  bun server/main.ts >"$work/server.log" 2>&1 &
  server_pid=$!
  for ((attempt=0; attempt<100; attempt++)); do
    if curl --silent --fail "http://127.0.0.1:$PIPCTL_PORT/" -o /dev/null; then return; fi
    if ! kill -0 "$server_pid" 2>/dev/null; then cat "$work/server.log"; return 1; fi
    sleep 0.1
  done
  cat "$work/server.log"
  echo 'clean-install: server did not become ready' >&2
  return 1
}
assert_output() {
  local label=$1 expected_status=$2 expected_output=$3
  shift 3
  local status=0 output
  output=$("$@" 2>&1 </dev/null) || status=$?
  if [[ "$status" != "$expected_status" || "$output" != "$expected_output" ]]; then
    printf '%s\n' "FAIL: $label (exit $status, expected $expected_status)" "$output" >&2
    return 1
  fi
  printf '%s\n' "PASS: $label" "$output"
}

printf '%s\n' '== Checking home screen and shared eyes =='
start_server
for path in / /avatar/pip.mjs; do
  status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PIPCTL_PORT$path")
  [[ "$status" == 200 ]] || { echo "FAIL: $path returned $status" >&2; exit 1; }
  echo "PASS: GET $path = 200"
done
stop_server

assert_output 'helper without Hyprland exits gracefully' 1 \
  'pip-agent: No active Hyprland IPC socket' python agent/pip_agent.py --no-overlay

printf '%s\n' '== Checking stopped-server and missing-Tailscale guidance =='
status=0
output=$(bun bin/pipctl status 2>&1) || status=$?
[[ "$status" == 1 && "$output" == *"http://127.0.0.1:$PIPCTL_PORT"* && \
   "$output" == *'omarchy plugin list'* && "$output" == *'blr.pip'* && \
   "$output" == *'omarchy restart shell'* && "$output" == *'~/.local/state/pip/server.log'* ]] || {
  printf '%s\n' 'FAIL: stopped-server guidance' "$output" >&2; exit 1;
}
printf '%s\n' 'PASS: stopped-server guidance' "$output"
bun_path=$(command -v bun)
status=0
output=$(PATH="$work/no-tailscale" "$bun_path" bin/pipctl pair 2>&1) || status=$?
[[ "$status" == 1 && "$output" == *'omarchy pkg add tailscale'* && \
   "$output" == *'omarchy-install-service-tailscale'* && "$output" == *'MagicDNS'* && \
   "$output" == *'HTTPS certificates'* ]] || {
  printf '%s\n' 'FAIL: missing-Tailscale guidance' "$output" >&2; exit 1;
}
printf '%s\n' 'PASS: missing-Tailscale guidance' "$output"

printf '%s\n' '== Checking missing accessibility dependencies =='
# Ignore dependent package constraints only in this disposable container.
pacman -Rdd --noconfirm at-spi2-core
assert_output 'missing AT-SPI gives one actionable line' 78 \
  'pip-agent: missing at-spi2-core (install: omarchy pkg add python-gobject at-spi2-core)' \
  python agent/pip_agent.py --no-overlay
pacman -Rdd --noconfirm python-gobject
assert_output 'missing PyGObject gives one actionable line' 78 \
  'pip-agent: missing python-gobject (install: omarchy pkg add python-gobject at-spi2-core)' \
  python agent/pip_agent.py --no-overlay

start_server
sleep 4
stop_server
python - "$work/server.log" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
message = 'pip-agent: missing python-gobject (install: omarchy pkg add python-gobject at-spi2-core)'
if text.count(message) != 1 or 'restarting' in text or 'Traceback' in text:
    print(text, file=sys.stderr)
    raise SystemExit('FAIL: missing PyGObject must not cause a helper restart loop')
print('PASS: missing PyGObject does not cause a helper restart loop')
PY
printf '%s\n' 'PASS: clean Arch install'
