import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';

import { focusTab, requestTabStates, requestTelemetry } from '../../shared/messaging';
import type {
  TabState,
  TabStateUpdatedMessage,
  TabTelemetryRecord,
  TelemetryResponseMessage
} from '../../shared/types';

const TAB_STATE_STALE_MS = 5 * 60 * 1000;
const MAX_VISIBLE_CRITICAL_ITEMS = 5;
const MAX_VISIBLE_RECENT_ACTION_ROWS = 5;

function formatTime(value: number): string {
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatClock(value: number): string {
  const date = new Date(value);
  return date.toLocaleTimeString();
}

type MemoryLike = {
  memoryUsageMb?: number;
  totalHeapMb?: number;
  heapLimitMb?: number;
  fullPageMemoryMb?: number;
  memorySource?: TabTelemetryRecord['memorySource'];
  memoryCapturedAt?: number;
};

function describeMemorySource(source?: TabTelemetryRecord['memorySource']): string {
  switch (source) {
    case 'companion':
      return 'Native companion (CDP)';
    case 'debugger':
      return 'Chrome debugger sampler';
    case 'probe':
      return 'In-tab heap probe';
    case 'processes':
      return 'Chrome processes API';
    default:
      return 'Source unknown';
  }
}

function formatMemoryDetail(sample: MemoryLike): string {
  const sourceLabel = describeMemorySource(sample.memorySource);
  const sampledAt = sample.memoryCapturedAt ? `Sampled ${formatClock(sample.memoryCapturedAt)}` : null;
  return [sourceLabel, sampledAt].filter(Boolean).join(' • ');
}

function formatMemoryHeadline(sample: MemoryLike): string {
  const preferred =
    typeof sample.totalHeapMb === 'number'
      ? sample.totalHeapMb
      : typeof sample.fullPageMemoryMb === 'number'
        ? sample.fullPageMemoryMb
        : sample.memoryUsageMb;
  return typeof preferred === 'number' ? `${preferred.toFixed(2)} MB` : 'unknown';
}

function memoryMetricLines(sample: MemoryLike): string[] {
  const lines: string[] = [];
  if (typeof sample.totalHeapMb === 'number') {
    const limitSuffix =
      typeof sample.heapLimitMb === 'number' ? ` / ${sample.heapLimitMb.toFixed(2)} MB limit` : '';
    lines.push(`Heap total: ${sample.totalHeapMb.toFixed(2)} MB${limitSuffix}`);
  }
  if (typeof sample.memoryUsageMb === 'number') {
    lines.push(`JS heap used: ${sample.memoryUsageMb.toFixed(2)} MB`);
  }
  if (typeof sample.fullPageMemoryMb === 'number') {
    lines.push(`Full page: ${sample.fullPageMemoryMb.toFixed(2)} MB`);
  }
  if (typeof sample.totalHeapMb !== 'number' && typeof sample.heapLimitMb === 'number') {
    lines.push(`Heap limit: ${sample.heapLimitMb.toFixed(2)} MB`);
  }
  return lines;
}

function formatMemoryTrigger(record: TabTelemetryRecord): string | null {
  if (typeof record.memoryThresholdMb !== 'number' || !record.memoryTarget) {
    return null;
  }
  const targetLabel = record.memoryTarget === 'active' ? 'active tab' : 'inactive tab';
  const thresholdText = `${record.memoryThresholdMb.toFixed(0)} MB`;
  if (record.reason === 'timeout') {
    return `Reminder timed out @ ${thresholdText} (${targetLabel})`;
  }
  if (record.reason === 'memory') {
    const mode = record.memoryPrompted === false ? 'Automatic action' : 'Reminder shown';
    return `${mode} @ ${thresholdText} (${targetLabel})`;
  }
  return null;
}

function formatReasonLabel(record: TabTelemetryRecord): string {
  if (record.reason === 'memory') {
    return record.memoryTarget === 'active' ? 'Memory (active tab)' : 'Memory (inactive tab)';
  }
  if (record.reason === 'timeout') {
    if (record.memoryTarget) {
      return record.memoryPrompted === false ? 'Memory auto action' : 'Memory reminder timeout';
    }
    return 'Reminder timeout';
  }
  if (record.reason === 'inactivity') {
    return 'Inactivity';
  }
  if (record.reason === 'manual') {
    return 'Manual override';
  }
  return record.reason;
}

function resolveMemorySample(record: TabTelemetryRecord, state?: TabState): MemoryLike {
  if (!state) {
    return record;
  }

  const hasStateMetric =
    typeof state.memoryUsageMb === 'number' ||
    typeof state.fullPageMemoryMb === 'number' ||
    typeof state.totalHeapMb === 'number' ||
    typeof state.heapLimitMb === 'number';

  if (!hasStateMetric) {
    return record;
  }

  return {
    memoryUsageMb: typeof state.memoryUsageMb === 'number' ? state.memoryUsageMb : record.memoryUsageMb,
    totalHeapMb: typeof state.totalHeapMb === 'number' ? state.totalHeapMb : record.totalHeapMb,
    heapLimitMb: typeof state.heapLimitMb === 'number' ? state.heapLimitMb : record.heapLimitMb,
    fullPageMemoryMb:
      typeof state.fullPageMemoryMb === 'number' ? state.fullPageMemoryMb : record.fullPageMemoryMb,
    memorySource: state.memorySource ?? record.memorySource,
    memoryCapturedAt: state.memoryCapturedAt ?? record.memoryCapturedAt
  } satisfies MemoryLike;
}

function canBringTabToFront(record: TabTelemetryRecord, state?: TabState): boolean {
  if (!state) {
    return false;
  }
  if (!state.url || state.url !== record.url) {
    return false;
  }
  if (!state.lastSeenAt) {
    return false;
  }
  return Date.now() - state.lastSeenAt < TAB_STATE_STALE_MS;
}

function DashboardApp(): JSX.Element {
  const [records, setRecords] = useState<TabTelemetryRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [migrationToast, setMigrationToast] = useState<string>('');
  const [tabStates, setTabStates] = useState<Record<number, TabState>>({});
  const [focusToast, setFocusToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [pendingFocusTabId, setPendingFocusTabId] = useState<number | null>(null);
  const [criticalListMaxHeight, setCriticalListMaxHeight] = useState<number | null>(null);
  const [recentActionsMaxHeight, setRecentActionsMaxHeight] = useState<number | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | TabTelemetryRecord['action']>('all');
  const [reasonFilter, setReasonFilter] = useState<'all' | string>('all');
  const criticalListRef = useRef<HTMLUListElement | null>(null);
  const recentActionsRef = useRef<HTMLDivElement | null>(null);
  const migrationToastRef = useRef('');

  useEffect(() => {
    migrationToastRef.current = migrationToast;
  }, [migrationToast]);

  useEffect(() => {
    requestTelemetry(200)
      .then((data) => {
        setRecords(data);
        const needsUpgradeToast = data.some((record) => record.memorySource === undefined);
        if (needsUpgradeToast) {
          setMigrationToast('Finishing telemetry upgrade… please keep this tab open for a few seconds.');
        }
      })
      .catch((err) => setError(err?.message ?? 'Failed to load logs'))
      .finally(() => setLoading(false));

    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message: unknown) => {
      const payload = message as TelemetryResponseMessage;
      if (payload?.type === 'telemetry-response') {
        setRecords((prev) => {
          const merged = [...payload.payload, ...prev].slice(0, 200);
          const stillMissingSources = merged.some((record) => record.memorySource === undefined);
          if (!stillMissingSources && migrationToastRef.current) {
            setMigrationToast('Telemetry upgrade complete — all entries now show source info.');
            window.setTimeout(() => setMigrationToast(''), 4000);
          }
          return merged;
        });
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    requestTabStates()
      .then((state) => setTabStates(state))
      .catch((err) => console.warn('Failed to load tab states', err));

    const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message: unknown) => {
      const payload = message as TabStateUpdatedMessage;
      if (payload?.type === 'tab-state-updated') {
        setTabStates((prev) => ({
          ...prev,
          [payload.tabId]: payload.state
        }));
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    const storageListener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      areaName
    ) => {
      if (areaName !== 'local') {
        return;
      }
      const tabStateChange = changes['sleepyTabs.tabState'];
      if (!tabStateChange) {
        return;
      }
      const nextState = (tabStateChange.newValue as Record<number, TabState>) ?? {};
      setTabStates(nextState);
    };

    chrome.storage.onChanged.addListener(storageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  useEffect(() => {
    if (!focusToast) {
      return;
    }
    const timeout = window.setTimeout(() => setFocusToast(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [focusToast]);

  useEffect(() => {
    const handleResize = () => setLayoutVersion((value) => value + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleBringToFront = useCallback(
    async (record: TabTelemetryRecord) => {
      const tabState = tabStates[record.tabId];
      if (!tabState) {
        setFocusToast({ tone: 'error', message: 'Live tab metadata unavailable. Try refreshing the dashboard.' });
        return;
      }

      setPendingFocusTabId(record.tabId);
      try {
        await focusTab(record.tabId, { expectedUrl: record.url, windowId: tabState.windowId });
        setFocusToast({ tone: 'success', message: 'Tab focused in the browser.' });
      } catch (focusError) {
        const message = focusError instanceof Error ? focusError.message : 'Unable to focus tab.';
        setFocusToast({ tone: 'error', message });
      } finally {
        setPendingFocusTabId((current) => (current === record.tabId ? null : current));
      }
    },
    [tabStates]
  );

  const availableActions = useMemo(() => {
    const actions = new Set<TabTelemetryRecord['action']>();
    records.forEach((record) => actions.add(record.action));
    return Array.from(actions).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const availableReasons = useMemo(() => {
    const reasons = new Set<string>();
    records.forEach((record) => reasons.add(formatReasonLabel(record)));
    return Array.from(reasons).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const filteredRecords = useMemo<TabTelemetryRecord[]>(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase();
    return records.filter((record) => {
      if (actionFilter !== 'all' && record.action !== actionFilter) {
        return false;
      }
      const reasonLabel = formatReasonLabel(record);
      if (reasonFilter !== 'all' && reasonLabel !== reasonFilter) {
        return false;
      }
      if (!normalizedTerm) {
        return true;
      }
      const haystack = [
        record.title ?? '',
        record.url ?? '',
        record.action ?? '',
        reasonLabel,
        record.memorySampleNotes ?? ''
      ];
      return haystack.some((value) => value.toLowerCase().includes(normalizedTerm));
    });
  }, [records, actionFilter, reasonFilter, searchTerm]);

  const criticalRecords = useMemo(
    () => filteredRecords.filter((record) => record.critical),
    [filteredRecords]
  );

  useLayoutEffect(() => {
    const listElement = criticalListRef.current;
    if (listElement) {
      const items = Array.from(listElement.children) as HTMLElement[];
      if (items.length > MAX_VISIBLE_CRITICAL_ITEMS) {
        const visibleItems = items.slice(0, MAX_VISIBLE_CRITICAL_ITEMS);
        const totalHeight = visibleItems.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
        const computedStyle = window.getComputedStyle(listElement);
        const gapValue = Number.parseFloat(computedStyle.rowGap || computedStyle.gap || '0') || 0;
        const newHeight = Math.ceil(totalHeight + gapValue * (visibleItems.length - 1));
        setCriticalListMaxHeight((current) => (current === newHeight ? current : newHeight));
      } else {
        setCriticalListMaxHeight((current) => (current === null ? current : null));
      }
    } else {
      setCriticalListMaxHeight((current) => (current === null ? current : null));
    }

    const recentContainer = recentActionsRef.current;
    if (recentContainer) {
      const table = recentContainer.querySelector('table');
      if (table) {
        const headerHeight = table.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        const rows = Array.from(table.querySelectorAll('tbody tr')) as HTMLElement[];
        if (rows.length > MAX_VISIBLE_RECENT_ACTION_ROWS) {
          const visibleRows = rows.slice(0, MAX_VISIBLE_RECENT_ACTION_ROWS);
          const rowsHeight = visibleRows.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
          const newHeight = Math.ceil(headerHeight + rowsHeight);
          setRecentActionsMaxHeight((current) => (current === newHeight ? current : newHeight));
        } else {
          setRecentActionsMaxHeight((current) => (current === null ? current : null));
        }
      }
    } else {
      setRecentActionsMaxHeight((current) => (current === null ? current : null));
    }
  }, [criticalRecords, filteredRecords, layoutVersion]);

  const hasFiltersApplied = searchTerm.trim() !== '' || actionFilter !== 'all' || reasonFilter !== 'all';

  return (
    <div
      style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', maxWidth: 960, minWidth: 320, margin: '0 auto' }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Sleepy Tabs Dashboard</h1>
        <p style={{ color: '#555' }}>
          Review recent actions and identify tabs that need attention.
        </p>
      </header>

      {loading && <p>Loading telemetry...</p>}
      {error && <p style={{ color: '#d93025' }}>{error}</p>}
      {migrationToast && (
        <p
          style={{
            color: '#0b8043',
            background: '#e6f4ea',
            border: '1px solid #81c995',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13
          }}
        >
          {migrationToast}
        </p>
      )}
      {focusToast && (
        <p
          style={{
            color: focusToast.tone === 'error' ? '#d93025' : '#0b8043',
            background: focusToast.tone === 'error' ? '#fce8e6' : '#e6f4ea',
            border: `1px solid ${focusToast.tone === 'error' ? '#f28b82' : '#81c995'}`,
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13
          }}
        >
          {focusToast.message}
        </p>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18 }}>Filter and search</h2>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'flex-end'
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#5f6368', gap: 4 }}>
            Search
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search titles, URLs, notes"
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid #c4c4c4',
                minWidth: 220
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#5f6368', gap: 4 }}>
            Action
            <select
              value={actionFilter}
              onChange={(event) => {
                const value = event.target.value;
                setActionFilter(value === 'all' ? 'all' : (value as TabTelemetryRecord['action']));
              }}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid #c4c4c4',
                minWidth: 160
              }}
            >
              <option value="all">All actions</option>
              {availableActions.map((action) => {
                const label = action.charAt(0).toUpperCase() + action.slice(1);
                return (
                  <option key={`action-${action}`} value={action}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#5f6368', gap: 4 }}>
            Reason
            <select
              value={reasonFilter}
              onChange={(event) => {
                const value = event.target.value;
                setReasonFilter(value === 'all' ? 'all' : value);
              }}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid #c4c4c4',
                minWidth: 200
              }}
            >
              <option value="all">All reasons</option>
              {availableReasons.map((reason) => (
                <option key={`reason-${reason}`} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setActionFilter('all');
              setReasonFilter('all');
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #1a73e8',
              background: '#1a73e8',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            Reset filters
          </button>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18 }}>Critical tabs</h2>
        {criticalRecords.length === 0 ? (
          <p style={{ color: '#555' }}>
            {hasFiltersApplied
              ? 'No critical tabs match the current filters.'
              : 'All clear. Recent activity looks healthy.'}
          </p>
        ) : (
          <ul
            ref={criticalListRef}
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'grid',
              gap: 12,
              maxHeight: criticalListMaxHeight !== null ? `${criticalListMaxHeight}px` : undefined,
              overflowY: criticalListMaxHeight !== null ? 'auto' : undefined,
              paddingRight: criticalListMaxHeight !== null ? 4 : 0
            }}
          >
            {criticalRecords.map((record) => {
              const liveState = tabStates[record.tabId];
              const memorySample = resolveMemorySample(record, liveState);
              const memoryTrigger = formatMemoryTrigger(record);
              const reasonLabel = formatReasonLabel(record);
              const memoryNotes = liveState?.memorySampleNotes ?? record.memorySampleNotes;
              return (
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
                    Peak memory {formatMemoryHeadline(memorySample)} at {formatTime(record.timestamp)}
                  </p>
                  <p style={{ margin: '4px 0', fontSize: 12, color: '#202124' }}>{reasonLabel}</p>
                  <div style={{ margin: '4px 0 0 0', fontSize: 12, color: '#5f6368' }}>
                    {memoryMetricLines(memorySample).map((line, index) => (
                      <div key={`${record.id ?? record.tabId}-critical-${index}`}>{line}</div>
                    ))}
                    {formatMemoryDetail(memorySample) && <div>{formatMemoryDetail(memorySample)}</div>}
                    {memorySample.memorySource === 'probe' && (
                      <div>In-tab heap probes are approximate; the tab process can consume more memory than shown here.</div>
                    )}
                    {memoryTrigger && (
                        <div style={{ fontSize: 11, color: '#5f6368', marginTop: 4 }}>{memoryTrigger}</div>
                      )}
                    {memoryNotes && <div style={{ marginTop: 6 }}>{memoryNotes}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18 }}>Recent actions</h2>
        <div
          ref={recentActionsRef}
          style={{
            overflowX: 'auto',
            overflowY: recentActionsMaxHeight !== null ? 'auto' : undefined,
            maxHeight: recentActionsMaxHeight !== null ? `${recentActionsMaxHeight}px` : undefined,
            paddingRight: recentActionsMaxHeight !== null ? 4 : undefined
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ padding: '8px 12px' }}>Time</th>
                <th style={{ padding: '8px 12px' }}>Action</th>
                <th style={{ padding: '8px 12px' }}>Reason</th>
                <th style={{ padding: '8px 12px' }}>Memory</th>
                <th style={{ padding: '8px 12px' }}>Title</th>
                <th style={{ padding: '8px 12px' }}>Bring to front</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '12px', textAlign: 'center', color: '#5f6368', fontSize: 13 }}>
                    {hasFiltersApplied
                      ? 'No recent actions match the current filters.'
                      : 'No recent actions logged yet.'}
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => {
                const liveState = tabStates[record.tabId];
                const memorySample = resolveMemorySample(record, liveState);
                const memoryTrigger = formatMemoryTrigger(record);
                const memoryNotes = liveState?.memorySampleNotes ?? record.memorySampleNotes;
                return (
                  <tr
                    key={record.id ?? `${record.tabId}-${record.timestamp}`}
                    style={{ borderBottom: '1px solid #f0f0f0' }}
                  >
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatTime(record.timestamp)}</td>
                    <td style={{ padding: '8px 12px', textTransform: 'capitalize' }}>{record.action}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <div>{formatReasonLabel(record)}</div>
                      {memoryTrigger && (
                        <div style={{ fontSize: 11, color: '#5f6368', marginTop: 4 }}>{memoryTrigger}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {memoryMetricLines(memorySample).map((line, index) => (
                        <div key={`${record.id ?? record.tabId}-recent-${index}`}>{line}</div>
                      ))}
                      {formatMemoryDetail(memorySample) && (
                        <div style={{ fontSize: 11, color: '#5f6368', marginTop: 4 }}>
                          {formatMemoryDetail(memorySample)}
                        </div>
                      )}
                      {memorySample.memorySource === 'probe' && (
                        <div style={{ fontSize: 11, color: '#5f6368', marginTop: 2 }}>
                          In-tab heap probes are approximate; the tab process can consume more memory than shown here.
                        </div>
                      )}
                      {memoryNotes && (
                        <div style={{ fontSize: 11, color: '#d93025', marginTop: 6 }}>{memoryNotes}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{record.title ?? 'Untitled'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {canBringTabToFront(record, tabStates[record.tabId]) ? (
                        <button
                          type="button"
                          onClick={() => handleBringToFront(record)}
                          disabled={pendingFocusTabId === record.tabId}
                          style={{
                            fontSize: 12,
                            padding: '6px 10px',
                            borderRadius: 4,
                            border: '1px solid #1a73e8',
                            background: pendingFocusTabId === record.tabId ? '#e8f0fe' : '#1a73e8',
                            color: pendingFocusTabId === record.tabId ? '#1a73e8' : '#fff',
                            cursor: pendingFocusTabId === record.tabId ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {pendingFocusTabId === record.tabId ? 'Focusing…' : 'Bring to front'}
                        </button>
                      ) : (
                        <span style={{ color: '#8a8a8a' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<DashboardApp />);
