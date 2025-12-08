import type {
  CompanionOutboundMessage,
  RuntimeMessage,
  SleepAction,
  TabTelemetryRecord
} from './types';

export function sendRuntimeMessage<T extends RuntimeMessage>(message: T): Promise<void> {
  return chrome.runtime.sendMessage(message);
}

export function requestTelemetry(limit = 100): Promise<TabTelemetryRecord[]> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'fetch-telemetry',
      payload: { limit }
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(response as TabTelemetryRecord[]);
    });
  });
}

let nativePort: chrome.runtime.Port | null = null;

export function ensureNativePort(): chrome.runtime.Port | null {
  if (nativePort) {
    return nativePort;
  }

  try {
    nativePort = chrome.runtime.connectNative('com.sleepytabs.companion');
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
    });
    return nativePort;
  } catch (error) {
    console.warn('Native messaging host unavailable', error);
    nativePort = null;
    return null;
  }
}

export function postToCompanion(message: CompanionOutboundMessage): void {
  const port = ensureNativePort();
  if (!port) {
    console.warn('Unable to post to companion; native host missing', message);
    return;
  }

  try {
    port.postMessage(message);
  } catch (error) {
    console.error('Failed to post native message', error);
  }
}

export function notifyReminderDecision(
  tabId: number,
  action: SleepAction,
  proceed: boolean,
  reason: TabTelemetryRecord['reason'],
  memoryUsageMb?: number
): void {
  chrome.runtime.sendMessage({
    type: 'reminder-decision',
    tabId,
    action,
    proceed,
    reason,
    memoryUsageMb
  });
}
