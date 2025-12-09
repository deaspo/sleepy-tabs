const SAMPLE_INTERVAL_MS = 15000;
const VISIBILITY_SAMPLE_DELAY_MS = 2000;

interface ChromePerformance extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

const perf = performance as ChromePerformance;

function bytesToMb(bytes: number): number {
  return Math.round((bytes / 1048576) * 100) / 100;
}

function hasMemoryApi(): boolean {
  return Boolean(perf.memory && typeof perf.memory.usedJSHeapSize === 'number');
}

function publishMeasurement(): void {
  if (!hasMemoryApi()) {
    return;
  }

  const memory = perf.memory;
  if (!memory) {
    return;
  }

  const runtime = chrome?.runtime;
  if (!runtime?.sendMessage) {
    console.debug('Sleepy Tabs: runtime unavailable, skipping memory probe dispatch.');
    return;
  }

  runtime.sendMessage(
    {
      type: 'tab-memory-probe',
      memoryUsageMb: bytesToMb(memory.usedJSHeapSize),
      totalHeapMb: bytesToMb(memory.totalJSHeapSize),
      heapLimitMb: bytesToMb(memory.jsHeapSizeLimit),
      source: 'probe'
    },
    () => {
      // Swallow errors triggered when the service worker is asleep.
      const error = runtime.lastError;
      if (error) {
        console.debug('Memory probe message not delivered', error.message);
      }
    }
  );
}

function scheduleSampling(): void {
  const jitter = Math.floor(Math.random() * 2000);
  window.setInterval(() => {
    if (document.visibilityState === 'hidden') {
      return;
    }
    publishMeasurement();
  }, SAMPLE_INTERVAL_MS + jitter);
}

if (window.top === window && document.contentType !== 'application/pdf') {
  if (document.visibilityState === 'visible') {
    publishMeasurement();
  } else {
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        publishMeasurement();
      }
    }, VISIBILITY_SAMPLE_DELAY_MS);
  }

  scheduleSampling();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      publishMeasurement();
    }
  });
}
