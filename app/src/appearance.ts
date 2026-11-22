import { readStored } from "./storage";

export const appearanceKey = "todo:appearance";
const defaults = {
  theme: "light",
  density: "comfortable",
  text: "default",
  shortcuts: true,
  motion: "system",
};

export type Appearance = typeof defaults;

export function readAppearance(): Appearance {
  try {
    return { ...defaults, ...JSON.parse(readStored(appearanceKey) ?? "null") };
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
  root.dataset.density = appearance.density;
  root.dataset.text = appearance.text;
  root.dataset.motion = appearance.motion;
  const chromeColor = getComputedStyle(root).getPropertyValue("--sidebar").trim();
  if (chromeColor) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", chromeColor);
}
