import { Box, Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getDockerIcon, getFolderIcon, type DockerContainer } from "../../lib/api";
import { subscribeAuthChange } from "../../lib/auth";

type IconItem = Pick<DockerContainer, "id" | "iconVersion"> & { folder?: boolean; iconUrl?: string };

// ContainerIcon supports authenticated cached PNGs and configured HTTPS folder icons.
export function ContainerIcon({ container, enabled }: { container: IconItem; enabled: boolean }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-text-muted" aria-hidden="true">
      {container.iconVersion || (container.folder && container.iconUrl)
        ? <PNGIcon key={`${container.id}:${container.iconVersion || container.iconUrl}`} id={container.id}
            version={container.iconVersion ?? ""} source={container.iconVersion ? undefined : container.iconUrl}
            folder={container.folder} enabled={enabled} />
        : <FallbackIcon folder={container.folder} />}
    </span>
  );
}

function FallbackIcon({ folder }: { folder?: boolean }) {
  return folder ? <Folder className="size-5" /> : <Box className="size-5" />;
}

// PNGIcon owns one cancellable request and one temporary object URL per source.
function PNGIcon({ id, version, source, folder, enabled }: {
  id: string; version: string; source?: string; folder?: boolean; enabled: boolean;
}) {
  const [result, setResult] = useState<{ src: string | null } | null>(null);
  const objectURL = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || result !== null) return;
    const controller = new AbortController();
    let active = true;
    const cancel = () => { active = false; controller.abort(); };
    const unsubscribe = subscribeAuthChange(cancel);
    const request = source ? getFolderIcon(source, controller.signal) : getDockerIcon(id, version, controller.signal);
    void request.then((blob) => {
      if (active) {
        objectURL.current = blob ? URL.createObjectURL(blob) : null;
        setResult({ src: objectURL.current });
      }
    }).catch(() => {
      if (active) setResult({ src: null });
    });
    return () => { cancel(); unsubscribe(); };
  }, [id, version, source, enabled, result]);
  useEffect(() => () => { if (objectURL.current) URL.revokeObjectURL(objectURL.current); }, []);
  return result?.src
    ? <img src={result.src} alt="" className="size-8 object-contain" onError={() => {
      if (objectURL.current) URL.revokeObjectURL(objectURL.current);
      objectURL.current = null;
      setResult({ src: null });
    }} />
    : <FallbackIcon folder={folder} />;
}
