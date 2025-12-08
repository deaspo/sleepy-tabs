import { chromium, type Browser, type CDPSession } from 'playwright';

import type { CompanionInboundMessage, CompanionOutboundMessage } from './types';

interface TargetSession {
  tabId: number;
  targetId: string;
  sessionId: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function toMb(bytes: number | undefined): number | undefined {
  if (typeof bytes !== 'number') {
    return undefined;
  }
  return bytes / (1024 * 1024);
}

export class TabMonitor {
  private browser: Browser | null = null;
  private browserSession: CDPSession | null = null;
  private readonly sessions = new Map<number, TargetSession>();
  private readonly trackedTabs = new Set<number>();
  private readonly pending = new Map<string, Map<number, PendingRequest>>();
  private telemetryInterval: NodeJS.Timeout | null = null;
  private messageCounter = 0;

  private readonly handleAttached = (event: unknown): void => {
    const payload = event as { sessionId: string; targetInfo: { targetId: string; tabId?: number; type: string } };
    const { sessionId, targetInfo } = payload;
    if (targetInfo.type === 'page' && typeof targetInfo.tabId === 'number') {
      this.sessions.set(targetInfo.tabId, {
        tabId: targetInfo.tabId,
        targetId: targetInfo.targetId,
        sessionId
      });
      this.pending.set(sessionId, new Map());
      void this.initializeSession(sessionId);
    }
  };

  private readonly handleDetached = (event: unknown): void => {
    const payload = event as { sessionId: string };
    this.detachSessionById(payload.sessionId);
  };

  private readonly handleTargetDestroyed = (event: unknown): void => {
    const targetId = (event as { targetId: string }).targetId;
    for (const [tabId, session] of this.sessions.entries()) {
      if (session.targetId === targetId) {
        this.sessions.delete(tabId);
      }
    }
  };

  private readonly handleMessageFromTarget = (event: unknown): void => {
    const payload = event as { sessionId: string; message: string };
    const message = JSON.parse(payload.message) as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string };
    };
    if (message.id) {
      const pendingBySession = this.pending.get(payload.sessionId);
      const pending = pendingBySession?.get(message.id);
      if (pending) {
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result ?? null);
        }
        pendingBySession?.delete(message.id);
      }
    }

    if (message.method === 'Page.lifecycleEvent') {
      const params = message.params as { name?: string };
      const session = this.findSessionById(payload.sessionId);
      if (session && params?.name) {
        this.send({
          type: 'telemetry',
          tabId: session.tabId,
          lifecycleState: params.name
        });
      }
    }
  };

  constructor(private readonly send: (message: CompanionInboundMessage) => void) {}

  async start(): Promise<void> {
    if (this.browser) {
      return;
    }

    const endpoint = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
    this.browser = await chromium.connectOverCDP(endpoint);
    this.browserSession = await this.browser.newBrowserCDPSession();

    this.browserSession.on('Target.attachedToTarget', this.handleAttached);
    this.browserSession.on('Target.detachedFromTarget', this.handleDetached);
    this.browserSession.on('Target.targetDestroyed', this.handleTargetDestroyed);
    this.browserSession.on('Target.receivedMessageFromTarget', this.handleMessageFromTarget);

    await this.browserSession.send('Target.setAutoAttach', {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
      filter: [
        {
          type: 'page',
          exclude: false
        }
      ]
    });

    await this.browserSession.send('Target.setDiscoverTargets', { discover: true });
    const targetList = (await this.browserSession.send('Target.getTargets')) as {
      targetInfos: Array<{ targetId: string; tabId?: number; type: string }>;
    };

    for (const info of targetList.targetInfos) {
      if (info.type === 'page' && typeof info.tabId === 'number') {
        await this.attachToTarget(info.tabId, info.targetId);
      }
    }

    this.telemetryInterval = setInterval(() => {
      void this.pollMetrics();
    }, 15000);
  }

  async stop(): Promise<void> {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }

    if (this.browserSession) {
      this.browserSession.removeListener('Target.attachedToTarget', this.handleAttached);
      this.browserSession.removeListener('Target.detachedFromTarget', this.handleDetached);
      this.browserSession.removeListener('Target.targetDestroyed', this.handleTargetDestroyed);
      this.browserSession.removeListener('Target.receivedMessageFromTarget', this.handleMessageFromTarget);
      await this.browserSession.detach();
      this.browserSession = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.sessions.clear();
    this.pending.clear();
    this.trackedTabs.clear();
  }

  handleOutbound(message: CompanionOutboundMessage): void {
    switch (message.type) {
      case 'monitor-tabs':
        void this.start().catch((error) => this.reportError(error));
        break;
      case 'track-tab':
        this.trackedTabs.add(message.tabId);
        break;
      case 'untrack-tab':
        this.trackedTabs.delete(message.tabId);
        break;
      case 'sleep-tab':
        void this.setLifecycle(message.tabId, 'frozen');
        break;
      case 'reload-tab':
        void this.reloadTab(message.tabId);
        break;
      default:
        break;
    }
  }

  private async pollMetrics(): Promise<void> {
    if (!this.browserSession) {
      return;
    }

    for (const tabId of this.trackedTabs) {
      const session = this.sessions.get(tabId);
      if (!session) {
        continue;
      }

      try {
        const metrics = (await this.sendCommand(session.sessionId, 'Performance.getMetrics')) as {
          metrics: Array<{ name: string; value: number }>;
        };
        const map = new Map(metrics.metrics.map((metric) => [metric.name, metric.value]));
        const jsHeap = toMb(map.get('JSHeapUsedSize'));
        this.send({
          type: 'telemetry',
          tabId,
          memoryUsageMb: jsHeap
        });
      } catch (error) {
        this.reportError(error as Error);
      }
    }
  }

  private async setLifecycle(tabId: number, state: 'frozen' | 'active'): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) {
      return;
    }

    try {
      await this.sendCommand(session.sessionId, 'Page.setWebLifecycleState', {
        state
      });
    } catch (error) {
      this.reportError(error as Error);
    }
  }

  private async reloadTab(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) {
      return;
    }

    try {
      await this.sendCommand(session.sessionId, 'Page.reload', { ignoreCache: false });
    } catch (error) {
      this.reportError(error as Error);
    }
  }

  private async attachToTarget(tabId: number, targetId: string): Promise<void> {
    if (!this.browserSession) {
      return;
    }

    try {
      await this.browserSession.send('Target.attachToTarget', {
        targetId,
        flatten: true
      });
    } catch (error) {
      this.reportError(error as Error);
    }
  }

  private async initializeSession(sessionId: string): Promise<void> {
    try {
      await this.sendCommand(sessionId, 'Page.enable');
      await this.sendCommand(sessionId, 'Runtime.enable');
      await this.sendCommand(sessionId, 'Performance.enable');
    } catch (error) {
      this.reportError(error as Error);
    }
  }

  private async sendCommand(sessionId: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.browserSession) {
      throw new Error('Browser session unavailable');
    }

    const id = ++this.messageCounter;

    const pendingBySession = this.pending.get(sessionId);
    if (!pendingBySession) {
      throw new Error(`Session ${sessionId} not registered`);
    }

    const resultPromise = new Promise<unknown>((resolve, reject) => {
      pendingBySession.set(id, { resolve, reject });
    });

    await this.browserSession.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id, method, params })
    });

    return resultPromise;
  }

  private detachSessionById(sessionId: string): void {
    this.pending.delete(sessionId);
    for (const [tabId, session] of this.sessions.entries()) {
      if (session.sessionId === sessionId) {
        this.sessions.delete(tabId);
      }
    }
  }

  private findSessionById(sessionId: string): TargetSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        return session;
      }
    }
    return undefined;
  }

  private reportError(error: Error): void {
    this.send({ type: 'error', message: error.message });
  }
}
