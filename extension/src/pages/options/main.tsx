import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import ReactDOM from 'react-dom/client';

import type { CapabilityReport, SleepSettings } from '../../shared/types';
import {
  DEFAULT_AUTO_FOCUS_ON_REMINDER,
  DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
  DEFAULT_ENABLE_PROCESS_FALLBACK,
  DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  DEFAULT_MEMORY_ACTION_FOR_ACTIVE_TAB,
  DEFAULT_MEMORY_ACTION_FOR_INACTIVE_TAB,
  DEFAULT_MEMORY_PROMPT_FOR_ACTIVE_TAB,
  DEFAULT_MEMORY_PROMPT_FOR_INACTIVE_TAB,
  DEFAULT_MEMORY_THRESHOLD_MB,
  DEFAULT_PROCESS_THRESHOLD_MB,
  DEFAULT_REMINDER_SNOOZE_MINUTES,
  DEFAULT_REMINDER_TIMEOUT_SECONDS,
  REMINDER_SNOOZE_PRESETS,
  PROCESS_THRESHOLD_PRESETS,
  SETTINGS_VERSION
} from '../../shared/constants';

const initialSettings: SleepSettings = {
  version: SETTINGS_VERSION,
  inactivityTimeoutMinutes: DEFAULT_INACTIVITY_TIMEOUT_MINUTES,
  memoryThresholdMb: DEFAULT_MEMORY_THRESHOLD_MB,
  enableAutoSleep: true,
  reminderTimeoutSeconds: DEFAULT_REMINDER_TIMEOUT_SECONDS,
  memoryReminderSnoozeMinutes: DEFAULT_REMINDER_SNOOZE_MINUTES,
  autoFocusOnReminder: DEFAULT_AUTO_FOCUS_ON_REMINDER,
  enableFullPageSampling: DEFAULT_ENABLE_FULL_PAGE_SAMPLING,
  enableProcessFallback: DEFAULT_ENABLE_PROCESS_FALLBACK,
  processFallbackThresholdMb: DEFAULT_PROCESS_THRESHOLD_MB,
  memoryActionForActiveTab: DEFAULT_MEMORY_ACTION_FOR_ACTIVE_TAB,
  memoryActionForInactiveTab: DEFAULT_MEMORY_ACTION_FOR_INACTIVE_TAB,
  memoryPromptForActiveTab: DEFAULT_MEMORY_PROMPT_FOR_ACTIVE_TAB,
  memoryPromptForInactiveTab: DEFAULT_MEMORY_PROMPT_FOR_INACTIVE_TAB
};

function OptionsApp(): JSX.Element {
  const [settings, setSettings] = useState<SleepSettings>(initialSettings);
  const [status, setStatus] = useState<string>('');
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'request-settings' }, (response: SleepSettings) => {
      if (response) {
        setSettings(response);
      }
    });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'request-capabilities' }, (response: CapabilityReport) => {
      if (response) {
        setCapabilities(response);
      } else {
        setCapabilities({ processFallbackSupported: false, processFallbackReason: 'Unavailable' });
      }
    });
  }, []);

  useEffect(() => {
    if (capabilities?.processFallbackSupported === false && settings.enableProcessFallback) {
      setSettings((prev) => ({ ...prev, enableProcessFallback: false }));
    }
  }, [capabilities, settings.enableProcessFallback]);

  const handleNumberChange = (key: keyof SleepSettings) => (event: ChangeEvent<HTMLInputElement>) => {
    setSettings((prev) => ({ ...prev, [key]: Number(event.target.value) }));
  };

  const handleSelectNumberChange = (key: keyof SleepSettings) =>
    (event: ChangeEvent<HTMLSelectElement>) => {
      setSettings((prev) => ({ ...prev, [key]: Number(event.target.value) }));
    };

  const handleCheckboxChange = (key: keyof SleepSettings) => (event: ChangeEvent<HTMLInputElement>) => {
    setSettings((prev) => ({ ...prev, [key]: event.target.checked }));
  };

  const handleSelectChange = (key: keyof SleepSettings) => (event: ChangeEvent<HTMLSelectElement>) => {
    setSettings((prev) => ({ ...prev, [key]: event.target.value as SleepSettings[keyof SleepSettings] }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    chrome.runtime.sendMessage({ type: 'update-settings', payload: settings }, () => {
      setStatus('Settings saved');
      window.setTimeout(() => setStatus(''), 2000);
    });
  };

  const processFallbackSupported = capabilities?.processFallbackSupported !== false;

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
            onChange={handleNumberChange('inactivityTimeoutMinutes')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span>Memory threshold (MB)</span>
          <input
            type="number"
            min={100}
            value={settings.memoryThresholdMb}
            onChange={handleNumberChange('memoryThresholdMb')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        <div
          style={{
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            padding: '12px 16px',
            display: 'grid',
            gap: 12,
            background: '#fafafa'
          }}
        >
          <div style={{ fontWeight: 600 }}>High-memory tab actions</div>
          <div style={{ color: '#5f6368', fontSize: 12 }}>
            Chrome exposes both used and total JS heap sizes. We default to 100 MB of total heap so you can catch
            runaway growth before it spills into the tab process footprint. In-tab heap probes are approximate,
            so calibrate against Chrome Task Manager or the processes fallback when you need exact numbers.
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>When the tab is active</span>
            <select
              value={settings.memoryActionForActiveTab}
              onChange={handleSelectChange('memoryActionForActiveTab')}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
            >
              <option value="reload">Reload the tab</option>
              <option value="sleep">Sleep the tab</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="checkbox"
              checked={settings.memoryPromptForActiveTab}
              onChange={handleCheckboxChange('memoryPromptForActiveTab')}
            />
            <span>Show a reminder before acting on active tabs</span>
          </label>
          <span style={{ color: '#5f6368', fontSize: 12 }}>
            Reminders now offer Keep active, Snooze, Ignore, Sleep, and Reload choices so you can respond without
            losing work.
          </span>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>When the tab is inactive</span>
            <select
              value={settings.memoryActionForInactiveTab}
              onChange={handleSelectChange('memoryActionForInactiveTab')}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
            >
              <option value="sleep">Sleep the tab</option>
              <option value="reload">Reload the tab</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="checkbox"
              checked={settings.memoryPromptForInactiveTab}
              onChange={handleCheckboxChange('memoryPromptForInactiveTab')}
            />
            <span>Show a reminder before acting on inactive tabs</span>
          </label>
        </div>

        <label style={{ display: 'grid', gap: 4 }}>
          <span>Reminder timeout (seconds)</span>
          <input
            type="number"
            min={5}
            value={settings.reminderTimeoutSeconds}
            onChange={handleNumberChange('reminderTimeoutSeconds')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span>Snooze interval for reminders</span>
          <select
            value={settings.memoryReminderSnoozeMinutes}
            onChange={handleSelectNumberChange('memoryReminderSnoozeMinutes')}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
          >
            {REMINDER_SNOOZE_PRESETS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minute{minutes === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <span style={{ color: '#5f6368', fontSize: 12 }}>
            Controls the default snooze duration in reminder popups.
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.enableAutoSleep}
            onChange={handleCheckboxChange('enableAutoSleep')}
          />
          <span>Automatically sleep inactive tabs</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.autoFocusOnReminder}
            onChange={handleCheckboxChange('autoFocusOnReminder')}
          />
          <span>
            <strong>Switch to the tab when showing reminders</strong>
            <br />
            <span style={{ color: '#5f6368', fontSize: 13 }}>
              Keep this on to auto-focus the impacted tab whenever we show inactivity or memory warnings.
              Turn it off if you prefer to stay on your current tab and review the reminder later.
            </span>
            <br />
            <span style={{ color: '#5f6368', fontSize: 12 }}>
              Some Chrome pages (for example `chrome://` or PDF viewer) block in-tab overlays. On those tabs we
              show a single reminder popup window instead, and it closes automatically when you act or the
              timer expires.
            </span>
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.enableFullPageSampling}
            onChange={handleCheckboxChange('enableFullPageSampling')}
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
            checked={processFallbackSupported && settings.enableProcessFallback}
            onChange={handleCheckboxChange('enableProcessFallback')}
            disabled={!processFallbackSupported}
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

        {!processFallbackSupported && (
          <div
            style={{
              border: '1px solid #f1c232',
              background: '#fff8e1',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: '#795548'
            }}
          >
            Chrome limits the processes API to Dev/Beta/Canary builds, so this fallback is unavailable on
            your current channel.
            {capabilities?.processFallbackReason && (
              <span style={{ display: 'block', marginTop: 4 }}>Details: {capabilities.processFallbackReason}</span>
            )}
          </div>
        )}

        {processFallbackSupported && settings.enableProcessFallback && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Process fallback threshold (MB)</span>
              <input
                type="number"
                min={100}
                value={settings.processFallbackThresholdMb}
                onChange={handleNumberChange('processFallbackThresholdMb')}
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
