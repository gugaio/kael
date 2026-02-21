import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type LiveResource = "health" | "jobs" | "schedules" | "plans" | "approvals" | "exec_sessions";

type LiveSyncEvent = {
  type: "sync";
  at: string;
  seq: number;
  changed: LiveResource[];
  summary: {
    jobs: number;
    plans: number;
    schedules: number;
    approvals: number;
    execSessions: number;
  };
};

type LiveStatus = {
  connected: boolean;
  mode: "sse" | "polling";
  lastEventAt: string | null;
};

function invalidateByResource(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  resource: LiveResource;
}): void {
  const { queryClient, resource } = params;
  if (resource === "health") {
    void queryClient.invalidateQueries({ queryKey: ["health"] });
    return;
  }
  if (resource === "jobs") {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["job"] }),
      queryClient.invalidateQueries({ queryKey: ["job-log"] }),
    ]);
    return;
  }
  if (resource === "schedules") {
    void queryClient.invalidateQueries({ queryKey: ["schedules"] });
    return;
  }
  if (resource === "plans") {
    void queryClient.invalidateQueries({ queryKey: ["plans"] });
    void queryClient.invalidateQueries({ queryKey: ["plan"] });
    return;
  }
  if (resource === "exec_sessions") {
    void queryClient.invalidateQueries({ queryKey: ["exec-sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["exec-session-log"] });
    return;
  }
  void queryClient.invalidateQueries({ queryKey: ["exec-approvals-open"] });
}

export function useLiveEvents(): LiveStatus {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");

    source.addEventListener("open", () => {
      setConnected(true);
    });

    source.addEventListener("error", () => {
      setConnected(false);
    });

    source.addEventListener("sync", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as LiveSyncEvent;
        setConnected(true);
        setLastEventAt(payload.at);
        for (const resource of payload.changed) {
          invalidateByResource({ queryClient, resource });
        }
      } catch {
        // ignore malformed events
      }
    });

    source.addEventListener("ping", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { at?: string };
        setConnected(true);
        if (typeof payload.at === "string") {
          setLastEventAt(payload.at);
        }
      } catch {
        // ignore malformed events
      }
    });

    return () => {
      source.close();
    };
  }, [queryClient]);

  useEffect(() => {
    if (connected) {
      return;
    }
    const timer = window.setInterval(() => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["health"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["plans"] }),
        queryClient.invalidateQueries({ queryKey: ["schedules"] }),
        queryClient.invalidateQueries({ queryKey: ["exec-approvals-open"] }),
        queryClient.invalidateQueries({ queryKey: ["exec-sessions"] }),
      ]);
    }, 7_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [connected, queryClient]);

  return {
    connected,
    mode: connected ? "sse" : "polling",
    lastEventAt,
  };
}
