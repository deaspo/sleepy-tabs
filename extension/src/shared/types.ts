export type SleepAction = 'sleep' | 'reload';

export interface SleepSettings {
  version: number;
  inactivityTimeoutMinutes: number;
  memoryThresholdMb: number;
  enableAutoReload: boolean;
  enableAutoSleep: boolean;
  reminderTimeoutSeconds: number;
}

export interface ConsentState {
  accepted: boolean;
  acceptedAt?: number;
}

export interface TabState {
  tabId: number;
  lastActiveAt: number;
  ignored: boolean;
  pendingReminder?: SleepAction;
  memoryUsageMb?: number;
}

export interface TabTelemetryRecord {
  id?: number;
  tabId: number;
  url: string;
  title?: string;
  action: SleepAction;
  memoryUsageMb?: number;
  reason: 'inactivity' | 'memory' | 'manual' | 'timeout';
  timestamp: number;
  critical: boolean;
}

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

export interface SettingsUpdateMessage {
  type: 'update-settings';
  payload: Partial<SleepSettings>;
}

export interface SettingsRequestMessage {
  type: 'request-settings';
}

export interface TabStateRequestMessage {
  type: 'request-tab-state';
  tabId: number;
}

export interface ConsentMessage {
  type: 'consent-updated';
  payload: ConsentState;
}

export interface TelemetryFetchMessage {
  type: 'fetch-telemetry';
  payload?: {
    limit?: number;
  };
}

export interface TelemetryResponseMessage {
  type: 'telemetry-response';
  payload: TabTelemetryRecord[];
}

export interface ReminderDecisionMessage {
  type: 'reminder-decision';
  tabId: number;
  action: SleepAction;
  proceed: boolean;
  reason: TabTelemetryRecord['reason'];
  memoryUsageMb?: number;
}

export interface ManualActionMessage {
  type: 'manual-action';
  tabId: number;
  action: SleepAction;
}

export interface ToggleIgnoreMessage {
  type: 'toggle-ignore-tab';
  tabId: number;
  ignored: boolean;
}

export interface TabStateUpdatedMessage {
  type: 'tab-state-updated';
  tabId: number;
  state: TabState;
}

export interface SleepAllTabsMessage {
  type: 'sleep-all-tabs';
  excludeActive?: boolean;
}

export type RuntimeMessage =
  | SettingsUpdateMessage
  | SettingsRequestMessage
  | TelemetryFetchMessage
  | TelemetryResponseMessage
  | ConsentMessage
  | TabStateRequestMessage
  | ReminderDecisionMessage
  | ManualActionMessage
  | ToggleIgnoreMessage
  | TabStateUpdatedMessage
  | SleepAllTabsMessage;
