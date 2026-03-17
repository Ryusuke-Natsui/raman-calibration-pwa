import { detectPeaks } from "./peaks.js";
import { autoMatchPeaks, applyCalibration, evaluatePolynomial } from "./calibration.js";
import {
  LASER_OPTIONS_NM,
  absWavenumberToRamanShiftCm,
  absWavenumberToWavelengthNm,
  convertAbsAxis,
  laserAbsWavenumberFromNm,
  outputAxisLabel,
} from "./units.js";
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
  peakDetection: null,
  preview: null,
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
  refineHalfWindowInput: document.getElementById("refineHalfWindowInput"),
  calibrationFileInput: document.getElementById("calibrationFileInput"),
  measurementFilesInput: document.getElementById("measurementFilesInput"),
  suffixInput: document.getElementById("suffixInput"),
  suffixWarning: document.getElementById("suffixWarning"),
  detectPeaksBtn: document.getElementById("detectPeaksBtn"),
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
  previewSpectrumModeSelect: document.getElementById("previewSpectrumModeSelect"),
  previewAxisModeSelect: document.getElementById("previewAxisModeSelect"),
  resetZoomBtn: document.getElementById("resetZoomBtn"),
};

init();

async function init() {
  populateLaserOptions();
  wireEvents();
  applyLanguage("en");
  registerServiceWorker();
  await loadBundledLampDb();
  setDefaultSuffix();
  updateCalibrationButtonState();
  updateSpectrumModeControl();
  updateZoomButtonState();
}

function wireEvents() {
  els.loadDefaultLampDbBtn.addEventListener("click", loadBundledLampDb);
  els.lampDbFileInput.addEventListener("change", onLampDbFileChange);
  els.lampSelect.addEventListener("change", () => {
    setDefaultSuffix();
    invalidatePeakDetection("Settings changed. Run peak detection again.");
  });
  els.fitDegreeSelect.addEventListener("change", () => invalidatePeakDetection("Settings changed. Run peak detection again."));
  els.laserSelect.addEventListener("change", () => invalidatePeakDetection("Settings changed. Run peak detection again."));
  els.customLaserInput.addEventListener("input", () => invalidatePeakDetection("Settings changed. Run peak detection again."));
  els.inputAxisModeSelect.addEventListener("change", () => invalidatePeakDetection("Settings changed. Run peak detection again."));
  els.smoothingWindowInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run peak detection again."));
  els.prominenceWindowInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run peak detection again."));
  els.minProminenceInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run peak detection again."));
  els.refineHalfWindowInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run peak detection again."));
  els.calibrationFileInput.addEventListener("change", () => {
    updateFileStatus(els.calibrationFileInput, els.calibrationFileStatus);
    invalidatePeakDetection("Calibration file changed. Run peak detection again.");
  });
  els.suffixInput.addEventListener("input", validateSuffix);
  els.detectPeaksBtn.addEventListener("click", detectPeaksWorkflow);
  els.runCalibrationBtn.addEventListener("click", runCalibrationWorkflow);
  els.downloadExampleNoteBtn.addEventListener("click", () => {
    setStatus("Bundled example file: `examples/20260205_Ne_example.txt`. If you upload this app to GitHub, include the `examples` folder as well.");
  });
  els.languageSelect.addEventListener("change", (event) => {
    applyLanguage(event.target.value);
  });
  els.lampDbFileInput.addEventListener("change", () => updateFileStatus(els.lampDbFileInput, els.lampDbFileStatus));
  els.measurementFilesInput.addEventListener("change", () => updateFileStatus(els.measurementFilesInput, els.measurementFilesStatus));
  els.previewSpectrumModeSelect.addEventListener("change", () => {
    if (!state.preview) return;
    state.preview.zoomRange = null;
    renderPreview();
    updateZoomButtonState();
  });
  els.previewAxisModeSelect.addEventListener("change", () => {
    if (state.preview) {
      state.preview.zoomRange = null;
      renderPreview();
      setStatus("Preview x-axis changed.");
    }
    updateZoomButtonState();
  });
  els.resetZoomBtn.addEventListener("click", () => {
    if (!state.preview) return;
    state.preview.zoomRange = null;
    renderPreview();
    updateZoomButtonState();
  });
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
    if (String(nm) === "514.55") opt.selected = true;
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
  invalidatePeakDetection();
}

async function onLampDbFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await readFileText(file);
  loadLampDbFromText(text, `Loaded user CSV: ${file.name}`);
  invalidatePeakDetection();
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

function updateCalibrationButtonState() {
  els.runCalibrationBtn.disabled = !state.peakDetection;
}

function invalidatePeakDetection(statusMessage = "") {
  state.peakDetection = null;
  updateCalibrationButtonState();
  state.lastCalibration = null;
  state.preview = null;
  els.previewSpectrumModeSelect.value = "raw";
  els.plotContainer.innerHTML = "";
  els.fitSummary.innerHTML = "";
  els.matchTableBody.innerHTML = "";
  els.downloadList.innerHTML = "";
  updateSpectrumModeControl();
  updateZoomButtonState();
  if (statusMessage) setStatus(statusMessage);
}

async function detectPeaksWorkflow() {
  try {
    validateBeforePeakDetection();
    setStatus("Detecting peaks...");

    const calibrationFile = els.calibrationFileInput.files[0];
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
      refineHalfWindow: Math.max(1, Math.floor(Number(els.refineHalfWindowInput.value) || 3)),
    };

    const calibrationRowsForFit = convertRowsToAbsInput(calibrationRows, inputAxisMode, laserNm);
    const peakResult = detectPeaks(calibrationRowsForFit, detectOptions);
    const xValues = calibrationRowsForFit.map((r) => r.x);

    state.peakDetection = {
      degree,
      lamp,
      laserNm,
      inputAxisMode,
      outputMode,
      calibrationRowsForFit,
      peakResult,
      xMin: Math.min(...xValues),
      xMax: Math.max(...xValues),
    };

    state.preview = {
      rows: calibrationRowsForFit,
      peakResult,
      matchedPeaks: [],
      matchedLines: [],
      laserNm,
      calibrationCoeffs: null,
      zoomRange: null,
    };
    renderPreview();

    updateCalibrationButtonState();
    updateSpectrumModeControl();
    setStatus(`Peak detection finished: ${peakResult.peaks.length} peaks. Now run calibration.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Peak detection failed.", true);
  }
}

async function runCalibrationWorkflow() {
  try {
    validateBeforeCalibration();
    setStatus("Running calibration...");

    const measurementFiles = [...els.measurementFilesInput.files];
    const { degree, lamp, laserNm, inputAxisMode, outputMode, calibrationRowsForFit, peakResult, xMin, xMax } = state.peakDetection;

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

    state.preview = {
      rows: calibrationRowsForFit,
      peakResult,
      matchedPeaks: match.measuredPeaks,
      matchedLines: match.referenceLines,
      laserNm,
      calibrationCoeffs: match.coeffs,
      zoomRange: state.preview?.zoomRange || null,
    };
    renderPreview();
    updateSpectrumModeControl();

    renderSummary(state.lastCalibration);
    renderMatchTable(state.lastCalibration);
    renderDownloads(measurementFiles);

    setStatus(`Done: ${lamp} / degree ${degree} / RMS = ${formatNumber(match.rmsError, 4)} cm^-1`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Processing failed.", true);
  }
}

function validateBeforePeakDetection() {
  if (!state.lampDb.length) throw new Error("Please load a lamp reference table.");
  if (!els.calibrationFileInput.files?.length) throw new Error("Please select a calibration text file.");
}

function validateBeforeCalibration() {
  if (!state.peakDetection) throw new Error("Please run peak detection first.");
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

function renderPreview() {
  if (!state.preview) return;
  renderPlot(state.preview);
}

function updateZoomButtonState() {
  els.resetZoomBtn.disabled = !state.preview?.zoomRange;
}

function updateSpectrumModeControl() {
  const hasCalibrated = Boolean(state.preview?.calibrationCoeffs);
  const calibratedOption = els.previewSpectrumModeSelect.querySelector('option[value="calibrated"]');
  if (calibratedOption) calibratedOption.disabled = !hasCalibrated;
  if (!hasCalibrated && els.previewSpectrumModeSelect.value === "calibrated") {
    els.previewSpectrumModeSelect.value = "raw";
  }
}

function convertAbsForPreview(absX, mode, laserNm) {
  if (mode === "raman") return absWavenumberToRamanShiftCm(absX, laserNm);
  if (mode === "wavelength") return absWavenumberToWavelengthNm(absX);
  return absX;
}

function previewAxisLabel(mode) {
  if (mode === "raman") return "Raman shift (cm^-1)";
  if (mode === "wavelength") return "Wavelength (nm)";
  return "Absolute wavenumber (cm^-1)";
}

function niceTicks(min, max, targetCount = 7) {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min];
  const rough = span / Math.max(2, targetCount);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / mag;
  const niceResidual = residual >= 5 ? 5 : residual >= 2 ? 2 : 1;
  const step = niceResidual * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(8)));
  }
  return ticks.length ? ticks : [min, max];
}

function renderPlot({ rows, peakResult, matchedPeaks = [], matchedLines = [], laserNm, calibrationCoeffs = null, zoomRange = null }) {
  const width = 1100;
  const height = 340;
  const margin = { top: 20, right: 20, bottom: 42, left: 62 };
  const previewMode = els.previewAxisModeSelect.value;
  const spectrumMode = els.previewSpectrumModeSelect.value;
  const xTransformer = spectrumMode === "calibrated" && calibrationCoeffs
    ? (x) => evaluatePolynomial(calibrationCoeffs, x)
    : (x) => x;

  const points = rows.map((r) => ({ ...r, xDisplay: convertAbsForPreview(xTransformer(r.x), previewMode, laserNm) }));
  const inZoom = zoomRange
    ? points.filter((p) => p.xDisplay >= zoomRange[0] && p.xDisplay <= zoomRange[1])
    : points;
  if (!inZoom.length) {
    els.plotContainer.innerHTML = "";
    return;
  }

  const xVals = inZoom.map((p) => p.xDisplay);
  const yVals = inZoom.map((p) => p.y);
  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);

  const sx = (v) => margin.left + ((v - xMin) / (xMax - xMin || 1)) * (width - margin.left - margin.right);
  const sy = (v) => height - margin.bottom - ((v - yMin) / (yMax - yMin || 1)) * (height - margin.top - margin.bottom);

  const path = inZoom.map((r, i) => `${i === 0 ? "M" : "L"} ${sx(r.xDisplay).toFixed(2)} ${sy(r.y).toFixed(2)}`).join(" ");

  const peakDots = peakResult.peaks.map((p) => ({ ...p, xDisplay: convertAbsForPreview(xTransformer(p.x), previewMode, laserNm) }))
    .filter((p) => p.xDisplay >= xMin && p.xDisplay <= xMax)
    .slice(0, 60)
    .map((p) => `<circle cx="${sx(p.xDisplay)}" cy="${sy(p.y)}" r="3.5" fill="#f87171"><title>x=${formatNumber(p.xDisplay, 3)}, prom=${formatNumber(p.prominence, 2)}</title></circle>`)
    .join("");

  const matchedPeakDots = matchedPeaks.map((p) => ({ ...p, xDisplay: convertAbsForPreview(xTransformer(p.x), previewMode, laserNm) }))
    .filter((p) => p.xDisplay >= xMin && p.xDisplay <= xMax)
    .map((p) => `<circle cx="${sx(p.xDisplay)}" cy="${sy(p.y)}" r="5.5" fill="#f59e0b" stroke="#fff" stroke-width="1"><title>matched peak ${formatNumber(p.xDisplay, 3)}</title></circle>`)
    .join("");

  const lineMarkers = matchedLines.map((line) => convertAbsForPreview(line.absWavenumber, previewMode, laserNm))
    .filter((xv) => xv >= xMin && xv <= xMax)
    .map((xv) => {
      const cx = sx(xv);
      return `
        <line x1="${cx}" y1="${margin.top}" x2="${cx}" y2="${height - margin.bottom}" stroke="#34d399" stroke-width="1.4" stroke-dasharray="4 4" />
        <text x="${cx + 4}" y="${margin.top + 16}" fill="#34d399" font-size="11">${formatNumber(xv, 1)}</text>
      `;
    }).join("");

  const tickValues = niceTicks(xMin, xMax, 8);
  const xTicks = tickValues.map((tv) => `
    <line x1="${sx(tv)}" y1="${height - margin.bottom}" x2="${sx(tv)}" y2="${height - margin.bottom + 6}" stroke="#64748b" />
    <text x="${sx(tv)}" y="${height - margin.bottom + 20}" text-anchor="middle" fill="#94a3b8" font-size="11">${formatNumber(tv, 1)}</text>
  `).join("");

  const axis = `
    <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#64748b" />
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#64748b" />
    ${xTicks}
    <text x="${width / 2}" y="${height - 4}" text-anchor="middle" fill="#94a3b8" font-size="12">${escapeHtml(previewAxisLabel(previewMode))} (${spectrumMode === "calibrated" ? "after calibration" : "before calibration"})</text>
    <text x="18" y="${height / 2}" text-anchor="middle" transform="rotate(-90 18 ${height / 2})" fill="#94a3b8" font-size="12">Intensity</text>
  `;

  els.plotContainer.innerHTML = `
    <svg id="previewPlotSvg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="spectrum plot">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
      ${axis}
      ${lineMarkers}
      <path d="${path}" fill="none" stroke="#60a5fa" stroke-width="1.5" />
      ${peakDots}
      ${matchedPeakDots}
      <rect id="zoomRect" x="0" y="0" width="0" height="0" fill="rgba(96,165,250,0.16)" stroke="#60a5fa" stroke-dasharray="4 3" visibility="hidden" />
    </svg>
  `;

  attachZoomHandlers({ width, height, margin, xMin, xMax });
  updateZoomButtonState();
}

function attachZoomHandlers({ width, height, margin, xMin, xMax }) {
  const svg = document.getElementById("previewPlotSvg");
  const zoomRect = document.getElementById("zoomRect");
  if (!svg || !zoomRect) return;

  let startX = null;
  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;

  const valueFromPx = (px) => xMin + ((px - left) / (right - left || 1)) * (xMax - xMin);

  const clampX = (px) => Math.max(left, Math.min(right, px));

  svg.addEventListener("pointerdown", (event) => {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    if (loc.x < left || loc.x > right || loc.y < top || loc.y > bottom) return;
    startX = clampX(loc.x);
    zoomRect.setAttribute("x", String(startX));
    zoomRect.setAttribute("y", String(top));
    zoomRect.setAttribute("width", "0");
    zoomRect.setAttribute("height", String(bottom - top));
    zoomRect.setAttribute("visibility", "visible");
  });

  svg.addEventListener("pointermove", (event) => {
    if (startX === null) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const currentX = clampX(loc.x);
    const x = Math.min(startX, currentX);
    const w = Math.abs(currentX - startX);
    zoomRect.setAttribute("x", String(x));
    zoomRect.setAttribute("width", String(w));
  });

  svg.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const endX = clampX(loc.x);
    const minPx = Math.min(startX, endX);
    const maxPx = Math.max(startX, endX);
    startX = null;
    zoomRect.setAttribute("visibility", "hidden");

    if (maxPx - minPx < 8) return;

    const minV = valueFromPx(minPx);
    const maxV = valueFromPx(maxPx);
    state.preview.zoomRange = [Math.min(minV, maxV), Math.max(minV, maxV)];
    renderPreview();
  });
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
