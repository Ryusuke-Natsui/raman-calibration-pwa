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
  downloadBlob,
  createZipBlob,
  basenameWithoutExt,
  extname,
} from "./utils.js";

const BUNDLED_LAMP_DB_URL = new URL("./data/calibration_lamps_data_for_ThomasLab.csv", import.meta.url);
const LASER_FILENAME_ALIASES = new Map([
  ["488nm", "488.00"],
  ["532nm", "532.08"],
  ["cf514", "514.55"],
  ["cf561", "561.32"],
  ["cf633", "632.93"],
]);

const state = {
  lampDb: [],
  lampNames: [],
  lastCalibration: null,
  peakDetection: null,
  preview: null,
  lampInference: null,
  outputDirectoryHandle: null,
  selectedPreviewPeak: null,
};


const els = {
  lampDbStatus: document.getElementById("lampDbStatus"),
  reloadLampDbBtn: document.getElementById("reloadLampDbBtn"),
  lampSelect: document.getElementById("lampSelect"),
  customLampField: document.getElementById("customLampField"),
  customLampPeaksInput: document.getElementById("customLampPeaksInput"),
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
  runCalibrationBtn: document.getElementById("runCalibrationBtn"),
  downloadExampleNoteBtn: document.getElementById("downloadExampleNoteBtn"),
  statusBox: document.getElementById("statusBox"),
  plotContainer: document.getElementById("plotContainer"),
  fitSummary: document.getElementById("fitSummary"),
  matchTableBody: document.querySelector("#matchTable tbody"),
  downloadCalibrationResultsBtn: document.getElementById("downloadCalibrationResultsBtn"),
  chooseOutputFolderBtn: document.getElementById("chooseOutputFolderBtn"),
  outputFolderStatus: document.getElementById("outputFolderStatus"),
  downloadList: document.getElementById("downloadList"),
  downloadAllBtn: document.getElementById("downloadAllBtn"),
  calibrationFileStatus: document.getElementById("calibrationFileStatus"),
  measurementFilesStatus: document.getElementById("measurementFilesStatus"),
  previewSpectrumModeSelect: document.getElementById("previewSpectrumModeSelect"),
  previewAxisModeSelect: document.getElementById("previewAxisModeSelect"),
  resetZoomBtn: document.getElementById("resetZoomBtn"),
  selectedPeakDetails: document.getElementById("selectedPeakDetails"),
};

init();

async function init() {
  populateLaserOptions();
  wireEvents();
  setupFileDropZones();
  registerServiceWorker();
  await loadBundledLampDb();
  setDefaultSuffix();
  updateCustomLampControls();
  updateCalibrationButtonState();
  updateSpectrumModeControl();
  updateCalibrationResultsButtonState();
  updateZoomButtonState();
  updateDownloadAllButtonState();
  updateOutputFolderStatus();
}

function wireEvents() {
  els.reloadLampDbBtn.addEventListener("click", loadBundledLampDb);
  els.lampSelect.addEventListener("change", () => {
    updateCustomLampControls();
    setDefaultSuffix();
    invalidatePeakDetection("Settings changed. Run calibration again.");
  });
  els.customLampPeaksInput.addEventListener("input", () => {
    validateCustomLampPeaks();
    updateCalibrationButtonState();
    invalidatePeakDetection("Custom lamp peaks changed. Run calibration again.");
  });
  els.fitDegreeSelect.addEventListener("change", () => {
    validateCustomLampPeaks();
    updateCalibrationButtonState();
    invalidatePeakDetection("Settings changed. Run calibration again.");
  });
  els.laserSelect.addEventListener("change", () => invalidatePeakDetection("Settings changed. Run calibration again."));
  els.customLaserInput.addEventListener("input", () => invalidatePeakDetection("Settings changed. Run calibration again."));
  els.inputAxisModeSelect.addEventListener("change", () => invalidatePeakDetection("Settings changed. Run calibration again."));
  els.smoothingWindowInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run calibration again."));
  els.prominenceWindowInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run calibration again."));
  els.minProminenceInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run calibration again."));
  els.refineHalfWindowInput.addEventListener("input", () => invalidatePeakDetection("Peak detection settings changed. Run calibration again."));
  els.calibrationFileInput.addEventListener("change", handleCalibrationFileChange);
  els.suffixInput.addEventListener("input", () => {
    validateSuffix();
    updateCalibrationButtonState();
  });
  els.runCalibrationBtn.addEventListener("click", runCalibrationWorkflow);
  els.downloadAllBtn.addEventListener("click", downloadAllOutputs);
  els.chooseOutputFolderBtn?.addEventListener("click", chooseOutputFolder);
  els.downloadExampleNoteBtn.addEventListener("click", () => {
    setStatus("Bundled example file: `examples/20260205_Ne_example.txt`. If you upload this app to GitHub, include the `examples` folder as well.");
  });
  els.downloadCalibrationResultsBtn.addEventListener("click", downloadCalibrationResults);
  els.measurementFilesInput.addEventListener("change", () => {
    updateFileStatus(els.measurementFilesInput, els.measurementFilesStatus);
    updateCalibrationButtonState();
  });
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


async function handleCalibrationFileChange() {
  updateFileStatus(els.calibrationFileInput, els.calibrationFileStatus);
  invalidatePeakDetection("Calibration file changed. Run calibration again.");
  state.lampInference = null;

  const calibrationFile = els.calibrationFileInput.files?.[0];
  if (!calibrationFile) return;

  const inferredLamp = state.lampNames.length ? inferLampFromFileName(calibrationFile.name, state.lampNames) : null;
  const inferredLaser = inferLaserFromFileName(calibrationFile.name);

  if (inferredLamp) {
    els.lampSelect.value = inferredLamp.lamp;
    setDefaultSuffix();
    state.lampInference = inferredLamp;
  }

  if (inferredLaser) {
    els.laserSelect.value = inferredLaser.optionValue;
    els.customLaserInput.value = "";
  }

  if (inferredLamp || inferredLaser) {
    const updates = [];
    if (inferredLamp) updates.push(`lamp: ${inferredLamp.lamp}`);
    if (inferredLaser) updates.push(`laser: ${inferredLaser.label}`);
    setStatus(`Settings guessed from filename (${updates.join(", ")}). Run calibration to verify.`);
  }
}

function lampFamilyKey(lamp) {
  const match = String(lamp).match(/^[A-Za-z]+/);
  return (match ? match[0] : lamp).toLowerCase();
}

function inferLampFromFileName(fileName, lampNames) {
  const normalized = String(fileName).toLowerCase();
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  const candidates = lampNames
    .filter((lamp) => lamp !== "Custom")
    .map((lamp) => ({
      lamp,
      family: lampFamilyKey(lamp),
      sanitized: sanitizeLampName(lamp).toLowerCase(),
    }))
    .filter((candidate, index, list) => list.findIndex((item) => item.family === candidate.family) === index);

  for (const candidate of candidates) {
    if (tokens.includes(candidate.family) || normalized.includes(`_${candidate.family}_`) || normalized.startsWith(`${candidate.family}_`) || normalized.endsWith(`_${candidate.family}`)) {
      return { lamp: candidate.lamp, source: "filename" };
    }
    if (candidate.sanitized && normalized.includes(candidate.sanitized)) {
      return { lamp: candidate.lamp, source: "filename" };
    }
  }

  return null;
}

function inferLaserFromFileName(fileName) {
  const normalized = String(fileName).toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]+/g, "");

  for (const [alias, optionValue] of LASER_FILENAME_ALIASES.entries()) {
    if (compact.includes(alias)) {
      return {
        optionValue,
        label: `${optionValue} nm`,
        source: "filename",
      };
    }
  }

  return null;
}

function inferLampFromSpectrum({ detectedPeaks, degree, xMin, xMax, fileHintLamp = null }) {
  const candidates = [];

  for (const lamp of state.lampNames.filter((name) => name !== "Custom")) {
    const referenceLines = getReferenceLinesForLamp(lamp);
    try {
      const match = autoMatchPeaks({
        detectedPeaks,
        referenceLines,
        degree,
        xMin,
        xMax,
      });
      const fileHintBonus = fileHintLamp && lampFamilyKey(fileHintLamp) === lampFamilyKey(lamp) ? 2 : 0;
      candidates.push({
        lamp,
        score: match.score - fileHintBonus,
        rawScore: match.score,
        rmsError: match.rmsError,
        matchedPeakCount: match.matchedPeakCount,
      });
    } catch {
      // ignore lamps that cannot explain the detected peak pattern
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.score - b.score || b.matchedPeakCount - a.matchedPeakCount || a.rmsError - b.rmsError);
  const [best, second] = candidates;
  return {
    ...best,
    alternatives: candidates,
    confidenceGap: second ? second.score - best.score : null,
    source: "spectrum",
  };
}

function setupFileDropZones() {
  const dropZones = document.querySelectorAll('[data-drop-zone]');
  dropZones.forEach((zone) => {
    const inputId = zone.getAttribute('data-input-id');
    const input = inputId ? document.getElementById(inputId) : null;
    if (!(input instanceof HTMLInputElement)) return;

    const setDragState = (isActive) => {
      zone.classList.toggle('is-dragover', isActive);
    };

    ['dragenter', 'dragover'].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        setDragState(true);
      });
    });

    ['dragleave', 'dragend', 'drop'].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (eventName === 'dragleave' && zone.contains(event.relatedTarget)) return;
        setDragState(false);
      });
    });

    zone.addEventListener('drop', (event) => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;

      const acceptedFiles = input.multiple ? files : [files[0]];
      const transfer = new DataTransfer();
      acceptedFiles.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function updateFileStatus(inputEl, statusEl) {
  const count = inputEl.files?.length || 0;
  if (count === 0) {
    statusEl.textContent = "No file selected";
    return;
  }
  if (count === 1) {
    statusEl.textContent = inputEl.files[0].name;
    return;
  }
  statusEl.textContent = `${count} files selected`;
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
  try {
    els.reloadLampDbBtn.disabled = true;
    els.lampDbStatus.textContent = "Loading bundled CSV...";

    const res = await fetch(BUNDLED_LAMP_DB_URL, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Failed to load bundled CSV (HTTP ${res.status}).`);
    }

    const text = await res.text();
    if (!text.includes("Wavelength_nm") || !text.includes("Abs. Wavenumber_cm^-1")) {
      throw new Error("Bundled CSV request returned unexpected content. Check the deployment path or service worker cache.");
    }
    loadLampDbFromText(text, "Using bundled CSV");
    invalidatePeakDetection();
  } catch (error) {
    console.error(error);
    state.lampDb = [];
    state.lampNames = [];
    els.lampSelect.innerHTML = "";
    els.lampDbStatus.textContent = "Failed to load bundled CSV. Click 'Reload bundled CSV' to retry.";
    setStatus(error.message || "Failed to load bundled CSV.", true);
    invalidatePeakDetection();
  } finally {
    els.reloadLampDbBtn.disabled = false;
  }
}

function loadLampDbFromText(text, message) {
  state.lampDb = parseLampCsv(text);
  state.lampNames = [...new Set(state.lampDb.map((row) => row.lamp)), "Custom"];
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
  updateCustomLampControls();
  setDefaultSuffix();
  setStatus("Lamp reference table is ready.");
}

function updateCustomLampControls() {
  const isCustom = els.lampSelect.value === "Custom";
  els.customLampField.classList.toggle("hidden", !isCustom);
  validateCustomLampPeaks();
}

function parseCustomLampPeaks() {
  const peaks = String(els.customLampPeaksInput.value || "")
    .split(/[\s,;]+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));

  return [...new Set(peaks)].sort((a, b) => a - b);
}

function validateCustomLampPeaks() {
  if (els.lampSelect.value !== "Custom") {
    els.customLampPeaksInput.setCustomValidity("");
    return true;
  }

  const peaks = parseCustomLampPeaks();
  const minimumRequired = Number(els.fitDegreeSelect.value) + 1;
  const isValid = peaks.length >= minimumRequired;
  els.customLampPeaksInput.setCustomValidity(isValid ? "" : `Enter at least ${minimumRequired} custom peak positions.`);
  return isValid;
}

function getReferenceLinesForLamp(lamp) {
  if (lamp === "Custom") {
    return parseCustomLampPeaks().map((absWavenumber) => ({
      lamp: "Custom",
      absWavenumber,
      wavelengthNm: NaN,
    }));
  }
  return state.lampDb.filter((row) => row.lamp === lamp);
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

function canWriteToChosenFolder() {
  return typeof window.showDirectoryPicker === "function";
}

function updateOutputFolderStatus() {
  if (!els.outputFolderStatus) return;
  if (!canWriteToChosenFolder()) {
    els.outputFolderStatus.textContent = "Direct save to a chosen folder is available in Chromium-based browsers only.";
    return;
  }
  if (state.outputDirectoryHandle) {
    els.outputFolderStatus.textContent = `Saving directly to: ${state.outputDirectoryHandle.name}`;
    return;
  }
  els.outputFolderStatus.textContent = "Optional: choose an output folder to save files there directly.";
}

async function chooseOutputFolder() {
  if (!canWriteToChosenFolder()) {
    setStatus("This browser does not support direct folder save. Please use regular download.", true);
    updateOutputFolderStatus();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.outputDirectoryHandle = handle;
    updateOutputFolderStatus();
    setStatus(`Output folder selected: ${handle.name}. Files will be saved there directly.`);
    if (state.lastCalibration && els.measurementFilesInput.files?.length) {
      renderDownloads([...els.measurementFilesInput.files]);
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    setStatus(error.message || "Failed to choose output folder.", true);
  }
}

async function writeTextToDirectory(directoryHandle, filename, text) {
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

function updateCalibrationButtonState() {
  const hasCalibrationFile = Boolean(els.calibrationFileInput.files?.length);
  const hasMeasurementFiles = Boolean(els.measurementFilesInput.files?.length);
  const hasValidCustomLamp = validateCustomLampPeaks();
  els.runCalibrationBtn.disabled = !(hasCalibrationFile && hasMeasurementFiles && validateSuffix() && hasValidCustomLamp);
}

function invalidatePeakDetection(statusMessage = "") {
  state.peakDetection = null;
  updateCalibrationButtonState();
  state.lastCalibration = null;
  state.preview = null;
  state.selectedPreviewPeak = null;
  els.previewSpectrumModeSelect.value = "raw";
  els.plotContainer.innerHTML = "";
  renderSelectedPeakDetails();
  els.fitSummary.innerHTML = "";
  els.matchTableBody.innerHTML = "";
  els.downloadList.innerHTML = "";
  updateCalibrationResultsButtonState();
  updateSpectrumModeControl();
  updateZoomButtonState();
  if (statusMessage) setStatus(statusMessage);
}

async function runPeakDetection() {
  try {
    validateBeforePeakDetection();
    setStatus("Detecting peaks...");

    const calibrationFile = els.calibrationFileInput.files[0];
    const calibrationRows = parseDelimitedTable(await readFileText(calibrationFile));
    if (calibrationRows.length < 3) {
      throw new Error("Could not read enough data points from the calibration file.");
    }

    const degree = Number(els.fitDegreeSelect.value);
    const selectedLamp = els.lampSelect.value;
    const fileHintLamp = state.lampInference?.lamp || selectedLamp;
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

    const inferredLamp = selectedLamp === "Custom"
      ? null
      : inferLampFromSpectrum({
        detectedPeaks: peakResult.peaks,
        degree,
        xMin: Math.min(...xValues),
        xMax: Math.max(...xValues),
        fileHintLamp,
      });
    const lamp = selectedLamp === "Custom" ? "Custom" : (inferredLamp?.lamp || fileHintLamp);
    if (lamp) {
      els.lampSelect.value = lamp;
      setDefaultSuffix();
    }
    state.lampInference = inferredLamp || (lamp ? { lamp, source: state.lampInference?.source || "selection" } : null);

    state.peakDetection = {
      degree,
      lamp,
      laserNm,
      inputAxisMode,
      outputMode,
      calibrationRows,
      calibrationRowsForFit,
      peakResult,
      detectOptions,
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

    updateSpectrumModeControl();
    const lampMessage = inferredLamp
      ? `Auto-selected lamp: ${lamp} (matched peaks: ${inferredLamp.matchedPeakCount}, score: ${formatNumber(inferredLamp.rawScore, 3)})`
      : `Using lamp: ${lamp}`;
    return { peakCount: peakResult.peaks.length, lampMessage };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function runCalibrationWorkflow() {
  try {
    validateBeforeCalibration();
    setStatus("Running calibration (including peak detection)...");

    const measurementFiles = [...els.measurementFilesInput.files];
    const peakDetectionSummary = await runPeakDetection();
    const { degree, lamp, laserNm, inputAxisMode, outputMode } = state.peakDetection;

    const referenceLines = getReferenceLinesForLamp(lamp);
    const resolvedCalibration = resolveCalibrationMatch(state.peakDetection, referenceLines);
    const { match, calibrationRowsForFit, peakResult, xMin, xMax, inputAxisMode: resolvedInputAxisMode, fallbackReason } = resolvedCalibration;

    if (fallbackReason) {
      els.inputAxisModeSelect.value = resolvedInputAxisMode;
      state.peakDetection = {
        ...state.peakDetection,
        inputAxisMode: resolvedInputAxisMode,
        calibrationRowsForFit,
        peakResult,
        xMin,
        xMax,
      };
    }

    state.lastCalibration = {
      degree,
      lamp,
      laserNm,
      inputAxisMode: resolvedInputAxisMode,
      outputMode,
      coeffs: match.coeffs,
      rmsError: match.rmsError,
      matchedPeaks: match.measuredPeaks,
      referenceLines: match.referenceLines,
      residuals: match.residuals,
      calibrationRows: calibrationRowsForFit,
      peakResult,
      xMin,
      xMax,
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
    updateCalibrationResultsButtonState();

    const fallbackNote = fallbackReason ? ` / auto-switched input axis to ${inputAxisLabel(resolvedInputAxisMode)}` : "";
    setStatus(`Done: ${lamp} / degree ${degree} / ${peakDetectionSummary.peakCount} peaks / ${peakDetectionSummary.lampMessage} / RMS = ${formatNumber(match.rmsError, 4)} cm^-1${fallbackNote}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Processing failed.", true);
  }
}

function validateBeforePeakDetection() {
  if (!state.lampDb.length) throw new Error("Please load a lamp reference table.");
  if (!els.calibrationFileInput.files?.length) throw new Error("Please select a calibration text file.");
  if (!validateCustomLampPeaks()) throw new Error(els.customLampPeaksInput.validationMessage);
}

function validateBeforeCalibration() {
  if (!els.calibrationFileInput.files?.length) throw new Error("Please select a calibration text file.");
  if (!els.measurementFilesInput.files?.length) throw new Error("Please select one or more measurement files.");
  if (!validateSuffix()) throw new Error("Please fix the output filename suffix.");
  if (!validateCustomLampPeaks()) throw new Error(els.customLampPeaksInput.validationMessage);
}


function buildCalibrationCandidate(peakDetection, inputAxisMode) {
  const calibrationRowsForFit = convertRowsToAbsInput(peakDetection.calibrationRows, inputAxisMode, peakDetection.laserNm);
  const peakResult = detectPeaks(calibrationRowsForFit, peakDetection.detectOptions);
  const xValues = calibrationRowsForFit.map((row) => row.x);
  return {
    inputAxisMode,
    calibrationRowsForFit,
    peakResult,
    xMin: Math.min(...xValues),
    xMax: Math.max(...xValues),
  };
}

function resolveCalibrationMatch(peakDetection, referenceLines) {
  const primaryCandidate = {
    inputAxisMode: peakDetection.inputAxisMode,
    calibrationRowsForFit: peakDetection.calibrationRowsForFit,
    peakResult: peakDetection.peakResult,
    xMin: peakDetection.xMin,
    xMax: peakDetection.xMax,
  };

  try {
    return {
      ...primaryCandidate,
      match: autoMatchPeaks({
        detectedPeaks: primaryCandidate.peakResult.peaks,
        referenceLines,
        degree: peakDetection.degree,
        xMin: primaryCandidate.xMin,
        xMax: primaryCandidate.xMax,
      }),
      fallbackReason: null,
    };
  } catch (error) {
    const canTryAlternate = error.message === "Not enough lamp lines fall within the measured x-range.";
    const alternateMode = peakDetection.inputAxisMode === "raman" ? "absolute" : "raman";
    if (!canTryAlternate) throw error;

    const alternateCandidate = buildCalibrationCandidate(peakDetection, alternateMode);
    const alternateMatch = autoMatchPeaks({
      detectedPeaks: alternateCandidate.peakResult.peaks,
      referenceLines,
      degree: peakDetection.degree,
      xMin: alternateCandidate.xMin,
      xMax: alternateCandidate.xMax,
    });

    return {
      ...alternateCandidate,
      match: alternateMatch,
      fallbackReason: error.message,
    };
  }
}

function getCalibrationCenterMetrics(cal) {
  const calibratedAbs = applyCalibration(cal.coeffs, cal.calibrationRows.map((row) => row.x));
  const minAbs = Math.min(...calibratedAbs);
  const maxAbs = Math.max(...calibratedAbs);
  const centerAbs = (minAbs + maxAbs) / 2;
  return {
    centerAbs,
    centerWavelengthNm: absWavenumberToWavelengthNm(centerAbs),
    calibratedAbsMin: minAbs,
    calibratedAbsMax: maxAbs,
  };
}

function renderSummary(cal) {
  const coeffText = cal.coeffs.map((c) => formatNumber(c, 8)).join(", ");
  const center = getCalibrationCenterMetrics(cal);
  const metrics = [
    ["Lamp", cal.lamp],
    ["Model", `${cal.degree} order`],
    ["Laser", `${formatNumber(cal.laserNm, 2)} nm`],
    ["Input axis", inputAxisLabel(cal.inputAxisMode)],
    ["Output", outputAxisLabel(cal.outputMode)],
    ["Matched peaks", String(cal.matchedPeaks.length)],
    ["RMS", `${formatNumber(cal.rmsError, 5)} cm^-1`],
    ["Center Abs. Wavenumber", `${formatNumber(center.centerAbs, 4)} cm^-1`],
    ["Center Wavelength", `${formatNumber(center.centerWavelengthNm, 4)} nm`],
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

function buildCalibrationResultsText(cal) {
  const center = getCalibrationCenterMetrics(cal);
  const lines = [
    '# Calibration results',
    `Lamp	${cal.lamp}`,
    `Model	${cal.degree} order`,
    `Laser_nm	${formatNumber(cal.laserNm, 4)}`,
    `Input_axis	${inputAxisLabel(cal.inputAxisMode)}`,
    `Output_axis	${outputAxisLabel(cal.outputMode)}`,
    `Matched_peaks	${cal.matchedPeaks.length}`,
    `Detected_peaks	${cal.peakResult.peaks.length}`,
    `RMS_cm^-1	${formatNumber(cal.rmsError, 6)}`,
    `Center_abs_wavenumber_cm^-1	${formatNumber(center.centerAbs, 6)}`,
    `Center_wavelength_nm	${formatNumber(center.centerWavelengthNm, 6)}`,
    `Calibrated_abs_min_cm^-1	${formatNumber(center.calibratedAbsMin, 6)}`,
    `Calibrated_abs_max_cm^-1	${formatNumber(center.calibratedAbsMax, 6)}`,
    `Coefficients	${cal.coeffs.map((c) => formatNumber(c, 10)).join(', ')}`,
    '',
    '# Matched peaks',
    'Index	Measured_x	Reference_abs_wavenumber_cm^-1	Reference_wavelength_nm	Residual_cm^-1',
    ...cal.matchedPeaks.map((peak, i) => [
      i + 1,
      formatNumber(peak.x, 6),
      formatNumber(cal.referenceLines[i].absWavenumber, 6),
      formatReferenceWavelength(cal.referenceLines[i].wavelengthNm, 6),
      formatNumber(cal.residuals[i], 6),
    ].join('\t')),
    '',
  ];
  return lines.join('\n');
}

function formatReferenceWavelength(value, digits = 4) {
  return Number.isFinite(value) ? formatNumber(value, digits) : "-";
}

function updateCalibrationResultsButtonState() {
  els.downloadCalibrationResultsBtn.disabled = !state.lastCalibration;
}

async function downloadCalibrationResults() {
  if (!state.lastCalibration) return;
  const fileBase = els.calibrationFileInput.files?.[0]?.name ? basenameWithoutExt(els.calibrationFileInput.files[0].name) : 'calibration';
  const suffix = els.suffixInput.value.trim() || '-clb';
  const filename = `${fileBase}${suffix}_results.txt`;
  const text = buildCalibrationResultsText(state.lastCalibration);

  try {
    if (state.outputDirectoryHandle) {
      await writeTextToDirectory(state.outputDirectoryHandle, filename, text);
      setStatus(`Saved calibration results to ${state.outputDirectoryHandle.name}/${filename}.`);
      return;
    }
    downloadText(filename, text);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed to save calibration results.", true);
  }
}

function renderMatchTable(cal) {
  els.matchTableBody.innerHTML = cal.matchedPeaks.map((peak, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${formatNumber(peak.x, 4)}</td>
      <td>${formatNumber(cal.referenceLines[i].absWavenumber, 4)}</td>
      <td>${formatReferenceWavelength(cal.referenceLines[i].wavelengthNm, 4)}</td>
      <td>${formatNumber(cal.residuals[i], 4)}</td>
    </tr>
  `).join("");
}

async function buildOutputFile(file) {
  if (!state.lastCalibration) {
    throw new Error("Run calibration before downloading outputs.");
  }

  const text = await readFileText(file);
  const rows = parseDelimitedTable(text);
  const inputX = rows.map((r) => convertInputXToAbs(r.x, state.lastCalibration.inputAxisMode, state.lastCalibration.laserNm));
  const absCalibrated = applyCalibration(state.lastCalibration.coeffs, inputX);
  const converted = convertAbsAxis(absCalibrated, state.lastCalibration.outputMode, state.lastCalibration.laserNm);
  const out = converted.map((x, i) => `${x}	${rows[i].y}`).join("\n") + "\n";
  const suffix = els.suffixInput.value.trim();
  const filename = `${basenameWithoutExt(file.name)}${suffix}${extname(file.name) || ".txt"}`;

  return {
    name: filename,
    data: out,
    lastModified: file.lastModified,
  };
}

async function downloadAllOutputs() {
  try {
    validateBeforeCalibration();
    els.downloadAllBtn.disabled = true;

    const files = [...els.measurementFilesInput.files];
    const outputFiles = await Promise.all(files.map((file) => buildOutputFile(file)));

    if (state.outputDirectoryHandle) {
      setStatus("Saving calibrated files to the selected folder...");
      await Promise.all(outputFiles.map((file) => writeTextToDirectory(state.outputDirectoryHandle, file.name, file.data)));
      setStatus(`Saved ${outputFiles.length} calibrated files to ${state.outputDirectoryHandle.name}.`);
      return;
    }

    setStatus("Preparing ZIP archive...");
    const zipBlob = await createZipBlob(outputFiles);
    const baseName = state.lastCalibration ? sanitizeLampName(state.lastCalibration.lamp) : "outputs";
    downloadBlob(`${baseName}_calibrated_outputs.zip`, zipBlob);
    setStatus(`Downloaded ${outputFiles.length} calibrated files as ZIP.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Failed to create output files.", true);
  } finally {
    updateDownloadAllButtonState();
  }
}

function updateDownloadAllButtonState() {
  const hasCalibration = Boolean(state.lastCalibration);
  const hasFiles = Boolean(els.measurementFilesInput.files?.length);
  els.downloadAllBtn.disabled = !(hasCalibration && hasFiles);
}

async function renderDownloads(files) {
  els.downloadList.innerHTML = "";
  updateDownloadAllButtonState();
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
      <div class="muted">${state.outputDirectoryHandle ? `save to: <span class="code">${escapeHtml(state.outputDirectoryHandle.name)}</span>` : "save via browser download"}</div>
    `;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = state.outputDirectoryHandle ? "Save" : "Download";
    btn.addEventListener("click", async () => {
      try {
        const outputFile = await buildOutputFile(file);
        if (state.outputDirectoryHandle) {
          await writeTextToDirectory(state.outputDirectoryHandle, outputFile.name, outputFile.data);
          setStatus(`Saved ${outputFile.name} to ${state.outputDirectoryHandle.name}.`);
        } else {
          downloadText(outputFile.name, outputFile.data);
        }
      } catch (error) {
        console.error(error);
        setStatus(error.message || `Failed to prepare ${file.name}.`, true);
      }
    });

    item.appendChild(meta);
    item.appendChild(btn);
    els.downloadList.appendChild(item);
  }
}

function getSelectedPeakData() {
  if (!state.preview || !state.selectedPreviewPeak) return null;
  const peak = state.preview.peakResult?.peaks?.[state.selectedPreviewPeak.index];
  if (!peak) return null;

  const previewMode = els.previewAxisModeSelect.value;
  const spectrumMode = els.previewSpectrumModeSelect.value;
  const xTransformer = spectrumMode === "calibrated" && state.preview.calibrationCoeffs
    ? (x) => evaluatePolynomial(state.preview.calibrationCoeffs, x)
    : (x) => x;

  const transformedX = xTransformer(peak.x);
  return {
    peak,
    spectrumMode,
    previewMode,
    xValue: convertAbsForPreview(transformedX, previewMode, state.preview.laserNm),
  };
}

function renderSelectedPeakDetails() {
  if (!els.selectedPeakDetails) return;
  const selected = getSelectedPeakData();
  if (!selected) {
    els.selectedPeakDetails.innerHTML = '<span class="muted">検出ピークをクリックすると、ピーク中心位置の x 軸値をここに表示します。</span>';
    return;
  }

  const { peak, spectrumMode, previewMode, xValue } = selected;
  const modeLabel = spectrumMode === "calibrated" ? "補正後" : "補正前";
  els.selectedPeakDetails.innerHTML = `
    <strong>選択中のピーク中心</strong>
    <span>${escapeHtml(previewAxisLabel(previewMode))}: <code>${formatNumber(xValue, 6)}</code></span>
    <span>Intensity: <code>${formatNumber(peak.y, 3)}</code></span>
    <span>Prominence: <code>${formatNumber(peak.prominence, 3)}</code></span>
    <span class="muted">表示モード: ${modeLabel}</span>
  `;
}

function renderPreview() {
  if (!state.preview) return;
  renderPlot(state.preview);
  renderSelectedPeakDetails();
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

  const peakDots = peakResult.peaks.map((p, index) => ({ ...p, index, xDisplay: convertAbsForPreview(xTransformer(p.x), previewMode, laserNm) }))
    .filter((p) => p.xDisplay >= xMin && p.xDisplay <= xMax)
    .slice(0, 60)
    .map((p) => {
      const isSelected = state.selectedPreviewPeak?.index === p.index;
      return `<circle class="preview-peak-dot${isSelected ? ' is-selected' : ''}" data-peak-index="${p.index}" cx="${sx(p.xDisplay)}" cy="${sy(p.y)}" r="${isSelected ? '6' : '4.5'}" fill="#f87171" stroke="${isSelected ? '#fef3c7' : '#ffffff'}" stroke-width="${isSelected ? '2' : '1'}"><title>x=${formatNumber(p.xDisplay, 3)}, prom=${formatNumber(p.prominence, 2)}</title></circle>`;
    })
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

  attachPeakSelectionHandlers();
  attachZoomHandlers({ width, height, margin, xMin, xMax });
  updateZoomButtonState();
}

function attachPeakSelectionHandlers() {
  const svg = document.getElementById("previewPlotSvg");
  if (!svg) return;

  for (const dot of svg.querySelectorAll(".preview-peak-dot")) {
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number(dot.dataset.peakIndex);
      if (!Number.isFinite(index)) return;
      state.selectedPreviewPeak = { index };
      renderPreview();
    });
  }
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
    if (event.target.closest?.(".preview-peak-dot")) return;
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
