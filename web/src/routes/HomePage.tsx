import { Link } from "@tanstack/react-router";
import { useTabPageEntry } from "../app/useTabTransition";
import { useDockerSnapshot, usePageData, useStorageSnapshot, useVMSnapshot } from "../app/pageData";
import { LoadingPanel } from "../components/app/LoadingPanel";
import { DockerPanel } from "../features/docker/DockerPanel";
import { VMPanel } from "../features/vm/VMPanel";
import { StoragePanel } from "../features/storage/StoragePanel";
import { SystemPanel } from "../features/system/SystemPanel";

const entryClass = "flex min-h-11 items-center justify-end rounded-lg px-2 text-sm font-medium text-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300";

// HomePage shows complete System telemetry and compact resource overviews.
export function HomePage() {
  useTabPageEntry("/");
  const { system, foreground, online } = usePageData();
  const docker = useDockerSnapshot();
  const vms = useVMSnapshot();
  const storage = useStorageSnapshot();
  const systemStale = !foreground || !online || system.connection !== "live";
  return (
    <div className="grid min-w-0 gap-4">
      <h2 className="text-xl font-semibold">Home</h2>
      {system.snapshot ? (
        <div>
          {systemStale ? <p role="status" className="mb-2 text-xs text-amber-200">Showing the last sample. Sampled <time dateTime={system.snapshot.timestamp}>{system.snapshot.timestamp}</time></p> : null}
          <div className={systemStale ? "opacity-60" : ""}><SystemPanel snapshot={system.snapshot} points={system.points} /></div>
        </div>
      ) : <LoadingPanel title="System" message="Connecting to the server…" />}
      <div>
        {docker.data ? <DockerPanel snapshot={docker.data} overview stale={docker.stale} errorMessage={docker.error?.message} />
          : <LoadingPanel title="Docker" message={docker.error?.message || "Loading containers…"} />}
        <Link to="/docker" className={entryClass}>View all containers →</Link>
      </div>
      <div>
        {vms.data ? <VMPanel snapshot={vms.data} overview stale={vms.stale} errorMessage={vms.error?.message} />
          : <LoadingPanel title="VM" message={vms.error?.message || "Loading virtual machines…"} />}
        <Link to="/vm" className={entryClass}>View all virtual machines →</Link>
      </div>
      <div>
        {storage.data ? <StoragePanel snapshot={storage.data} overview stale={storage.stale} errorMessage={storage.error?.message} />
          : <LoadingPanel title="Storage" message={storage.error?.message || "Loading storage…"} />}
        <Link to="/storage" className={entryClass}>View storage details →</Link>
      </div>
    </div>
  );
}
