# Pip's personality

Pip is two elastic blobs on a flat body colour. The eyes carry every feeling; colour follows the Omarchy palette, while flat/glass/glow are rendering choices, not different personalities. `avatar/persona.mjs` choreographs **target poses**; `avatar/eyes.mjs` owns the contour springs, goo, overshoot and rendering. There are no face parameters, facial accessories or persona-side spring system. The same deterministic modules run in Chromium and QML Context2D.

## Contract and priorities

- `createPersona(seed)` creates the seeded brain and one reusable `pose` object with reusable `L` and `R` eyes.
- `stepPersona(p, dt, input, engine)` returns that pose. Seconds are clamped to 0–0.1. Time comes only from `dt`, not wall time. Same seed, input/timestep sequence and reaction sequence produce the same performance.
- `reactPersona(p, name)` auditions an act or flashes an expression for three seconds. Unknown names do nothing. Deliberate acts bypass selection cooldowns but **not** voice, task, pointing or reduced-motion gates.
- `activityPersona(p, name | null)` starts or clears a tool activity. Changing activity clears an act. `null` releases to the current state on the next frame.
- `pokePersona(p, x, y, hit)` records normalized taps. The public rig supplies `hit` (`L`, `R`, `both`, or empty string) using its actual rendered eye geometry and dents the touched contour. Direct persona calls without geometry assume portrait framing.
- `EXPRESSIONS` contains sparse Pose targets. `ACTS` contains duration, sparse timed keys, selection weight and cooldown in seconds. Sparse final keys return to the **current** live base target, not a saved neutral pose.

The Pose contract and available shapes are in [eyes.md](eyes.md). Units are base eye diameters; `s` is overall eye scale, `sx/sy` stretch, `x/y` offset from home, `open` lid opening. `merge` pulls the two eyes into a shared blob; `spin` is its rotation speed; `tension` controls engine stiffness.

The larger default eye diameter is 0.22 × the short screen edge. The user `eyeSize` multiplies that base; persona `s` is an independent expressive multiplier. Excitement/love swell, asking grows with hear, speech pulses with emphasis, shyness/worry/sorry shrink, waking pops large, and shock shrinks to pins before a wide rebound. Finite reactions release back to the current default/state scale; the engine springs every size change.

Holding chooses asking before the supplied state. Tool activities replace idle/loader shapes while tools run. Idle emotions never hide asking, thinking, speaking, waking or sleep. Gaze and pointing layer over the current state; choreographed acts layer over idle; touch gets a brief final targeted wince. Blinks are independent lid closures, suppressed during performances, asking bars, waking and the merged loader.

## Base states

| State | Pose and timing |
|---|---|
| asleep | `content` arcs at y +0.18; slow 1.4 rad/s breath, 3.5% vertical stretch. A seeded bubble drips from alternating eyes every 4–8 s. |
| waking | `line` eyes for 180 ms → dots pop to scale 1.23 with a jiggle → glance left until 700 ms, right until 1.15 s → settle. |
| listening | Open dots, tiny seeded saccades every 0.8–3 s. Gaze follows the supplied gaze. Natural blinks every 2.8–7.6 s, 18% double. |
| asking / holding | `bar` eyes, scale 1.08–1.23, width 0.76. Smoothed `hear` raises height from 0.65 to 2.0 / 1.8; listening to the user's voice, not Pip's. |
| thinking | Both dots scale 0.88 and merge over 460 ms, then a 2.4 rad/s soft loader morphing pill → drop → squircle every 0.8 s with coherent stretch. Speech immediately targets merge 0; engine physics produces the split and recoil. |
| speaking | Dots lift, swell up to 14%, lengthen and squash to smoothed `talk`, asymmetrically so the reply feels spoken, not a metronome. |
| pointing | Eyes look along `angle`. For 550 ms after landing below 90 px/s, they become directional chevrons; then return to the live eye shape. |

Gaze anticipates a new direction for 45 ms with an 8% counter-look, then overshoots by 12% until 160 ms. The engine supplies continuous spring motion between targets. A jump larger than 1.25 gaze units can startle, with a 12 s cooldown. Sustained flight above 2600 px/s accumulates flight fatigue; after more than 1.2 s, slowing below 900 px/s triggers dizzy (18 s cooldown). These reactions cannot interrupt voice, loader or tool work.

## Tool activities

| Activity | Read |
|---|---|
| looking | `wide` for 650 ms, then dots; quick side-to-side scan, amplitude 0.38. |
| researching | Tall `pill` eyes read each 1.4 s line left-to-right, with three small vertical line steps. |
| acting | Scale-0.91 `squircle` eyes; short determined nod beats at 9 rad/s. |
| pointing | Same directional glance and landing chevrons as base pointing. |
| error | `cross` eyes with a decaying 27 rad/s shake and a jiggle for 1.45 s, then the base shape returns even if the error activity remains set. This one-shot holds even when `null` follows in the same server tick; a new non-null activity can replace it. |
| null | Tool pose releases to the current state, after any latched error payoff. |

## Expressions

Asymmetric shapes are mirrored by the engine, not by persona shape swapping.

| Expression | Distinguishing eye pose |
|---|---|
| happy | Upward `happy` arcs, scale 1.08, y −0.08. |
| laugh | `happy` arcs, scale 1.12, width 1.12 / height 0.82; small emphasis pulses, alternating laugh hops and a jiggle. |
| love | Soft `heart`s, scale 1.22, gentle 4.5% swell pulse. |
| excited | `star`s, scale 1.23 with 7% emphasis pulses, raised 0.13; spark on explicit reaction. |
| proud | `happy` arcs, lifted 0.22 and scale 1.1. |
| curious | Left `wide` at scale 1.13, raised; right smaller dot, lowered slightly. |
| surprised | `wide`s, scale 1.26, lifted 0.12. |
| shocked | Tiny `pin`s, scale 0.78, raised 0.16. An explicit reaction holds pins 320 ms, rebounds to wide scale-1.18 eyes, and returns to dots by 850 ms. |
| skeptical | Left `half` lid, right `wide`, shared sidelong glance. |
| smug | Raised `half`s, glance +0.16. |
| annoyed | Sloping `angry`s, height 0.84. |
| grumpy | Strong low `angry`s, height 0.64. |
| sad | Lowered `sad` contours, scale 0.94; tear on explicit reaction. |
| worried | Small scale-0.87 `sad`s tilted outward; sweat on explicit reaction. |
| embarrassed | Down-left glance, scale-0.82 left `half` and scale-0.72 right dot; sweat on explicit reaction. |
| shy | Both `half`s shrink to scale 0.72 and glance down-left. |
| scared | Small `wide`s, scale 0.7, slightly narrower and lowered in recoil; unlike surprised, fear shrinks rather than swells. |
| confused | Left raised `wide`, right lowered `half`. |
| bored | Horizontal `line`s, lowered and looking aside. |
| sleepy | `half`s, lid opening 0.55, y +0.2. |
| determined | `angry`s, scale 1.07, slightly lifted. |
| mischievous | Left `half`, right `happy`, sidelong glance. |
| sorry | Small `sad`s, scale 0.8, y +0.26; tear on explicit reaction. |

## Acts: anticipation → action → hold → settle

Automatic acts occur only outside voice, sleep/wake, tool activities and pointing. Selection is seeded and weighted, respects per-act cooldowns, and leaves 7–17 s breathing space after each completed act. Nod-off additionally requires 45 s idle. Incidental blinks cannot cover a comic payoff. Engine impulses fire once at the payoff, not once per frame.

| Act | Duration | Read and beat | Weight / cooldown |
|---|---:|---|---|
| blink | 0.22 s | 65 ms close → 35 ms hold → 120 ms open. | natural blink clock |
| doubleBlink | 0.50 s | Close/open → short beat → second close/open. | 18% natural doubles |
| lookAround | 3.30 s | Look up-left at 0.25 → hold → wide up-right at 1.05 → hold → down-right at 2.15 → return. | 1 / 26 s |
| sideEye | 2.40 s | Sharp half-lid glance at 0.2 → long suspicious hold → other eye opens wide at 1.7 → release. | 1 / 28 s |
| eyeRoll | 2.60 s | Half-lid anticipation → dots travel left/up/top/right, 0.6–1.3 → resigned half-lids at 1.8 → release. | 0.55 / 48 s |
| sneeze | 2.65 s | Pill inhale at 0.4 → inward `> <` chevrons and tiny build-up wobble → ACHOO at 1.2: big jiggle + high wide jump → flattened landing → recover. | 0.4 / 85 s |
| yawn | 3.80 s | Sleepy inhale at 0.55 → very tall pills at 1.05, held through 2.1 → content squeeze at 2.65 → recover. | 0.7 / 65 s |
| daydream | 5.20 s | Float upward into `content` at 0.7 → dreamy hold through 3.3 → realize with `wide` at 3.65 → bashful half-lids → return. | 0.7 / 60 s |
| idea | 2.80 s | Search up at 0.4 → squeeze at 0.7 → star pop + spark at 0.9 → proud star hold → happy settle. | 0.55 / 65 s |
| sigh | 3.10 s | Wide inhale at 0.55 → half-lid exhale → small low sag at 1.9 → resigned glance → release. | 0.6 / 48 s |
| crossEyed | 2.10 s | Small anticipation → eyes slide inward + tiny near-merge at 0.5 → hold to 1.25 → snap wide at 1.42 → home. | 0.6 / 45 s |
| bounce | 1.75 s | Happy compressed crouch at 0.25 → tall hop at 0.5 → squashed landing + jiggle at 0.82 → smaller rebound → settle. | 0.8 / 32 s |
| nodOff | 6.10 s | Lids droop at 1 → headless eye sag/content at 2.7 → sleep hold → snap awake + jiggle at 3.8 → embarrassed glance → settle. | 0.5 / 95 s |
| startled | 1.90 s | Small pins held to 0.17 → wide recoil by 0.34 → hold to 0.72 → sheepish half-lid recovery. | gaze jump / 12 s |
| dizzy | 3.70 s | Eyes shrink at 0.28 → opposite orbit with slowing phase and decaying radius → low half-lid recovery at 3 → settle. | flight / 18 s |

## Touch memory

An eye tap dents that eye at the actual touch angle and briefly closes only that eye (`line` for 300 ms, then `half`). A tap between eyes makes both cross-eyed toward the finger. A tap elsewhere makes both look toward the tap. Touch poses last 1.1 s and do not interrupt asking/thinking/speaking.

Consecutive taps less than four seconds apart build irritation: second tap is annoyed, fourth grumpy, seventh turns **playful**, with mischievous eyes and a happy bounce rather than endless hostility. Irritation decays at 0.055/s, or 0.16/s with happy/loving input. Flash expressions expire; residual irritation softens from angry to half-lids and then neutral. No reaction traps the character in a permanent bad mood.

## Reduced motion and performance

Reduced motion disables automatic acts, flight/gaze startles, anticipation/overshoot, saccades, sleep breathing/bubbles, loader rotation, scan sweeps, jiggles and cosmetic drips. Explicit non-blink acts are gated too. Voice levels still communicate using a smaller stretch/bounce, state/emotion shape changes remain readable, and ordinary blinks remain.

The persona allocates no per-frame objects: one Pose and its two eyes are reset and reused; act keys and expression targets are module-level data. Engine events are supplied as a sink by the rig. Persona timing is distinct from renderer timing; full/cursor contour physics and canvas submission are measured separately in the [lab](lab/). Tests pin seeded sequence identity, target reuse, voice-state gating, hear-driven bars, speech splitting, touch calming and reduced-motion gating.

## Reviewed motion evidence

Every base state, tool activity, expression and act was reviewed as a sixteen-frame Chromium sequence. The merged loader was strengthened from a nearly circular spin to pill/drop/squircle morphs; the pin anticipation was lengthened so startle reads before its wide payoff; pointing now counter-mirrors the right chevron so both eyes point together, rather than accidentally reading as sneeze. QML offscreen also renders the loader-to-speech split as a sixteen-frame sequence.

Representative filmstrips: [state/voice motion](persona-states.png), [comic acts](persona-acts.png), [QML loader/speech split](persona-qml-loader.png). Persona-only warmed cost measured at 0.000405 ms/frame in Chromium (20,000 frames) and 0.0022 ms/frame in QML (20,000 frames), below the 0.05 ms target. Native 1170×2532 full and 44 px cursor canvas submission measured 0.0127 / 0.0045 ms in Chromium and 0.0717 / 0.0500 ms in QML (600 draws each). These flat-style renderer measurements are CPU submission, not raster completion; style/theme changes can change renderer cost without changing persona cost.
