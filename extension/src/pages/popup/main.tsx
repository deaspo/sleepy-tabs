import { useEffect, useState, type ChangeEvent } from 'react';
import ReactDOM from 'react-dom/client';

import type {
  NativeHostStatus,
  RuntimeMessage,
  SleepAction,
  TabMemorySource,
  TabState
} from '../../shared/types';

interface PopupState {
  tabId: number;
  title: string;
  url: string;
  memoryUsageMb?: number;
  memorySource?: TabMemorySource;
  memoryCapturedAt?: number;
  ignored: boolean;
}

function PopupApp(): JSX.Element {
  const [state, setState] = useState<PopupState | null>(null);
  const [status, setStatus] = useState<string>('');
  const [hostStatus, setHostStatus] = useState<NativeHostStatus>('unknown');
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
            memorySource: tabState?.memorySource,
            memoryCapturedAt: tabState?.memoryCapturedAt,
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
          memorySource: message.state.memorySource,
          memoryCapturedAt: message.state.memoryCapturedAt
        };
      });
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    chrome.storage.local.get('sleepyTabs.nativeHostStatus', (result) => {
      setHostStatus((result['sleepyTabs.nativeHostStatus'] as NativeHostStatus | undefined) ?? 'unknown');
    });

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: 'sync' | 'local' | 'managed' | 'session'
    ): void => {
      if (areaName !== 'local') {
        return;
      }
      const statusChange = changes['sleepyTabs.nativeHostStatus'];
      if (statusChange) {
        setHostStatus((statusChange.newValue as NativeHostStatus | undefined) ?? 'unknown');
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
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
              memorySource: updated.memorySource,
              memoryCapturedAt: updated.memoryCapturedAt
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
    type SleepAllResponse = {
      success: boolean;
      attempted?: number;
      succeeded?: number;
      errors?: Array<{ tabId: number; message: string }>;
      error?: string;
    };

    chrome.runtime.sendMessage({ type: 'sleep-all-tabs', excludeActive: excludeCurrentTab }, (response: SleepAllResponse) => {
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

  const memoryUsageText = (() => {
    if (typeof state.memoryUsageMb === 'number') {
      return `${state.memoryUsageMb.toFixed(2)} MB`;
    }
    if (hostStatus !== 'connected') {
      return 'Native companion offline';
    }
    return 'collecting...';
  })();

  const memorySourceText = (() => {
    if (state.memorySource === 'companion') {
      return 'Source: Native companion (full fidelity)';
    }
    if (state.memorySource === 'debugger') {
      return 'Source: Chrome debugger sampler (JS heap only)';
    }
    if (state.memorySource === 'probe') {
      return 'Source: In-tab JS heap probe (approximate)';
    }
    if (hostStatus === 'connecting') {
      return 'Source: waiting for native companion...';
    }
    if (hostStatus === 'connected') {
      return 'Source: awaiting first sample';
    }
    return 'Source: fallback samplers unavailable';
  })();

  const memoryCapturedHint = (() => {
    if (typeof state.memoryCapturedAt !== 'number') {
      return '';
    }
    const captured = new Date(state.memoryCapturedAt);
    return ` • Captured ${captured.toLocaleTimeString()}`;
  })();

  return (
    <div style={{ width: 320, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px 0' }}>Sleepy Tabs</h1>
      <p style={{ margin: '0 0 8px 0', fontSize: 14 }}>{state.title}</p>
      {/* <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#555', wordBreak: 'break-word' }}>
        {state.url}
      </p> */}
      {/* <p style={{ margin: '0 0 16px 0', fontSize: 13 }}>
        Estimated memory usage: {memoryUsageText}
      </p>
      <p style={{ margin: '-8px 0 16px 0', fontSize: 11, color: '#5f6368' }}>
        {memorySourceText}
        {memoryCapturedHint}
      </p> */}

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
          onClick={() => handleAction('reload')}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #1a73e8',
            background: '#fff',
            color: '#1a73e8',
            cursor: 'pointer'
          }}
        >
          Reload tab
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
