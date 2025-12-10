import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';

import { notifyReminderDecision } from '../../shared/messaging';
import type { MemoryActionTarget, SleepAction, TabTelemetryRecord } from '../../shared/types';

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

  const remaining = useCountdown(timeoutSeconds, () => {
    notifyReminderDecision(tabId, action, true, reason, {
      memoryUsageMb,
      totalHeapMb,
      fullPageMemoryMb,
      heapLimitMb,
      memoryThresholdMb,
      memoryTarget
    });
    window.close();
  });

  const handleDecision = (proceed: boolean) => {
    notifyReminderDecision(tabId, action, proceed, reason, {
      memoryUsageMb,
      totalHeapMb,
      fullPageMemoryMb,
      heapLimitMb,
      memoryThresholdMb,
      memoryTarget
    });
    window.close();
  };

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
          <p style={{ margin: '0 0 4px 0' }}>Latest memory snapshot:</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {typeof memoryUsageMb === 'number' && (
              <li>JS heap: {memoryUsageMb.toFixed(2)} MB</li>
            )}
            {typeof totalHeapMb === 'number' && (
              <li>
                Heap total: {totalHeapMb.toFixed(2)} MB
                {typeof heapLimitMb === 'number' ? ` / ${heapLimitMb.toFixed(2)} MB limit` : ''}
              </li>
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
      <p>We will proceed automatically in {remaining} seconds.</p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => handleDecision(false)}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid #1a73e8',
            background: '#fff',
            color: '#1a73e8'
          }}
        >
          Keep active
        </button>
        <button
          type="button"
          onClick={() => handleDecision(true)}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#1a73e8',
            color: '#fff'
          }}
        >
          {action === 'sleep' ? 'Sleep now' : 'Reload now'}
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<ReminderApp />);
