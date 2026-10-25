import { useDockerSnapshot } from "../app/pageData";
import { LoadingPanel } from "../components/app/LoadingPanel";
import { DockerPanel } from "../features/docker/DockerPanel";

// DockerPage mounts only Docker polling and preserves the full read-only panel.
export function DockerPage() {
  const query = useDockerSnapshot();
  return query.data
    ? <DockerPanel snapshot={query.data} stale={query.stale} errorMessage={query.error?.message} />
    : <LoadingPanel title="Docker" message={query.error?.message || "Loading containers…"} />;
}
