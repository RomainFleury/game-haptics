/** Profile OCR engine. "daemon" follows Daemon Settings. Keep ids in sync with Python. */
export const AMMO_OCR_ENGINES = [
  { id: "templates", label: "Learned digit templates", beta: false },
  { id: "daemon", label: "Daemon setting", beta: false },
  { id: "windows_ocr", label: "Windows OCR", beta: false },
  { id: "rapidocr", label: "RapidOCR (ONNX)", beta: true },
  { id: "tesseract", label: "Tesseract OCR", beta: true },
  { id: "tesseract_boxes", label: "OpenCV + Tesseract boxes", beta: true },
  { id: "opencv_knn", label: "OpenCV contours + kNN", beta: true },
  { id: "opencv_cells", label: "OpenCV cells + kNN", beta: true },
] as const;

export type AmmoOcrEngineId = (typeof AMMO_OCR_ENGINES)[number]["id"];

export const DEFAULT_AMMO_OCR_ENGINE: AmmoOcrEngineId = "templates";

export function normalizeAmmoOcrEngine(value: unknown): AmmoOcrEngineId {
  const raw = String(value ?? "").trim();
  const match = AMMO_OCR_ENGINES.find((e) => e.id === raw);
  return match?.id ?? DEFAULT_AMMO_OCR_ENGINE;
}
