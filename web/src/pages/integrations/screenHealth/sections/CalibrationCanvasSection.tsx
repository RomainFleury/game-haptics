import { useCallback, useMemo, useState } from "react";
import { useScreenHealthCalibration } from "../draft/CalibrationContext";
import { useScreenHealthHealthBarDraft, useScreenHealthHealthBarDraftControls } from "../draft/HealthBarDraftContext";
import { useScreenHealthHealthNumberDraft, useScreenHealthHealthNumberDraftControls } from "../draft/HealthNumberDraftContext";
import { useScreenHealthProfileDraft } from "../draft/ProfileDraftContext";
import { useScreenHealthRecoilDraft, useScreenHealthRecoilDraftControls } from "../draft/RecoilDraftContext";
import { useScreenHealthColorVignetteDraft, useScreenHealthColorVignetteDraftControls } from "../draft/ColorVignetteDraftContext";
import { useScreenHealthRednessDraft, useScreenHealthRednessDraftControls } from "../draft/RednessDraftContext";
import { clamp01, clampInt } from "../utils";
import type { RoiRect } from "../draft/types";

type ZoneTip = { x: number; y: number; lines: string[] };

function zoneLines(kind: string, name?: string | null, extra?: string | null): string[] {
  const lines = [kind];
  const trimmedName = name?.trim();
  if (trimmedName) lines.push(trimmedName);
  const trimmedExtra = extra?.trim();
  if (trimmedExtra) lines.push(trimmedExtra);
  return lines;
}

function RoiZoneOverlay(props: {
  rect: RoiRect;
  className: string;
  lines: string[];
  onHover: (tip: ZoneTip | null) => void;
}) {
  const { rect, className, lines, onHover } = props;
  return (
    <div
      className={`absolute ${className}`}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      }}
      onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY, lines })}
      onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, lines })}
      onMouseLeave={() => onHover(null)}
    />
  );
}

export function CalibrationCanvasSection(props: { lastCapturedImage: { dataUrl: string } | null }) {
  const { lastCapturedImage } = props;
  const { imgContainerRef, offscreenCanvasRef, imageLoadedRef } = useScreenHealthCalibration();
  const profile = useScreenHealthProfileDraft();
  const redness = useScreenHealthRednessDraft();
  const { setRois } = useScreenHealthRednessDraftControls();
  const colorVignette = useScreenHealthColorVignetteDraft();
  const {
    setRois: setColorVignetteRois,
    setTargetRgb,
    setPickingColor,
  } = useScreenHealthColorVignetteDraftControls();
  const hb = useScreenHealthHealthBarDraft();
  const { setRoi: setHealthBarRoi, setFilledRgb, setEmptyRgb, setColorPickMode } = useScreenHealthHealthBarDraftControls();
  const hn = useScreenHealthHealthNumberDraft();
  const { setRoi: setHealthNumberRoi } = useScreenHealthHealthNumberDraftControls();
  const recoil = useScreenHealthRecoilDraft();
  const {
    setRoi: setRecoilRoi,
    appendAmmoZone,
    setRecoilType,
    setBackgroundRgb: setRecoilBackgroundRgb,
    setColorPickMode: setRecoilColorPickMode,
  } = useScreenHealthRecoilDraftControls();

  const detectorType = profile.detectorType;
  const editingRecoil = profile.canvasEditTarget === "recoil";

  const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [hoverTip, setHoverTip] = useState<{ left: number; top: number; lines: string[] } | null>(null);

  const updateHoverTip = useCallback(
    (tip: ZoneTip | null) => {
      if (!tip || !imgContainerRef.current) {
        setHoverTip(null);
        return;
      }
      const bounds = imgContainerRef.current.getBoundingClientRect();
      const left = Math.min(Math.max(8, tip.x - bounds.left + 12), Math.max(8, bounds.width - 160));
      const top = Math.min(Math.max(8, tip.y - bounds.top + 12), Math.max(8, bounds.height - 48));
      setHoverTip({ left, top, lines: tip.lines });
    },
    [imgContainerRef]
  );

  const pickColorAtMouse = useCallback(
    (e: React.MouseEvent) => {
      const pickingVignette = colorVignette.pickingColor;
      const pickingBar = Boolean(hb.colorPickMode);
      const pickingFillUp = Boolean(recoil.colorPickMode);
      if (!pickingVignette && !pickingBar && !pickingFillUp) return false;
      if (!imgContainerRef.current) return false;
      const canvas = offscreenCanvasRef.current;
      if (!canvas || !imageLoadedRef.current) return false;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;

      const rect = imgContainerRef.current.getBoundingClientRect();
      const nx = clamp01((e.clientX - rect.left) / rect.width);
      const ny = clamp01((e.clientY - rect.top) / rect.height);
      const px = clampInt(Math.floor(nx * canvas.width), 0, canvas.width - 1);
      const py = clampInt(Math.floor(ny * canvas.height), 0, canvas.height - 1);
      const data = ctx.getImageData(px, py, 1, 1).data; // RGBA
      const rgb: [number, number, number] = [data[0], data[1], data[2]];
      if (pickingVignette) {
        setTargetRgb(rgb);
        setPickingColor(false);
        return true;
      }
      if (pickingFillUp) {
        setRecoilBackgroundRgb(rgb);
        setRecoilColorPickMode(null);
        return true;
      }
      if (hb.colorPickMode === "filled") setFilledRgb(rgb);
      else setEmptyRgb(rgb);
      setColorPickMode(null);
      return true;
    },
    [
      colorVignette.pickingColor,
      hb.colorPickMode,
      recoil.colorPickMode,
      imgContainerRef,
      offscreenCanvasRef,
      imageLoadedRef,
      setEmptyRgb,
      setFilledRgb,
      setColorPickMode,
      setRecoilBackgroundRgb,
      setRecoilColorPickMode,
      setTargetRgb,
      setPickingColor,
    ]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (pickColorAtMouse(e)) return;
      if (!imgContainerRef.current) return;
      setHoverTip(null);
      const rect = imgContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDrawing({ startX: x, startY: y, curX: x, curY: y });
    },
    [pickColorAtMouse, imgContainerRef]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawing || !imgContainerRef.current) return;
      const rect = imgContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDrawing({ ...drawing, curX: x, curY: y });
    },
    [drawing, imgContainerRef]
  );

  const handleMouseUp = useCallback(() => {
    if (!drawing || !imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    const x1 = Math.min(drawing.startX, drawing.curX);
    const y1 = Math.min(drawing.startY, drawing.curY);
    const x2 = Math.max(drawing.startX, drawing.curX);
    const y2 = Math.max(drawing.startY, drawing.curY);
    const w = x2 - x1;
    const h = y2 - y1;
    setDrawing(null);
    if (w < 5 || h < 5) return;

    const newRect = { x: clamp01(x1 / rect.width), y: clamp01(y1 / rect.height), w: clamp01(w / rect.width), h: clamp01(h / rect.height) };
    if (editingRecoil) {
      if (recoil.recoilDrawKind === "fill_up_bar") {
        setRecoilRoi(newRect);
      } else {
        appendAmmoZone(newRect);
      }
      setRecoilType(recoil.recoilDrawKind);
      return;
    }
    if (detectorType === "health_bar") {
      setHealthNumberRoi(null);
      setRois([]);
      setColorVignetteRois([]);
      setHealthBarRoi(newRect);
      return;
    }
    if (detectorType === "health_number") {
      setHealthBarRoi(null);
      setRois([]);
      setColorVignetteRois([]);
      setHealthNumberRoi(newRect);
      return;
    }
    if (detectorType === "color_vignette") {
      setHealthBarRoi(null);
      setHealthNumberRoi(null);
      setRois([]);
      setColorVignetteRois((prev) => [...prev, { name: `roi_${prev.length + 1}`, direction: "", rect: newRect }]);
      return;
    }
    setHealthBarRoi(null);
    setHealthNumberRoi(null);
    setColorVignetteRois([]);
    setRois((prev) => [...prev, { name: `roi_${prev.length + 1}`, direction: "", rect: newRect }]);
  }, [
    drawing,
    detectorType,
    editingRecoil,
    imgContainerRef,
    recoil.recoilDrawKind,
    setHealthBarRoi,
    setHealthNumberRoi,
    setRecoilRoi,
    appendAmmoZone,
    setRecoilType,
    setRois,
    setColorVignetteRois,
  ]);

  const cursor = hb.colorPickMode || colorVignette.pickingColor || recoil.colorPickMode ? "copy" : "crosshair";
  const overlays = useMemo(
    () => ({
      rois: detectorType === "redness_rois" ? redness.rois : detectorType === "color_vignette" ? colorVignette.rois : [],
      roiKind: detectorType === "color_vignette" ? "Color vignette" : "Red vignette",
      hbRoi: detectorType === "health_bar" ? hb.roi : null,
      hnRoi: detectorType === "health_number" ? hn.roi : null,
    }),
    [detectorType, redness.rois, colorVignette.rois, hb.roi, hn.roi]
  );

  if (!lastCapturedImage) return null;

  const drawHint = recoil.colorPickMode
    ? "Click the screenshot to pick the unfilled bar background color."
    : editingRecoil
    ? recoil.recoilDrawKind === "fill_up_bar"
      ? "Drawing fill-up bar (amber)."
      : "Drawing ammo counter (amber). Draw each gun's number — dual-wield needs two boxes."
    : detectorType === "health_bar"
      ? "Drawing health bar (green)."
      : detectorType === "health_number"
        ? "Drawing health number (green)."
        : detectorType === "color_vignette"
          ? colorVignette.pickingColor
            ? "Click the screenshot to pick the vignette color."
            : "Drawing color vignette (green)."
          : "Drawing red vignette (green).";

  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-400">{drawHint} Saved when you click Start.</div>
      <div
        ref={imgContainerRef}
        className="relative w-full overflow-hidden rounded-xl ring-1 ring-white/10 bg-slate-900/30"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ cursor }}
      >
        <img src={lastCapturedImage.dataUrl} className="block w-full select-none" draggable={false} />
        <canvas ref={offscreenCanvasRef} className="hidden" />

        {overlays.rois.map((r, idx) => (
          <RoiZoneOverlay
            key={`${r.name}-${idx}`}
            rect={r.rect}
            className="border-2 border-emerald-400/80 bg-emerald-400/10"
            lines={zoneLines(overlays.roiKind, r.name, r.direction ? `direction: ${r.direction}` : null)}
            onHover={drawing ? () => undefined : updateHoverTip}
          />
        ))}

        {overlays.hbRoi && (
          <RoiZoneOverlay
            rect={overlays.hbRoi}
            className="border-2 border-emerald-400/80 bg-emerald-400/10"
            lines={zoneLines("Health bar")}
            onHover={drawing ? () => undefined : updateHoverTip}
          />
        )}

        {overlays.hnRoi && (
          <RoiZoneOverlay
            rect={overlays.hnRoi}
            className="border-2 border-emerald-400/80 bg-emerald-400/10"
            lines={zoneLines("Health number")}
            onHover={drawing ? () => undefined : updateHoverTip}
          />
        )}

        {recoil.zones.map((z, idx) => (
          <RoiZoneOverlay
            key={`${z.name}-${idx}`}
            rect={z.rect}
            className="border-2 border-amber-400/80 bg-amber-400/10"
            lines={zoneLines(
              recoil.recoilType === "fill_up_bar" ? "Fill-up bar" : "Ammo box",
              z.name
            )}
            onHover={drawing ? () => undefined : updateHoverTip}
          />
        ))}

        {hoverTip && !drawing && (
          <div
            className="pointer-events-none absolute z-20 max-w-[12rem] rounded-md bg-slate-950/95 px-2 py-1.5 text-xs text-white shadow-lg ring-1 ring-white/15"
            style={{ left: hoverTip.left, top: hoverTip.top }}
          >
            <div className="font-medium text-slate-100">{hoverTip.lines[0]}</div>
            {hoverTip.lines.slice(1).map((line) => (
              <div key={line} className="text-slate-300">
                {line}
              </div>
            ))}
          </div>
        )}

        {drawing && (
          <div
            className="absolute border-2 border-blue-400/80 bg-blue-400/10"
            style={{
              left: `${(Math.min(drawing.startX, drawing.curX) / (imgContainerRef.current?.getBoundingClientRect().width || 1)) * 100}%`,
              top: `${(Math.min(drawing.startY, drawing.curY) / (imgContainerRef.current?.getBoundingClientRect().height || 1)) * 100}%`,
              width: `${(Math.abs(drawing.curX - drawing.startX) / (imgContainerRef.current?.getBoundingClientRect().width || 1)) * 100}%`,
              height: `${(Math.abs(drawing.curY - drawing.startY) / (imgContainerRef.current?.getBoundingClientRect().height || 1)) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
