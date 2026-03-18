# Raman Calibration PWA

PWA for calibrating Raman spectra measured with a triple monochromator.

## What this prototype does

- loads a lamp reference table from `data/calibration_lamps_data_for_ThomasLab.csv`
- guesses the calibration lamp automatically from the uploaded filename and detected peak positions (Ar / Kr / Ne / Xe), while still allowing manual override
- guesses the laser wavelength automatically from the calibration filename for supported aliases (`488nm`, `532nm`, `CF514`, `CF561`, `CF633`)
- reads a calibration spectrum text file
- detects peaks automatically
- matches measured peaks to the inferred lamp's absolute wavenumber lines
- fits one of three calibration models:
  - 0th order: rigid shift
  - 1st order: linear calibration (**default**)
  - 2nd order: quadratic calibration
- applies the calibration to one or more measurement text files
- exports calibrated files in:
  - Raman shift (default)
  - absolute wavenumber
  - wavelength
- appends a configurable suffix to output filenames
- in Chromium-based browsers, can write calibrated files directly into a user-selected output folder (e.g. the same folder as the input files)
- works as a static site and can be published on GitHub Pages

## Expected input formats

### Lamp table CSV
Columns expected:

- `Wavelength_nm`
- `Lamp`
- `Abs. Wavenumber_cm^-1`

### Spectrum text files
Two numeric columns separated by whitespace, tab, comma, or semicolon:

- column 1: x-axis
- column 2: intensity

Comment lines beginning with `#` or non-numeric lines are ignored.

## Local use

Just open `index.html` in a modern browser.

For full PWA/service-worker behavior, serve it locally:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/raman-calibration-pwa/`

## GitHub Pages deployment

1. Create a new GitHub repository.
2. Upload the contents of this folder.
3. In GitHub:
   - Settings
   - Pages
   - Deploy from a branch
   - choose `main` and `/root`
4. Open the published URL in Chrome/Edge and install it as an app.

## Current assumptions

- The uploaded example calibration file appears to already use an absolute-wavenumber-like x-axis.
- Auto-matching is designed to work first with the strongest lamp lines in range.
- Manual peak pairing is not yet implemented; this would be a strong next enhancement for edge cases.

## Suggested next improvements

- manual add/remove peak matching
- residual plot and RMS diagnostics
- save/load calibration session as JSON
- drag-and-drop file upload
- output ZIP download for multiple calibrated files
- optional Savitzky–Golay smoothing
- custom laser wavelength input field
