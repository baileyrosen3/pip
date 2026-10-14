import {luminance, alpha} from '/avatar/core.mjs';
import {tokens} from './tokens.js';

export const defaultTheme = {background:'#1a1b26',foreground:'#c0caf5',accent:'#7aa2f7',mode:'dark'};
export function normalizeTheme(value = {}) { return {...defaultTheme,...value}; }
export function isDark(background) { return luminance(background)<.35; }
export function applyTheme(value) {
  const theme=normalizeTheme(value),dark=theme.mode?theme.mode!=='light':isDark(theme.background),surface=tokens.surface[dark?'dark':'light'];
  const style=document.documentElement.style;
  const vars={bg:theme.background,accent:theme.accent,fg:theme.foreground,ink:alpha(theme.background,.96),hairline:surface.hairline,
    primary:alpha(theme.foreground,tokens.text.primary),secondary:alpha(theme.foreground,tokens.text.secondary),tertiary:alpha(theme.foreground,tokens.text.tertiary),
    neutral:alpha(theme.foreground,.06),track:alpha(theme.foreground,.18),'accent-tint':alpha(theme.accent,.12),'on-accent':isDark(theme.accent)?theme.bright_foreground||theme.foreground:theme.darker_background||theme.background};
  for(const [key,color] of Object.entries(vars))style.setProperty(`--${key}`,color);
  document.documentElement.style.colorScheme=dark?'dark':'light';
  return theme;
}
