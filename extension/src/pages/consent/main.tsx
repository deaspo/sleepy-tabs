import { useState } from 'react';
import ReactDOM from 'react-dom/client';

import type { ConsentState } from '../../shared/types';

function ConsentApp(): JSX.Element {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  const handleAccept = () => {
    setSubmitting(true);
    const payload: ConsentState = { accepted: true, acceptedAt: Date.now() };
    chrome.runtime.sendMessage(
      {
        type: 'consent-updated',
        payload
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setError(chrome.runtime.lastError.message ?? 'Failed to record consent');
          setSubmitting(false);
          return;
        }
        if (response?.success) {
          setAccepted(true);
        } else {
          setError('Failed to record consent');
        }
        setSubmitting(false);
      }
    );
  };

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '24px auto',
        fontFamily: 'system-ui, sans-serif',
        lineHeight: 1.6,
        color: '#1a1a1a'
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 8px 0' }}>Sleepy Tabs Guardian</h1>
        <p style={{ margin: 0, color: '#555' }}>
          Before we begin, we need your approval to monitor tab activity and resource usage.
        </p>
      </header>

      <section style={{ background: '#f8f9fa', padding: 20, borderRadius: 12, marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>What we monitor</h2>
        <ul>
          <li>Tab focus changes and inactivity to decide when to pause.</li>
          <li>Memory usage metrics forwarded by the companion app to highlight heavy tabs.</li>
          <li>Actions triggered by the extension so you can review them later in the dashboard.</li>
        </ul>
        <p style={{ marginTop: 16 }}>
          Metrics stay on your device. We never transmit browsing data outside of your machine.
        </p>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Consent</h2>
        <p>
          By clicking <strong>I agree</strong>, you allow Sleepy Tabs Guardian to monitor open tabs and
          manage them based on your configured limits. You can revoke this consent at any time from the
          settings page.
        </p>
      </section>

      {error && <p style={{ color: '#d93025' }}>{error}</p>}
      {accepted ? (
        <div style={{ color: '#1a73e8', fontWeight: 600 }}>
          Thanks! You can now close this tab and continue browsing.
        </div>
      ) : (
        <button
          type="button"
          onClick={handleAccept}
          disabled={submitting}
          style={{
            padding: '10px 24px',
            borderRadius: 999,
            border: 'none',
            background: '#1a73e8',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          {submitting ? 'Recording...' : 'I agree'}
        </button>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<ConsentApp />);
