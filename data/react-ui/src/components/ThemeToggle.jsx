import React from "react";

/**
 * ThemeToggle component supporting Light, Dark, and Auto modes
 * @param {Object} props
 * @param {'light' | 'dark' | 'auto'} props.themePreference - The user's theme preference
 * @param {Function} props.setThemePreference - Function to update theme preference
 */
export default function ThemeToggle({ themePreference, setThemePreference }) {
  const cycleTheme = () => {
    // Cycle: light -> dark -> auto -> light
    const next = themePreference === 'light' ? 'dark' : themePreference === 'dark' ? 'auto' : 'light';
    setThemePreference(next);
  };

  // Icons for each mode
  const getIcon = () => {
    switch (themePreference) {
      case 'light':
        return (
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        );
      case 'dark':
        return (
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        );
      case 'auto':
        return (
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getLabel = () => {
    switch (themePreference) {
      case 'light':
        return 'Light';
      case 'dark':
        return 'Dark';
      case 'auto':
        return 'Auto';
      default:
        return '';
    }
  };

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-2 px-3 py-2 rounded-md bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      title={`Theme: ${getLabel()} (click to cycle)`}
      aria-label={`Theme: ${getLabel()}`}
    >
      {getIcon()}
      <span className="hidden sm:inline text-sm">{getLabel()}</span>
    </button>
  );
}
