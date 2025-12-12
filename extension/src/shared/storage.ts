import {
  DEFAULT_AUTO_FOCUS_ON_REMINDER,
  DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
  DEFAULT_ENABLE_PROCESS_FALLBACK,
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_MEMORY_THRESHOLD_MB,
  DEFAULT_MEMORY_ACTION_FOR_ACTIVE_TAB,
  DEFAULT_MEMORY_ACTION_FOR_INACTIVE_TAB,
  DEFAULT_MEMORY_PROMPT_FOR_ACTIVE_TAB,
  DEFAULT_MEMORY_PROMPT_FOR_INACTIVE_TAB,
  DEFAULT_PROCESS_THRESHOLD_MB,
  DEFAULT_REMINDER_TIMEOUT_SECONDS,
  SETTINGS_VERSION,
  DEFAULT_REMINDER_SNOOZE_MINUTES,
  STORAGE_KEYS
} from './constants';
import type { ConsentState, NativeHostStatus, SleepSettings, TabState } from './types';

export async function getSettings(): Promise<SleepSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const stored = result[STORAGE_KEYS.settings] as (SleepSettings & { enableAutoReload?: boolean }) | undefined;
  const defaults: SleepSettings = {
    version: SETTINGS_VERSION,
    inactivityTimeoutMinutes: DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
    memoryThresholdMb: DEFAULT_MEMORY_THRESHOLD_MB,
    enableAutoSleep: true,
    reminderTimeoutSeconds: DEFAULT_REMINDER_TIMEOUT_SECONDS,
    memoryReminderSnoozeMinutes: DEFAULT_REMINDER_SNOOZE_MINUTES,
    autoFocusOnReminder: DEFAULT_AUTO_FOCUS_ON_REMINDER,
    enableFullPageSampling: DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
    enableProcessFallback: DEFAULT_ENABLE_PROCESS_FALLBACK,
    processFallbackThresholdMb: DEFAULT_PROCESS_THRESHOLD_MB,
    memoryActionForActiveTab: DEFAULT_MEMORY_ACTION_FOR_ACTIVE_TAB,
    memoryActionForInactiveTab: DEFAULT_MEMORY_ACTION_FOR_INACTIVE_TAB,
    memoryPromptForActiveTab: DEFAULT_MEMORY_PROMPT_FOR_ACTIVE_TAB,
    memoryPromptForInactiveTab: DEFAULT_MEMORY_PROMPT_FOR_INACTIVE_TAB
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
  const hasMemoryActionActive = typeof stored.memoryActionForActiveTab === 'string';
  const hasMemoryActionInactive = typeof stored.memoryActionForInactiveTab === 'string';
  const hasMemoryPromptActive = typeof stored.memoryPromptForActiveTab === 'boolean';
  const hasMemoryPromptInactive = typeof stored.memoryPromptForInactiveTab === 'boolean';
  const hasSnoozeMinutes = typeof stored.memoryReminderSnoozeMinutes === 'number';
  const needsVersionMigration = stored.version !== SETTINGS_VERSION;
  const legacyAutoReload = stored.enableAutoReload;
  const resolvedActiveAction = hasMemoryActionActive
    ? stored.memoryActionForActiveTab
    : legacyAutoReload === false
      ? ('sleep' as const)
      : defaults.memoryActionForActiveTab;
  const resolvedInactiveAction = hasMemoryActionInactive
    ? stored.memoryActionForInactiveTab
    : defaults.memoryActionForInactiveTab;
  const resolvedPromptActive = hasMemoryPromptActive
    ? stored.memoryPromptForActiveTab
    : defaults.memoryPromptForActiveTab;
  const resolvedPromptInactive = hasMemoryPromptInactive
    ? stored.memoryPromptForInactiveTab
    : defaults.memoryPromptForInactiveTab;

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
          : defaults.processFallbackThresholdMb,
        memoryReminderSnoozeMinutes: hasSnoozeMinutes
          ? stored.memoryReminderSnoozeMinutes
          : defaults.memoryReminderSnoozeMinutes,
        memoryActionForActiveTab: resolvedActiveAction,
        memoryActionForInactiveTab: resolvedInactiveAction,
        memoryPromptForActiveTab: resolvedPromptActive,
        memoryPromptForInactiveTab: resolvedPromptInactive
      }
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
          : defaults.processFallbackThresholdMb,
        memoryReminderSnoozeMinutes: hasSnoozeMinutes
          ? stored.memoryReminderSnoozeMinutes
          : defaults.memoryReminderSnoozeMinutes,
        memoryActionForActiveTab: resolvedActiveAction,
        memoryActionForInactiveTab: resolvedInactiveAction,
        memoryPromptForActiveTab: resolvedPromptActive,
        memoryPromptForInactiveTab: resolvedPromptInactive
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
