import { detectPeaks } from "./peaks.js";
import { autoMatchPeaks, applyCalibration, evaluatePolynomial } from "./calibration.js";
import { LASER_OPTIONS_NM, convertAbsAxis, laserAbsWavenumberFromNm, outputAxisLabel } from "./units.js";
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

const I18N = {
  en: {
    language: "Language",
    selectFile: "Select File",
    noFileSelected: "No file selected",
    filesSelected: (count) => `${count} files selected`,
  },
  ja: {
    language: "言語",
    selectFile: "ファイルを選択",
    noFileSelected: "ファイルが選択されていません",
    filesSelected: (count) => `${count} 件のファイルを選択中`,
  },
};

let currentLang = "en";

const els = {
  lampDbFileInput: document.getElementById("lampDbFileInput"),
  loadDefaultLampDbBtn: document.getElementById("loadDefaultLampDbBtn"),
  lampDbStatus: document.getElementById("lampDbStatus"),
  lampSelect: document.getElementById("lampSelect"),
  fitDegreeSelect: document.getElementById("fitDegreeSelect"),
  laserSelect: document.getElementById("laserSelect"),
  customLaserInput: document.getElementById("customLaserInput"),
  inputAxisModeSelect: document.getElementById("inputAxisModeSelect"),
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
  languageSelect: document.getElementById("languageSelect"),
  lampDbFileStatus: document.getElementById("lampDbFileStatus"),
  calibrationFileStatus: document.getElementById("calibrationFileStatus"),
  measurementFilesStatus: document.getElementById("measurementFilesStatus"),
};

init();

async function init() {
  populateLaserOptions();
  wireEvents();
  applyLanguage("en");
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
    setStatus("Bundled example file: `examples/20260205_Ne_example.txt`. If you upload this app to GitHub, include the `examples` folder as well.");
  });
  els.languageSelect.addEventListener("change", (event) => {
    applyLanguage(event.target.value);
  });
  els.lampDbFileInput.addEventListener("change", () => updateFileStatus(els.lampDbFileInput, els.lampDbFileStatus));
  els.calibrationFileInput.addEventListener("change", () => updateFileStatus(els.calibrationFileInput, els.calibrationFileStatus));
  els.measurementFilesInput.addEventListener("change", () => updateFileStatus(els.measurementFilesInput, els.measurementFilesStatus));
}

function t(key, ...args) {
  const table = I18N[currentLang] || I18N.en;
  const val = table[key] ?? I18N.en[key];
  return typeof val === "function" ? val(...args) : val;
}

function applyLanguage(lang) {
  currentLang = I18N[lang] ? lang : "en";
  document.documentElement.lang = currentLang;
  els.languageSelect.value = currentLang;

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    node.textContent = t(key);
  });

  updateFileStatus(els.lampDbFileInput, els.lampDbFileStatus);
  updateFileStatus(els.calibrationFileInput, els.calibrationFileStatus);
  updateFileStatus(els.measurementFilesInput, els.measurementFilesStatus);
}

function updateFileStatus(inputEl, statusEl) {
  const count = inputEl.files?.length || 0;
  if (count === 0) {
    statusEl.textContent = t("noFileSelected");
    return;
  }
  if (count === 1) {
    statusEl.textContent = inputEl.files[0].name;
    return;
  }
  statusEl.textContent = t("filesSelected", count);
}

function convertRowsToAbsInput(rows, inputAxisMode, laserNm) {
  return rows.map((row) => ({
    ...row,
    x: convertInputXToAbs(row.x, inputAxisMode, laserNm),
  }));
}

function convertInputXToAbs(x, inputAxisMode, laserNm) {
  if (inputAxisMode === "raman") {
    return laserAbsWavenumberFromNm(laserNm) - x;
  }
  return x;
}

function inputAxisLabel(inputAxisMode) {
  if (inputAxisMode === "raman") return "Raman shift (cm^-1)";
  return "Absolute wavenumber (cm^-1)";
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
  loadLampDbFromText(text, "Loaded bundled CSV");
}

async function onLampDbFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await readFileText(file);
  loadLampDbFromText(text, `Loaded user CSV: ${file.name}`);
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
  setStatus("Lamp reference table is ready.");
}

function getSelectedLaserNm() {
  if (els.laserSelect.value === "custom") {
    const custom = Number(els.customLaserInput.value);
    if (!Number.isFinite(custom) || custom <= 0) {
      throw new Error("Please enter a custom laser wavelength.");
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
    els.suffixWarning.textContent = "The suffix contains invalid filename characters: < > : \" / \\ | ? *";
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
    setStatus("Running calibration...");

    const calibrationFile = els.calibrationFileInput.files[0];
    const measurementFiles = [...els.measurementFilesInput.files];

    const calibrationRows = parseDelimitedTable(await readFileText(calibrationFile));
    if (calibrationRows.length < 3) {
      throw new Error("Could not read enough data points from the calibration file.");
    }

    const degree = Number(els.fitDegreeSelect.value);
    const lamp = els.lampSelect.value;
    const laserNm = getSelectedLaserNm();
    const inputAxisMode = els.inputAxisModeSelect.value;
    const outputMode = els.outputModeSelect.value;

    const detectOptions = {
      smoothingWindow: Number(els.smoothingWindowInput.value) || 5,
      prominenceWindow: Number(els.prominenceWindowInput.value) || 10,
      minProminence: els.minProminenceInput.value === "" ? undefined : Number(els.minProminenceInput.value),
    };

    const calibrationRowsForFit = convertRowsToAbsInput(calibrationRows, inputAxisMode, laserNm);

    const peakResult = detectPeaks(calibrationRowsForFit, detectOptions);
    const xValues = calibrationRowsForFit.map((r) => r.x);
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
      inputAxisMode,
      outputMode,
      coeffs: match.coeffs,
      rmsError: match.rmsError,
      matchedPeaks: match.measuredPeaks,
      referenceLines: match.referenceLines,
      residuals: match.residuals,
      calibrationRows: calibrationRowsForFit,
      peakResult,
    };

    renderPlot({
      rows: calibrationRowsForFit,
      peakResult,
      matchedPeaks: match.measuredPeaks,
      matchedLines: match.referenceLines,
    });

    renderSummary(state.lastCalibration);
    renderMatchTable(state.lastCalibration);
    renderDownloads(measurementFiles);

    setStatus(`Done: ${lamp} / degree ${degree} / RMS = ${formatNumber(match.rmsError, 4)} cm^-1`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Processing failed.", true);
  }
}

function validateBeforeRun() {
  if (!state.lampDb.length) throw new Error("Please load a lamp reference table.");
  if (!els.calibrationFileInput.files?.length) throw new Error("Please select a calibration text file.");
  if (!els.measurementFilesInput.files?.length) throw new Error("Please select one or more measurement files.");
  if (!validateSuffix()) throw new Error("Please fix the output filename suffix.");
}

function renderSummary(cal) {
  const coeffText = cal.coeffs.map((c) => formatNumber(c, 8)).join(", ");
  const metrics = [
    ["Lamp", cal.lamp],
    ["Model", `${cal.degree} order`],
    ["Laser", `${formatNumber(cal.laserNm, 2)} nm`],
    ["Input axis", inputAxisLabel(cal.inputAxisMode)],
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
    btn.textContent = "Download";
    btn.addEventListener("click", async () => {
      const text = await readFileText(file);
      const rows = parseDelimitedTable(text);
      const inputX = rows.map((r) => convertInputXToAbs(r.x, state.lastCalibration.inputAxisMode, state.lastCalibration.laserNm));
      const absCalibrated = applyCalibration(state.lastCalibration.coeffs, inputX);
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
