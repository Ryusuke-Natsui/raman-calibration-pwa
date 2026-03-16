import { movingAverage } from "./utils.js";

export function detectPeaks(rows, options = {}) {
  const x = rows.map((r) => r.x);
  const y = rows.map((r) => r.y);

  const smoothingWindow = options.smoothingWindow ?? 5;
  const prominenceWindow = options.prominenceWindow ?? 10;
  const ySmooth = movingAverage(y, smoothingWindow);

  const yMin = Math.min(...ySmooth);
  const yMax = Math.max(...ySmooth);
  const autoProminence = Math.max(5, 0.02 * (yMax - yMin));
  const minProminence = Number.isFinite(options.minProminence) ? options.minProminence : autoProminence;

  const peaks = [];
  for (let i = 1; i < ySmooth.length - 1; i += 1) {
    if (!(ySmooth[i] > ySmooth[i - 1] && ySmooth[i] >= ySmooth[i + 1])) continue;

    const leftStart = Math.max(0, i - prominenceWindow);
    const rightEnd = Math.min(ySmooth.length, i + prominenceWindow + 1);

    const leftMin = Math.min(...ySmooth.slice(leftStart, i));
    const rightMin = Math.min(...ySmooth.slice(i + 1, rightEnd));
    const prominence = ySmooth[i] - Math.max(leftMin, rightMin);

    if (prominence >= minProminence) {
      peaks.push({
        index: i,
        x: x[i],
        y: y[i],
        ySmooth: ySmooth[i],
        prominence,
      });
    }
  }

  peaks.sort((a, b) => b.prominence - a.prominence || b.y - a.y);
  return {
    peaks,
    ySmooth,
    minProminence,
  };
}
