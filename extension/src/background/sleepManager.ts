import {
  getSettings,
  getTabState,
  setTabState,
  deleteTabState,
  updateSettings
} from '../shared/storage';
import { DEFAULT_MEMORY_THRESHOLD_MB, DEFAULT_REMINDER_TIMEOUT_SECONDS } from '../shared/constants';
import {
  postToCompanion,
  sendRuntimeMessage
} from '../shared/messaging';
import { saveTelemetry } from '../shared/telemetryDb';
import type {
  CapabilityReport,
  ConsentState,
  MemoryActionTarget,
  NativeHostStatus,
  SleepAction,
  SleepSettings,
  TabMemorySample,
  TabState,
  TabTelemetryRecord
} from '../shared/types';

export const WATCHDOG_ALARM = 'sleepy-tabs-watchdog';
const SETTINGS_POLL_SECONDS = 30;
const PROCESS_FALLBACK_INTERVAL_MS = 20000;
const PROCESS_SAMPLE_REFRESH_MS = 60000;
const SESSION_RESUME_RESET_THRESHOLD_MS = 60 * 1000;

interface SleepAllResult {
  attempted: number;
  succeeded: number;
  errors: Array<{ tabId: number; message: string }>;
}

export class SleepManager {
  private settings: SleepSettings | null = null;
  private consent: ConsentState | null = null;
  private processFallbackHandle: ReturnType<typeof setInterval> | null = null;
  private processSampleCache = new Map<number, { processId: number; lastSampledAt: number }>();
  private processFallbackSupported = false;
  private processFallbackReason?: string;
  private activeReminderWindows = new Map<number, number>();
  private reminderTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
  private reminderMemoryContext = new Map<
    number,
    {
      memoryThresholdMb?: number;
      memoryTarget?: MemoryActionTarget;
      memoryPrompted: boolean;
    }
  >();

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
      const lastSeenAt = existing?.lastSeenAt ?? 0;
      const resumeGap = lastSeenAt > 0 ? now - lastSeenAt : Number.POSITIVE_INFINITY;
      const resumedFromPriorSession = Boolean(existing) && resumeGap > SESSION_RESUME_RESET_THRESHOLD_MS;

      const overrides: Partial<TabState> = {
        lastActiveAt: resumedFromPriorSession ? now : existing?.lastActiveAt ?? now,
        lastSeenAt: now,
        url: tab.url ?? existing?.url,
        title: tab.title ?? existing?.title,
        windowId: tab.windowId ?? existing?.windowId
      };

      if (resumedFromPriorSession) {
        // Edge restores tabs eagerly on startup; treat them as freshly active to avoid instant reminders.
        overrides.pendingReminder = undefined;
        overrides.memoryUsageMb = undefined;
        overrides.totalHeapMb = undefined;
        overrides.fullPageMemoryMb = undefined;
        overrides.heapLimitMb = existing?.heapLimitMb; // heap limit is static, keep if previously captured
        overrides.memoryCapturedAt = undefined;
        overrides.memorySource = undefined;
      }

      state[tab.id] = this.composeTabState(tab.id, now, existing, overrides);
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
    this.processSampleCache.delete(tabId);
    this.clearReminderTimeout(tabId);
    await this.closeExistingReminderWindow(tabId);
    this.reminderMemoryContext.delete(tabId);
    postToCompanion({ type: 'untrack-tab', tabId });
  }

  async evaluateTabs(): Promise<void> {
    const [tabs, state, settings] = await Promise.all([
      chrome.tabs.query({ discarded: false }),
      getTabState(),
      getSettings()
    ]);

    this.settings = settings;

    for (const tab of tabs) {
      if (typeof tab.id !== 'number') {
        continue;
      }

      const tabInfo = state[tab.id];
      if (!tabInfo || tabInfo.ignored) {
        continue;
      }

      const isActive = Boolean(tab.active);
      const inactivityMs = Date.now() - tabInfo.lastActiveAt;
      const inactivityThresholdMs = settings.inactivityTimeoutMinutes * 60 * 1000;
      const shouldSleepForInactivity =
        !isActive && settings.enableAutoSleep && inactivityMs >= inactivityThresholdMs;

      const memoryThresholdMb = settings.memoryThresholdMb ?? DEFAULT_MEMORY_THRESHOLD_MB;
      const memoryUsage = this.resolveTabMemoryUsage(tabInfo) ?? 0;
      const overMemoryThreshold = memoryUsage > memoryThresholdMb && !tab.discarded;

      if (overMemoryThreshold) {
        const memoryTarget: MemoryActionTarget = isActive ? 'active' : 'inactive';
        const preferredAction = isActive
          ? settings.memoryActionForActiveTab
          : settings.memoryActionForInactiveTab;
        const shouldPrompt = isActive
          ? settings.memoryPromptForActiveTab
          : settings.memoryPromptForInactiveTab;

        if (tabInfo.pendingReminder && shouldPrompt) {
          continue;
        }

        const metrics = {
          totalHeapMb: tabInfo.totalHeapMb,
          fullPageMemoryMb: tabInfo.fullPageMemoryMb,
          heapLimitMb: tabInfo.heapLimitMb,
          memoryThresholdMb,
          memoryTarget,
          memoryPrompted: shouldPrompt
        };

        if (shouldPrompt) {
          await this.promptAndAct(tab.id, preferredAction, 'memory', memoryUsage, metrics);
        } else {
          await this.executeAction(tab.id, preferredAction, 'memory', memoryUsage, false, metrics);
        }
        continue;
      }

      if (shouldSleepForInactivity) {
        if (tabInfo.pendingReminder === 'sleep') {
          continue;
        }
        await this.promptAndAct(tab.id, 'sleep', 'inactivity', memoryUsage, {
          totalHeapMb: tabInfo.totalHeapMb,
          fullPageMemoryMb: tabInfo.fullPageMemoryMb,
          heapLimitMb: tabInfo.heapLimitMb
        });
      }
    }
  }

  async promptAndAct(
    tabId: number,
    action: SleepAction,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb?: number,
    metrics?: {
      totalHeapMb?: number;
      fullPageMemoryMb?: number;
      heapLimitMb?: number;
      memoryThresholdMb?: number;
      memoryTarget?: MemoryActionTarget;
      memoryPrompted?: boolean;
    }
  ): Promise<void> {
    const state = await getTabState();
    let tabState = state[tabId];
    if (!tabState) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const now = Date.now();
      // Compose a minimal state so we do not drop memory samples for tabs we have not seen yet.
      tabState = this.composeTabState(tabId, now, undefined, {
        url: tab?.url ?? undefined,
        title: tab?.title ?? 'Unknown tab',
        windowId: tab?.windowId
      });
      state[tabId] = tabState;
    }

    const reminderMemoryUsage =
      typeof memoryUsageMb === 'number' ? memoryUsageMb : this.resolveTabMemoryUsage(tabState);
    const shouldAutoFocus = this.settings?.autoFocusOnReminder !== false;

    tabState.pendingReminder = action;
    await setTabState(state);
    this.broadcastTabStateUpdate(tabId, tabState);

    const reminderMetrics = {
      totalHeapMb: metrics?.totalHeapMb ?? tabState.totalHeapMb,
      fullPageMemoryMb: metrics?.fullPageMemoryMb ?? tabState.fullPageMemoryMb,
      heapLimitMb: metrics?.heapLimitMb ?? tabState.heapLimitMb,
      memoryThresholdMb:
        typeof metrics?.memoryThresholdMb === 'number'
          ? metrics.memoryThresholdMb
          : reason === 'memory'
            ? this.settings?.memoryThresholdMb ?? DEFAULT_MEMORY_THRESHOLD_MB
            : undefined,
      memoryTarget: metrics?.memoryTarget,
      memoryPrompted: metrics?.memoryPrompted ?? true
    } satisfies {
      totalHeapMb?: number;
      fullPageMemoryMb?: number;
      heapLimitMb?: number;
      memoryThresholdMb?: number;
      memoryTarget?: MemoryActionTarget;
      memoryPrompted?: boolean;
    };

    if (reason === 'memory') {
      this.reminderMemoryContext.set(tabId, {
        memoryThresholdMb: reminderMetrics.memoryThresholdMb,
        memoryTarget: reminderMetrics.memoryTarget,
        memoryPrompted: true
      });
    }

    this.scheduleReminderTimeout(tabId, action, reason, reminderMemoryUsage, reminderMetrics);

    const liveTab = await chrome.tabs.get(tabId).catch(() => null);
    const requiresStandalone = !this.canInjectReminder(liveTab);
    if (requiresStandalone) {
      if (shouldAutoFocus) {
        await this.focusTabIfPossible(tabId, tabState.windowId);
      }
      try {
        await this.closeExistingReminderWindow(tabId);
        await this.launchStandaloneReminder(tabId, action, reason, reminderMemoryUsage, tabState, {
          memoryThresholdMb: reminderMetrics.memoryThresholdMb,
          memoryTarget: reminderMetrics.memoryTarget
        });
      } catch (fallbackError) {
        console.warn('Standalone reminder failed, proceeding automatically', fallbackError);
        this.clearReminderTimeout(tabId);
        const context = this.reminderMemoryContext.get(tabId);
        this.reminderMemoryContext.delete(tabId);
        await this.clearPendingReminderState(tabId);
        await this.executeAction(tabId, action, reason, reminderMemoryUsage, true, {
          ...reminderMetrics,
          memoryThresholdMb: context?.memoryThresholdMb ?? reminderMetrics.memoryThresholdMb,
          memoryTarget: context?.memoryTarget ?? reminderMetrics.memoryTarget,
          memoryPrompted: context?.memoryPrompted ?? reminderMetrics.memoryPrompted
        });
      }
      return;
    }

    try {
      if (shouldAutoFocus) {
        await this.focusTabIfPossible(tabId, tabState.windowId);
      }
      await chrome.tabs.sendMessage(tabId, {
        type: 'sleepy-tabs-reminder',
        tabId,
        action,
        timeoutSeconds: this.settings?.reminderTimeoutSeconds,
        reason,
        memoryUsageMb: reminderMemoryUsage,
        totalHeapMb: tabState.totalHeapMb,
        heapLimitMb: tabState.heapLimitMb,
        fullPageMemoryMb: tabState.fullPageMemoryMb,
        memorySource: tabState.memorySource,
        memoryCapturedAt: tabState.memoryCapturedAt,
        memoryThresholdMb: reminderMetrics.memoryThresholdMb,
        memoryTarget: reminderMetrics.memoryTarget
      });
    } catch (error) {
      console.warn('Reminder message failed, attempting standalone reminder', error);
      try {
        await this.closeExistingReminderWindow(tabId);
        await this.launchStandaloneReminder(tabId, action, reason, reminderMemoryUsage, tabState, {
          memoryThresholdMb: reminderMetrics.memoryThresholdMb,
          memoryTarget: reminderMetrics.memoryTarget
        });
      } catch (fallbackError) {
        console.warn('Standalone reminder failed, proceeding automatically', fallbackError);
        this.clearReminderTimeout(tabId);
        const context = this.reminderMemoryContext.get(tabId);
        this.reminderMemoryContext.delete(tabId);
        await this.clearPendingReminderState(tabId);
        await this.executeAction(tabId, action, reason, reminderMemoryUsage, true, {
          ...reminderMetrics,
          memoryThresholdMb: context?.memoryThresholdMb ?? reminderMetrics.memoryThresholdMb,
          memoryTarget: context?.memoryTarget ?? reminderMetrics.memoryTarget,
          memoryPrompted: context?.memoryPrompted ?? reminderMetrics.memoryPrompted
        });
      }
    }
  }

  async handleReminderDecision(
    tabId: number,
    action: SleepAction,
    proceed: boolean,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb?: number,
    totalHeapMb?: number,
    fullPageMemoryMb?: number,
    heapLimitMb?: number,
    memoryThresholdMb?: number,
    memoryTarget?: MemoryActionTarget
  ): Promise<void> {
    const state = await getTabState();
    let tabState = state[tabId];
    if (!tabState) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const now = Date.now();
      tabState = this.composeTabState(tabId, now, undefined, {
        url: tab?.url ?? undefined,
        title: tab?.title ?? 'Unknown tab',
        windowId: tab?.windowId
      });
      state[tabId] = tabState;
    }
    delete tabState.pendingReminder;
    await setTabState(state);
    this.broadcastTabStateUpdate(tabId, tabState);

    this.clearReminderTimeout(tabId);
    await this.closeExistingReminderWindow(tabId);
    const reminderContext = this.reminderMemoryContext.get(tabId);
    if (reminderContext) {
      this.reminderMemoryContext.delete(tabId);
    }
    const context = reminderContext ??
      (reason === 'memory'
        ? {
            memoryThresholdMb,
            memoryTarget,
            memoryPrompted: true
          }
        : undefined);

    if (proceed) {
      await this.executeAction(tabId, action, reason, memoryUsageMb, false, {
        totalHeapMb,
        fullPageMemoryMb,
        heapLimitMb,
        memoryThresholdMb: context?.memoryThresholdMb,
        memoryTarget: context?.memoryTarget,
        memoryPrompted: context?.memoryPrompted ?? true
      });
    }
  }

  private async executeAction(
    tabId: number,
    action: SleepAction,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb: number | undefined,
    autoDueToTimeout: boolean,
    metrics?: {
      totalHeapMb?: number;
      fullPageMemoryMb?: number;
      heapLimitMb?: number;
      memoryThresholdMb?: number;
      memoryTarget?: MemoryActionTarget;
      memoryPrompted?: boolean;
    }
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
      typeof memoryUsageMb === 'number' ? memoryUsageMb : this.resolveTabMemoryUsage(tabState);

    await this.logTelemetry({
      tabId,
      url: tab.url ?? 'unknown',
      title: tab.title ?? 'Untitled',
      action,
      reason: autoDueToTimeout ? 'timeout' : reason,
      memoryUsageMb: resolvedMemoryUsage,
      totalHeapMb: metrics?.totalHeapMb ?? tabState?.totalHeapMb,
      heapLimitMb: metrics?.heapLimitMb ?? tabState?.heapLimitMb,
      fullPageMemoryMb: metrics?.fullPageMemoryMb ?? tabState?.fullPageMemoryMb,
      memorySource: tabState?.memorySource,
      memoryCapturedAt: tabState?.memoryCapturedAt,
      processFallbackThresholdMb: tabState?.processFallbackThresholdMb,
      timestamp: Date.now(),
      critical: reason === 'memory',
      memoryThresholdMb: metrics?.memoryThresholdMb,
      memoryTarget: metrics?.memoryTarget,
      memoryPrompted: metrics?.memoryPrompted
    });
  }

  async logTelemetry(record: TabTelemetryRecord): Promise<void> {
    try {
      await saveTelemetry(record);
    } catch (error) {
      console.error('Failed to persist telemetry', error);
      return;
    }

    void sendRuntimeMessage({ type: 'telemetry-response', payload: [record] }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Receiving end does not exist') ||
        message.includes('The message port closed before a response was received')
      ) {
        return;
      }
    });
  }

  async updateTabMemory(tabId: number, sample: TabMemorySample): Promise<void> {
    const hasSample =
      typeof sample.memoryUsageMb === 'number' ||
      typeof sample.totalHeapMb === 'number' ||
      typeof sample.heapLimitMb === 'number' ||
      typeof sample.fullPageMemoryMb === 'number';
    if (!hasSample) {
      return;
    }

    const state = await getTabState();
    const tabState = state[tabId];
    if (!tabState) {
      return;
    }

    if (typeof sample.memoryUsageMb === 'number' && !Number.isNaN(sample.memoryUsageMb)) {
      tabState.memoryUsageMb = sample.memoryUsageMb;
    }
    if (typeof sample.totalHeapMb === 'number' && !Number.isNaN(sample.totalHeapMb)) {
      tabState.totalHeapMb = sample.totalHeapMb;
    }
    if (typeof sample.heapLimitMb === 'number' && !Number.isNaN(sample.heapLimitMb)) {
      tabState.heapLimitMb = sample.heapLimitMb;
    }
    if (typeof sample.fullPageMemoryMb === 'number' && !Number.isNaN(sample.fullPageMemoryMb)) {
      tabState.fullPageMemoryMb = sample.fullPageMemoryMb;
    }

    tabState.memorySource = sample.source;
    tabState.memoryCapturedAt = Date.now();
    if (sample.source === 'processes' && typeof sample.processId === 'number') {
      tabState.processId = sample.processId;
      tabState.processSampledAt = tabState.memoryCapturedAt;
    }
    tabState.processFallbackThresholdMb =
      sample.source === 'processes' ? this.settings?.processFallbackThresholdMb : undefined;
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

  handleNativeHostStatusChange(status: NativeHostStatus): void {
    if (
      !chrome.processes?.getProcessInfo ||
      !this.settings?.enableProcessFallback ||
      !this.processFallbackSupported
    ) {
      this.stopProcessFallback();
      return;
    }
    if (status === 'connected') {
      this.stopProcessFallback();
    } else {
      this.startProcessFallback();
    }
  }

  private startProcessFallback(): void {
    if (
      this.processFallbackHandle ||
      !chrome.processes?.getProcessInfo ||
      !this.settings?.enableProcessFallback ||
      !this.processFallbackSupported
    ) {
      return;
    }
    this.processFallbackHandle = setInterval(() => {
      void this.collectProcessSamples();
    }, PROCESS_FALLBACK_INTERVAL_MS);
    void this.collectProcessSamples();
  }

  private stopProcessFallback(): void {
    if (this.processFallbackHandle) {
      clearInterval(this.processFallbackHandle);
      this.processFallbackHandle = null;
    }
    this.processSampleCache.clear();
  }

  private async collectProcessSamples(): Promise<void> {
    if (
      !chrome.processes?.getProcessInfo ||
      !this.settings?.enableProcessFallback ||
      !this.processFallbackSupported
    ) {
      return;
    }

    const state = await getTabState();
    const now = Date.now();
    const candidateTabIds = new Set<number>();
    for (const tab of Object.values(state)) {
      if (!tab || tab.ignored) {
        continue;
      }
      const lastCaptured = tab.memoryCapturedAt ?? 0;
      if (now - lastCaptured >= PROCESS_SAMPLE_REFRESH_MS) {
        candidateTabIds.add(tab.tabId);
      }
    }

    if (candidateTabIds.size === 0) {
      return;
    }

    const processInfo = await new Promise<chrome.processes.ProcessesMap>((resolve, reject) => {
      chrome.processes.getProcessInfo(undefined, true, (info) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(info);
      });
    }).catch(() => {
      return null;
    });

    if (!processInfo) {
      return;
    }

    for (const process of Object.values(processInfo)) {
      if (!Array.isArray(process.tasks) || process.tasks.length === 0) {
        continue;
      }
      const memoryMb = this.processMemoryToMb(process);
      if (typeof memoryMb !== 'number' || Number.isNaN(memoryMb)) {
        continue;
      }

      for (const task of process.tasks) {
        if (typeof task.tabId !== 'number' || !candidateTabIds.has(task.tabId)) {
          continue;
        }
        const cacheEntry = this.processSampleCache.get(task.tabId);
        if (cacheEntry && now - cacheEntry.lastSampledAt < PROCESS_SAMPLE_REFRESH_MS / 2) {
          continue;
        }
        await this.updateTabMemory(task.tabId, {
          memoryUsageMb: memoryMb,
          source: 'processes',
          processId: process.osProcessId ?? process.id
        });
        this.processSampleCache.set(task.tabId, {
          processId: process.osProcessId ?? process.id ?? -1,
          lastSampledAt: now
        });
      }
    }
  }

  private processMemoryToMb(process: chrome.processes.ProcessInformation): number | undefined {
    const privateKb = process.privateMemory ?? 0;
    const sharedKb = process.sharedMemory ?? 0;
    const totalMb = (privateKb + sharedKb) / 1024;
    if (totalMb <= 0) {
      return undefined;
    }
    if (this.settings) {
      const threshold = this.settings.processFallbackThresholdMb ?? DEFAULT_MEMORY_THRESHOLD_MB;
      if (totalMb < threshold) {
        return undefined;
      }
    }
    return Math.round(totalMb * 100) / 100;
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
      totalHeapMb: existing?.totalHeapMb,
      heapLimitMb: existing?.heapLimitMb,
      fullPageMemoryMb: existing?.fullPageMemoryMb,
      memorySource: existing?.memorySource,
      memoryCapturedAt: existing?.memoryCapturedAt,
      processId: existing?.processId,
      processSampledAt: existing?.processSampledAt,
      processFallbackThresholdMb: existing?.processFallbackThresholdMb,
      url: existing?.url,
      title: existing?.title,
      windowId: existing?.windowId,
      ...overrides
    } satisfies TabState;
  }

  private resolveTabMemoryUsage(tabState?: TabState): number | undefined {
    if (!tabState) {
      return undefined;
    }
    const candidates = [
      tabState.totalHeapMb,
      tabState.fullPageMemoryMb,
      tabState.memoryUsageMb
    ].filter((value): value is number => typeof value === 'number' && value > 0);
    if (candidates.length > 0) {
      return Math.max(...candidates);
    }
    return tabState.heapLimitMb ?? tabState.memoryUsageMb ?? tabState.totalHeapMb ?? undefined;
  }

  setProcessFallbackSupport(report: CapabilityReport): void {
    this.processFallbackSupported = report.processFallbackSupported;
    this.processFallbackReason = report.processFallbackReason;
    if (!report.processFallbackSupported) {
      this.stopProcessFallback();
    }
  }

  getProcessFallbackSupport(): CapabilityReport {
    return {
      processFallbackSupported: this.processFallbackSupported,
      processFallbackReason: this.processFallbackReason
    };
  }

  private broadcastTabStateUpdate(tabId: number, tabState: TabState): void {
    void sendRuntimeMessage({
      type: 'tab-state-updated',
      tabId,
      state: tabState
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Receiving end does not exist') ||
        message.includes('The message port closed before a response was received')
      ) {
        return;
      }
      console.warn('Failed to broadcast tab state update', error);
    });
  }

  private canInjectReminder(tab: chrome.tabs.Tab | null): boolean {
    if (!tab) {
      return false;
    }
    const url = tab.url ?? '';
    if (!url) {
      return false;
    }
    const blockedSchemes = ['chrome://', 'edge://', 'about:', 'devtools://', 'file://', 'chrome-extension://'];
    return !blockedSchemes.some((scheme) => url.startsWith(scheme));
  }

  private async focusTabIfPossible(tabId: number, windowId?: number): Promise<void> {
    try {
      await chrome.tabs.update(tabId, { active: true });
      if (typeof windowId === 'number') {
        await chrome.windows.update(windowId, { focused: true });
      }
    } catch (error) {
      console.warn('Unable to auto-focus tab before reminder', error);
    }
  }

  private async closeExistingReminderWindow(tabId: number): Promise<void> {
    const existingWindowId = this.activeReminderWindows.get(tabId);
    if (typeof existingWindowId === 'number') {
      try {
        await chrome.windows.remove(existingWindowId);
      } catch (error) {
        void error;
      }
      this.activeReminderWindows.delete(tabId);
    }
  }

  private scheduleReminderTimeout(
    tabId: number,
    action: SleepAction,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb: number | undefined,
    metrics: {
      totalHeapMb?: number;
      fullPageMemoryMb?: number;
      heapLimitMb?: number;
      memoryThresholdMb?: number;
      memoryTarget?: MemoryActionTarget;
      memoryPrompted?: boolean;
    }
  ): void {
    const timeoutSeconds = this.settings?.reminderTimeoutSeconds ?? DEFAULT_REMINDER_TIMEOUT_SECONDS;
    const timeoutMs = Math.max(1, timeoutSeconds) * 1000;
    this.clearReminderTimeout(tabId);
    const handle = setTimeout(() => {
      void this.handleReminderTimeout(tabId, action, reason, memoryUsageMb, metrics);
    }, timeoutMs);
    this.reminderTimeouts.set(tabId, handle);
  }

  private clearReminderTimeout(tabId: number): void {
    const handle = this.reminderTimeouts.get(tabId);
    if (handle) {
      clearTimeout(handle);
      this.reminderTimeouts.delete(tabId);
    }
  }

  private async clearPendingReminderState(tabId: number): Promise<void> {
    const state = await getTabState();
    const tabState = state[tabId];
    if (tabState?.pendingReminder) {
      delete tabState.pendingReminder;
      await setTabState(state);
      this.broadcastTabStateUpdate(tabId, tabState);
    }
  }

  private async handleReminderTimeout(
    tabId: number,
    action: SleepAction,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb: number | undefined,
    metrics: {
      totalHeapMb?: number;
      fullPageMemoryMb?: number;
      heapLimitMb?: number;
      memoryThresholdMb?: number;
      memoryTarget?: MemoryActionTarget;
      memoryPrompted?: boolean;
    }
  ): Promise<void> {
    this.reminderTimeouts.delete(tabId);
    await this.closeExistingReminderWindow(tabId);
    const state = await getTabState();
    const tabState = state[tabId];
    if (tabState?.pendingReminder) {
      delete tabState.pendingReminder;
      await setTabState(state);
      this.broadcastTabStateUpdate(tabId, tabState);
    }
    const context = this.reminderMemoryContext.get(tabId);
    this.reminderMemoryContext.delete(tabId);
    const resolvedMetrics = {
      totalHeapMb: metrics.totalHeapMb ?? tabState?.totalHeapMb,
      fullPageMemoryMb: metrics.fullPageMemoryMb ?? tabState?.fullPageMemoryMb,
      heapLimitMb: metrics.heapLimitMb ?? tabState?.heapLimitMb,
      memoryThresholdMb: context?.memoryThresholdMb ?? metrics.memoryThresholdMb,
      memoryTarget: context?.memoryTarget ?? metrics.memoryTarget,
      memoryPrompted: context?.memoryPrompted ?? metrics.memoryPrompted ?? true
    };
    const resolvedMemoryUsage =
      typeof memoryUsageMb === 'number' ? memoryUsageMb : this.resolveTabMemoryUsage(tabState);
    await this.executeAction(tabId, action, reason, resolvedMemoryUsage, true, resolvedMetrics);
  }

  private async launchStandaloneReminder(
    tabId: number,
    action: SleepAction,
    reason: TabTelemetryRecord['reason'],
    memoryUsageMb: number | undefined,
    tabState: TabState,
    metrics?: {
      memoryThresholdMb?: number;
      memoryTarget?: MemoryActionTarget;
    }
  ): Promise<void> {
    const reminderUrl = new URL(chrome.runtime.getURL('src/pages/reminder/index.html'));
    reminderUrl.searchParams.set('tabId', String(tabId));
    reminderUrl.searchParams.set('action', action);
    reminderUrl.searchParams.set('reason', reason);
    const timeoutSeconds = this.settings?.reminderTimeoutSeconds ?? 15;
    reminderUrl.searchParams.set('timeoutSeconds', String(timeoutSeconds));

    const preferredMemory =
      typeof memoryUsageMb === 'number'
        ? memoryUsageMb
        : this.resolveTabMemoryUsage(tabState);
    if (typeof preferredMemory === 'number') {
      reminderUrl.searchParams.set('memoryUsageMb', String(preferredMemory));
    }
    if (typeof tabState.totalHeapMb === 'number') {
      reminderUrl.searchParams.set('totalHeapMb', String(tabState.totalHeapMb));
    }
    if (typeof tabState.fullPageMemoryMb === 'number') {
      reminderUrl.searchParams.set('fullPageMemoryMb', String(tabState.fullPageMemoryMb));
    }
    if (typeof tabState.heapLimitMb === 'number') {
      reminderUrl.searchParams.set('heapLimitMb', String(tabState.heapLimitMb));
    }
    if (typeof tabState.memoryCapturedAt === 'number') {
      reminderUrl.searchParams.set('memoryCapturedAt', String(tabState.memoryCapturedAt));
    }
    if (tabState.memorySource) {
      reminderUrl.searchParams.set('memorySource', tabState.memorySource);
    }
    if (typeof metrics?.memoryThresholdMb === 'number') {
      reminderUrl.searchParams.set('memoryThresholdMb', String(metrics.memoryThresholdMb));
    }
    if (metrics?.memoryTarget) {
      reminderUrl.searchParams.set('memoryTarget', metrics.memoryTarget);
    }

    await new Promise<void>((resolve, reject) => {
      chrome.windows.create(
        {
          url: reminderUrl.toString(),
          type: 'popup',
          width: 420,
          height: 520,
          focused: true
        },
        (window) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          if (window?.id) {
            this.activeReminderWindows.set(tabId, window.id);
          }
          resolve();
        }
      );
    });
  }
}
