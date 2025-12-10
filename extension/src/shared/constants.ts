export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 5;
export const DEFAULT_MEMORY_THRESHOLD_MB = 250;
export const DEFAULT_REMINDER_TIMEOUT_SECONDS = 15;
export const DEFAULT_ENABLE_FULL_PAGE_SAMPLING = false;
export const DEFAULT_ENABLE_PROCESS_FALLBACK = true;
export const DEFAULT_PROCESS_THRESHOLD_MB = 500;
export const PROCESS_THRESHOLD_PRESETS = [250, 500, 800, 1200];
export const DEFAULT_AUTO_FOCUS_ON_REMINDER = true;
export const DEFAULT_MEMORY_ACTION_FOR_ACTIVE_TAB = 'reload' as const;
export const DEFAULT_MEMORY_ACTION_FOR_INACTIVE_TAB = 'sleep' as const;
export const DEFAULT_MEMORY_PROMPT_FOR_ACTIVE_TAB = true;
export const DEFAULT_MEMORY_PROMPT_FOR_INACTIVE_TAB = false;

export const STORAGE_KEYS = {
  settings: 'sleepyTabs.settings',
  tabState: 'sleepyTabs.tabState',
  consent: 'sleepyTabs.consent',
  nativeHostStatus: 'sleepyTabs.nativeHostStatus'
} as const;

export const SETTINGS_VERSION = 4;
