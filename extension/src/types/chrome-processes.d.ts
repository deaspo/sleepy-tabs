declare namespace chrome {
  namespace processes {
    interface TaskInformation {
      tabId?: number;
      title?: string;
      processType?: string;
    }

    interface ProcessInformation {
      id?: number;
      osProcessId?: number;
      privateMemory?: number;
      sharedMemory?: number;
      tasks?: TaskInformation[];
    }

    type ProcessesMap = Record<number, ProcessInformation>;

    function getProcessInfo(
      processIds?: number[] | undefined,
      includeMemory?: boolean,
      callback?: (processes: ProcessesMap) => void
    ): void;
  }
}
