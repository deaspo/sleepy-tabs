import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';

import { DEFAULT_REMINDER_SNOOZE_MINUTES, REMINDER_SNOOZE_PRESETS } from '../../shared/constants';
import { notifyReminderDecision } from '../../shared/messaging';
import type {
  MemoryActionTarget,
  ReminderDecisionOption,
  SleepAction,
  TabTelemetryRecord
} from '../../shared/types';

function useCountdown(seconds: number, onElapsed: () => void): number {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (seconds <= 0) {
      return;
    }
    let current = seconds;
    const timer = window.setInterval(() => {
      current -= 1;
      if (current <= 0) {
        window.clearInterval(timer);
        onElapsed();
      }
      setRemaining(current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds, onElapsed]);

  return remaining;
}

function ReminderApp(): JSX.Element {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const tabId = Number(params.get('tabId') ?? -1);
  const action = (params.get('action') ?? 'sleep') as SleepAction;
  const reason = (params.get('reason') ?? 'inactivity') as TabTelemetryRecord['reason'];
  const timeoutSeconds = Number(params.get('timeoutSeconds') ?? 15);
  const memoryUsageMb = params.get('memoryUsageMb')
    ? Number(params.get('memoryUsageMb'))
    : undefined;
  const totalHeapMb = params.get('totalHeapMb') ? Number(params.get('totalHeapMb')) : undefined;
  const fullPageMemoryMb = params.get('fullPageMemoryMb')
    ? Number(params.get('fullPageMemoryMb'))
    : undefined;
  const heapLimitMb = params.get('heapLimitMb') ? Number(params.get('heapLimitMb')) : undefined;
  const memoryCapturedAt = params.get('memoryCapturedAt')
    ? Number(params.get('memoryCapturedAt'))
    : undefined;
  const memorySource = params.get('memorySource') ?? undefined;
  const memoryThresholdMb = params.get('memoryThresholdMb')
    ? Number(params.get('memoryThresholdMb'))
    : undefined;
  const memoryTarget = (params.get('memoryTarget') ?? undefined) as MemoryActionTarget | undefined;
  const memorySampleNotes = params.get('memorySampleNotes') ?? undefined;
  const snoozeParamRaw = params.get('snoozeMinutes');
  const snoozeParsed = snoozeParamRaw ? Number(snoozeParamRaw) : Number.NaN;
  const configuredSnoozeMinutes = Number.isFinite(snoozeParsed) && snoozeParsed > 0 ? snoozeParsed : undefined;
  const defaultSnoozeMinutes = configuredSnoozeMinutes ?? DEFAULT_REMINDER_SNOOZE_MINUTES;
  const snoozeOptions = useMemo(() => {
    const merged = new Set<number>([defaultSnoozeMinutes, ...REMINDER_SNOOZE_PRESETS]);
    return Array.from(merged)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
  }, [defaultSnoozeMinutes]);
  const [selectedSnoozeMinutes, setSelectedSnoozeMinutes] = useState<number>(defaultSnoozeMinutes);

  useEffect(() => {
    setSelectedSnoozeMinutes(defaultSnoozeMinutes);
  }, [defaultSnoozeMinutes]);

  const commonMetrics = {
    memoryUsageMb,
    totalHeapMb,
    fullPageMemoryMb,
    heapLimitMb,
    memoryThresholdMb,
    memoryTarget,
    memorySampleNotes
  };

  const sendDecision = (decision: ReminderDecisionOption, extras?: { snoozeMinutes?: number }) => {
    const snoozeMinutes = extras?.snoozeMinutes ?? selectedSnoozeMinutes;
    notifyReminderDecision(tabId, action, decision, reason, {
      ...commonMetrics,
      snoozeMinutes: snoozeMinutes > 0 ? snoozeMinutes : undefined
    });
    window.close();
  };

  const autoDecision: ReminderDecisionOption = action === 'sleep' ? 'sleep-now' : 'reload-now';

  const remaining = useCountdown(timeoutSeconds, () =>
    sendDecision(autoDecision, { snoozeMinutes: selectedSnoozeMinutes })
  );

  const primaryActionLabel = action === 'sleep' ? 'Sleep now' : 'Reload now';
  const secondaryActionLabel = action === 'sleep' ? 'Reload now' : 'Sleep now';
  const secondaryDecision: ReminderDecisionOption = action === 'sleep' ? 'reload-now' : 'sleep-now';

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '20vh auto',
        padding: '24px',
        borderRadius: 12,
        border: '1px solid #e0e0e0',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center'
      }}
    >
      <h1 style={{ marginTop: 0 }}>
        {action === 'sleep' ? 'Pause inactive tab?' : 'Reload heavy tab?'}
      </h1>
      {reason === 'memory' ? (
        <div style={{ fontSize: 14, color: '#202124', marginBottom: 12 }}>
          <p style={{ margin: '0 0 4px 0' }}>Latest heap snapshot:</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {typeof totalHeapMb === 'number' && (
              <li>
                Heap total: {totalHeapMb.toFixed(2)} MB
                {typeof heapLimitMb === 'number' ? ` / ${heapLimitMb.toFixed(2)} MB limit` : ''}
              </li>
            )}
            {typeof memoryUsageMb === 'number' && (
              <li>JS heap used: {memoryUsageMb.toFixed(2)} MB</li>
            )}
            {typeof fullPageMemoryMb === 'number' && (
              <li>Full page: {fullPageMemoryMb.toFixed(2)} MB</li>
            )}
            {typeof totalHeapMb !== 'number' && typeof heapLimitMb === 'number' && (
              <li>Heap limit: {heapLimitMb.toFixed(2)} MB</li>
            )}
          </ul>
          <div style={{ color: '#5f6368', marginTop: 6, fontSize: 12 }}>
            {memoryCapturedAt
              ? `Sampled ${new Date(memoryCapturedAt).toLocaleTimeString()} (${memorySource ?? 'unknown source'})`
              : ''}
          </div>
          {memorySource === 'probe' && (
            <div style={{ color: '#5f6368', marginTop: 6, fontSize: 12 }}>
              In-tab heap probes are approximate; the tab process can consume more memory than shown here.
            </div>
          )}
          {memorySampleNotes === 'probe-saturated' && (
            <div style={{ color: '#5f6368', marginTop: 6, fontSize: 12 }}>
              JS heap usage hit the browser limit. Sleepy Tabs is using the total heap estimate and will capture a deeper sample shortly.
            </div>
          )}
          {typeof memoryThresholdMb === 'number' && (
            <div style={{ color: '#5f6368', marginTop: 6, fontSize: 12 }}>
              Configured threshold: {memoryThresholdMb.toFixed(0)} MB{' '}
              {memoryTarget === 'active' ? '(active tab)' : '(inactive tab)'}.
            </div>
          )}
        </div>
      ) : (
        <p>This tab has been inactive for a while.</p>
      )}
      <p>
        We will {action === 'sleep' ? 'sleep this tab' : 'reload this tab'} automatically in {remaining}{' '}
        seconds if you do nothing.
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <button
          type="button"
          onClick={() => sendDecision('keep-active')}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: '1px solid #1a73e8',
            background: '#fff',
            color: '#1a73e8',
            fontWeight: 600
          }}
        >
          Keep tab active
        </button>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#3c4043' }}>
            Remind me in
            <select
              value={selectedSnoozeMinutes}
              onChange={(event) => setSelectedSnoozeMinutes(Number(event.target.value))}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #5f6368',
                fontSize: 14
              }}
            >
              {snoozeOptions.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minute{minutes === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => sendDecision('snooze', { snoozeMinutes: selectedSnoozeMinutes })}
            style={{
              padding: '10px 16px',
              borderRadius: 6,
              border: '1px solid #5f6368',
              background: '#fff',
              color: '#3c4043'
            }}
          >
            Snooze
          </button>
        </div>
        <button
          type="button"
          onClick={() => sendDecision('ignore-tab')}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: '1px solid #dadce0',
            background: '#fff',
            color: '#3c4043'
          }}
        >
          Ignore this tab (clears on reload)
        </button>
        <button
          type="button"
          onClick={() => sendDecision(autoDecision)}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#1a73e8',
            color: '#fff',
            fontWeight: 600
          }}
        >
          {primaryActionLabel}
        </button>
        <button
          type="button"
          onClick={() => sendDecision(secondaryDecision)}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: '1px solid #1a1a1a',
            background: '#fff',
            color: '#1a1a1a'
          }}
        >
          {secondaryActionLabel}
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<ReminderApp />);
