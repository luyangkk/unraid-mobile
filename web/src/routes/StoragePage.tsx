import { useStorageSnapshot } from "../app/pageData";
import { useTabPageEntry } from "../app/useTabTransition";
import { LoadingPanel } from "../components/app/LoadingPanel";
import { StoragePanel } from "../features/storage/StoragePanel";

// StoragePage mounts only Storage polling and exposes all existing disk details.
export function StoragePage() {
  useTabPageEntry("/storage");
  const query = useStorageSnapshot();
  return query.data
    ? <StoragePanel snapshot={query.data} stale={query.stale} errorMessage={query.error?.message} />
    : <LoadingPanel title="Storage" message={query.error?.message || "Loading storage…"} />;
}
