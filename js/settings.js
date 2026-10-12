// Print settings, remembered per device.

import { modelById, labelById } from "./raster.js";

const KEY = "label.print";

const DEFAULTS = {
  model: "QL-800",
  label: "62",
  copies: 1,
  cut: true,
  picture: false,
};

export function printSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch { /* ignore */ }
  const settings = { ...DEFAULTS, ...saved };
  const model = modelById(settings.model);
  const label = labelById(model, settings.label);
  return { ...settings, model: model.id, label: label.id, modelSpec: model, labelSpec: label };
}

export function savePrintSettings(patch) {
  const { modelSpec, labelSpec, ...current } = printSettings();
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage unavailable: settings last for this visit only */ }
  return printSettings();
}
