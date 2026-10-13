// GPS fixes worse than this (in metres) are too vague to interpolate from.
export const MAX_ACCURACY_M = 50;

const SCALE = [
  [173, 216, 230], // light blue - shallow
  [135, 206, 250],
  [100, 149, 237],
  [65, 105, 225],
  [0, 0, 205],
  [0, 0, 139],
  [25, 25, 112]    // midnight blue - deepest
];

export function getDepthColor(depth, maxDepth) {
  const span = maxDepth > 0 ? maxDepth : 1;
  const ratio = Math.min(Math.max(depth / span, 0), 1);
  const idx = Math.min(Math.floor(ratio * (SCALE.length - 1)), SCALE.length - 2);
  const t = ratio * (SCALE.length - 1) - idx;
  const mix = (i) => Math.round(SCALE[idx][i] + t * (SCALE[idx + 1][i] - SCALE[idx][i]));
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

export function formatDepth(depth) {
  return Number(depth).toFixed(1);
}
