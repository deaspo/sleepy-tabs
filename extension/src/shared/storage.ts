import {
  DEFAULT_AUTO_FOCUS_ON_REMINDER,
  DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
  DEFAULT_ENABLE_PROCESS_FALLBACK,
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_MEMORY_THRESHOLD_MB,
  DEFAULT_PROCESS_THRESHOLD_MB,
  DEFAULT_REMINDER_TIMEOUT_SECONDS,
  SETTINGS_VERSION,
  STORAGE_KEYS
} from './constants';
import type { ConsentState, NativeHostStatus, SleepSettings, TabState } from './types';

export async function getSettings(): Promise<SleepSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const stored = result[STORAGE_KEYS.settings] as SleepSettings | undefined;
  const defaults: SleepSettings = {
    version: SETTINGS_VERSION,
    inactivityTimeoutMinutes: DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
    memoryThresholdMb: DEFAULT_MEMORY_THRESHOLD_MB,
    enableAutoReload: true,
    enableAutoSleep: true,
    reminderTimeoutSeconds: DEFAULT_REMINDER_TIMEOUT_SECONDS,
    autoFocusOnReminder: DEFAULT_AUTO_FOCUS_ON_REMINDER,
    enableFullPageSampling: DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
    enableProcessFallback: DEFAULT_ENABLE_PROCESS_FALLBACK,
    processFallbackThresholdMb: DEFAULT_PROCESS_THRESHOLD_MB
  };

  if (!stored) {
    await setSettings(defaults);
    return defaults;
  }

  const hasValidFullPageFlag = typeof stored.enableFullPageSampling === 'boolean';
  const hasAutoFocusFlag = typeof stored.autoFocusOnReminder === 'boolean';
  const hasProcessSettings =
    typeof stored.enableProcessFallback === 'boolean' &&
    typeof stored.processFallbackThresholdMb === 'number';
  const needsVersionMigration = stored.version !== SETTINGS_VERSION;
  const resolved: SleepSettings = needsVersionMigration
    ? {
        ...defaults,
        ...stored,
        version: SETTINGS_VERSION,
        enableFullPageSampling: hasValidFullPageFlag
          ? stored.enableFullPageSampling
          : defaults.enableFullPageSampling,
        autoFocusOnReminder: hasAutoFocusFlag
          ? stored.autoFocusOnReminder
          : defaults.autoFocusOnReminder,
        enableProcessFallback: hasProcessSettings
          ? stored.enableProcessFallback
          : defaults.enableProcessFallback,
        processFallbackThresholdMb: hasProcessSettings
          ? stored.processFallbackThresholdMb
          : defaults.processFallbackThresholdMb
      }
    : hasValidFullPageFlag && hasProcessSettings && hasAutoFocusFlag
      ? stored
      : {
          ...stored,
          enableFullPageSampling: hasValidFullPageFlag
            ? stored.enableFullPageSampling
            : defaults.enableFullPageSampling,
          autoFocusOnReminder: hasAutoFocusFlag
            ? stored.autoFocusOnReminder
            : defaults.autoFocusOnReminder,
          enableProcessFallback: hasProcessSettings
            ? stored.enableProcessFallback
            : defaults.enableProcessFallback,
          processFallbackThresholdMb: hasProcessSettings
            ? stored.processFallbackThresholdMb
            : defaults.processFallbackThresholdMb
        };

  if (needsVersionMigration || resolved !== stored) {
    await setSettings(resolved);
  }

  return resolved;
}

export async function setSettings(settings: SleepSettings): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: settings
  });
}

export async function updateSettings(partial: Partial<SleepSettings>): Promise<SleepSettings> {
  const existing = await getSettings();
  const updated = { ...existing, ...partial } satisfies SleepSettings;
  await setSettings(updated);
  return updated;
}

export async function getConsentState(): Promise<ConsentState> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.consent);
  const consent = result[STORAGE_KEYS.consent] as ConsentState | undefined;
  return consent ?? { accepted: false };
}

export async function setConsentState(consent: ConsentState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.consent]: consent
  });
}

export async function getTabState(): Promise<Record<number, TabState>> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.tabState);
  const tabState = (result[STORAGE_KEYS.tabState] as Record<number, TabState> | undefined) ?? {};
  return tabState;
}

export async function setTabState(state: Record<number, TabState>): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.tabState]: state
  });
}

export async function upsertTabState(tab: TabState): Promise<void> {
  const state = await getTabState();
  state[tab.tabId] = tab;
  await setTabState(state);
}

export async function deleteTabState(tabId: number): Promise<void> {
  const state = await getTabState();
  delete state[tabId];
  await setTabState(state);
}

export async function getNativeHostStatus(): Promise<NativeHostStatus> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.nativeHostStatus);
  return (result[STORAGE_KEYS.nativeHostStatus] as NativeHostStatus | undefined) ?? 'unknown';
}

export async function setNativeHostStatus(status: NativeHostStatus): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.nativeHostStatus]: status
  });
}
