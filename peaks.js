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

  const refinedPeaks = refinePeakCentersQuadratic(rows, peaks, options.refineHalfWindow ?? 3);
  refinedPeaks.sort((a, b) => b.prominence - a.prominence || b.y - a.y);

  return {
    peaks: refinedPeaks,
    ySmooth,
    minProminence,
  };
}

function refinePeakCentersQuadratic(rows, peaks, halfWindow = 3) {
  const hw = Math.max(1, Math.floor(halfWindow));
  const x = rows.map((r) => r.x);
  const y = rows.map((r) => r.y);

  return peaks.map((peak) => {
    const start = Math.max(0, peak.index - hw);
    const end = Math.min(rows.length - 1, peak.index + hw);
    const xs = [];
    const ys = [];

    for (let i = start; i <= end; i += 1) {
      xs.push(x[i]);
      ys.push(y[i]);
    }

    if (xs.length < 3) return peak;

    const fit = quadraticLeastSquares(xs, ys);
    if (!fit) return peak;

    const { a, b, c } = fit;
    if (!Number.isFinite(a) || Math.abs(a) < 1e-12 || !Number.isFinite(b) || !Number.isFinite(c)) return peak;

    const xCenter = -b / (2 * a);
    const xLo = xs[0];
    const xHi = xs[xs.length - 1];
    if (!Number.isFinite(xCenter) || xCenter < xLo || xCenter > xHi) return peak;

    const yCenter = a * xCenter * xCenter + b * xCenter + c;
    if (!Number.isFinite(yCenter)) return peak;

    return {
      ...peak,
      xRaw: peak.x,
      yRaw: peak.y,
      x: xCenter,
      y: yCenter,
      fitWindowStartIndex: start,
      fitWindowEndIndex: end,
    };
  });
}

function quadraticLeastSquares(xs, ys) {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;

  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i];
    const y = ys[i];
    const x2 = x * x;

    s0 += 1;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    t0 += y;
    t1 += x * y;
    t2 += x2 * y;
  }

  const A = [
    [s4, s3, s2],
    [s3, s2, s1],
    [s2, s1, s0],
  ];
  const b = [t2, t1, t0];

  const sol = solve3x3(A, b);
  if (!sol) return null;
  return { a: sol[0], b: sol[1], c: sol[2] };
}

function solve3x3(matrix, vector) {
  const A = matrix.map((row, i) => [...row, vector[i]]);
  const n = 3;

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(A[pivotRow][col]) < 1e-12) return null;
    [A[col], A[pivotRow]] = [A[pivotRow], A[col]];

    const pivot = A[col][col];
    for (let c = col; c <= n; c += 1) A[col][c] /= pivot;

    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = A[r][col];
      for (let c = col; c <= n; c += 1) {
        A[r][c] -= factor * A[col][c];
      }
    }
  }

  return A.map((row) => row[n]);
}
