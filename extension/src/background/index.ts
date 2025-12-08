import { SleepManager, WATCHDOG_ALARM } from './sleepManager';
import { ensureNativePort } from '../shared/messaging';
import { getRecentTelemetry } from '../shared/telemetryDb';
import { getConsentState, getSettings, getTabState } from '../shared/storage';
import type {
  CompanionInboundMessage,
  ManualActionMessage,
  ReminderDecisionMessage,
  RuntimeMessage,
  TabStateRequestMessage,
  ToggleIgnoreMessage
} from '../shared/types';

const manager = new SleepManager();

async function bootstrap(): Promise<void> {
  await manager.init();
  manager.scheduleSettingsPoll();
  setupCompanionBridge();
}

function setupCompanionBridge(): void {
  const port = ensureNativePort();
  if (!port) {
    return;
  }

  const handleMessage = async (message: CompanionInboundMessage) => {
    if (message.type === 'telemetry') {
      await manager.updateTabMemory(message.tabId, message.memoryUsageMb);
    } else if (message.type === 'error') {
      console.error('Companion error', message.message);
    }
  };

  port.onMessage.addListener((message) => {
    void handleMessage(message as CompanionInboundMessage);
  });

  port.onDisconnect.addListener(() => {
    setTimeout(setupCompanionBridge, 5000);
  });
}

void bootstrap();

chrome.runtime.onInstalled.addListener(async () => {
  const consent = await getConsentState();
  if (!consent.accepted) {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('src/pages/consent/index.html')
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) {
    void manager.evaluateTabs();
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void manager.recordTabActivity(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    void manager.recordTabActivity(tabId);
  }
  if (changeInfo.url) {
    chrome.storage.local.get('sleepyTabs.tabState').then((data) => {
      const state = data['sleepyTabs.tabState'] ?? {};
      if (state[tabId]) {
        state[tabId].lastActiveAt = Date.now();
        chrome.storage.local.set({ 'sleepyTabs.tabState': state });
      }
    });
  }
  if (typeof tab.id === 'number') {
    ensureNativePort();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void manager.removeTab(tabId);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
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

  if (message.type === 'sleep-all-tabs') {
    const excludeActive = message.excludeActive !== false;
    void manager
      .sleepAllTabs(excludeActive)
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
      .handleReminderDecision(reminder.tabId, reminder.action, reminder.proceed, reminder.reason, reminder.memoryUsageMb)
      .then(() => sendResponse({ success: true }));
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
