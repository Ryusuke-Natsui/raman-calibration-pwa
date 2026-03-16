export const LASER_OPTIONS_NM = [325, 442, 458, 488, 514, 532, 561, 633, 785, 1064];

export function laserAbsWavenumberFromNm(laserNm) {
  return 1e7 / Number(laserNm);
}

export function absWavenumberToWavelengthNm(absWavenumberCm) {
  return 1e7 / absWavenumberCm;
}

export function absWavenumberToRamanShiftCm(absWavenumberCm, laserNm) {
  return laserAbsWavenumberFromNm(laserNm) - absWavenumberCm;
}

export function convertAbsAxis(absValues, outputMode, laserNm) {
  if (outputMode === "absolute") return absValues;
  if (outputMode === "wavelength") return absValues.map((x) => absWavenumberToWavelengthNm(x));
  return absValues.map((x) => absWavenumberToRamanShiftCm(x, laserNm));
}

export function outputAxisLabel(outputMode) {
  if (outputMode === "absolute") return "Absolute wavenumber (cm^-1)";
  if (outputMode === "wavelength") return "Wavelength (nm)";
  return "Raman shift (cm^-1)";
}
