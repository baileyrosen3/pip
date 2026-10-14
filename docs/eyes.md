# Pip's eyes

Pip is two expressive blobs on one flat colour. Nothing else: no mouth, nose, ears or brows. Every emotion, state and action is the eyes changing shape like soft ink: squashing, stretching, pinching, merging, splitting, wobbling, growing and shrinking. The phone screen is his body; the eyes are the whole character. This replaces the old face styles (chunky/soft/ink) and FaceParams entirely.

Design bar: slick, minimal, alive. Every change is a physical morph (contour points travel, ripple, overshoot and settle), never a cross-fade or a swap. The default Flat look uses `palette.ink` on the flat body colour. Glass and Glow change only the rendering, never the geometry or personality. Theme mode uses the exact Omarchy background and accent; Accent mode uses the exact accent for the body and a readable theme colour for the eyes.

## Architecture (all plain ES modules, canvas subset from docs/face-system.md: browser + QML Context2D parity, no shadowBlur)

```
avatar/eyes.mjs     blob engine: shape library, contour physics, goo bridges, renderer   (owner: eyes builder)
avatar/persona.mjs  personality: states, emotions, acts, reactions → a Pose each frame  (owner: persona builder)
avatar/pip.mjs      public API used by phone, overlay and bar                              (owner: eyes builder)
avatar/core.mjs     shared math/colour (lead)          avatar/engine.mjs  pointer flight (shell)
```

## Pose (persona → engine contract)

The persona outputs a **target** pose each frame; the engine owns all physics (springs, wobble, overshoot) and renders.

```js
// Units: 1 = one eye's base diameter. Eye homes are fixed by the engine (left/right of centre).
Pose = {
  L: Eye, R: Eye,
  merge: 0..1,           // pull both eyes together into one blob at `mergeX, mergeY` (thinking, "loading"); goo bridge forms as they meet
  mergeX: 0, mergeY: 0,  // where they merge (units)
  spin: 0,               // rad/s: while merged, the blob's contour rotates (loader feel)
  tension: 1,            // 0.4 = floppy jelly … 1.6 = snappy (scales spring stiffness)
}
Eye = {
  shape: "dot",          // name from SHAPES (below)
  x: 0, y: 0,            // offset from the eye's home (gaze, looks, bounces)
  s: 1,                  // uniform scale
  sx: 1, sy: 1,          // stretch (applied after shape, before rotation)
  rot: 0,                // rad
  open: 1,               // 0..1 lid: flattens the shape from the top toward its bottom edge (blinks, sleepy, squint); engine handles it as a vertical squash anchored low with the top edge flattened
}
```

Events the persona can fire into the engine (one-shot, physics only):
- `engine.dent(eye, angle, depth)`: push contour points near `angle` inward then let them wobble back (pokes, flinches).
- `engine.jiggle(eye | "both", amount)`: radial wobble impulse (laughs, landing, sneezes).
- `engine.drip(eye, kind)`: a small blob pinches off the eye with a goo neck and travels: `"tear"` falls and fades, `"bubble"` floats up (sleep z's as bubbles), `"spark"` pops above (idea), `"sweat"` slides down the outside.

## Shape library (`SHAPES`, eyes builder)
Each shape = a closed contour, resampled to N points (N = 96 on "full", 40 on "cursor"/"mini") by arc length, clockwise, starting at the top-most point, centred on its visual centre, sized to fit a unit diameter. Morphs interpolate point i → point i (with per-point spring + slight phase offset around the contour so changes ripple like jelly).

| shape | look | used for |
|---|---|---|
| `dot` | circle | default |
| `pill` | tall capsule | attentive, listening |
| `wide` | larger circle with a slightly flattened bottom | surprise, curiosity |
| `pin` | tiny circle | shock, focus |
| `line` | thin horizontal capsule | blink keyframe, bored, unimpressed |
| `happy` | thick upward arc (∩) | happy, laugh, proud |
| `content` | thick downward arc (∪) | asleep, cosy, daydream |
| `half` | lower half-dot (flat top) | smug, sleepy, skeptical |
| `angry` | dot with a flat top sloping down toward the nose (mirror for R) | annoyed, determined, grumpy |
| `sad` | dot with a flat top sloping down away from the nose (mirror for R) | sad, worried, sorry |
| `heart` | rounded heart | love, thanks |
| `star` | soft 5-point star | delight, idea, excited |
| `cross` | rounded X | error, knocked out |
| `chevronL` / `chevronR` | thick rounded < / > | pointing, "over there", squeezed-shut sneeze (> <) |
| `drop` | teardrop, point up | wobbly/sad, about to cry |
| `bar` | vertical capsule whose height follows a level | listening to your voice (equaliser), speaking rhythm |
| `squircle` | rounded square | robot/computer-use "focused mode" |

Mirrored shapes: the engine mirrors asymmetric shapes for the right eye automatically (`angry`, `sad`, `chevron*` swap).

## Engine behaviours (eyes builder)
- Contour physics: each point springs to its target (stiffness × `tension`, damping ~0.55–0.7) plus a small travelling wobble so even idle dots look wet and alive (tiny, very slow; zero when reduced motion).
- Motion: when an eye's position moves fast, it stretches along the motion and squashes on stop (velocity-based, capped).
- Goo bridges: when the two eyes (or an eye and a drip) are within ~1.6 diameters and `merge` > 0, draw a metaball-style neck between them (two concave bezier sides tangent to both contours) that thins and snaps with a little recoil when they separate.
- Rendering: anti-aliased contour paths. Default eye diameter on "full" is ≈ 0.22 × min(w, h), with a centre gap ≈ 0.46 × min(w, h), centred at (0.5w, 0.46h). On "cursor"/"mini" the engine uses N = 40, bigger readable dots and stronger damping.
- Size: personality uses `s` to swell and shrink from the neutral pose. `eyeSize` is a user multiplier from 0.7 to 1.5, default 1.0; its own damped spring feeds contour springs, so settings changes ripple and settle without jumps. Uniform contour limits keep non-merged eyes separate and inside the screen.
- Eye styles (`eyeStyle`, default `"flat"`): Flat is pure theme ink. Glass is a smoky body/ink tint with inner radial depth, a contour-following top-left specular rim, darker bottom edge, lighter refraction band and bottom-right caustic; tiny sizes simplify the inner band. Glow is a near-white ink-tinted core with three expanded low-alpha contour halos and a faint hot centre. No `shadowBlur`, filters or extra facial features; every style uses the same contour springs. Glass uses Canvas gradients and contour rim strokes; Flat remains fill-only.
- On light bodies, Glow adds a narrow theme-ink edge behind the luminous core so white eyes remain readable. Pointer/tile bodies use the theme's lifted body colour and a quiet light rim; the phone background stays exactly `palette.face`.

## pip.mjs public API (eyes builder; keep these names)
`createRig(seed)`, `stepRig(rig, dt, input)`, `poke(rig, x, y)` (0..1 over the drawn area; the persona decides the reaction, the engine dents the nearest eye at the touch angle), `react(rig, name)`, `activity(rig, name | null)`, `setEyeStyle(rig, id)`, `setEyeSize(rig, n)`, `drawFace(ctx, rig, w, h, palette)` (fills the whole area with `palette.face`, then eyes), `drawCursor(ctx, rig, size, palette, type)`, `cursorBounds(size, type)`, `drawMini(ctx, rig, size, palette)`, `POINTERS`, `EYE_STYLES`, `makePalette(theme, color = "theme")`, `EXPRESSIONS`, `ACTS`. The rig stores `eyeStyle` and the requested `eyeSize`; invalid style ids and non-finite sizes are ignored, finite sizes are clamped. `STYLES`, `setStyle` and `styles/` are removed.
Pointers keep their shapes (`arrow`, `orb`, `eyes`, `face` → the "face" pointer is now a small squircle tile of body colour with the blob eyes, renamed "Tile"); all of them draw their eyes with the blob engine (simplified N).

`input` = `{ state: "asleep|waking|listening|asking|thinking|speaking", mood, gazeX, gazeY (−1..1), talk (0..1, Pip's chirp/speech level), hear (0..1, the user's live mic level, phone only), holding, vx, vy, angle, pointing, home, now, reducedMotion }`.

`activity` names (from the server while tools run): `looking` (look_at_screen), `pointing`, `researching` (web_research), `acting` (click/type/keys/scroll/drag/open), `error`, `null` (done).

## Expression vocabulary (persona builder)
Base states: asleep (`content` arcs, slow breathing, bubble drips now and then), waking (lines → pop to dots with a jiggle, look around), listening (dots, alive: saccades, gaze follows `gazeX/Y`, blinks), asking/holding (eyes become `bar`s that pulse with `hear`, leaning in = bigger), thinking (eyes slide together and **merge** into one blob that spins/morphs like a loader; split back when the answer starts), speaking (dots bounce/squash with `talk`, little `happy` flashes on positive replies is optional), pointing (eyes glance toward the pointing direction; on the desktop pointer they become `chevron`s for a beat when landing).
Activities: looking (`wide` → quick scan left/right), researching (`pill`s scanning side to side like reading lines), acting (`squircle` focused mode, small determined nods per action), error (`cross` with a shake, then back).
Emotions (EXPRESSIONS, at least): happy, laugh, love, excited, proud, curious, surprised, shocked, skeptical, smug, annoyed, grumpy, sad, worried, embarrassed, confused (asymmetric: one `wide`, one `half`), bored, sleepy, determined, mischievous, sorry.
Idle ACTS with comic timing (hold, beat, payoff), state-gated, cooldowns, seeded: blink/double-blink, look around, side-eye, eye-roll (dots travel up along an arc with `half` lids), sneeze (tighten to > < chevrons, build-up wobble, ACHOO = big jiggle + jump, recover), yawn (eyes stretch to tall `pill` then squeeze `content`), daydream (drift up, `content`), idea (`star` + `spark` drip), sigh (sag + `half`), cross-eyed (eyes slide toward each other, almost merge, snap back), bounce (happy hop), drowsy nod-off when idle long, startled by a sudden big mouse move (`pin` → `wide`), dizzy after fast flights (eyes orbit each other).
Pokes: poke an eye → that eye dents at the touch point and winces (`line`/`half`), the other stays; poke between the eyes → both go cross-eyed toward the tap; poke elsewhere → both look at the tap; repeated pokes escalate (annoyed → grumpy → playful), time calms.
