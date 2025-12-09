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
  TabMemorySource,
  TabState,
  TabTelemetryRecord
} from '../shared/types';

export const WATCHDOG_ALARM = 'sleepy-tabs-watchdog';
const SETTINGS_POLL_SECONDS = 30;

interface SleepAllResult {
  attempted: number;
  succeeded: number;
  errors: Array<{ tabId: number; message: string }>;
}

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
      state[tab.id] = this.composeTabState(tab.id, now, existing, {
        lastActiveAt,
        lastSeenAt: now,
        url: tab.url ?? existing?.url,
        title: tab.title ?? existing?.title,
        windowId: tab.windowId ?? existing?.windowId
      });
      postToCompanion({ type: 'track-tab', tabId: tab.id, url: tab.url ?? undefined });
    }
    await setTabState(state);
  }

  async recordTabActivity(tabId: number): Promise<void> {
    const [state, tab] = await Promise.all([
      getTabState(),
      chrome.tabs.get(tabId).catch(() => null)
    ]);
    const existing = state[tabId];
    const now = Date.now();
    state[tabId] = this.composeTabState(tabId, now, existing, {
      lastActiveAt: now,
      lastSeenAt: now,
      url: tab?.url ?? existing?.url,
      title: tab?.title ?? existing?.title,
      windowId: tab?.windowId ?? existing?.windowId
    });
    await setTabState(state);
    this.broadcastTabStateUpdate(tabId, state[tabId]);
  }

  async setTabIgnored(tabId: number, ignored: boolean): Promise<void> {
    const state = await getTabState();
    const existing = state[tabId];
    const now = Date.now();
    state[tabId] = this.composeTabState(tabId, now, existing, { ignored });
    await setTabState(state);
    this.broadcastTabStateUpdate(tabId, state[tabId]);
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
    const stateSnapshot = await getTabState();
    const tabState = stateSnapshot[tabId];
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

    const resolvedMemoryUsage =
      typeof memoryUsageMb === 'number' ? memoryUsageMb : tabState?.memoryUsageMb;

    await this.logTelemetry({
      tabId,
      url: tab.url ?? 'unknown',
      title: tab.title ?? 'Untitled',
      action,
      reason: autoDueToTimeout ? 'timeout' : reason,
      memoryUsageMb: resolvedMemoryUsage,
      memorySource: tabState?.memorySource,
      memoryCapturedAt: tabState?.memoryCapturedAt,
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

  async updateTabMemory(
    tabId: number,
    memoryUsageMb?: number,
    source: TabMemorySource = 'companion'
  ): Promise<void> {
    if (typeof memoryUsageMb !== 'number' || Number.isNaN(memoryUsageMb)) {
      return;
    }

    const state = await getTabState();
    const tabState = state[tabId];
    if (!tabState) {
      return;
    }

    tabState.memoryUsageMb = memoryUsageMb;
    tabState.memorySource = source;
    tabState.memoryCapturedAt = Date.now();
    if (!tabState.lastSeenAt) {
      tabState.lastSeenAt = Date.now();
    }
    await setTabState(state);
    this.broadcastTabStateUpdate(tabId, tabState);
  }

  async handleManualAction(tabId: number, action: SleepAction): Promise<void> {
    const reason: TabTelemetryRecord['reason'] = 'manual';
    await this.executeAction(tabId, action, reason, undefined, false);
  }

  async sleepAllTabs(excludeActive = true, excludeTabId?: number): Promise<SleepAllResult> {
    const [tabs, state] = await Promise.all([
      chrome.tabs.query({ discarded: false }),
      getTabState()
    ]);

    let activeTabId: number | undefined;
    if (excludeActive) {
      const activeTab = tabs.find((tab) => tab.active && typeof tab.id === 'number');
      activeTabId = activeTab?.id;
    }

    const result: SleepAllResult = {
      attempted: 0,
      succeeded: 0,
      errors: []
    };

    for (const tab of tabs) {
      if (typeof tab.id !== 'number') {
        continue;
      }
      if ((excludeActive && activeTabId === tab.id) || (typeof excludeTabId === 'number' && tab.id === excludeTabId)) {
        continue;
      }

      const tabState = state[tab.id];
      if (!tabState || tabState.ignored) {
        continue;
      }

      result.attempted += 1;
      try {
        await this.handleManualAction(tab.id, 'sleep');
        result.succeeded += 1;
      } catch (error) {
        console.error('Failed to put tab to sleep', error);
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ tabId: tab.id, message });
      }
    }

    return result;
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

  async syncTabMetadata(tab: chrome.tabs.Tab): Promise<void> {
    if (typeof tab.id !== 'number') {
      return;
    }
    const state = await getTabState();
    const existing = state[tab.id];
    const now = Date.now();
    state[tab.id] = this.composeTabState(tab.id, now, existing, {
      lastSeenAt: now,
      url: tab.url ?? existing?.url,
      title: tab.title ?? existing?.title,
      windowId: tab.windowId ?? existing?.windowId
    });
    await setTabState(state);
    this.broadcastTabStateUpdate(tab.id, state[tab.id]);
  }

  private composeTabState(
    tabId: number,
    now: number,
    existing?: TabState,
    overrides?: Partial<TabState>
  ): TabState {
    return {
      tabId,
      lastActiveAt: existing?.lastActiveAt ?? now,
      lastSeenAt: existing?.lastSeenAt ?? now,
      ignored: existing?.ignored ?? false,
      pendingReminder: existing?.pendingReminder,
      memoryUsageMb: existing?.memoryUsageMb,
      memorySource: existing?.memorySource,
      memoryCapturedAt: existing?.memoryCapturedAt,
      url: existing?.url,
      title: existing?.title,
      windowId: existing?.windowId,
      ...overrides
    } satisfies TabState;
  }

  private broadcastTabStateUpdate(tabId: number, tabState: TabState): void {
    void sendRuntimeMessage({
      type: 'tab-state-updated',
      tabId,
      state: tabState
    }).catch((error) => {
      console.warn('Failed to broadcast tab state update', error);
    });
  }
}
