import { SleepManager, WATCHDOG_ALARM } from './sleepManager';
import { ensureNativePort, postToCompanion } from '../shared/messaging';
import { getRecentTelemetry } from '../shared/telemetryDb';
import { getConsentState, getSettings, getTabState, setNativeHostStatus } from '../shared/storage';
import type {
  CapabilityReport,
  CompanionInboundMessage,
  FocusTabMessage,
  ManualActionMessage,
  NativeHostStatus,
  ReminderDecisionMessage,
  RuntimeMessage,
  TabStateRequestMessage,
  ToggleIgnoreMessage
} from '../shared/types';

const manager = new SleepManager();
let companionRetryHandle: ReturnType<typeof setTimeout> | null = null;
let currentNativeHostStatus: NativeHostStatus = 'unknown';
const DEBUGGER_PROBE_ALARM = 'sleepy-tabs-debugger-probe';
const DEBUGGER_PROBE_INTERVAL_MINUTES = 0.5;
const DEBUGGER_SAMPLE_STALE_MS = 60 * 1000;
const DEBUGGER_MAX_TABS_PER_RUN = 1;
const activeDebuggerSessions = new Set<number>();
let consentPromptPromise: Promise<void> | null = null;
let processCapabilityReport: CapabilityReport | null = null;
let processCapabilityPromise: Promise<CapabilityReport> | null = null;

interface ScriptProbeResult {
  memoryUsageMb: number;
  totalHeapMb: number;
  heapLimitMb: number;
}

interface PerformanceMetricsResponse {
  metrics?: Array<{ name: string; value: number }>;
}

function reflectNativeHostStatus(status: NativeHostStatus): void {
  currentNativeHostStatus = status;
  manager.handleNativeHostStatusChange(status);
  void setNativeHostStatus(status);
  if (status === 'connected') {
    void chrome.alarms.clear(DEBUGGER_PROBE_ALARM);
  } else if (status === 'disconnected') {
    void ensureDebuggerProbeAlarm();
    void pollDebuggerTelemetry();
  }
}

async function ensureDebuggerProbeAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(DEBUGGER_PROBE_ALARM);
  if (!alarm) {
    chrome.alarms.create(DEBUGGER_PROBE_ALARM, {
      periodInMinutes: DEBUGGER_PROBE_INTERVAL_MINUTES,
      delayInMinutes: DEBUGGER_PROBE_INTERVAL_MINUTES
    });
  }
}

function scheduleCompanionRetry(delay = 5000): void {
  if (companionRetryHandle) {
    return;
  }
  companionRetryHandle = setTimeout(() => {
    companionRetryHandle = null;
    setupCompanionBridge();
  }, delay);
}

async function bootstrap(): Promise<void> {
  reflectNativeHostStatus('connecting');
  await manager.init();
  manager.scheduleSettingsPoll();
  await ensureConsentPrompt();
  void ensureProcessCapabilityDetection();
  setupCompanionBridge();
}

function ensureProcessCapabilityDetection(): Promise<CapabilityReport> {
  if (processCapabilityReport) {
    return Promise.resolve(processCapabilityReport);
  }
  if (processCapabilityPromise) {
    return processCapabilityPromise;
  }
  processCapabilityPromise = detectProcessCapabilities()
    .then((report) => {
      processCapabilityReport = report;
      manager.setProcessFallbackSupport(report);
      manager.handleNativeHostStatusChange(currentNativeHostStatus);
      return report;
    })
    .catch((error) => {
      console.warn('Process capability detection failed', error);
      const fallback: CapabilityReport = {
        processFallbackSupported: false,
        processFallbackReason: error instanceof Error ? error.message : String(error)
      };
      processCapabilityReport = fallback;
      manager.setProcessFallbackSupport(fallback);
      return fallback;
    })
    .finally(() => {
      processCapabilityPromise = null;
    });
  return processCapabilityPromise;
}

function detectProcessCapabilities(): Promise<CapabilityReport> {
  return new Promise((resolve) => {
    if (!chrome.processes?.getProcessInfo) {
      resolve({ processFallbackSupported: false, processFallbackReason: 'chrome.processes API unavailable' });
      return;
    }
    try {
      chrome.processes.getProcessInfo([], false, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({ processFallbackSupported: false, processFallbackReason: error.message });
          return;
        }
        resolve({ processFallbackSupported: true });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      resolve({ processFallbackSupported: false, processFallbackReason: reason });
    }
  });
}

function setupCompanionBridge(): void {
  const port = ensureNativePort();
  if (!port) {
    reflectNativeHostStatus('disconnected');
    scheduleCompanionRetry();
    return;
  }

  reflectNativeHostStatus('connected');
  void manager.hydrateExistingTabs();
  postToCompanion({ type: 'monitor-tabs' });

  const handleMessage = async (message: CompanionInboundMessage) => {
    if (message.type === 'telemetry') {
      await manager.updateTabMemory(message.tabId, {
        source: 'companion',
        memoryUsageMb: message.memoryUsageMb
      });
    } else if (message.type === 'error') {
      console.error('Companion error', message.message);
    }
  };

  port.onMessage.addListener((message) => {
    void handleMessage(message as CompanionInboundMessage);
  });

  port.onDisconnect.addListener(() => {
    reflectNativeHostStatus('disconnected');
    scheduleCompanionRetry();
  });
}

async function pollDebuggerTelemetry(): Promise<void> {
  if (currentNativeHostStatus === 'connected') {
    await chrome.alarms.clear(DEBUGGER_PROBE_ALARM);
    return;
  }

  const [tabs, state] = await Promise.all([chrome.tabs.query({ discarded: false }), getTabState()]);
  const now = Date.now();
  const candidates: number[] = [];

  for (const tab of tabs) {
    if (candidates.length >= DEBUGGER_MAX_TABS_PER_RUN) {
      break;
    }
    if (typeof tab.id !== 'number') {
      continue;
    }
    if (!isDebuggerAttachable(tab)) {
      continue;
    }
    const tabState = state[tab.id];
    if (!tabState || tabState.ignored) {
      continue;
    }
    if (tabState.memorySource === 'companion') {
      continue;
    }
    const lastCapturedAt = tabState.memoryCapturedAt ?? 0;
    if (now - lastCapturedAt < DEBUGGER_SAMPLE_STALE_MS) {
      continue;
    }
    candidates.push(tab.id);
  }

  for (const tabId of candidates) {
    const scriptingSuccess = await collectTabMemoryViaScripting(tabId);
    if (scriptingSuccess) {
      continue;
    }
    await collectTabMemoryViaDebugger(tabId);
  }
}

async function collectTabMemoryViaScripting(tabId: number): Promise<boolean> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const perf = performance as Performance & {
          memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
          };
        };
        if (!('memory' in perf) || !perf.memory) {
          return null;
        }
        const bytesToMb = (bytes: number): number => Math.round((bytes / 1048576) * 100) / 100;
        const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = perf.memory;
        return {
          memoryUsageMb: bytesToMb(usedJSHeapSize),
          totalHeapMb: bytesToMb(totalJSHeapSize),
          heapLimitMb: bytesToMb(jsHeapSizeLimit)
        };
      }
    });

    const sample = (injection?.result ?? null) as ScriptProbeResult | null;
    if (sample) {
      await manager.updateTabMemory(tabId, {
        source: 'probe',
        memoryUsageMb: sample.memoryUsageMb,
        totalHeapMb: sample.totalHeapMb,
        heapLimitMb: sample.heapLimitMb
      });
      return true;
    }
  } catch (error) {
    console.debug('Script memory probe failed', { tabId, error });
  }
  return false;
}

async function collectTabMemoryViaDebugger(tabId: number): Promise<void> {
  if (activeDebuggerSessions.has(tabId)) {
    return;
  }

  const target: chrome.debugger.Debuggee = { tabId };
  let attached = false;
  activeDebuggerSessions.add(tabId);

  try {
    await attachDebugger(target);
    attached = true;
    const metrics = await sendDebuggerCommand<PerformanceMetricsResponse>(
      target,
      'Performance.getMetrics',
      {}
    );
    const usedMetric = Array.isArray(metrics.metrics)
      ? metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')
      : undefined;

    if (usedMetric && typeof usedMetric.value === 'number') {
      const memoryUsageMb = bytesToMb(usedMetric.value);
      await manager.updateTabMemory(tabId, { source: 'debugger', memoryUsageMb });
    }
  } catch (error) {
    console.warn('Debugger memory probe failed', { tabId, error });
  } finally {
    if (attached) {
      await detachDebugger(target);
    }
    activeDebuggerSessions.delete(tabId);
  }
}

function attachDebugger(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, '1.3', () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function detachDebugger(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.warn('Debugger detach error', error.message);
      }
      resolve();
    });
  });
}

function sendDebuggerCommand<T = unknown>(
  target: chrome.debugger.Debuggee,
  method: string,
  params: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response as T);
    });
  });
}

function isDebuggerAttachable(tab: chrome.tabs.Tab): boolean {
  if (!tab.url) {
    return false;
  }
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) {
    return false;
  }
  return true;
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1048576) * 100) / 100;
}

async function bringTabToFront(message: FocusTabMessage): Promise<void> {
  const { tabId, expectedUrl, windowId } = message;
  const liveTab = await chrome.tabs.get(tabId).catch(() => null);

  if (liveTab && tabMatchesExpected(liveTab, expectedUrl)) {
    await activateTab(liveTab.id!, windowId ?? liveTab.windowId);
    return;
  }

  if (expectedUrl) {
    const fallback = await findTabByUrl(expectedUrl);
    if (fallback && typeof fallback.id === 'number') {
      await activateTab(fallback.id, fallback.windowId);
      return;
    }
  }

  throw new Error('No matching tab is currently open. It may have been closed or navigated.');
}

async function activateTab(tabId: number, targetWindowId?: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  if (typeof targetWindowId === 'number') {
    await chrome.windows.update(targetWindowId, { focused: true });
  }
}

async function findTabByUrl(expectedUrl: string): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url === expectedUrl && typeof tab.id === 'number') ?? null;
}

function tabMatchesExpected(tab: chrome.tabs.Tab, expectedUrl?: string): boolean {
  if (typeof tab.id !== 'number') {
    return false;
  }
  if (!expectedUrl) {
    return true;
  }
  return tab.url === expectedUrl;
}

async function ensureConsentPrompt(): Promise<void> {
  if (consentPromptPromise) {
    return consentPromptPromise;
  }
  consentPromptPromise = (async () => {
    const consent = await getConsentState();
    if (consent.accepted) {
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/consent/index.html') }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      });
    } catch (error) {
      console.error('Failed to open consent page', error);
    }
  })()
    .finally(() => {
      consentPromptPromise = null;
    });
  return consentPromptPromise;
}

void bootstrap();

chrome.runtime.onInstalled.addListener(async () => {
  await ensureConsentPrompt();
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) {
    void manager.evaluateTabs();
  } else if (alarm.name === DEBUGGER_PROBE_ALARM) {
    void pollDebuggerTelemetry();
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void manager.recordTabActivity(activeInfo.tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  void manager.syncTabMetadata(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    void manager.recordTabActivity(tabId);
  }
  if (changeInfo.url || changeInfo.title) {
    void manager.syncTabMetadata(tab);
  }
  if (typeof tab.id === 'number') {
    ensureNativePort();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void manager.removeTab(tabId);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'request-settings') {
    void getSettings().then((settings) => sendResponse(settings));
    return true;
  }

  if (message.type === 'update-settings') {
    void manager.syncSettings(message.payload).then((settings) => sendResponse(settings));
    return true;
  }

  if (message.type === 'fetch-telemetry') {
    const limit = message.payload?.limit ?? 100;
    void getRecentTelemetry(limit).then((records) => sendResponse(records));
    return true;
  }

  if (message.type === 'request-tab-state') {
    const request = message as TabStateRequestMessage;
    void getTabState().then((state) => sendResponse(state[request.tabId] ?? null));
    return true;
  }

  if (message.type === 'request-tab-states') {
    void getTabState().then((state) => sendResponse(state));
    return true;
  }

  if (message.type === 'consent-updated') {
    void manager.updateConsent(message.payload).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'manual-action') {
    const manual = message as ManualActionMessage;
    void manager.handleManualAction(manual.tabId, manual.action).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'toggle-ignore-tab') {
    const toggle = message as ToggleIgnoreMessage;
    void manager.setTabIgnored(toggle.tabId, toggle.ignored).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'tab-memory-probe') {
    if (currentNativeHostStatus === 'connected') {
      return false;
    }
    const senderTabId = sender.tab?.id;
    if (typeof senderTabId === 'number') {
      console.debug('Sleepy Tabs: received tab-memory-probe', {
        tabId: senderTabId,
        payload: {
          memoryUsageMb: message.memoryUsageMb,
          totalHeapMb: message.totalHeapMb,
          heapLimitMb: message.heapLimitMb,
          fullPageMemoryMb: message.fullPageMemoryMb
        }
      });
      void manager.updateTabMemory(senderTabId, {
        source: 'probe',
        memoryUsageMb: message.memoryUsageMb,
        totalHeapMb: message.totalHeapMb,
        heapLimitMb: message.heapLimitMb,
        fullPageMemoryMb: message.fullPageMemoryMb
      });
    }
    return false;
  }

  if (message.type === 'focus-tab') {
    const focusMessage = message as FocusTabMessage;
    void bringTabToFront(focusMessage)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.warn('Failed to bring tab to front', error);
        const messageText = error instanceof Error ? error.message : String(error);
        sendResponse({ success: false, error: messageText });
      });
    return true;
  }

  if (message.type === 'sleep-all-tabs') {
    const excludeActive = message.excludeActive !== false;
    void manager
      .sleepAllTabs(excludeActive, message.excludeTabId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => {
        console.error('Failed to process sleep-all-tabs request', error);
        const messageText = error instanceof Error ? error.message : String(error);
        sendResponse({ success: false, error: messageText });
      });
    return true;
  }

  if (message.type === 'reminder-decision') {
    const reminder = message as ReminderDecisionMessage;
    void manager
      .handleReminderDecision(
        reminder.tabId,
        reminder.action,
        reminder.proceed,
        reminder.reason,
        reminder.memoryUsageMb,
        reminder.totalHeapMb,
        reminder.fullPageMemoryMb,
        reminder.heapLimitMb
      )
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'request-capabilities') {
    ensureProcessCapabilityDetection()
      .then((report) => sendResponse(report))
      .catch(() =>
        sendResponse({ processFallbackSupported: false, processFallbackReason: 'Detection failed' })
      );
    return true;
  }

  return false;
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('sleepy-tabs-critical')) {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('src/pages/dashboard/index.html')
    });
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('sleepy-tabs-critical')) {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('src/pages/dashboard/index.html')
    });
  }
});
