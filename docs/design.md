# Pip design language

Pip is two liquid-ink eyes on one flat colour. The phone screen is his body. All expression lives in the eyes: no mouth, ears or other facial furniture. **Flat** is the default pure-ink rendering; **Glass** adds smoky depth and a contour-following highlight; **Glow** uses luminous layered contours. All three share exactly the same morphing physics. The character and motion contract is [eyes.md](eyes.md); shared UI values come from `design/tokens.json`.

The Omarchy theme is used exactly, not hue-shifted or lightness-clamped: Theme means theme background plus accent eyes (with a contrast fallback to another theme colour); Accent means accent background and dark-background eyes. Swatches come from the theme’s accent, red, green, cyan, magenta and yellow. A custom body colour picks readable eyes from that same theme. The server reads and watches Omarchy’s `colors.toml` and sends the full palette to every surface. Browser theme chrome matches `palette.face`.

## Nothing until needed

At rest the phone shows only colour and eyes. No connection badge, mode label, navigation buttons or permanent captions. Connection trouble earns one tiny line at the bottom; a successful connection removes it. A one-time pairing hint explains navigation and disappears.

- Two-finger tap opens settings.
- Swipe up from the bottom edge opens sessions.
- Hold the top-right corner for settings or top-left for sessions (650 ms).
- Double tap wakes or sleeps Pip; hold elsewhere to ask, release to answer; a tap pokes the eyes.
- Hidden, labelled corner targets remain keyboard and screen-reader accessible. Enter wakes/sleeps, Space holds to ask, S opens settings, Up opens sessions, Escape closes a sheet.

## Voice

Pip’s phone reply is plain Fredoka in the readable eye colour under the eyes, never a box, bubble or tail. Words fade in independently (40 ms stagger, 160 ms fade), retaining words already streamed, and fade out one by one after a short reading interval. Normal type is 23 px, weight 450; long replies shrink to 14 px and clamp to three lines. The canvas remains the dominant surface.

On the desktop a small, nearly opaque ink-glass pill gives Fredoka text enough contrast over windows. No tail, hairline, highlight or layered shadows. Keep it close to Pip and out of the pointed-at target; flip below near the top edge. Short action acknowledgements use the same quiet backing.

## Sheets and controls

Settings, sessions and pairing are flat neutral surfaces, with generous 24 px margins and vertical space. No nested cards or ornamental glass. A small grabber and plain Done button suffice. Fredoka headings (26 px, weight 500); IBM Plex Sans controls and prose (14–16 px); Plex Mono only for timestamps and metadata (11 px). Primary, secondary and tertiary foregrounds remain 92%, 64% and 44%.

Controls are at least 44 px tall. Selected choices use a restrained accent tint, toggles one small pill, sliders a 3 px track. Colour choices are dots. Eye style and pointer choices have live previews; Flat / Glass / Glow change only rendering. Eye size is a live 70–150% slider, default 100%, springing smoothly to its new value. Base eyes are deliberately large; personality grows and shrinks them expressively. Pointer previews show Arrow, Orb, Eyes and Tile. Expose only meaningful settings: answer mode, body colour, eye style and size, pointer and size, desktop visibility, mouse following, computer control, personality, chirp volume, private OpenAI key, monitor and sessions. Advanced motion parameters are not chrome.

Pairing is a small Pip, a short introduction and three clear steps. The private token belongs in the pairing URL/QR, never UI logs. The API key stays on the computer.

## Desktop

The bar is a tiny tile drawn with `drawMini`; the eyes still carry its state. Its popup uses the same flat, spaced language with direct controls, colour dots and pointer previews, not face-style selectors.

Research is a quiet 420 px report: a small Pip, Fredoka title, readable paragraphs, plain domain links and a close affordance. A collapsed report shows three lines and expands on tap. Pip’s thinking eyes supply the loading animation; no competing bouncing-dot decoration, source monograms or chip clutter.

## Motion and access

Eye changes are physical contour morphs, never cross-fades or shape swaps. Springs settle naturally; motion is not added to every UI surface merely because it can be. Sheets enter gently, words fade, controls move only to explain state. Respect reduced motion: quiet eye poses, no cosmetic trails and no translational word animation. Keep focus visible, dialogs keyboard-contained, text readable and all gesture navigation reachable without gestures.

Canvas parity and pointer placement rules remain in [face-system.md](face-system.md). There is no face-style setting; the internal pointer id `face` now means **Tile**.
