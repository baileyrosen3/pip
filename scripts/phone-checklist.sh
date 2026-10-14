#!/usr/bin/env bash
# Human-in-the-loop phone checks, following hitl-loop.template.sh's step/capture pattern.
set -euo pipefail

case "${1:-}" in
  '') dry_run=false ;;
  --dry-run) dry_run=true ;;
  -h|--help) printf '%s\n' 'Usage: bash scripts/phone-checklist.sh [--dry-run]'; exit 0 ;;
  *) printf '%s\n' 'Usage: bash scripts/phone-checklist.sh [--dry-run]' >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  printf '%s\n' 'Only --dry-run or --help is accepted.' >&2
  exit 2
fi

# Keep instructions shared by the real run and the non-interactive preview.
titles=(
  'Open in Safari' 'Same-account pairing' 'Add to Home Screen' 'Theme and home screen'
  'Wake and microphone' 'When I talk: speech and caption' 'Complete long caption'
  'Interrupt an answer' 'When I hold' 'When I say Pip' 'Settings gesture'
  'Sessions gesture' 'Stay awake while idle' 'Lock and unlock recovery' 'Poke an eye'
  'Desktop pointer' 'Sleep'
)
instructions=(
  'On a real iPhone, connect Tailscale and open the printed HTTPS phone address in Safari. Confirm the page loads. In your note, record the iPhone model, iOS version and selected brain; do not include keys.'
  'Use the same Tailscale account as this computer. Confirm Pip pairs automatically without entering a key or scanning a token-bearing pairing link. If the accounts differ, switch to the same account before testing this step.'
  'In Safari, choose Share > Add to Home Screen. Open Pip using that new icon and continue all remaining checks in the home-screen app, not the Safari tab.'
  'With Pip asleep, confirm the home screen contains only a flat colour and two eyes, with no buttons or badges. In settings (two-finger tap), select Theme colour, return home, and confirm the background and eyes use the desktop theme colours.'
  'Double tap to wake Pip. Allow the microphone when iOS prompts (an already-granted permission need not prompt again). Speak and confirm the eyes react and Pip connects. If setup or an API key is missing, finish it privately before continuing.'
  'Two-finger tap for settings. Select When I talk and turn Talk out loud on, then return home. Ask a short question without holding the screen. Confirm Pip answers out loud and the full answer also appears as a caption.'
  'Ask: "Give me a 60-word answer about the Moon." Watch the caption through the whole reply. Confirm every word is accessible: the text shrinks or scrolls rather than being cut off. Record any clipping, including the last words you could read.'
  'Ask for a long spoken answer. While Pip is speaking, start talking over him: "Stop, tell me the time instead." Confirm he stops the original audio promptly and listens to the interruption.'
  'In settings select When I hold, then return home. Press and hold the screen, ask a question while holding, and release. Confirm Pip waits for release and then answers out loud with a caption.'
  'In settings select When I say Pip, then return home. Say "Pip, what is two plus two?" without holding. Confirm he answers. Say an unrelated sentence without his name and confirm it does not trigger an answer.'
  'From the home screen, use a two-finger tap. Confirm settings opens, remains usable, and can be dismissed to return to the eyes.'
  'From the home screen, swipe up from the bottom edge. Confirm sessions opens and can be dismissed. An empty session list is fine; do not enable meeting notes just for this check.'
  'With Pip awake on his home screen, leave the phone idle and untouched for a full two minutes (use a separate clock). Confirm the display stays on and Pip remains connected. Do not change the phone Auto-Lock setting to make this pass.'
  'Lock the iPhone, wait about ten seconds, then unlock and return to Pip. Background listening is not expected on iOS. Confirm he reconnects; tap if iOS requires a gesture to resume the microphone, then say "Pip, are you there?" and confirm he hears and answers. Note whether a tap was needed.'
  'Tap directly on one eye. Confirm it dents or visibly winces at your finger, then returns to normal.'
  'Put something non-sensitive on the desktop. Ask "Pip, what is on my screen?" (or hold to ask if needed). Confirm he describes the actual desktop and his pointer flies out on that desktop. Do not grant computer control just for this check.'
  'Double tap to put Pip to sleep. Confirm his eyes show sleep and he no longer responds to speech. Restore any settings you changed for the checklist if desired.'
)

if $dry_run; then
  printf '%s\n' 'Pip phone checklist — dry run (no prompts, server calls, log capture or files).'
  for index in "${!titles[@]}"; do
    printf '\n>>> %02d. %s\n%s\n' "$((index + 1))" "${titles[index]}" "${instructions[index]}"
  done
  printf '\n%d steps. Real runs record Pass / Fail / Skip, an optional note and per-step server log excerpts.\n' "${#titles[@]}"
  exit 0
fi

if [[ ! -t 0 || ! -t 1 ]]; then
  printf '%s\n' 'Run in an interactive terminal, or use --dry-run to preview every step.' >&2
  exit 2
fi
if ! command -v python3 >/dev/null; then
  printf '%s\n' 'python3 is required to redact secrets from the report (Omarchy package: python).' >&2
  exit 2
fi

# Redact before anything from status, notes or logs reaches the shareable report.
# Whole sensitive lines are withheld, including unknown key formats; common bare
# API keys, JWTs and long opaque credentials are also removed from other lines.
redact() {
  python3 -c '
import re, sys
sensitive = re.compile(r"api[ _-]?key|\bkeys?\b|authorization|bearer|[a-z_]*token|secret|password|credential|[?&]key=", re.I)
opaque = re.compile(r"AIza[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+|[A-Za-z0-9_+/=-]{32,}")
for line in sys.stdin:
    if sensitive.search(line):
        print("[REDACTED: potentially sensitive line]")
    else:
        # Indent report input as literal Markdown, even if logs contain fences.
        print("    " + opaque.sub("[REDACTED]", line.rstrip("\n")))
'
}

umask 077
work=$(mktemp -d)
results=$(mktemp "$HOME/pip-phone-checklist-$(date +%Y-%m-%d-%H%M%S)-XXXXXX.md")
log_file="$HOME/.local/state/pip/server.log"
tail_pid=''
active_step=''
passes=0
failures=0
skips=0
completed=false

stop_capture() {
  if [[ -n "$tail_pid" ]]; then
    # Let tail drain its final polling interval before closing the capture.
    sleep 0.2
    kill "$tail_pid" 2>/dev/null || true
    wait "$tail_pid" 2>/dev/null || true
    tail_pid=''
  fi
}

record_step() {
  local verdict="$1" note="$2"
  {
    printf '\n## %02d. %s — %s\n\n' "$((active_step + 1))" "${titles[active_step]}" "$verdict"
    printf '%s\n\n' "${instructions[active_step]}"
    printf 'Note:\n\n'
    printf '%s\n' "${note:-(none)}" | redact
    printf '\nServer log excerpt (last 120 lines captured during this step):\n\n'
    if [[ -s "$work/step-$active_step.log" ]]; then
      tail -n 120 "$work/step-$active_step.log" | redact
    else
      printf '    (No server log lines arrived during this step.)\n'
    fi
  } >> "$results"
  active_step=''
}

finish() {
  stop_capture
  if [[ -n "$active_step" ]]; then
    record_step Skip 'Run interrupted before a verdict was recorded.'
    skips=$((skips + 1))
  fi
  {
    printf '\n## Summary\n\nPass: %d · Fail: %d · Skip: %d\n' "$passes" "$failures" "$skips"
    if ! $completed; then printf '\nIncomplete run: not all steps were reached.\n'; fi
    printf '\nSkipped or unrun steps are not release-test evidence. Review for private data before attaching this file to an issue.\n'
  } >> "$results"
  rm -rf -- "$work"
  printf '\nPass: %d · Fail: %d · Skip: %d\nResults: %s\n' "$passes" "$failures" "$skips" "$results"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

{
  printf '# Pip phone checklist\n\nStarted: %s\n' "$(date --iso-8601=seconds)"
  printf '\nRun on a real phone; verdicts are human observations, not automated certification.\n'
} >> "$results"
printf '%s\n' 'Pip phone checklist: leave this terminal open while you test on your iPhone.'
printf '%s\n' 'Each step records Pass / Fail / Skip plus an optional note. Ctrl-C saves an incomplete report.'
printf '%s\n' 'Speech uses your configured brain and may incur API charges. No settings are changed by this script.'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if command -v pipctl >/dev/null; then
  cli=$(command -v pipctl)
elif [[ -x "$script_dir/../bin/pipctl" ]]; then
  cli="$script_dir/../bin/pipctl"
else
  printf '%s\n' 'Cannot find pipctl on PATH or in this plugin checkout.' >&2
  exit 2
fi
if ! status=$("$cli" status 2>&1); then
  printf '%s\n' "$status" | redact
  printf '\nStatus failed; finish desktop setup before running the phone checklist.\n' >&2
  printf '\nStatus failed:\n\n' >> "$results"
  printf '%s\n' "$status" | redact >> "$results"
  exit 2
fi
phone_url=''
while IFS= read -r line; do
  if [[ "$line" =~ URL:[[:space:]]*(https://[^[:space:]]+) ]]; then
    phone_url="${BASH_REMATCH[1]}"
    # Never print or encode a credential-bearing pairing link.
    phone_url="${phone_url%%[?#]*}"
    break
  fi
done <<< "$status"
if [[ -z "$phone_url" ]]; then
  printf '%s\n' 'pipctl status has no HTTPS phone address. Finish phone access setup in the bar menu, then rerun.' >&2
  exit 2
fi
printf '\nPhone address: %s\n' "$phone_url"
if command -v qrencode >/dev/null; then
  qrencode -t ansiutf8 "$phone_url"
else
  printf '%s\n' 'qrencode is missing (omarchy pkg add qrencode); type the address into Safari instead.'
fi
if [[ ! -r "$log_file" ]]; then
  printf '\nWarning: %s is not readable; log capture will retry while you test.\n' "$log_file"
fi
use_gum=false
if command -v gum >/dev/null; then use_gum=true; fi

for index in "${!titles[@]}"; do
  active_step="$index"
  # Private, temporary per-step captures are removed on normal exit or Ctrl-C.
  tail -n 0 --follow=name --retry --sleep-interval=0.1 "$log_file" > "$work/step-$index.log" 2>&1 &
  tail_pid=$!
  printf '\n>>> %02d/%d. %s\n%s\n' "$((index + 1))" "${#titles[@]}" "${titles[index]}" "${instructions[index]}"
  if $use_gum; then
    verdict=$(gum choose --header 'After trying this step, choose a verdict:' Pass Fail Skip)
    note=$(gum input --placeholder 'Optional note (Enter to leave blank; never paste keys)')
  else
    while true; do
      read -r -p 'After trying this step: [p]ass / [f]ail / [s]kip: ' answer
      case "$answer" in
        p|P|pass|Pass) verdict=Pass; break ;;
        f|F|fail|Fail) verdict=Fail; break ;;
        s|S|skip|Skip) verdict=Skip; break ;;
        *) printf '%s\n' 'Enter p, f or s.' ;;
      esac
    done
    read -r -p 'Optional note (Enter to leave blank; never paste keys): ' note
  fi
  stop_capture
  record_step "$verdict" "$note"
  case "$verdict" in
    Pass) passes=$((passes + 1)) ;;
    Fail) failures=$((failures + 1)) ;;
    Skip) skips=$((skips + 1)) ;;
  esac
done
completed=true
if (( failures > 0 )); then exit 1; fi
