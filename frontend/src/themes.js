/** App chrome themes (sidebar + primary accents). */

export const DEFAULT_THEME_ID = 'blue';

export const THEMES = {
  blue: {
    id: 'blue',
    label: 'Blue',
    description: 'Sky-to-blue gradient sidebar (current default)',
    sidebarBg: 'linear-gradient(160deg, #0EA5E9 0%, #1296DB 40%, #2563EB 100%)',
    sidebarShadow: '4px 0 32px rgba(14,165,233,0.25), 2px 0 0 rgba(255,255,255,0.06)',
    primary: '#1565c0',
    primaryHover: '#0d47a1',
    accent: '#2563EB',
    contentBg: '#F1F5F9',
    swatches: ['#0EA5E9', '#2563EB', '#F1F5F9'],
  },
  purple: {
    id: 'purple',
    label: 'Purple',
    description: 'Deep purple sidebar with violet accents',
    sidebarBg: 'linear-gradient(165deg, #1a1236 0%, #2b1848 45%, #4c2a86 100%)',
    sidebarShadow: '4px 0 32px rgba(76,42,134,0.35), 2px 0 0 rgba(255,255,255,0.06)',
    primary: '#4c2a86',
    primaryHover: '#3b1f6b',
    accent: '#6d3fb3',
    contentBg: '#F1F5F9',
    swatches: ['#1a1236', '#4c2a86', '#F1F5F9'],
  },
};

/** Shared sidebar chrome (works on both themes). */
export const SIDEBAR_CHROME = {
  sidebarW: 250,
  hover: 'rgba(255,255,255,0.12)',
  active: 'rgba(255,255,255,0.20)',
  activeBorder: 'rgba(255,255,255,0.85)',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.65)',
  divider: 'rgba(255,255,255,0.15)',
  glass: 'rgba(255,255,255,0.08)',
  radius: 10,
  transition: 'all 0.18s ease',
};

export function normalizeThemeId(value) {
  const id = String(value || '').trim().toLowerCase();
  return THEMES[id] ? id : DEFAULT_THEME_ID;
}

export function getTheme(themeId) {
  return THEMES[normalizeThemeId(themeId)];
}

/** Apply CSS variables used by buttons / content chrome. */
export function applyThemeToDocument(themeId) {
  const t = getTheme(themeId);
  const root = document.documentElement;
  root.dataset.theme = t.id;
  root.style.setProperty('--theme-primary', t.primary);
  root.style.setProperty('--theme-primary-hover', t.primaryHover);
  root.style.setProperty('--theme-accent', t.accent);
  root.style.setProperty('--theme-content-bg', t.contentBg);
}
