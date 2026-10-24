import { useEffect, useState } from "react";
import { Icon } from "@ream/ui";

const modes = ["system", "light", "dark"] as const;
type Mode = (typeof modes)[number];
const icon: Record<Mode, string> = {
  system: "monitor",
  light: "sun",
  dark: "moon",
};

const saved = (): Mode => {
  try {
    const v = localStorage.getItem("ream-theme") as Mode;
    return modes.includes(v) ? v : "system";
  } catch {
    return "system";
  }
};

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(saved);
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = mode;
    try {
      localStorage.setItem("ream-theme", mode);
    } catch {
      /* storage blocked */
    }
  }, [mode]);
  const next = modes[(modes.indexOf(mode) + 1) % modes.length];
  return (
    <button
      onClick={() => setMode(next)}
      aria-label={`Theme: ${mode}. Switch to ${next}`}
      className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Icon name={icon[mode]} className="size-[18px]" />
    </button>
  );
}
