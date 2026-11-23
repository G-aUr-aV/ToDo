import { readStored } from "./storage";

export const appearanceKey = "todo:appearance";
const defaults = {
  theme: "light",
  text: "default",
  shortcuts: true,
  motion: "system",
};

export type Appearance = typeof defaults;

export function readAppearance(): Appearance {
  try {
    const saved: Partial<Appearance> = JSON.parse(readStored(appearanceKey) ?? "{}") ?? {};
    return {
      theme: saved.theme ?? defaults.theme,
      text: saved.text ?? defaults.text,
      shortcuts: saved.shortcuts ?? defaults.shortcuts,
      motion: saved.motion ?? defaults.motion,
    };
  } catch {
    return defaults;
  }
}

export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const dark = appearance.theme === "dark" || (
    appearance.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches
  );
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.text = appearance.text;
  root.dataset.motion = appearance.motion;
}
