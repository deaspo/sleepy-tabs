import { notifyReminderDecision } from '../shared/messaging';
import type { MemoryActionTarget, SleepAction, TabTelemetryRecord } from '../shared/types';

type ReminderPayload = {
  type: 'sleepy-tabs-reminder';
  tabId: number;
  action: SleepAction;
  timeoutSeconds?: number;
  reason: TabTelemetryRecord['reason'];
  memoryUsageMb?: number;
  totalHeapMb?: number;
  heapLimitMb?: number;
  fullPageMemoryMb?: number;
  memorySource?: TabTelemetryRecord['memorySource'];
  memoryCapturedAt?: number;
  memoryThresholdMb?: number;
  memoryTarget?: MemoryActionTarget;
};

const OVERLAY_ID = 'sleepy-tabs-reminder-overlay';

function removeOverlay(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing && existing.parentElement) {
    existing.parentElement.removeChild(existing);
  }
}

function renderOverlay(payload: ReminderPayload): void {
  removeOverlay();

  if (!document.body) {
    window.setTimeout(() => renderOverlay(payload), 50);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0,0,0,0.55)';
  overlay.style.zIndex = '2147483647';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.fontFamily = 'system-ui, sans-serif';
  overlay.style.color = '#1a1a1a';

  const panel = document.createElement('div');
  panel.style.background = '#ffffff';
  panel.style.padding = '24px';
  panel.style.borderRadius = '12px';
  panel.style.boxShadow = '0 10px 40px rgba(0,0,0,0.2)';
  panel.style.maxWidth = '420px';
  panel.style.width = '90%';
  panel.style.textAlign = 'center';

  const heading = document.createElement('h2');
  heading.textContent = payload.action === 'sleep' ? 'Pause inactive tab?' : 'Reload heavy tab?';
  heading.style.marginTop = '0';

  const info = document.createElement('p');
  info.style.margin = '12px 0 16px';
  info.style.lineHeight = '1.5';
  let metricsContainer: HTMLDivElement | null = null;
  if (payload.reason === 'memory') {
    const decisionValue =
      typeof payload.totalHeapMb === 'number'
        ? `${payload.totalHeapMb.toFixed(2)} MB`
        : typeof payload.memoryUsageMb === 'number'
          ? `${payload.memoryUsageMb.toFixed(2)} MB`
          : 'unknown';
    info.textContent = `This tab looks heavy. Latest heap snapshot: ${decisionValue}`;

    metricsContainer = document.createElement('div');
    metricsContainer.style.fontSize = '13px';
    metricsContainer.style.background = '#f7f9fc';
    metricsContainer.style.border = '1px solid #e0e5f1';
    metricsContainer.style.borderRadius = '8px';
    metricsContainer.style.padding = '8px 12px';
    metricsContainer.style.textAlign = 'left';

    const metricsList = document.createElement('ul');
    metricsList.style.listStyle = 'none';
    metricsList.style.padding = '0';
    metricsList.style.margin = '8px 0 0';

    if (typeof payload.totalHeapMb === 'number') {
      const totalHeapItem = document.createElement('li');
      const limitSuffix =
        typeof payload.heapLimitMb === 'number'
          ? ` / ${payload.heapLimitMb.toFixed(2)} MB limit`
          : '';
      totalHeapItem.textContent = `Heap total: ${payload.totalHeapMb.toFixed(2)} MB${limitSuffix}`;
      metricsList.appendChild(totalHeapItem);
    }

    if (typeof payload.memoryUsageMb === 'number') {
      const heapItem = document.createElement('li');
      heapItem.textContent = `JS heap used: ${payload.memoryUsageMb.toFixed(2)} MB`;
      metricsList.appendChild(heapItem);
    }

    if (typeof payload.fullPageMemoryMb === 'number') {
      const fullPageItem = document.createElement('li');
      fullPageItem.textContent = `Full page: ${payload.fullPageMemoryMb.toFixed(2)} MB`;
      metricsList.appendChild(fullPageItem);
    }

    if (typeof payload.totalHeapMb !== 'number' && typeof payload.heapLimitMb === 'number') {
      const limitOnlyItem = document.createElement('li');
      limitOnlyItem.textContent = `Heap limit: ${payload.heapLimitMb.toFixed(2)} MB`;
      metricsList.appendChild(limitOnlyItem);
    }

    const sampleMeta = document.createElement('div');
    sampleMeta.style.marginTop = '8px';
    sampleMeta.style.color = '#5f6368';
    sampleMeta.style.fontSize = '12px';
    if (payload.memoryCapturedAt) {
      const sampledAt = new Date(payload.memoryCapturedAt).toLocaleTimeString();
      const sourceLabel = payload.memorySource ?? 'unknown source';
      sampleMeta.textContent = `Sampled ${sampledAt} (${sourceLabel})`;
    } else {
      sampleMeta.textContent = '';
    }

    metricsContainer.appendChild(metricsList);
    metricsContainer.appendChild(sampleMeta);

    if (payload.memorySource === 'probe') {
      const probeNote = document.createElement('div');
      probeNote.style.marginTop = '8px';
      probeNote.style.color = '#5f6368';
      probeNote.style.fontSize = '12px';
      probeNote.textContent = 'In-tab heap probes are approximate; the tab process can consume more memory than shown here.';
      metricsContainer.appendChild(probeNote);
    }

    if (typeof payload.memoryThresholdMb === 'number') {
      const thresholdMeta = document.createElement('div');
      thresholdMeta.style.marginTop = '8px';
      thresholdMeta.style.color = '#5f6368';
      thresholdMeta.style.fontSize = '12px';
      const targetLabel = payload.memoryTarget === 'active' ? 'active tab' : 'inactive tab';
      thresholdMeta.textContent = `Configured threshold: ${payload.memoryThresholdMb.toFixed(0)} MB (${targetLabel}).`;
      metricsContainer.appendChild(thresholdMeta);
    }
  } else {
    info.textContent = 'This tab has been inactive for a while. We can pause it to save resources.';
  }

  const countdown = document.createElement('p');
  countdown.style.fontSize = '14px';
  countdown.style.color = '#555';

  const buttons = document.createElement('div');
  buttons.style.display = 'flex';
  buttons.style.justifyContent = 'center';
  buttons.style.gap = '12px';
  buttons.style.marginTop = '16px';

  const stayButton = document.createElement('button');
  stayButton.textContent = 'Keep tab active';
  stayButton.style.padding = '8px 16px';
  stayButton.style.borderRadius = '8px';
  stayButton.style.border = '1px solid #1a73e8';
  stayButton.style.background = '#ffffff';
  stayButton.style.color = '#1a73e8';
  stayButton.style.cursor = 'pointer';

  const proceedButton = document.createElement('button');
  proceedButton.textContent = payload.action === 'sleep' ? 'Put tab to sleep' : 'Reload now';
  proceedButton.style.padding = '8px 16px';
  proceedButton.style.borderRadius = '8px';
  proceedButton.style.border = 'none';
  proceedButton.style.background = '#1a73e8';
  proceedButton.style.color = '#ffffff';
  proceedButton.style.cursor = 'pointer';

  buttons.appendChild(stayButton);
  buttons.appendChild(proceedButton);

  panel.appendChild(heading);
  panel.appendChild(info);
  if (metricsContainer) {
    panel.appendChild(metricsContainer);
  }
  panel.appendChild(countdown);
  panel.appendChild(buttons);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let remaining = payload.timeoutSeconds ?? 15;
  countdown.textContent = `Taking action in ${remaining} seconds...`;

  const interval = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(interval);
      removeOverlay();
      notifyReminderDecision(payload.tabId, payload.action, true, payload.reason, {
        memoryUsageMb: payload.memoryUsageMb,
        totalHeapMb: payload.totalHeapMb,
        heapLimitMb: payload.heapLimitMb,
        fullPageMemoryMb: payload.fullPageMemoryMb,
        memoryThresholdMb: payload.memoryThresholdMb,
        memoryTarget: payload.memoryTarget
      });
    } else {
      countdown.textContent = `Taking action in ${remaining} seconds...`;
    }
  }, 1000);

  const sendDecision = (proceed: boolean) => {
    window.clearInterval(interval);
    removeOverlay();
    notifyReminderDecision(payload.tabId, payload.action, proceed, payload.reason, {
      memoryUsageMb: payload.memoryUsageMb,
      totalHeapMb: payload.totalHeapMb,
      heapLimitMb: payload.heapLimitMb,
      fullPageMemoryMb: payload.fullPageMemoryMb,
      memoryThresholdMb: payload.memoryThresholdMb,
      memoryTarget: payload.memoryTarget
    });
  };

  stayButton.addEventListener('click', () => sendDecision(false));
  proceedButton.addEventListener('click', () => sendDecision(true));
}

chrome.runtime.onMessage.addListener((message: ReminderPayload) => {
  if (message?.type === 'sleepy-tabs-reminder') {
    renderOverlay(message);
  }
});
