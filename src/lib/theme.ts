export type ColorTheme = 'default' | 'reading-room' | 'dhole' | 'nightwolf' | 'azure-fox';

export const COLOR_THEMES: ColorTheme[] = ['default', 'reading-room', 'dhole', 'nightwolf', 'azure-fox'];

// Themes offered to everyone. The rest are still being polished (they lack the
// full accent system Nightwolf got) and only surface under Developer Mode.
export const STABLE_THEMES: ColorTheme[] = ['default', 'nightwolf'];

// Themes that commit to a single dark look regardless of the light/dark mode
// toggle. We force `.dark` on for them so `dark:` utilities stay consistent.
// Dhole and Azure Fox also have a light variant and follow the mode setting.
const DARK_COMMITTED: ColorTheme[] = ['reading-room', 'nightwolf'];

/**
 * Apply the light/dark mode and the named color theme to <html>. The color
 * theme is a `data-color-theme` attribute; index.css overrides the shadcn
 * tokens under `.dark[data-color-theme=…]` (and the light variant under
 * `:root[data-color-theme=…]:not(.dark)` for the adaptive themes).
 */
export function applyTheme(mode: 'dark' | 'light' | 'system', colorTheme: ColorTheme = 'default') {
  const html = document.documentElement;
  if (colorTheme && colorTheme !== 'default') html.setAttribute('data-color-theme', colorTheme);
  else html.removeAttribute('data-color-theme');

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = DARK_COMMITTED.includes(colorTheme) || mode === 'dark' || (mode === 'system' && prefersDark);
  html.classList.toggle('dark', isDark);
}
