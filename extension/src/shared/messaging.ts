import type {
  CompanionOutboundMessage,
  FocusTabResponse,
  MemoryActionTarget,
  ReminderDecisionOption,
  ReminderDecisionMessage,
  RuntimeMessage,
  SleepAction,
  TabState,
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

export function requestTabStates(): Promise<Record<number, TabState>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'request-tab-states' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve((response as Record<number, TabState>) ?? {});
    });
  });
}

export function focusTab(
  tabId: number,
  options: { expectedUrl?: string; windowId?: number } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'focus-tab',
        tabId,
        expectedUrl: options.expectedUrl,
        windowId: options.windowId
      },
      (response: FocusTabResponse) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        if (!response || !response.success) {
          reject(new Error(response?.error ?? 'Unable to focus tab.'));
          return;
        }
        resolve();
      }
    );
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
  decision: ReminderDecisionOption,
  reason: TabTelemetryRecord['reason'],
  metrics?: {
    memoryUsageMb?: number;
    totalHeapMb?: number;
    heapLimitMb?: number;
    fullPageMemoryMb?: number;
    memoryThresholdMb?: number;
    memoryTarget?: MemoryActionTarget;
    memorySampleNotes?: string;
    snoozeMinutes?: number;
  }
): Promise<void> {
  const payload = {
    type: 'reminder-decision' as const,
    tabId,
    action,
    decision,
    reason,
    memoryUsageMb: metrics?.memoryUsageMb,
    totalHeapMb: metrics?.totalHeapMb,
    heapLimitMb: metrics?.heapLimitMb,
    fullPageMemoryMb: metrics?.fullPageMemoryMb,
    memoryThresholdMb: metrics?.memoryThresholdMb,
    memoryTarget: metrics?.memoryTarget,
    memorySampleNotes: metrics?.memorySampleNotes,
    snoozeMinutes: metrics?.snoozeMinutes
  } satisfies ReminderDecisionMessage;

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        const message = error.message ?? String(error);
        if (
          message.includes('Receiving end does not exist') ||
          message.includes('The message port closed before a response was received')
        ) {
          resolve();
          return;
        }
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
}
