'use strict';

(function bootstrapIfinTheme(global) {
  const STORAGE_KEY = 'ifin-platform-browser-theme';
  const MODES = ['system', 'dark', 'light'];
  const mediaQuery = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  let currentMode = 'system';

  function getEffectiveTheme(mode = currentMode) {
    if (mode === 'dark' || mode === 'light') {
      return mode;
    }
    return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
  }

  function updateToggles() {
    const labels = { system: 'Auto', dark: 'Dark', light: 'Light' };
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = labels[currentMode];
      button.setAttribute('title', `Theme: ${labels[currentMode]}`);
      button.setAttribute('aria-label', `Theme: ${labels[currentMode]}`);
    });
  }

  function applyTheme(mode) {
    currentMode = MODES.includes(mode) ? mode : 'system';
    document.documentElement.dataset.theme = getEffectiveTheme(currentMode);
    document.documentElement.dataset.themeMode = currentMode;
    updateToggles();
    return currentMode;
  }

  function persist(mode) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: mode });
    }
  }

  function setMode(mode) {
    const nextMode = applyTheme(mode);
    persist(nextMode);
    return nextMode;
  }

  function cycleMode() {
    const currentIndex = MODES.indexOf(currentMode);
    return setMode(MODES[(currentIndex + 1) % MODES.length] || 'system');
  }

  function bindToggles() {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      if (button.dataset.bound === 'true') {
        return;
      }
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        cycleMode();
      });
    });
  }

  function init() {
    bindToggles();

    if (mediaQuery && !mediaQuery.__ifinThemeBound) {
      mediaQuery.addEventListener('change', () => {
        if (currentMode === 'system') {
          applyTheme('system');
        }
      });
      mediaQuery.__ifinThemeBound = true;
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        applyTheme(typeof result[STORAGE_KEY] === 'string' ? result[STORAGE_KEY] : 'system');
      });
      return;
    }

    applyTheme('system');
  }

  global.ifinTheme = {
    init,
    cycleMode,
    setMode,
    getMode: () => currentMode,
    getEffectiveTheme: () => getEffectiveTheme(currentMode),
  };
})(window);
