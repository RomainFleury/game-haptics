import { clamp01, clampInt } from "./utils";

export type TemplateSize = { w: number; h: number };

type LearnArgs = {
  canvas: HTMLCanvasElement;
  roi: { x: number; y: number; w: number; h: number };
  digitsCount: number;
  displayedValue: string;
  threshold: number;
  invert: boolean;
  scale: number;
  templateSize: TemplateSize;
  prevTemplates: Record<string, string>;
};

export function learnDigitTemplatesFromCanvas(args: LearnArgs): Record<string, string> {
  const {
    canvas,
    roi,
    digitsCount,
    displayedValue,
    threshold,
    invert,
    scale,
    templateSize,
    prevTemplates,
  } = args;

  const raw = (displayedValue || "").replace(/[^\d]/g, "");
  if (!raw) throw new Error("Enter the number currently shown in the ROI (digits only)");
  if (raw.length !== digitsCount) throw new Error(`Expected exactly ${digitsCount} digits (got ${raw.length})`);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context not available");

  const x0 = clampInt(Math.floor(clamp01(roi.x) * canvas.width), 0, canvas.width - 1);
  const y0 = clampInt(Math.floor(clamp01(roi.y) * canvas.height), 0, canvas.height - 1);
  const x1 = clampInt(Math.floor(clamp01(roi.x + roi.w) * canvas.width), x0 + 1, canvas.width);
  const y1 = clampInt(Math.floor(clamp01(roi.y + roi.h) * canvas.height), y0 + 1, canvas.height);
  const roiW = x1 - x0;
  const roiH = y1 - y0;

  const imageData = ctx.getImageData(x0, y0, roiW, roiH).data; // RGBA
  const scl = Math.max(1, Math.floor(scale));
  const bw = roiW * scl;
  const bh = roiH * scl;
  const bits = new Uint8Array(bw * bh);
  const thr = Math.round(Math.max(0, Math.min(1, threshold)) * 255);

  // Binarize then replicate (matches daemon semantics)
  for (let yy = 0; yy < roiH; yy++) {
    for (let xx = 0; xx < roiW; xx++) {
      const idx = (yy * roiW + xx) * 4;
      const r = imageData[idx + 0];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];
      const gray = Math.floor((r * 299 + g * 587 + b * 114) / 1000);
      let bit = gray >= thr ? 1 : 0;
      if (invert) bit = bit ? 0 : 1;

      const oy0 = yy * scl;
      const ox0 = xx * scl;
      for (let sy = 0; sy < scl; sy++) {
        const row = (oy0 + sy) * bw;
        for (let sx = 0; sx < scl; sx++) {
          bits[row + (ox0 + sx)] = bit;
        }
      }
    }
  }

  function resizeNearest(src: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number) {
    const out = new Uint8Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
      const sy = Math.floor((y * srcH) / dstH);
      for (let x = 0; x < dstW; x++) {
        const sx = Math.floor((x * srcW) / dstW);
        out[y * dstW + x] = src[sy * srcW + sx] ? 1 : 0;
      }
    }
    return out;
  }

  const tw = templateSize.w;
  const th = templateSize.h;
  const nextTemplates: Record<string, string> = { ...prevTemplates };

  for (let i = 0; i < digitsCount; i++) {
    const ch = raw[i];
    const sx0 = Math.round((i * bw) / digitsCount);
    const sx1 = Math.round(((i + 1) * bw) / digitsCount);
    const sw = Math.max(1, sx1 - sx0);
    const slice = new Uint8Array(sw * bh);
    for (let y = 0; y < bh; y++) {
      slice.set(bits.subarray(y * bw + sx0, y * bw + sx0 + sw), y * sw);
    }
    const norm = resizeNearest(slice, sw, bh, tw, th);
    let bitStr = "";
    for (let k = 0; k < norm.length; k++) bitStr += norm[k] ? "1" : "0";
    nextTemplates[ch] = bitStr;
  }

  return nextTemplates;
}

type TryReadArgs = {
  canvas: HTMLCanvasElement;
  roi: { x: number; y: number; w: number; h: number };
  digitsCount: number;
  threshold: number;
  invert: boolean;
  scale: number;
  templateSize: TemplateSize;
  templates: Record<string, string>;
  hammingMax: number;
};

export function tryReadDigitValueFromCanvas(args: TryReadArgs): { value: number | null; digits?: string; reason?: string } {
  const { canvas, roi, digitsCount, threshold, invert, scale, templateSize, templates, hammingMax } = args;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { value: null, reason: "Canvas context not available" };

  const x0 = clampInt(Math.floor(clamp01(roi.x) * canvas.width), 0, canvas.width - 1);
  const y0 = clampInt(Math.floor(clamp01(roi.y) * canvas.height), 0, canvas.height - 1);
  const x1 = clampInt(Math.floor(clamp01(roi.x + roi.w) * canvas.width), x0 + 1, canvas.width);
  const y1 = clampInt(Math.floor(clamp01(roi.y + roi.h) * canvas.height), y0 + 1, canvas.height);
  const roiW = x1 - x0;
  const roiH = y1 - y0;

  const imageData = ctx.getImageData(x0, y0, roiW, roiH).data; // RGBA
  const scl = Math.max(1, Math.floor(scale));
  const bw = roiW * scl;
  const bh = roiH * scl;
  const bits = new Uint8Array(bw * bh);
  const thr = Math.round(Math.max(0, Math.min(1, threshold)) * 255);

  for (let yy = 0; yy < roiH; yy++) {
    for (let xx = 0; xx < roiW; xx++) {
      const idx = (yy * roiW + xx) * 4;
      const r = imageData[idx + 0];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];
      const gray = Math.floor((r * 299 + g * 587 + b * 114) / 1000);
      let bit = gray >= thr ? 1 : 0;
      if (invert) bit = bit ? 0 : 1;

      const oy0 = yy * scl;
      const ox0 = xx * scl;
      for (let sy = 0; sy < scl; sy++) {
        const row = (oy0 + sy) * bw;
        for (let sx = 0; sx < scl; sx++) {
          bits[row + (ox0 + sx)] = bit;
        }
      }
    }
  }

  function resizeNearest(src: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number) {
    const out = new Uint8Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
      const sy = Math.floor((y * srcH) / dstH);
      for (let x = 0; x < dstW; x++) {
        const sx = Math.floor((x * srcW) / dstW);
        out[y * dstW + x] = src[sy * srcW + sx] ? 1 : 0;
      }
    }
    return out;
  }

  const tw = templateSize.w;
  const th = templateSize.h;
  const expectedLen = tw * th;
  const templateKeys = Object.keys(templates);
  if (templateKeys.length === 0) return { value: null, reason: "No templates learned" };

  let digitsOut = "";
  for (let i = 0; i < digitsCount; i++) {
    const sx0 = Math.round((i * bw) / digitsCount);
    const sx1 = Math.round(((i + 1) * bw) / digitsCount);
    const sw = Math.max(1, sx1 - sx0);
    const slice = new Uint8Array(sw * bh);
    for (let y = 0; y < bh; y++) {
      slice.set(bits.subarray(y * bw + sx0, y * bw + sx0 + sw), y * sw);
    }
    const norm = resizeNearest(slice, sw, bh, tw, th);

    let bestDigit: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    let secondDist = Number.POSITIVE_INFINITY;
    for (const dch of Object.keys(templates)) {
      const tmpl = templates[dch];
      if (typeof tmpl !== "string" || tmpl.length !== expectedLen) continue;
      let dist = 0;
      for (let k = 0; k < expectedLen; k++) {
        const tb = tmpl[k] === "1" ? 1 : 0;
        dist += norm[k] === tb ? 0 : 1;
      }
      if (dist < bestDist) {
        secondDist = bestDist;
        bestDist = dist;
        bestDigit = dch;
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }

    const ink = norm.reduce((a, b) => a + (b ? 1 : 0), 0);
    if (ink < Math.max(2, Math.floor(expectedLen / 50)) || ink > expectedLen - Math.max(2, Math.floor(expectedLen / 50))) {
      return { value: null, reason: `Digit ${i + 1} looks empty/solid (background?)` };
    }

    if (!bestDigit || bestDist > hammingMax) {
      return { value: null, reason: `No match for digit ${i + 1} (bestDist=${bestDist})` };
    }
    if (bestDist > 0 && Number.isFinite(secondDist)) {
      const margin = Math.max(8, Math.floor(expectedLen / 32));
      if (secondDist - bestDist < margin) {
        return {
          value: null,
          reason: `Ambiguous digit ${i + 1} (best=${bestDist}, second=${secondDist}, need gap≥${margin})`,
        };
      }
    }
    digitsOut += bestDigit;
  }

  const value = Number.parseInt(digitsOut, 10);
  if (Number.isNaN(value)) return { value: null, digits: digitsOut, reason: "Parse failed" };
  return { value, digits: digitsOut };
}

