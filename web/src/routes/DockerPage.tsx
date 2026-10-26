import { useDockerSnapshot, usePageData } from "../app/pageData";
import { useTabPageEntry } from "../app/useTabTransition";
import { LoadingPanel } from "../components/app/LoadingPanel";
import { DockerPanel } from "../features/docker/DockerPanel";

// DockerPage mounts only Docker polling and preserves the full read-only panel.
export function DockerPage() {
  useTabPageEntry("/docker");
  const { foreground, online } = usePageData();
  const query = useDockerSnapshot();
  return query.data
    ? <DockerPanel snapshot={query.data} loadIcons={foreground && online} stale={query.stale} errorMessage={query.error?.message} />
    : <LoadingPanel title="Docker" message={query.error?.message || "Loading containers…"} />;
}
