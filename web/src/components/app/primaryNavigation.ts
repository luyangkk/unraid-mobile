import { Box, HardDrive, House, Monitor } from "lucide-react";

export const primaryNavigation = [
  { to: "/", label: "Home", icon: House },
  { to: "/docker", label: "Docker", icon: Box },
  { to: "/vm", label: "VM", icon: Monitor },
  { to: "/storage", label: "Storage", icon: HardDrive },
] as const;
