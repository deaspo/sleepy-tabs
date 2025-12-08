import {
  getSettings,
  getTabState,
  setTabState,
  deleteTabState,
  updateSettings
} from '../shared/storage';
import { DEFAULT_MEMORY_THRESHOLD_MB } from '../shared/constants';
import {
  postToCompanion,
  sendRuntimeMessage
} from '../shared/messaging';
import { saveTelemetry } from '../shared/telemetryDb';
import type {
  ConsentState,
  SleepAction,
  SleepSettings,
  TabTelemetryRecord
} from '../shared/types';

export const WATCHDOG_ALARM = 'sleepy-tabs-watchdog';
const SETTINGS_POLL_SECONDS = 30;

export class SleepManager {
  private settings: SleepSettings | null = null;
  private consent: ConsentState | null = null;

  async init(): Promise<void> {
    this.settings = await getSettings();
    this.consent = await chrome.storage.local
      .get('sleepyTabs.consent')
      .then((result) => result['sleepyTabs.consent'] ?? { accepted: false });

    await this.ensureAlarm();
    await this.hydrateExistingTabs();
    postToCompanion({ type: 'monitor-tabs' });
  }

  async refreshSettings(): Promise<void> {
    this.settings = await getSettings();
  }

  async ensureAlarm(): Promise<void> {
    const alarm = await chrome.alarms.get(WATCHDOG_ALARM);
    if (!alarm) {
      await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
    }
  }

  async hydrateExistingTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    const state = await getTabState();
    const now = Date.now();
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') {
        continue;
      }
      const existing = state[tab.id];
      const lastActiveAt = existing?.lastActiveAt ?? now;
      state[tab.id] = {
        tabId: tab.id,
        lastActiveAt,
        ignored: existing?.ignored ?? false,
        memoryUsageMb: existing?.memoryUsageMb
      };
      postToCompanion({ type: 'track-tab', tabId: tab.id, url: tab.url ?? undefined });
    }
    await setTabState(state);
  }

  async recordTabActivity(tabId: number): Promise<void> {
    const state = await getTabState();
    const existing = state[tabId];
    state[tabId] = {
      tabId,
      lastActiveAt: Date.now(),
      ignored: existing?.ignored ?? false,
      memoryUsageMb: existing?.memoryUsageMb
    };
    await setTabState(state);
  }

  async setTabIgnored(tabId: number, ignored: boolean): Promise<void> {
    const state = await getTabState();
    const existing = state[tabId];
    if (!existing) {
      state[tabId] = {
        tabId,
        lastActiveAt: Date.now(),
        ignored,
        memoryUsageMb: undefined
      };
    } else {
      existing.ignored = ignored;
    }
    await setTabState(state);
  }

  async removeTab(tabId: number): Promise<void> {
    await deleteTabState(tabId);
    postToCompanion({ type: 'untrack-tab', tabId });
  }

  async evaluateTabs(): Promise<void> {
    const [tabs, state, settings] = await Promise.all([
      chrome.tabs.query({ active: false, discarded: false }),
      getTabState(),
      getSettings()
    ]);

    for (const tab of tabs) {
      if (typeof tab.id !== 'number') {
        continue;
      }

      const tabInfo = state[tab.id];
      if (!tabInfo || tabInfo.ignored) {
        continue;
      }

      const inactivityMs = Date.now() - tabInfo.lastActiveAt;
      const inactivityThresholdMs = settings.inactivityTimeoutMinutes * 60 * 1000;
      const shouldSleep = settings.enableAutoSleep && inactivityMs >= inactivityThresholdMs;
      const memoryThresholdMb = settings.memoryThresholdMb ?? DEFAULT_MEMORY_THRESHOLD_MB;
      const memoryUsage = tabInfo.memoryUsageMb ?? 0;
      const shouldReload =
        settings.enableAutoReload && memoryUsage > memoryThresholdMb && !tab.discarded;

      if (shouldReload) {
        await this.promptAndAct(tab.id, 'reload', 'memory', memoryUsage);
      } else if (shouldSleep) {
        await this.promptAndAct(tab.id, 'sleep', 'inactivity', memoryUsage);
      }
    }
  }

  async promptAndAct(
    tabId: number,
    action: SleepAction,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb?: number
  ): Promise<void> {
    const state = await getTabState();
    const tabState = state[tabId];
    if (!tabState) {
      return;
    }

    tabState.pendingReminder = action;
    await setTabState(state);

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'sleepy-tabs-reminder',
        tabId,
        action,
        timeoutSeconds: this.settings?.reminderTimeoutSeconds,
        reason,
        memoryUsageMb
      });
    } catch (error) {
      console.warn('Reminder message failed, proceeding automatically', error);
      await this.executeAction(tabId, action, reason, memoryUsageMb, true);
    }
  }

  async handleReminderDecision(
    tabId: number,
    action: SleepAction,
    proceed: boolean,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb?: number
  ): Promise<void> {
    const state = await getTabState();
    const tabState = state[tabId];
    if (!tabState) {
      return;
    }
    delete tabState.pendingReminder;
    await setTabState(state);

    if (proceed) {
      await this.executeAction(tabId, action, reason, memoryUsageMb, false);
    }
  }

  private async executeAction(
    tabId: number,
    action: SleepAction,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb: number | undefined,
    autoDueToTimeout: boolean
  ): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      return;
    }

    if (action === 'sleep') {
      postToCompanion({ type: 'sleep-tab', tabId });
      await chrome.tabs.discard(tabId);
    } else {
      postToCompanion({ type: 'reload-tab', tabId });
      await chrome.tabs.reload(tabId);
    }

    await this.logTelemetry({
      tabId,
      url: tab.url ?? 'unknown',
      title: tab.title ?? 'Untitled',
      action,
      reason: autoDueToTimeout ? 'timeout' : reason,
      memoryUsageMb,
      timestamp: Date.now(),
      critical: reason === 'memory'
    });
  }

  async logTelemetry(record: TabTelemetryRecord): Promise<void> {
    try {
      await saveTelemetry(record);
      await sendRuntimeMessage({ type: 'telemetry-response', payload: [record] });
    } catch (error) {
      console.error('Failed to persist telemetry', error);
    }
  }

  async updateTabMemory(tabId: number, memoryUsageMb?: number): Promise<void> {
    if (typeof memoryUsageMb !== 'number') {
      return;
    }

    const state = await getTabState();
    const tabState = state[tabId];
    if (!tabState) {
      return;
    }

    tabState.memoryUsageMb = memoryUsageMb;
    await setTabState(state);
  }

  async handleManualAction(tabId: number, action: SleepAction): Promise<void> {
    const reason: TabTelemetryRecord['reason'] = 'manual';
    await this.executeAction(tabId, action, reason, undefined, false);
  }

  async updateConsent(consent: ConsentState): Promise<void> {
    this.consent = consent;
    await chrome.storage.local.set({ 'sleepyTabs.consent': consent });
  }

  async syncSettings(partial: Partial<SleepSettings>): Promise<SleepSettings> {
    const updated = await updateSettings(partial);
    this.settings = updated;
    return updated;
  }

  scheduleSettingsPoll(): void {
    setInterval(() => {
      this.refreshSettings().catch((error) => console.error('Failed to refresh settings', error));
    }, SETTINGS_POLL_SECONDS * 1000);
  }
}
