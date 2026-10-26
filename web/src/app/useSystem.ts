import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSystem, type SystemSnapshot } from "../lib/api";
import { subscribeSystem } from "../lib/stream";
import { appendPoint, type Connection, type Point } from "../lib/system";
import { appendNetworkPoint, resolveNetwork, type NetworkPoint } from "../lib/network";

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
  const latestTime = useRef(-Infinity);
  const [network, setNetwork] = useState<{
    selection: string | null; name: string; points: NetworkPoint[];
  }>({ selection: null, name: "", points: [] });

  // setNetworkSelection resets and seeds only the chosen interface without reopening SSE.
  const setNetworkSelection = useCallback((selection: string | null) => {
    const current = queryClient.getQueryData<SystemSnapshot>(["system"]);
    setNetwork((previous) => {
      if (selection === previous.selection) return previous;
      const selected = current ? resolveNetwork(current, selection) : null;
      return {
        selection, name: selected?.name ?? "",
        points: current && selected ? appendNetworkPoint([], {
          timestamp: current.timestamp, rx: selected.rxBytesPerSecond, tx: selected.txBytesPerSecond,
        }) : [],
      };
    });
  }, [queryClient]);

  useEffect(() => subscribeSystem({
    snapshot: getSystem,
    page: document,
    onSnapshot: (value) => {
      const time = Date.parse(value.timestamp);
      if (!Number.isFinite(time) || time <= latestTime.current) return;
      latestTime.current = time;
      queryClient.setQueryData(["system"], value);
      setNetwork((previous) => {
        const selected = resolveNetwork(value, previous.selection);
        return {
          ...previous, name: selected.name,
          points: appendNetworkPoint(previous.name === selected.name ? previous.points : [], {
            timestamp: value.timestamp, rx: selected.rxBytesPerSecond, tx: selected.txBytesPerSecond,
          }),
        };
      });
      if (value.available) {
        setPoints((previous) => appendPoint(previous, {
          timestamp: value.timestamp, value: value.cpuUsage,
        }));
      } else setPoints([]);
    },
    onConnection: setConnection,
    onError: setError,
  }), [queryClient, revision]);
  return {
    snapshot, connection, points, error, refresh: () => setRevision((value) => value + 1),
    networkSelection: network.selection, setNetworkSelection,
    selectedNetwork: snapshot ? resolveNetwork(snapshot, network.selection) : null,
    networkPoints: network.points,
  };
}
