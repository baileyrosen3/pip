# Pip canvas and pointers

The character, Pose contract, expressions and public API are specified in [eyes.md](eyes.md). FaceParams, face styles and `setStyle` no longer exist. Pip is two morphing blob eyes on one flat body colour, with Flat / Glass / Glow eye materials and an animated eye-size multiplier.

## Canvas parity

Shared avatar modules run unchanged in browser `CanvasRenderingContext2D` and QML `Context2D`. Use only save/restore, translate/rotate/scale, beginPath/closePath/moveTo/lineTo/quadraticCurveTo/bezierCurveTo/arc, fill/stroke, fillStyle/strokeStyle (CSS colour strings or linear/radial gradients), lineWidth/lineCap/lineJoin, globalAlpha, clearRect and fillRect. Ellipses use `ellipsePath` from core. No `shadowBlur`, `ctx.ellipse`, `roundRect`, `Path2D`, filters, `ctx.canvas` or canvas text. Relative `.mjs` imports are supported. Flat eyes use `palette.ink`; Glass and Glow layer gradients and contours without changing physics. `palette.face` is the body colour. Call `makePalette(theme, color)` with the complete Omarchy colour object; the theme colours are used exactly.

## Pointers

The desktop pointer setting chooses `arrow` (rounded body-colour arrow), `orb` (round body), `eyes` (only eyes beside the hotspot) or `face` (**Tile**, a small body-colour squircle with eyes). The internal `face` pointer id is retained; it is not a face-style setting. All use the same blob-eye engine with simplified cursor detail and the chosen eye material/size. `cursorSize` defaults to 44 px, range 28–72 px. The bar uses `drawMini`, never a separate character.

`avatar/engine.mjs` owns flight and placement. The arrow’s tip is its hotspot; Orb, Eyes and Tile remain pinned to their own hotspot dot. `cursorBounds(size, type)` describes exact canvas extents around the tip; consumers translate by the negative bounds origin before `drawCursor`. Flight velocity, angle, gaze and pointing are inputs to `stepRig`; they do not replace eye physics. Keep speech close to Pip, above the pointed-at target where possible and below near the screen’s top edge.

Full rendering target: ≤2 ms/frame at 1170×2532 in Chromium. Cursor target: ≤0.5 ms/frame at 44 px. Verify browser and QML images as well as moving filmstrips: correctness of a still image is not sufficient for a morphing character.
