import { Box } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getDockerIcon, type DockerContainer } from "../../lib/api";
import { subscribeAuthChange } from "../../lib/auth";

// ContainerIcon accepts only server-issued versions, never metadata paths or URLs.
export function ContainerIcon({ container, enabled }: { container: DockerContainer; enabled: boolean }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-text-muted" aria-hidden="true">
      {container.iconVersion
        ? <PNGIcon key={`${container.id}:${container.iconVersion}`} id={container.id} version={container.iconVersion} enabled={enabled} />
        : <Box className="size-5" />}
    </span>
  );
}

// PNGIcon owns one cancellable request and one temporary object URL per version.
function PNGIcon({ id, version, enabled }: { id: string; version: string; enabled: boolean }) {
  const [result, setResult] = useState<{ src: string | null } | null>(null);
  const objectURL = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || result !== null) return;
    const controller = new AbortController();
    let active = true;
    const cancel = () => { active = false; controller.abort(); };
    const unsubscribe = subscribeAuthChange(cancel);
    void getDockerIcon(id, version, controller.signal).then((blob) => {
      if (active) {
        objectURL.current = blob ? URL.createObjectURL(blob) : null;
        setResult({ src: objectURL.current });
      }
    }).catch(() => {
      if (active) setResult({ src: null });
    });
    return () => { cancel(); unsubscribe(); };
  }, [id, version, enabled, result]);
  useEffect(() => () => { if (objectURL.current) URL.revokeObjectURL(objectURL.current); }, []);
  return result?.src
    ? <img src={result.src} alt="" className="size-8 object-contain" onError={() => {
      if (objectURL.current) URL.revokeObjectURL(objectURL.current);
      objectURL.current = null;
      setResult({ src: null });
    }} />
    : <Box className="size-5" />;
}
