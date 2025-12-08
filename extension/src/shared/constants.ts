export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 5;
export const DEFAULT_MEMORY_THRESHOLD_MB = 500;
export const DEFAULT_REMINDER_TIMEOUT_SECONDS = 15;

export const STORAGE_KEYS = {
  settings: 'sleepyTabs.settings',
  tabState: 'sleepyTabs.tabState',
  consent: 'sleepyTabs.consent'
} as const;

export const SETTINGS_VERSION = 1;
