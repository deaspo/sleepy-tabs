import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import ReactDOM from 'react-dom/client';

import type { SleepSettings } from '../../shared/types';
import {
  DEFAULT_AUTO_FOCUS_ON_REMINDER,
  DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
  DEFAULT_ENABLE_PROCESS_FALLBACK,
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_MEMORY_THRESHOLD_MB,
  DEFAULT_PROCESS_THRESHOLD_MB,
  DEFAULT_REMINDER_TIMEOUT_SECONDS,
  PROCESS_THRESHOLD_PRESETS,
  SETTINGS_VERSION
} from '../../shared/constants';

const initialSettings: SleepSettings = {
  version: SETTINGS_VERSION,
  inactivityTimeoutMinutes: DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  memoryThresholdMb: DEFAULT_MEMORY_THRESHOLD_MB,
  enableAutoReload: true,
  enableAutoSleep: true,
  reminderTimeoutSeconds: DEFAULT_REMINDER_TIMEOUT_SECONDS,
  autoFocusOnReminder: DEFAULT_AUTO_FOCUS_ON_REMINDER,
  enableFullPageSampling: DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
  enableProcessFallback: DEFAULT_ENABLE_PROCESS_FALLBACK,
  processFallbackThresholdMb: DEFAULT_PROCESS_THRESHOLD_MB
};

function OptionsApp(): JSX.Element {
  const [settings, setSettings] = useState<SleepSettings>(initialSettings);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'request-settings' }, (response: SleepSettings) => {
      if (response) {
        setSettings(response);
      }
    });
  }, []);

  const handleChange = (key: keyof SleepSettings) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    chrome.runtime.sendMessage({ type: 'update-settings', payload: settings }, () => {
      setStatus('Settings saved');
      window.setTimeout(() => setStatus(''), 2000);
    });
  };

  return (
    <div style={{ maxWidth: 640, margin: '24px auto', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 8 }}>Sleepy Tabs Settings</h1>
        <p style={{ color: '#555' }}>
          Tune resource thresholds and reminders. Changes apply instantly across all tabs.
        </p>
      </header>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Inactivity timeout (minutes)</span>
          <input
            type="number"
            min={1}
            value={settings.inactivityTimeoutMinutes}
            onChange={handleChange('inactivityTimeoutMinutes')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span>Memory threshold (MB)</span>
          <input
            type="number"
            min={100}
            value={settings.memoryThresholdMb}
            onChange={handleChange('memoryThresholdMb')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span>Reminder timeout (seconds)</span>
          <input
            type="number"
            min={5}
            value={settings.reminderTimeoutSeconds}
            onChange={handleChange('reminderTimeoutSeconds')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.enableAutoSleep}
            onChange={handleChange('enableAutoSleep')}
          />
          <span>Automatically sleep inactive tabs</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.enableAutoReload}
            onChange={handleChange('enableAutoReload')}
          />
          <span>Automatically reload high-memory tabs</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.autoFocusOnReminder}
            onChange={handleChange('autoFocusOnReminder')}
          />
          <span>
            <strong>Switch to the tab when showing reminders</strong>
            <br />
            <span style={{ color: '#5f6368', fontSize: 13 }}>
              Keep this on to auto-focus the impacted tab whenever we show inactivity or memory warnings.
              Turn it off if you prefer to stay on your current tab and review the reminder later.
            </span>
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.enableFullPageSampling}
            onChange={handleChange('enableFullPageSampling')}
          />
          <span>
            <strong>Enable full-page memory sampling</strong>
            <br />
            <span style={{ color: '#5f6368', fontSize: 13 }}>
              Requires cross-origin isolated tabs (COOP/COEP). When enabled, we will attempt deeper
              measurements via the experimental User-Agent Specific Memory API.
            </span>
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.enableProcessFallback}
            onChange={handleChange('enableProcessFallback')}
          />
          <span>
            <strong>Use Chrome processes fallback</strong>
            <br />
            <span style={{ color: '#5f6368', fontSize: 13 }}>
              When the companion service is offline we can pull memory numbers from Chrome's internal
              processes API. These match Task Manager values for each tab.
            </span>
          </span>
        </label>

        {settings.enableProcessFallback && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Process fallback threshold (MB)</span>
              <input
                type="number"
                min={100}
                value={settings.processFallbackThresholdMb}
                onChange={handleChange('processFallbackThresholdMb')}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
              />
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PROCESS_THRESHOLD_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    setSettings((prev) => ({ ...prev, processFallbackThresholdMb: preset }))
                  }
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    border:
                      settings.processFallbackThresholdMb === preset
                        ? '1px solid #1a73e8'
                        : '1px solid #dadce0',
                    background:
                      settings.processFallbackThresholdMb === preset ? '#e8f0fe' : '#fff',
                    color: '#1a73e8',
                    cursor: 'pointer',
                    fontSize: 13
                  }}
                >
                  {preset} MB
                </button>
              ))}
            </div>
            <span style={{ color: '#5f6368', fontSize: 12 }}>
              Popular presets: 250 MB for 8 GB machines, 500 MB default, 800+ MB for larger rigs.
            </span>
          </div>
        )}

        <button
          type="submit"
          style={{
            padding: '10px 20px',
            borderRadius: 6,
            border: 'none',
            background: '#1a73e8',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Save changes
        </button>
        {status && <span style={{ color: '#1a73e8' }}>{status}</span>}
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<OptionsApp />);
