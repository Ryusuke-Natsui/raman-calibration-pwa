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
  downloadBlob(filename, blob);
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

export async function createZipBlob(files) {
  const encoder = new TextEncoder();
  const zipParts = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data));
    const checksum = crc32(contentBytes);
    const { dosTime, dosDate } = dosDateTime(file.lastModified ? new Date(file.lastModified) : new Date());

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, contentBytes.length);
    writeUint32(localView, 22, contentBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    zipParts.push(localHeader, contentBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, contentBytes.length);
    writeUint32(centralView, 24, contentBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralDirectory.push(centralHeader);

    offset += localHeader.length + contentBytes.length;
  }

  const centralSize = centralDirectory.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return new Blob([...zipParts, ...centralDirectory, endRecord], { type: "application/zip" });
}

export function basenameWithoutExt(name) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? name : name.slice(0, idx);
}

export function extname(name) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx);
}
