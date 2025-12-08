import { useEffect, useState, type ChangeEvent } from 'react';
import ReactDOM from 'react-dom/client';

import type { SleepAction, TabState } from '../../shared/types';

interface PopupState {
  tabId: number;
  title: string;
  url: string;
  memoryUsageMb?: number;
  ignored: boolean;
}

function PopupApp(): JSX.Element {
  const [state, setState] = useState<PopupState | null>(null);
  const [status, setStatus] = useState<string>('');

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
            ignored: tabState?.ignored ?? false
          });
        }
      );
    });
  }, []);

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

  if (!state) {
    return <div style={{ padding: 16 }}>Loading...</div>;
  }

  return (
    <div style={{ width: 320, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px 0' }}>Sleepy Tabs</h1>
      <p style={{ margin: '0 0 8px 0', fontSize: 14 }}>{state.title}</p>
      <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#555', wordBreak: 'break-word' }}>
        {state.url}
      </p>
      <p style={{ margin: '0 0 16px 0', fontSize: 13 }}>
        Estimated memory usage: {state.memoryUsageMb?.toFixed(2) ?? 'collecting...'} MB
      </p>

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
      </div>

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
