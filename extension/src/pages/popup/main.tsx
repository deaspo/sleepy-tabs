import { useEffect, useState, type ChangeEvent } from 'react';
import ReactDOM from 'react-dom/client';

import type { RuntimeMessage, SleepAction, TabMemorySource, TabState } from '../../shared/types';

interface PopupState {
  tabId: number;
  title: string;
  url: string;
  memoryUsageMb?: number;
  totalHeapMb?: number;
  heapLimitMb?: number;
  fullPageMemoryMb?: number;
  memorySource?: TabMemorySource;
  memoryCapturedAt?: number;
  memorySampleNotes?: string;
  ignored: boolean;
}

function PopupApp(): JSX.Element {
  const [state, setState] = useState<PopupState | null>(null);
  const [status, setStatus] = useState<string>('');
  const [excludeCurrentTab, setExcludeCurrentTab] = useState<boolean>(true);
  const currentTabId = state?.tabId ?? null;

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const [active] = tabs;
      if (!active || typeof active.id !== 'number') {
        return;
      }
      const tabId = active.id;
      chrome.runtime.sendMessage(
        { type: 'request-tab-state', tabId },
        (tabState: TabState | null) => {
          setState({
            tabId,
            title: active.title ?? 'Untitled tab',
            url: active.url ?? 'Unknown URL',
            memoryUsageMb: tabState?.memoryUsageMb,
            totalHeapMb: tabState?.totalHeapMb,
            heapLimitMb: tabState?.heapLimitMb,
            fullPageMemoryMb: tabState?.fullPageMemoryMb,
            memorySource: tabState?.memorySource,
            memoryCapturedAt: tabState?.memoryCapturedAt,
            memorySampleNotes: tabState?.memorySampleNotes,
            ignored: tabState?.ignored ?? false
          });
        }
      );
    });
  }, []);

  useEffect(() => {
    const handleMessage = (message: RuntimeMessage): void => {
      if (message.type !== 'tab-state-updated') {
        return;
      }

      setState((prev) => {
        if (!prev || prev.tabId !== message.tabId) {
          return prev;
        }

        return {
          ...prev,
          ignored: message.state.ignored,
          memoryUsageMb: message.state.memoryUsageMb,
          totalHeapMb: message.state.totalHeapMb,
          heapLimitMb: message.state.heapLimitMb,
          fullPageMemoryMb: message.state.fullPageMemoryMb,
          memorySource: message.state.memorySource,
          memoryCapturedAt: message.state.memoryCapturedAt,
          memorySampleNotes: message.state.memorySampleNotes
        };
      });
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    if (typeof currentTabId !== 'number') {
      return;
    }

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: 'sync' | 'local' | 'managed' | 'session'
    ): void => {
      if (areaName !== 'local') {
        return;
      }
      const tabStateChange = changes['sleepyTabs.tabState'];
      if (!tabStateChange) {
        return;
      }
      const newState = tabStateChange.newValue as Record<number, TabState> | undefined;
      if (!newState) {
        return;
      }
      const updated = newState[currentTabId];
      if (!updated) {
        return;
      }
      setState((prev) =>
        prev
          ? {
              ...prev,
              ignored: updated.ignored,
              memoryUsageMb: updated.memoryUsageMb,
              totalHeapMb: updated.totalHeapMb,
              heapLimitMb: updated.heapLimitMb,
              fullPageMemoryMb: updated.fullPageMemoryMb,
              memorySource: updated.memorySource,
              memoryCapturedAt: updated.memoryCapturedAt,
              memorySampleNotes: updated.memorySampleNotes
            }
          : prev
      );
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [currentTabId]);

  const handleAction = (action: SleepAction) => {
    if (!state) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'manual-action', tabId: state.tabId, action }, () => {
      setStatus(action === 'sleep' ? 'Tab will be slept momentarily' : 'Reload requested');
      window.setTimeout(() => setStatus(''), 2000);
      if (action === 'sleep') {
        window.close();
      }
    });
  };

  const handleIgnoreToggle = (event: ChangeEvent<HTMLInputElement>) => {
    if (!state) {
      return;
    }
    const ignored = event.target.checked;
    chrome.runtime.sendMessage({ type: 'toggle-ignore-tab', tabId: state.tabId, ignored }, () => {
      setState((prev) => (prev ? { ...prev, ignored } : prev));
      setStatus(ignored ? 'Tab will be ignored' : 'Tab monitoring resumed');
      window.setTimeout(() => setStatus(''), 2000);
    });
  };

  const handleSleepAll = () => {
    if (!state) {
      return;
    }
    type SleepAllResponse = {
      success: boolean;
      attempted?: number;
      succeeded?: number;
      errors?: Array<{ tabId: number; message: string }>;
      error?: string;
    };

    const payload = {
      type: 'sleep-all-tabs' as const,
      excludeActive: excludeCurrentTab,
      excludeTabId: excludeCurrentTab ? state.tabId : undefined
    };
    chrome.runtime.sendMessage(payload, (response: SleepAllResponse) => {
      let messageText = '';

      if (chrome.runtime.lastError) {
        messageText = `Failed to sleep tabs: ${chrome.runtime.lastError.message}`;
      } else if (!response?.success) {
        messageText = `Failed to sleep tabs: ${response?.error ?? 'Unknown error'}`;
      } else {
        const attempted = response.attempted ?? 0;
        const succeeded = response.succeeded ?? 0;
        const failedCount = response.errors?.length ?? 0;
        if (attempted === 0) {
          messageText = 'No eligible tabs to sleep';
        } else if (failedCount > 0) {
          console.warn('Some tabs failed to sleep', response.errors);
          messageText = `Slept ${succeeded}/${attempted} tabs; ${failedCount} failed`;
        } else {
          messageText = `Slept ${succeeded} tab${succeeded === 1 ? '' : 's'}`;
        }
      }

      setStatus(messageText);
      window.setTimeout(() => setStatus(''), 3000);
    });
  };

  if (!state) {
    return <div style={{ padding: 16 }}>Loading...</div>;
  }

  const hasMemorySample = [
    state.memoryUsageMb,
    state.totalHeapMb,
    state.heapLimitMb,
    state.fullPageMemoryMb
  ].some((value) => typeof value === 'number' && !Number.isNaN(value));

  const formatMb = (value?: number): string | null => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }
    const clamped = Math.max(value, 0);
    return `${clamped.toFixed(2)} MB`;
  };

  return (
    <div style={{ width: 320, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px 0' }}>Sleepy Tabs</h1>
      <p style={{ margin: '0 0 8px 0', fontSize: 14 }}>{state.title}</p>
      {hasMemorySample && (
        <div
          style={{
            fontSize: 12,
            background: '#f1f3f4',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 12,
            lineHeight: 1.4
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>
            Latest memory sample
            {state.memorySource && (
              <span
                style={{
                  marginLeft: 6,
                  padding: '2px 6px',
                  borderRadius: 999,
                  background: '#e8eaed',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: '#5f6368'
                }}
              >
                {state.memorySource}
              </span>
            )}
          </strong>
          {formatMb(state.totalHeapMb) && (
            <div>
              Heap total: {formatMb(state.totalHeapMb)}
              {formatMb(state.heapLimitMb) ? ` / ${formatMb(state.heapLimitMb)}` : ''}
            </div>
          )}
          {formatMb(state.memoryUsageMb) && <div>JS heap used: {formatMb(state.memoryUsageMb)}</div>}
          {formatMb(state.fullPageMemoryMb) && <div>Full page: {formatMb(state.fullPageMemoryMb)}</div>}
          {!formatMb(state.totalHeapMb) && formatMb(state.heapLimitMb) && (
            <div>Heap limit: {formatMb(state.heapLimitMb)}</div>
          )}
          {state.memoryCapturedAt && (
            <div style={{ marginTop: 4, color: '#5f6368' }}>
              {`Sampled ${new Date(state.memoryCapturedAt).toLocaleTimeString()} (${state.memorySource ?? 'unknown source'})`}
            </div>
          )}
          {state.memorySource === 'probe' && (
            <div style={{ marginTop: 4, color: '#5f6368' }}>
              In-tab heap probes are approximate; the tab process can consume more memory than shown here.
            </div>
          )}
          {state.memorySampleNotes === 'probe-saturated' && (
            <div style={{ marginTop: 4, color: '#5f6368' }}>
              JS heap usage hit the browser limit. Will capture a deeper sample shortly.
            </div>
          )}
          {state.memorySource === 'processes' && (
            <div style={{ marginTop: 4, color: '#5f6368' }}>
              Using Chrome processes fallback (Task Manager values)
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          type="button"
          onClick={() => handleAction('sleep')}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: 'none',
            background: '#1a73e8',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Sleep tab now
        </button>
        <button
          type="button"
          onClick={handleSleepAll}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: 'none',
            background: '#0b8043',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Sleep all tabs
        </button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={excludeCurrentTab}
          onChange={(event) => setExcludeCurrentTab(event.target.checked)}
        />
        Exclude current tab from bulk sleep
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13 }}>
        <input type="checkbox" checked={state.ignored} onChange={handleIgnoreToggle} />
        Ignore this tab
      </label>

      {status && <p style={{ marginTop: 12, fontSize: 12, color: '#1a73e8' }}>{status}</p>}

      <a
        href={chrome.runtime.getURL('src/pages/options/index.html')}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 16, fontSize: 12, color: '#1a73e8' }}
      >
        Open settings
      </a>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<PopupApp />);
