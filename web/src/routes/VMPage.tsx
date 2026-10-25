import { useVMSnapshot } from "../app/pageData";
import { LoadingPanel } from "../components/app/LoadingPanel";
import { VMPanel } from "../features/vm/VMPanel";

// VMPage mounts only VM polling and keeps stopped and unusual states available.
export function VMPage() {
  const query = useVMSnapshot();
  return query.data
    ? <VMPanel snapshot={query.data} stale={query.stale} errorMessage={query.error?.message} />
    : <LoadingPanel title="VM" message={query.error?.message || "Loading virtual machines…"} />;
}
