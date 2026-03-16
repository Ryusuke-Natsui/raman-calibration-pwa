# Requirements and implementation notes

## Goal

Build a browser-based PWA for wavelength / absolute-wavenumber calibration of spectra measured with a triple monochromator.

## Functional requirements

### 1. Reference data
- Use the bundled lamp reference table from `data/calibration_lamps_data_for_ThomasLab.csv`.
- Filter by selected lamp.

### 2. Calibration spectrum import
- Accept one calibration spectrum text file.
- Parse two-column numeric data.

### 3. Peak detection
- Smooth spectrum lightly.
- Detect local maxima.
- Rank by prominence.
- Show detected peaks on a preview plot.

### 4. Peak-line matching
- From the selected lamp, take only reference lines inside the measured x-range (with small margin).
- Try combinations of measured candidate peaks and reference lines.
- Fit the chosen polynomial degree.
- Select the lowest-error monotonic solution.

### 5. Calibration model
Support:
- 0th order: `x_true = x_meas + c`
- 1st order: `x_true = a*x_meas + b`
- 2nd order: `x_true = a*x_meas^2 + b*x_meas + c`

### 6. Output units
Support output as:
- Raman shift: `nu_laser - nu_abs`
- Absolute wavenumber: `nu_abs`
- Wavelength: `1e7 / nu_abs`

### 7. Laser selection
Provide preset excitation wavelengths:
- 325
- 442
- 458
- 488
- 514
- 532
- 561
- 633
- 785
- 1064
- custom input

### 8. Batch application
- Accept multiple measurement files.
- Apply one calibration to all selected files.

### 9. Output filename policy
Default suffix:
- `-clb_<lamp_name>`

User may override suffix.
Warn when suffix contains invalid filename characters:
- `< > : " / \ | ? *`

### 10. Export
- Download calibrated text files individually.
- Preserve original row order.
- Output two columns:
  - calibrated x
  - original intensity

## UX requirements

- Keep the interface simple and single-page.
- Show:
  - chosen lamp
  - fit method
  - matched peak pairs
  - coefficients
  - RMS error
  - preview plot
- Let the user recalibrate repeatedly without page reload.

## Technical choices

- Pure HTML / CSS / JavaScript
- No build step
- Static deploy on GitHub Pages
- Service worker for installability / offline shell
- SVG preview plot for zero dependency

## Notes based on the uploaded files

- The example text file is a plain two-column numeric file.
- The bundled lamp table is directly usable as CSV.
