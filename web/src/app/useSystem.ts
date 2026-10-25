import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSystem, type SystemSnapshot } from "../lib/api";
import { subscribeSystem } from "../lib/stream";
import { appendPoint, type Connection, type Point } from "../lib/system";

// useSystem keeps one subscription and the in-memory trend above all page routes.
export function useSystem() {
  const queryClient = useQueryClient();
  const { data: snapshot } = useQuery<SystemSnapshot>({
    queryKey: ["system"], queryFn: ({ signal }) => getSystem(signal), enabled: false,
  });
  const [connection, setConnection] = useState<Connection>("connecting");
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeSystem({
    snapshot: getSystem,
    page: document,
    onSnapshot: (value) => {
      queryClient.setQueryData(["system"], value);
      if (value.available && value.cpuUsage !== null) {
        setPoints((previous) => appendPoint(previous, {
          timestamp: value.timestamp, value: value.cpuUsage!,
        }));
      } else if (!value.available) setPoints([]);
    },
    onConnection: setConnection,
    onError: setError,
  }), [queryClient, revision]);
  return { snapshot, connection, points, error, refresh: () => setRevision((value) => value + 1) };
}
