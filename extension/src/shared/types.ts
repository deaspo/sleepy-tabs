export type SleepAction = 'sleep' | 'reload';
export type MemoryActionTarget = 'active' | 'inactive';

export interface SleepSettings {
  version: number;
  inactivityTimeoutMinutes: number;
  memoryThresholdMb: number;
  enableAutoSleep: boolean;
  reminderTimeoutSeconds: number;
  autoFocusOnReminder: boolean;
  enableFullPageSampling: boolean;
  enableProcessFallback: boolean;
  processFallbackThresholdMb: number;
  memoryActionForActiveTab: SleepAction;
  memoryActionForInactiveTab: SleepAction;
  memoryPromptForActiveTab: boolean;
  memoryPromptForInactiveTab: boolean;
}

export interface CapabilityReport {
  processFallbackSupported: boolean;
  processFallbackReason?: string;
}

export interface ConsentState {
  accepted: boolean;
  acceptedAt?: number;
}

export type TabMemorySource = 'companion' | 'probe' | 'debugger' | 'processes';

export interface TabState {
  tabId: number;
  windowId?: number;
  url?: string;
  title?: string;
  lastActiveAt: number;
  lastSeenAt: number;
  ignored: boolean;
  pendingReminder?: SleepAction;
  memoryUsageMb?: number;
  totalHeapMb?: number;
  heapLimitMb?: number;
  fullPageMemoryMb?: number;
  memorySource?: TabMemorySource;
  memoryCapturedAt?: number;
  processId?: number;
  processSampledAt?: number;
  processFallbackThresholdMb?: number;
}

export type NativeHostStatus = 'unknown' | 'connecting' | 'connected' | 'disconnected';

export interface TabTelemetryRecord {
  id?: number;
  tabId: number;
  url: string;
  title?: string;
  action: SleepAction;
  memoryUsageMb?: number;
  totalHeapMb?: number;
  heapLimitMb?: number;
  fullPageMemoryMb?: number;
  memorySource?: TabMemorySource;
  memoryCapturedAt?: number;
  processFallbackThresholdMb?: number;
  reason: 'inactivity' | 'memory' | 'manual' | 'timeout';
  timestamp: number;
  critical: boolean;
  memoryThresholdMb?: number;
  memoryTarget?: MemoryActionTarget;
  memoryPrompted?: boolean;
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

export interface TabStatesRequestMessage {
  type: 'request-tab-states';
}

export interface FocusTabMessage {
  type: 'focus-tab';
  tabId: number;
  expectedUrl?: string;
  windowId?: number;
}

export interface FocusTabResponse {
  success: boolean;
  error?: string;
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
  totalHeapMb?: number;
  fullPageMemoryMb?: number;
  heapLimitMb?: number;
  memoryThresholdMb?: number;
  memoryTarget?: MemoryActionTarget;
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

export interface TabMemoryProbeMessage {
  type: 'tab-memory-probe';
  memoryUsageMb: number;
  totalHeapMb?: number;
  heapLimitMb?: number;
  fullPageMemoryMb?: number;
  source: TabMemorySource;
}

export interface TabMemorySample {
  memoryUsageMb?: number;
  totalHeapMb?: number;
  heapLimitMb?: number;
  fullPageMemoryMb?: number;
  source: TabMemorySource;
  processId?: number;
}

export interface TabStateUpdatedMessage {
  type: 'tab-state-updated';
  tabId: number;
  state: TabState;
}

export interface SleepAllTabsMessage {
  type: 'sleep-all-tabs';
  excludeActive?: boolean;
  excludeTabId?: number;
}

export interface NativeHostStatusMessage {
  type: 'native-host-status';
  status: NativeHostStatus;
}

export interface CapabilitiesRequestMessage {
  type: 'request-capabilities';
}

export interface PingMessage {
  type: 'ping';
}

export type RuntimeMessage =
  | SettingsUpdateMessage
  | SettingsRequestMessage
  | TelemetryFetchMessage
  | TelemetryResponseMessage
  | ConsentMessage
  | TabStateRequestMessage
  | TabStatesRequestMessage
  | FocusTabMessage
  | ReminderDecisionMessage
  | ManualActionMessage
  | ToggleIgnoreMessage
  | TabStateUpdatedMessage
  | SleepAllTabsMessage
  | NativeHostStatusMessage
  | TabMemoryProbeMessage
  | CapabilitiesRequestMessage
  | PingMessage;
