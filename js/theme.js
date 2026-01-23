/**
 * Theme Toggle for bz2api.js Landing & Docs
 * Handles dark/light mode with localStorage persistence
 */

(function() {
  'use strict';

  const THEME_KEY = 'bz2api_theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  /**
   * Get the user's preferred theme
   * Priority: 1. Saved preference, 2. System preference, 3. Default to dark
   */
  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === DARK || saved === LIGHT) {
      return saved;
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return LIGHT;
    }
    
    // Default to dark
    return DARK;
  }

  /**
   * Apply theme to the document
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    updateToggleIcon(theme);
  }

  /**
   * Update the toggle button icon
   */
  function updateToggleIcon(theme) {
    const toggleBtns = document.querySelectorAll('.theme-toggle');
    toggleBtns.forEach(btn => {
      // Sun icon for dark mode (click to switch to light)
      // Moon icon for light mode (click to switch to dark)
      btn.innerHTML = theme === DARK ? '☀️' : '🌙';
      btn.setAttribute('aria-label', theme === DARK ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', theme === DARK ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  /**
   * Toggle between dark and light themes
   */
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-bs-theme');
    const next = current === DARK ? LIGHT : DARK;
    
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  /**
   * Initialize theme on page load
   */
  function initTheme() {
    // Apply theme immediately to prevent flash
    const theme = getPreferredTheme();
    applyTheme(theme);

    // Listen for system preference changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only auto-switch if user hasn't set a preference
        if (!localStorage.getItem(THEME_KEY)) {
          applyTheme(e.matches ? DARK : LIGHT);
        }
      });
    }
  }

  /**
   * Set up toggle button click handlers
   */
  function setupToggleButtons() {
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', toggleTheme);
    });
  }

  // Initialize theme immediately (before DOM ready) to prevent flash
  initTheme();

  // Set up toggle buttons when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupToggleButtons);
  } else {
    setupToggleButtons();
  }

  // Expose functions globally for manual use if needed
  window.BZ2Theme = {
    toggle: toggleTheme,
    set: function(theme) {
      if (theme === DARK || theme === LIGHT) {
        applyTheme(theme);
        localStorage.setItem(THEME_KEY, theme);
      }
    },
    get: function() {
      return document.documentElement.getAttribute('data-bs-theme');
    }
  };
})();
