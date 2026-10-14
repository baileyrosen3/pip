// Shared math, springs, randomness and colour for Pip's species modules.
// Plain ECMAScript: runs in browsers and in QML (Qt 6) unchanged. No DOM, no Qt APIs.

export const TAU = Math.PI * 2;

export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/// Deterministic PRNG (mulberry32). Returns a function giving floats in [0, 1).
export function prng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// A damped spring value: { x, v }. `k` = stiffness (1/s²), `zeta` = damping ratio (1 = critical).
export function spring(x = 0) { return { x, v: 0 }; }
export function stepSpring(s, target, dt, k, zeta = 1) {
  // Semi-implicit Euler in small substeps so big dt (tab switches, dropped frames) stays stable.
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  const c = 2 * zeta * Math.sqrt(k);
  for (let i = 0; i < steps; i++) {
    s.v += (k * (target - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

/// Exponential approach, frame-rate independent.
export function approach(current, target, dt, rate) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// MARK: Colour

export function parseColor(input) {
  let s = String(input || "").trim();
  if (s[0] === "#") s = s.slice(1);
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map((c) => c + c).join("");
  if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
  if (/^[0-9a-f]{6}$/i.test(s)) {
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }
  const m = String(input).match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0 };
  }
  return { r: 122, g: 162, b: 247 };
}

export function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function fromHsl({ h, s, l }) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255) };
}

export function hsl(h, s, l, a = 1) {
  const c = fromHsl({ h, s: clamp(s, 0, 1), l: clamp(l, 0, 1) });
  return a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${+a.toFixed(3)})`;
}

/// `color` (any CSS string parseColor understands) with a new alpha.
export function alpha(color, a) {
  const c = parseColor(color);
  return `rgba(${c.r},${c.g},${c.b},${+clamp(a, 0, 1).toFixed(3)})`;
}

export function mix(a, b, t) {
  const x = parseColor(a), y = parseColor(b);
  return `rgb(${Math.round(lerp(x.r, y.r, t))},${Math.round(lerp(x.g, y.g, t))},${Math.round(lerp(x.b, y.b, t))})`;
}

/// WCAG relative luminance (0 black … 1 white).
export function luminance(color) {
  const c = parseColor(color);
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/// WCAG contrast ratio between two colours (1 … 21).
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/// Pip's colours from the Omarchy theme (`~/.local/state/omarchy/current/theme/colors.toml`, sent by the
/// server as `theme`: background, foreground, accent and the optional dark_/darker_/lighter_background,
/// bright_foreground, mode). Colours are used exactly as the theme defines them; only the eye colour
/// falls back to another theme colour when the pair wouldn't read.
///
/// `color`: "theme"  — the screen is the theme background, the eyes are the theme accent (default)
///          "accent" — the screen is the accent, the eyes are the theme's darkest background
///          "#rrggbb" — a custom screen colour; the eyes pick the theme colour that reads best on it
export function makePalette(theme, color = "theme") {
  const t = theme || {};
  const bg = t.background || "#1a1b26";
  const fg = t.foreground || "#c0caf5";
  const accent = t.accent || "#7aa2f7";
  const darkest = t.darker_background || t.dark_background || bg;
  const brightest = t.bright_foreground || t.light_foreground || fg;
  const pick = (face, preferred) => {
    if (contrast(face, preferred) >= 3) return preferred;
    const options = [accent, brightest, fg, darkest, bg].filter((c) => contrast(face, c) >= 3);
    if (options.length) return options[0];
    return luminance(face) > 0.35 ? "#0b0b0f" : "#f5f5f7";
  };
  let face, ink;
  if (color === "accent") { face = accent; ink = pick(accent, darkest); }
  else if (/^#[0-9a-f]{6}$/i.test(String(color))) { face = color; ink = pick(color, luminance(color) > 0.35 ? darkest : accent); }
  else { face = bg; ink = pick(bg, accent); }
  const dark = luminance(face) < 0.35;
  return {
    dark,
    theme: { background: bg, foreground: fg, accent },
    face,
    faceDeep: mix(face, "#000", dark ? 0.35 : 0.14),
    faceLift: mix(face, "#fff", dark ? 0.08 : 0.16),
    ink,
    inkSoft: alpha(ink, 0.55),
    glow: alpha(ink, 0.5),
    glint: "rgba(255,255,255,0.95)",
    paper: "rgb(255,255,255)",
    shadow: dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)",
  };
}

/// Ellipse helper for both canvas APIs (QML Context2D's `ellipse` differs from the browser's).
export function ellipsePath(ctx, cx, cy, rx, ry, rotation = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate(rotation);
  ctx.scale(Math.max(rx, 0.0001), Math.max(ry, 0.0001));
  ctx.moveTo(1, 0);
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.restore();
}
