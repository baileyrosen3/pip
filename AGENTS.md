# Pip

Omarchy shell plugin (`manifest.json`, `*.qml`, `qml/`), bun server (`server/`), python desktop helper (`agent/`), phone web app (`web/`) and shared avatar modules (`avatar/`, drawn by both QML and the browser). Read `README.md` for the product and `GLOSSARY.md` for the vocabulary.

- Tests: `bun test tests/`. Build check: `bun build --target=bun server/main.ts --outdir <tmp>`.
- Pip may be running live from this checkout (symlinked as `~/.config/omarchy/plugins/blr.pip`). Test servers must use their own `PIPCTL_PORT`, `PIPCTL_CONFIG_DIR`, `PIPCTL_NOTES_DIR` and `PIPCTL_SHELL_SOCKET`; never write the live `~/.config/pip`.
- Never call a Hyprland dispatcher without explicit arguments (an argument-less `hl.dsp.cursor.move()` crashed Hyprland 0.56).

## Agent skills

### Issue tracker

GitHub Issues on baileyrosen3/pip (gh CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
