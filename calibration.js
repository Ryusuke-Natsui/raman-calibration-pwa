import { combinations, mean, rms } from "./utils.js";

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const A = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(A[pivotRow][col]) < 1e-12) {
      throw new Error("Singular system while fitting calibration polynomial.");
    }
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

export function fitPolynomial(xValues, yValues, degree) {
  if (xValues.length !== yValues.length) {
    throw new Error("x/y length mismatch.");
  }
  if (xValues.length < degree + 1) {
    throw new Error("Not enough points for selected polynomial degree.");
  }

  const m = degree + 1;
  const XtX = Array.from({ length: m }, () => Array(m).fill(0));
  const Xty = Array(m).fill(0);

  for (let i = 0; i < xValues.length; i += 1) {
    const x = xValues[i];
    const y = yValues[i];
    const powers = Array.from({ length: m }, (_, p) => x ** (degree - p));

    for (let r = 0; r < m; r += 1) {
      Xty[r] += powers[r] * y;
      for (let c = 0; c < m; c += 1) {
        XtX[r][c] += powers[r] * powers[c];
      }
    }
  }

  return solveLinearSystem(XtX, Xty);
}

export function evaluatePolynomial(coeffs, x) {
  return coeffs.reduce((acc, c) => acc * x + c, 0);
}

export function applyCalibration(coeffs, xValues) {
  return xValues.map((x) => evaluatePolynomial(coeffs, x));
}

export function derivativeIsPositive(coeffs, xMin, xMax) {
  if (coeffs.length === 1) return true;
  if (coeffs.length === 2) return coeffs[0] > 0;
  const [a, b] = coeffs;
  const d1 = 2 * a * xMin + b;
  const d2 = 2 * a * xMax + b;
  return d1 > 0 && d2 > 0;
}

export function fitCalibrationFromPeaks(measuredPeaks, referenceLines, degree) {
  const xMeasured = measuredPeaks.map((p) => p.x);
  const yReference = referenceLines.map((r) => r.absWavenumber);
  const coeffs = fitPolynomial(xMeasured, yReference, degree);
  const residuals = xMeasured.map((x, i) => evaluatePolynomial(coeffs, x) - yReference[i]);
  return {
    coeffs,
    rmsError: rms(residuals),
    residuals,
  };
}

export function autoMatchPeaks({
  detectedPeaks,
  referenceLines,
  degree,
  xMin,
  xMax,
  maxMeasuredCandidates = 10,
  maxMatchedPeaks = 6,
}) {
  const inRangeLines = referenceLines
    .filter((line) => line.absWavenumber >= xMin - 50 && line.absWavenumber <= xMax + 50)
    .sort((a, b) => a.absWavenumber - b.absWavenumber);

  if (inRangeLines.length < degree + 1) {
    throw new Error("Not enough lamp lines fall within the measured x-range.");
  }

  const candidatePeaks = [...detectedPeaks]
    .slice(0, maxMeasuredCandidates)
    .sort((a, b) => a.x - b.x);

  let best = null;
  const maxPairs = Math.min(maxMatchedPeaks, candidatePeaks.length, inRangeLines.length);

  for (let n = maxPairs; n >= degree + 1; n -= 1) {
    const measuredCombos = combinations(candidatePeaks, n);
    const lineCombos = combinations(inRangeLines, n);

    for (const measured of measuredCombos) {
      for (const refs of lineCombos) {
        try {
          const fit = fitCalibrationFromPeaks(measured, refs, degree);
          if (!derivativeIsPositive(fit.coeffs, xMin, xMax)) continue;

          const transformedMin = evaluatePolynomial(fit.coeffs, xMin);
          const transformedMax = evaluatePolynomial(fit.coeffs, xMax);
          const mappedRangeLooksReasonable =
            Math.abs((transformedMax - transformedMin) - (xMax - xMin)) < Math.max(100, 0.05 * Math.abs(xMax - xMin));

          const identityPenalty =
            coeffsPenalty(fit.coeffs, degree);

          const score = fit.rmsError + identityPenalty + (mappedRangeLooksReasonable ? 0 : 20);

          if (!best || score < best.score) {
            best = {
              score,
              measuredPeaks: measured,
              referenceLines: refs,
              ...fit,
            };
          }
        } catch {
          // ignore failed fits
        }
      }
    }

    if (best) break;
  }

  if (!best) {
    throw new Error("Automatic peak matching failed.");
  }

  return best;
}

function coeffsPenalty(coeffs, degree) {
  if (degree === 0) return 0;
  if (degree === 1) {
    const [a, b] = coeffs;
    return Math.abs(a - 1) * 20 + Math.max(0, Math.abs(b) - 200) * 0.05;
  }
  if (degree === 2) {
    const [a, b, c] = coeffs;
    return Math.abs(a) * 1e6 + Math.abs(b - 1) * 20 + Math.max(0, Math.abs(c) - 500) * 0.05;
  }
  return 0;
}
