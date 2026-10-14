# Real-phone checklist

Pip's iPhone Safari release check is a human-run test on a real device, first in Safari and then as an **Add to Home Screen** app. Desktop browser checks cannot certify iOS microphone permissions, audio playback, wake locks or lock/unlock recovery. Android Chrome is community-tested: run the same checklist and report your device and browser.

## Run it

From a Pip checkout on the desktop:

```bash
bash scripts/phone-checklist.sh
```

For an installed plugin, the equivalent command is:

```bash
bash ~/.config/omarchy/plugins/blr.pip/scripts/phone-checklist.sh
```

Have Pip running with phone access already configured, a working brain key, and the iPhone connected to **the same Tailscale account** as the computer. The script reads the HTTPS address from `pipctl status` (falling back to this plugin's `bin/pipctl`) and displays a QR code with `qrencode` when installed. It does not configure Tailscale, start or restart Pip, change settings, inject desktop input, or collect API keys. Speech uses the configured brain and may incur charges. Keep sensitive windows off the desktop for the screen-description step.

Run in an interactive terminal. `gum` supplies the verdict and note prompts if available; otherwise ordinary terminal input works. Python 3 (Omarchy's `python` package) is required for report redaction. `qrencode` is optional for the script; without it, type the printed address into Safari. Leave the terminal open, follow each instruction on the iPhone, then choose **Pass**, **Fail** or **Skip** and optionally add a note. Record the device model, iOS version and selected brain in the first note. Existing microphone permission need not produce another prompt.

To preview all steps without prompts, server calls, log capture or report files:

```bash
bash scripts/phone-checklist.sh --dry-run
```

## Coverage

- Safari loading and same-account automatic pairing.
- Add to Home Screen and launching the installed home-screen app.
- Only colour and eyes on the home screen, using the desktop theme colours.
- Double-tap wake, microphone permission and reactive eyes.
- **When I talk**, spoken answers and full captions, including a 60-word answer without clipping.
- Interrupting spoken answers by talking, **When I hold** (hold, ask, release), and **When I say Pip**.
- Two-finger settings and swipe-up sessions gestures.
- Staying awake for two minutes while idle without changing iOS Auto-Lock.
- Lock/unlock reconnection and microphone recovery, allowing the tap iOS may require.
- Eye-poke deformation, the desktop pointer flying out for a screen question, and double-tap sleep.

Pip is a foreground web app: listening while the phone is locked is **not** expected. A tap to resume the microphone after unlocking is acceptable; record whether it was needed. Empty sessions are fine, and neither meeting notes nor computer control needs enabling for these checks. Changing reply modes and theme is done by the human; restore your preferred settings at the end.

## Results and failures

The script prints the path to a private report such as `~/pip-phone-checklist-2026-10-14-143000-AbCd12.md`. It contains each reached step's instructions, verdict, optional note and the last 120 server-log lines captured **during that step**, plus a summary. It tails `~/.local/state/pip/server.log` separately for each step, following log rotation. Private temporary captures are deleted when the script exits normally or receives Ctrl-C; the shareable report redacts credential-labelled lines, common API-key formats and long opaque strings. Missing logs are recorded rather than preventing the human checks.

The exit status is **1 if any step fails**, **0 if all steps finish without failures** (skips still appear in the report), and **2 for setup or usage errors**. Ctrl-C saves the partial report and exits non-zero. Skipped and unrun steps do not count as passes: every step must pass on a real iPhone before the release checklist is complete. A dry run proves only the checklist script, not phone behaviour.

For a failure, [open a GitHub issue](https://github.com/baileyrosen3/pip/issues/new) and attach the results file. Include the failed step number, what you expected, what happened, and whether it reproduces in Safari, the home-screen app, or both. Reference [the iPhone checklist ticket #5](https://github.com/baileyrosen3/pip/issues/5); Android reports should say Android Chrome and give the Android/Chrome versions. **Review the report before sharing**: redaction is best-effort and logs or notes may still include private screen descriptions, captions, names or tailnet addresses. Never attach raw captures, API keys or token-bearing pairing links. Human failures need fixing and another real-device run; committing this script alone does not complete ticket #5.
