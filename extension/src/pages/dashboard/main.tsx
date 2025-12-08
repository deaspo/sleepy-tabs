import { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';

import { requestTelemetry } from '../../shared/messaging';
import type { TabTelemetryRecord, TelemetryResponseMessage } from '../../shared/types';

function formatTime(value: number): string {
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function DashboardApp(): JSX.Element {
  const [records, setRecords] = useState<TabTelemetryRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    requestTelemetry(200)
      .then((data) => setRecords(data))
      .catch((err) => setError(err?.message ?? 'Failed to load logs'))
      .finally(() => setLoading(false));

    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message: unknown) => {
      const payload = message as TelemetryResponseMessage;
      if (payload?.type === 'telemetry-response') {
        setRecords((prev) => [...payload.payload, ...prev].slice(0, 200));
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const criticalRecords = useMemo(
    () => records.filter((record) => record.critical).slice(0, 10),
    [records]
  );

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Sleepy Tabs Dashboard</h1>
        <p style={{ color: '#555' }}>
          Review recent actions and identify tabs that need attention.
        </p>
      </header>

      {loading && <p>Loading telemetry...</p>}
      {error && <p style={{ color: '#d93025' }}>{error}</p>}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18 }}>Critical tabs</h2>
        {criticalRecords.length === 0 ? (
          <p style={{ color: '#555' }}>All clear. Recent activity looks healthy.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {criticalRecords.map((record) => (
              <li
                key={`critical-${record.id ?? `${record.tabId}-${record.timestamp}`}`}
                style={{
                  border: '1px solid #f3b8b8',
                  background: '#fdecea',
                  padding: 16,
                  borderRadius: 8
                }}
              >
                <h3 style={{ margin: '0 0 8px 0', fontSize: 16 }}>{record.title}</h3>
                <p style={{ margin: '0 0 4px 0', wordBreak: 'break-word' }}>{record.url}</p>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Used {record.memoryUsageMb ?? 'unknown'} MB at {formatTime(record.timestamp)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>Recent actions</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ padding: '8px 12px' }}>Time</th>
                <th style={{ padding: '8px 12px' }}>Action</th>
                <th style={{ padding: '8px 12px' }}>Reason</th>
                <th style={{ padding: '8px 12px' }}>Memory (MB)</th>
                <th style={{ padding: '8px 12px' }}>Title</th>
                <th style={{ padding: '8px 12px' }}>URL</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr
                  key={record.id ?? `${record.tabId}-${record.timestamp}`}
                  style={{ borderBottom: '1px solid #f0f0f0' }}
                >
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatTime(record.timestamp)}</td>
                  <td style={{ padding: '8px 12px', textTransform: 'capitalize' }}>{record.action}</td>
                  <td style={{ padding: '8px 12px', textTransform: 'capitalize' }}>{record.reason}</td>
                  <td style={{ padding: '8px 12px' }}>{record.memoryUsageMb?.toFixed(2) ?? '—'}</td>
                  <td style={{ padding: '8px 12px' }}>{record.title ?? 'Untitled'}</td>
                  <td style={{ padding: '8px 12px', wordBreak: 'break-word' }}>{record.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<DashboardApp />);
