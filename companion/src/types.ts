export type CompanionOutboundMessage =
  | {
      type: 'monitor-tabs';
    }
  | {
      type: 'sleep-tab';
      tabId: number;
    }
  | {
      type: 'reload-tab';
      tabId: number;
    }
  | {
      type: 'track-tab';
      tabId: number;
      url?: string;
    }
  | {
      type: 'untrack-tab';
      tabId: number;
    };

export type CompanionInboundMessage =
  | {
      type: 'telemetry';
      tabId: number;
      memoryUsageMb?: number;
      lifecycleState?: string;
    }
  | {
      type: 'error';
      message: string;
    };
