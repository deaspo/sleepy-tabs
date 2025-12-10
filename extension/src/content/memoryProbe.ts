import { STORAGE_KEYS } from '../shared/constants';
import type { SleepSettings, TabMemoryProbeMessage } from '../shared/types';

const SAMPLE_INTERVAL_MS = 15000;
const VISIBILITY_SAMPLE_DELAY_MS = 2000;
const SEND_RETRY_DELAY_MS = 1000;
const SEND_RETRY_ATTEMPTS = 3;

interface ChromePerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

const perf = performance as ChromePerformance;
const SETTINGS_KEY = STORAGE_KEYS.settings;
let allowFullPageSampling = false;

function refreshSamplingPreference(): void {
  if (!chrome?.storage?.local) {
    return;
  }
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    const settings = result[SETTINGS_KEY] as SleepSettings | undefined;
    allowFullPageSampling = Boolean(settings?.enableFullPageSampling);
  });
}

if (chrome?.storage?.local) {
  refreshSamplingPreference();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (changes[SETTINGS_KEY]) {
      const next = changes[SETTINGS_KEY].newValue as SleepSettings | undefined;
      allowFullPageSampling = Boolean(next?.enableFullPageSampling);
    }
  });
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1048576) * 100) / 100;
}

function hasMemoryApi(): boolean {
  return Boolean(perf.memory && typeof perf.memory.usedJSHeapSize === 'number');
}

async function measureFullPageMemoryMb(): Promise<number | null> {
  if (!allowFullPageSampling) {
    return null;
  }
  const supportsFullPage =
    typeof window !== 'undefined' && 'measureUserAgentSpecificMemory' in performance && window.crossOriginIsolated;

  if (!supportsFullPage) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (performance as any).measureUserAgentSpecificMemory();
    if (!result || typeof result !== 'object') {
      return null;
    }
    const breakdown = (result as { breakdown?: Array<{ bytes?: number }> }).breakdown;
    if (Array.isArray(breakdown)) {
      const totalBytes = breakdown.reduce((sum: number, entry: { bytes?: number }) => sum + (entry?.bytes ?? 0), 0);
      if (totalBytes > 0) {
        return bytesToMb(totalBytes);
      }
    }
    if (typeof (result as { bytes?: number }).bytes === 'number') {
      return bytesToMb((result as { bytes: number }).bytes);
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : undefined;
    if (name !== 'SecurityError') {
      console.debug('measureUserAgentSpecificMemory failed', error);
    }
  }
  return null;
}

async function publishMeasurement(): Promise<void> {
  if (!hasMemoryApi()) {
    console.debug('Sleepy Tabs: performance.memory missing, skipping sample');
    return;
  }

  const memory = perf.memory;
  if (!memory) {
    return;
  }

  console.debug('Sleepy Tabs: memory probe raw bytes', {
    used: memory.usedJSHeapSize,
    total: memory.totalJSHeapSize,
    limit: memory.jsHeapSizeLimit
  });

  if (!canDispatchRuntimeMessage()) {
    console.debug('Sleepy Tabs: runtime unavailable, skipping memory probe dispatch.');
    return;
  }

  const payload: TabMemoryProbeMessage = {
    type: 'tab-memory-probe' as const,
    memoryUsageMb: bytesToMb(memory.usedJSHeapSize),
    totalHeapMb: bytesToMb(memory.totalJSHeapSize),
    heapLimitMb: bytesToMb(memory.jsHeapSizeLimit),
    fullPageMemoryMb: (await measureFullPageMemoryMb()) ?? undefined,
    source: 'probe'
  };

  console.debug('Sleepy Tabs: sending tab-memory-probe payload', payload);
  dispatchProbePayload(payload);
}

function scheduleSampling(): void {
  const jitter = Math.floor(Math.random() * 2000);
  window.setInterval(() => {
    if (document.visibilityState === 'hidden') {
      return;
    }
    void publishMeasurement();
  }, SAMPLE_INTERVAL_MS + jitter);
}

if (window.top === window && document.contentType !== 'application/pdf') {
  if (document.visibilityState === 'visible') {
    void publishMeasurement();
  } else {
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        void publishMeasurement();
      }
    }, VISIBILITY_SAMPLE_DELAY_MS);
  }

  scheduleSampling();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void publishMeasurement();
    }
  });
}

function canDispatchRuntimeMessage(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
}

function dispatchProbePayload(
  payload: TabMemoryProbeMessage,
  attemptsRemaining = SEND_RETRY_ATTEMPTS
): void {
  if (!canDispatchRuntimeMessage()) {
    console.debug('Sleepy Tabs: runtime unavailable, skipping memory probe dispatch.');
    return;
  }

  try {
    chrome.runtime.sendMessage(payload, () => {
      const runtimeError = chrome.runtime.lastError;
      if (!runtimeError) {
        return;
      }
      const message = runtimeError.message ?? String(runtimeError);
      if (message.includes('Extension context invalidated')) {
        if (attemptsRemaining > 0) {
          console.debug('Memory probe send deferred; extension context invalidated. Retrying...', {
            attemptsRemaining
          });
          window.setTimeout(() => dispatchProbePayload(payload, attemptsRemaining - 1), SEND_RETRY_DELAY_MS);
        } else {
          console.debug('Memory probe skipped after retries: extension context invalidated');
        }
        return;
      }
      console.error('Sleepy Tabs: memory probe sendMessage error', message);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Extension context invalidated') && attemptsRemaining > 0) {
      console.debug('Memory probe send threw; extension context invalidated. Retrying...', {
        attemptsRemaining
      });
      window.setTimeout(() => dispatchProbePayload(payload, attemptsRemaining - 1), SEND_RETRY_DELAY_MS);
      return;
    }
    console.error('Sleepy Tabs: runtime.sendMessage threw', error);
  }
}
