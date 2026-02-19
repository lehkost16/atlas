/**
 * Theme utility functions for managing light/dark/auto modes
 * Uses session cookies for persistence
 */

const THEME_COOKIE_NAME = 'atlas_theme';

/**
 * Get theme preference from session cookie
 * @returns {'light' | 'dark' | 'auto' | null}
 */
export function getThemeFromCookie() {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === THEME_COOKIE_NAME) {
        const theme = decodeURIComponent(value);
        if (theme === 'light' || theme === 'dark' || theme === 'auto') {
          return theme;
        }
      }
    }
  } catch (e) {
    console.error('Error reading theme cookie:', e);
  }
  return null;
}

/**
 * Save theme preference to session cookie
 * Session cookies have no expiry date, so they persist only for the session
 * @param {'light' | 'dark' | 'auto'} theme
 */
export function setThemeCookie(theme) {
  try {
    // Session cookie (no expiry) with path=/
    document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(theme)}; path=/; SameSite=Lax`;
  } catch (e) {
    console.error('Error setting theme cookie:', e);
  }
}

/**
 * Get the OS/browser color scheme preference
 * @returns {'light' | 'dark'}
 */
export function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * Resolve the effective theme based on user preference
 * @param {'light' | 'dark' | 'auto'} themePreference
 * @returns {'light' | 'dark'}
 */
export function resolveTheme(themePreference) {
  if (themePreference === 'auto') {
    return getSystemTheme();
  }
  return themePreference === 'dark' ? 'dark' : 'light';
}

/**
 * Apply theme to document
 * @param {'light' | 'dark'} effectiveTheme
 */
export function applyTheme(effectiveTheme) {
  if (effectiveTheme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/**
 * Get initial theme preference
 * Priority: cookie > default to 'auto'
 * @returns {'light' | 'dark' | 'auto'}
 */
export function getInitialTheme() {
  const cookieTheme = getThemeFromCookie();
  if (cookieTheme) {
    return cookieTheme;
  }
  return 'auto'; // default to auto mode
}
