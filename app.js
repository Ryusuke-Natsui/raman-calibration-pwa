import { detectPeaks } from "./peaks.js";
import { autoMatchPeaks, applyCalibration, evaluatePolynomial } from "./calibration.js";
import { LASER_OPTIONS_NM, convertAbsAxis, outputAxisLabel } from "./units.js";
import {
  parseDelimitedTable,
  parseLampCsv,
  sanitizeLampName,
  isValidSuffix,
  formatNumber,
  readFileText,
  downloadText,
  basenameWithoutExt,
  extname,
} from "./utils.js";

const state = {
  lampDb: [],
  lampNames: [],
  lastCalibration: null,
};

const els = {
  lampDbFileInput: document.getElementById("lampDbFileInput"),
  loadDefaultLampDbBtn: document.getElementById("loadDefaultLampDbBtn"),
  lampDbStatus: document.getElementById("lampDbStatus"),
  lampSelect: document.getElementById("lampSelect"),
  fitDegreeSelect: document.getElementById("fitDegreeSelect"),
  laserSelect: document.getElementById("laserSelect"),
  customLaserInput: document.getElementById("customLaserInput"),
  outputModeSelect: document.getElementById("outputModeSelect"),
  smoothingWindowInput: document.getElementById("smoothingWindowInput"),
  prominenceWindowInput: document.getElementById("prominenceWindowInput"),
  minProminenceInput: document.getElementById("minProminenceInput"),
  calibrationFileInput: document.getElementById("calibrationFileInput"),
  measurementFilesInput: document.getElementById("measurementFilesInput"),
  suffixInput: document.getElementById("suffixInput"),
  suffixWarning: document.getElementById("suffixWarning"),
  runCalibrationBtn: document.getElementById("runCalibrationBtn"),
  downloadExampleNoteBtn: document.getElementById("downloadExampleNoteBtn"),
  statusBox: document.getElementById("statusBox"),
  plotContainer: document.getElementById("plotContainer"),
  fitSummary: document.getElementById("fitSummary"),
  matchTableBody: document.querySelector("#matchTable tbody"),
  downloadList: document.getElementById("downloadList"),
};

init();

async function init() {
  populateLaserOptions();
  wireEvents();
  registerServiceWorker();
  await loadBundledLampDb();
  setDefaultSuffix();
}

function wireEvents() {
  els.loadDefaultLampDbBtn.addEventListener("click", loadBundledLampDb);
  els.lampDbFileInput.addEventListener("change", onLampDbFileChange);
  els.lampSelect.addEventListener("change", setDefaultSuffix);
  els.suffixInput.addEventListener("input", validateSuffix);
  els.runCalibrationBtn.addEventListener("click", runCalibrationWorkflow);
  els.downloadExampleNoteBtn.addEventListener("click", () => {
    setStatus("同梱の例ファイルは `examples/20260205_Ne_example.txt` にあります。GitHubへ置く場合は examples フォルダも一緒にアップロードしてください。");
  });
}

function populateLaserOptions() {
  els.laserSelect.innerHTML = "";
  for (const nm of LASER_OPTIONS_NM) {
    const opt = document.createElement("option");
    opt.value = String(nm);
    opt.textContent = `${nm} nm`;
    if (nm === 514) opt.selected = true;
    els.laserSelect.appendChild(opt);
  }
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "custom";
  els.laserSelect.appendChild(custom);
}

async function loadBundledLampDb() {
  const res = await fetch("./data/calibration_lamps_data_for_ThomasLab.csv");
  const text = await res.text();
  loadLampDbFromText(text, "同梱CSVを読み込みました");
}

async function onLampDbFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await readFileText(file);
  loadLampDbFromText(text, `ユーザーCSVを読み込みました: ${file.name}`);
}

function loadLampDbFromText(text, message) {
  state.lampDb = parseLampCsv(text);
  state.lampNames = [...new Set(state.lampDb.map((row) => row.lamp))];
  els.lampSelect.innerHTML = "";

  for (const lamp of state.lampNames) {
    const opt = document.createElement("option");
    opt.value = lamp;
    opt.textContent = lamp;
    els.lampSelect.appendChild(opt);
  }

  const neOption = state.lampNames.find((name) => name.startsWith("Ne"));
  if (neOption) els.lampSelect.value = neOption;

  els.lampDbStatus.textContent = `${message} / ${state.lampDb.length} lines / lamps: ${state.lampNames.join(", ")}`;
  setDefaultSuffix();
  setStatus("ランプ参照テーブルを準備しました。");
}

function getSelectedLaserNm() {
  if (els.laserSelect.value === "custom") {
    const custom = Number(els.customLaserInput.value);
    if (!Number.isFinite(custom) || custom <= 0) {
      throw new Error("custom laser wavelength を入力してください。");
    }
    return custom;
  }
  return Number(els.laserSelect.value);
}

function setDefaultSuffix() {
  const lamp = els.lampSelect.value;
  if (!lamp) return;
  els.suffixInput.value = `-clb_${sanitizeLampName(lamp)}`;
  validateSuffix();
}

function validateSuffix() {
  const suffix = els.suffixInput.value.trim();
  if (!isValidSuffix(suffix)) {
    els.suffixWarning.textContent = "ファイル名に使えない文字が含まれています: < > : \" / \\ | ? *";
    return false;
  }
  els.suffixWarning.textContent = "";
  return true;
}

function setStatus(message, isError = false) {
  els.statusBox.textContent = message;
  els.statusBox.style.borderColor = isError ? "var(--danger)" : "var(--line)";
}

async function runCalibrationWorkflow() {
  try {
    validateBeforeRun();
    setStatus("キャリブレーションを実行中...");

    const calibrationFile = els.calibrationFileInput.files[0];
    const measurementFiles = [...els.measurementFilesInput.files];

    const calibrationRows = parseDelimitedTable(await readFileText(calibrationFile));
    if (calibrationRows.length < 3) {
      throw new Error("キャリブレーションファイルから十分なデータ点を読み込めませんでした。");
    }

    const degree = Number(els.fitDegreeSelect.value);
    const lamp = els.lampSelect.value;
    const laserNm = getSelectedLaserNm();
    const outputMode = els.outputModeSelect.value;

    const detectOptions = {
      smoothingWindow: Number(els.smoothingWindowInput.value) || 5,
      prominenceWindow: Number(els.prominenceWindowInput.value) || 10,
      minProminence: els.minProminenceInput.value === "" ? undefined : Number(els.minProminenceInput.value),
    };

    const peakResult = detectPeaks(calibrationRows, detectOptions);
    const xValues = calibrationRows.map((r) => r.x);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);

    const referenceLines = state.lampDb.filter((row) => row.lamp === lamp);
    const match = autoMatchPeaks({
      detectedPeaks: peakResult.peaks,
      referenceLines,
      degree,
      xMin,
      xMax,
    });

    state.lastCalibration = {
      degree,
      lamp,
      laserNm,
      outputMode,
      coeffs: match.coeffs,
      rmsError: match.rmsError,
      matchedPeaks: match.measuredPeaks,
      referenceLines: match.referenceLines,
      residuals: match.residuals,
      calibrationRows,
      peakResult,
    };

    renderPlot({
      rows: calibrationRows,
      peakResult,
      matchedPeaks: match.measuredPeaks,
      matchedLines: match.referenceLines,
    });

    renderSummary(state.lastCalibration);
    renderMatchTable(state.lastCalibration);
    renderDownloads(measurementFiles);

    setStatus(`完了: ${lamp} / ${degree}次 / RMS = ${formatNumber(match.rmsError, 4)} cm^-1`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "処理に失敗しました。", true);
  }
}

function validateBeforeRun() {
  if (!state.lampDb.length) throw new Error("ランプ参照テーブルを読み込んでください。");
  if (!els.calibrationFileInput.files?.length) throw new Error("キャリブレーション用テキストを選択してください。");
  if (!els.measurementFilesInput.files?.length) throw new Error("測定ファイルを1つ以上選択してください。");
  if (!validateSuffix()) throw new Error("出力ファイル名末尾を修正してください。");
}

function renderSummary(cal) {
  const coeffText = cal.coeffs.map((c) => formatNumber(c, 8)).join(", ");
  const metrics = [
    ["Lamp", cal.lamp],
    ["Model", `${cal.degree}次式`],
    ["Laser", `${formatNumber(cal.laserNm, 2)} nm`],
    ["Output", outputAxisLabel(cal.outputMode)],
    ["Matched peaks", String(cal.matchedPeaks.length)],
    ["RMS", `${formatNumber(cal.rmsError, 5)} cm^-1`],
    ["Coefficients", coeffText],
    ["Detected peaks", String(cal.peakResult.peaks.length)],
  ];

  els.fitSummary.innerHTML = metrics.map(([label, value]) => `
    <div class="metric">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value ${label === "Coefficients" ? "code" : ""}">${escapeHtml(value)}</div>
    </div>
  `).join("");
}

function renderMatchTable(cal) {
  els.matchTableBody.innerHTML = cal.matchedPeaks.map((peak, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${formatNumber(peak.x, 4)}</td>
      <td>${formatNumber(cal.referenceLines[i].absWavenumber, 4)}</td>
      <td>${formatNumber(cal.referenceLines[i].wavelengthNm, 4)}</td>
      <td>${formatNumber(cal.residuals[i], 4)}</td>
    </tr>
  `).join("");
}

function renderDownloads(files) {
  els.downloadList.innerHTML = "";
  if (!state.lastCalibration) return;

  const suffix = els.suffixInput.value.trim();
  for (const file of files) {
    const item = document.createElement("div");
    item.className = "download-item";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <div class="name">${escapeHtml(file.name)}</div>
      <div class="muted">suffix: <span class="code">${escapeHtml(suffix)}</span></div>
    `;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "ダウンロード";
    btn.addEventListener("click", async () => {
      const text = await readFileText(file);
      const rows = parseDelimitedTable(text);
      const absCalibrated = applyCalibration(state.lastCalibration.coeffs, rows.map((r) => r.x));
      const converted = convertAbsAxis(absCalibrated, state.lastCalibration.outputMode, state.lastCalibration.laserNm);
      const out = converted.map((x, i) => `${x}\t${rows[i].y}`).join("\n") + "\n";

      const filename = `${basenameWithoutExt(file.name)}${suffix}${extname(file.name) || ".txt"}`;
      downloadText(filename, out);
    });

    item.appendChild(meta);
    item.appendChild(btn);
    els.downloadList.appendChild(item);
  }
}

function renderPlot({ rows, peakResult, matchedPeaks, matchedLines }) {
  const width = 1100;
  const height = 340;
  const margin = { top: 20, right: 20, bottom: 36, left: 62 };

  const x = rows.map((r) => r.x);
  const y = rows.map((r) => r.y);
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  const yMin = Math.min(...y);
  const yMax = Math.max(...y);

  const sx = (v) => margin.left + ((v - xMin) / (xMax - xMin || 1)) * (width - margin.left - margin.right);
  const sy = (v) => height - margin.bottom - ((v - yMin) / (yMax - yMin || 1)) * (height - margin.top - margin.bottom);

  const path = rows.map((r, i) => `${i === 0 ? "M" : "L"} ${sx(r.x).toFixed(2)} ${sy(r.y).toFixed(2)}`).join(" ");

  const peakDots = peakResult.peaks.slice(0, 18).map((p) =>
    `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3.5" fill="#f87171"><title>x=${formatNumber(p.x, 3)}, prom=${formatNumber(p.prominence, 2)}</title></circle>`
  ).join("");

  const matchedPeakDots = matchedPeaks.map((p) =>
    `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5.5" fill="#f59e0b" stroke="#fff" stroke-width="1"><title>matched peak ${formatNumber(p.x, 3)}</title></circle>`
  ).join("");

  const lineMarkers = matchedLines.map((line) => {
    const cx = sx(line.absWavenumber);
    return `
      <line x1="${cx}" y1="${margin.top}" x2="${cx}" y2="${height - margin.bottom}" stroke="#34d399" stroke-width="1.4" stroke-dasharray="4 4" />
      <text x="${cx + 4}" y="${margin.top + 16}" fill="#34d399" font-size="11">${formatNumber(line.absWavenumber, 1)}</text>
    `;
  }).join("");

  const axis = `
    <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#64748b" />
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#64748b" />
    <text x="${width / 2}" y="${height - 8}" text-anchor="middle" fill="#94a3b8" font-size="12">Measured x-axis</text>
    <text x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})" fill="#94a3b8" font-size="12">Intensity</text>
  `;

  els.plotContainer.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="spectrum plot">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
      ${axis}
      ${lineMarkers}
      <path d="${path}" fill="none" stroke="#60a5fa" stroke-width="1.5" />
      ${peakDots}
      ${matchedPeakDots}
    </svg>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    });
  }
}
