export function parseDelimitedTable(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[\t,;\s]+/).filter(Boolean);
    if (parts.length < 2) continue;

    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    rows.push({ x, y });
  }

  return rows;
}

export function parseLampCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(",").map((s) => s.trim());
  const idxWavelength = header.indexOf("Wavelength_nm");
  const idxLamp = header.indexOf("Lamp");
  const idxAbs = header.indexOf("Abs. Wavenumber_cm^-1");

  if (idxWavelength === -1 || idxLamp === -1 || idxAbs === -1) {
    throw new Error("Lamp CSV must contain Wavelength_nm, Lamp, and Abs. Wavenumber_cm^-1 columns.");
  }

  return lines
    .map((line) => line.split(","))
    .map((parts) => ({
      wavelengthNm: Number(parts[idxWavelength]),
      lamp: String(parts[idxLamp]).trim(),
      absWavenumber: Number(parts[idxAbs]),
    }))
    .filter((row) => Number.isFinite(row.wavelengthNm) && row.lamp && Number.isFinite(row.absWavenumber))
    .sort((a, b) => a.absWavenumber - b.absWavenumber);
}

export function movingAverage(values, windowSize = 5) {
  const w = Math.max(1, Math.floor(windowSize));
  const half = Math.floor(w / 2);
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count += 1;
      }
    }
    return sum / count;
  });
}

export function combinations(items, k) {
  const out = [];
  const n = items.length;
  if (k < 0 || k > n) return out;
  if (k === 0) return [[]];

  function rec(start, chosen) {
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i <= n - (k - chosen.length); i += 1) {
      chosen.push(items[i]);
      rec(i + 1, chosen);
      chosen.pop();
    }
  }

  rec(0, []);
  return out;
}

export function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function rms(values) {
  return Math.sqrt(mean(values.map((v) => v * v)));
}

export function sanitizeLampName(lamp) {
  return lamp.replace(/\(.+?\)/g, "").replace(/[^a-zA-Z0-9_-]+/g, "").trim() || "Lamp";
}

export function isValidSuffix(suffix) {
  return !/[<>:"/\\|?*\x00-\x1F]/.test(suffix);
}

export function formatNumber(value, digits = 4) {
  return Number(value).toFixed(digits);
}

export async function readFileText(file) {
  return await file.text();
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function basenameWithoutExt(name) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? name : name.slice(0, idx);
}

export function extname(name) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx);
}
