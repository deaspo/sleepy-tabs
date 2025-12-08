import { NativeMessagingHost } from './nativeMessaging.js';
import { TabMonitor } from './tabMonitor.js';
import type { CompanionOutboundMessage } from './types';

let host: NativeMessagingHost | null = null;

const monitor = new TabMonitor((message) => {
  if (host) {
    host.send(message);
  }
});

host = new NativeMessagingHost(
  (rawMessage) => {
    const message = rawMessage as CompanionOutboundMessage;
    monitor.handleOutbound(message);
  },
  (error) => {
    console.error('[sleepy-tabs-companion] Native messaging error', error);
    if (host) {
      host.send({ type: 'error', message: error.message });
    }
  }
);

process.on('SIGINT', async () => {
  await monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await monitor.stop();
  process.exit(0);
});
