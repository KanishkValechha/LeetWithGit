declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: { id?: number };
      url?: string;
    }

    interface Message {
      type?: unknown;
      payload?: unknown;
    }

    const onMessage: {
      addListener(
        listener: (
          message: Message,
          sender: MessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    const onInstalled: { addListener(listener: () => void): void };
    const onStartup: { addListener(listener: () => void): void };
    function sendMessage(message: Message): Promise<unknown>;
  }

  namespace storage {
    interface StorageArea<T extends object> {
      get<K extends keyof T>(keys?: K | K[] | null): Promise<Partial<T>>;
      set(items: Partial<T>): Promise<void>;
      remove(keys: keyof T | Array<keyof T>): Promise<void>;
    }

    const local: StorageArea<LocalExtensionData>;
    const sync: StorageArea<SyncedExtensionData>;
    const onChanged: {
      addListener(
        listener: (
          changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
          areaName: "sync" | "local" | "managed",
        ) => void,
      ): void;
    };
  }

  namespace tabs {
    interface Tab {
      url?: string;
    }
    const onUpdated: {
      addListener(
        listener: (tabId: number, changeInfo: { status?: string }, tab: Tab) => void,
      ): void;
    };
  }

  namespace scripting {
    function executeScript(injection: {
      target: { tabId: number };
      world: "MAIN" | "ISOLATED";
      func: (...args: never[]) => void;
    }): Promise<unknown[]>;
  }

  namespace alarms {
    const onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
    function create(name: string, alarmInfo: { when?: number }): void;
    function clear(name: string): Promise<boolean>;
  }

  namespace notifications {
    function create(options: {
      type: "basic";
      iconUrl: string;
      title: string;
      message: string;
    }): Promise<string>;
  }
}
