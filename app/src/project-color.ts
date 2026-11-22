// Projects get a stable, muted colour from their id; nothing extra is stored.
const hues = [
  "#2e6b57",
  "#3d5a99",
  "#8a5a2b",
  "#7a4f8c",
  "#a0562e",
  "#4f7a8c",
  "#8c4f5f",
  "#5f6b3a",
];
export function projectColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return hues[h % hues.length];
}
