import React, { useEffect, useRef, useState } from 'react';
import { Check, Eraser, Lock, PenLine, RotateCcw, X } from 'lucide-react';
import type { SignOffEntry } from '../types/inspection';

interface SignaturePadProps {
  title: string;
  roleSubtitle: string;
  value: SignOffEntry;
  onChange: (next: SignOffEntry) => void;
  readOnly?: boolean;
}

export function SignaturePad({
  title,
  roleSubtitle,
  value,
  onChange,
  readOnly = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDraftStrokes, setHasDraftStrokes] = useState(false);

  // Reset to locked state whenever the external signature changes (e.g., loading/resetting report)
  useEffect(() => {
    setIsEditing(false);
    setIsDrawing(false);
    setHasDraftStrokes(false);
  }, [value.signatureDataUrl]);

  // Initialize crisp HiDPI canvas when entering editing mode
  useEffect(() => {
    if (!isEditing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.max(240, Math.round(rect.width * dpr));
    const targetH = Math.max(112, Math.round(rect.height * dpr));

    canvas.width = targetW;
    canvas.height = targetH;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [isEditing]);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isEditing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    const { x, y } = getPoint(e);
    const dpr = window.devicePixelRatio || 1;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2.1 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Draw initial dot so single taps/short strokes register cleanly
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setIsDrawing(true);
    setHasDraftStrokes(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isEditing || !isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const finishStroke = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
  };

  const handleClearDraft = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDraftStrokes(false);
  };

  const handleSaveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDraftStrokes) return;
    const dataUrl = canvas.toDataURL('image/png');
    onChange({
      ...value,
      signatureDataUrl: dataUrl,
    });
    setIsEditing(false);
    setIsDrawing(false);
    setHasDraftStrokes(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setIsDrawing(false);
    setHasDraftStrokes(false);
  };

  const handleRemoveSavedSignature = () => {
    onChange({
      ...value,
      signatureDataUrl: null,
    });
    setIsEditing(false);
    setHasDraftStrokes(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <p className="text-xs text-slate-500 mt-0.5">{roleSubtitle}</p>
        </div>

        {!readOnly && !isEditing && value.signatureDataUrl && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setHasDraftStrokes(false);
                setIsEditing(true);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition-colors whitespace-nowrap"
              title="Unlock to draw a new signature"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Re-sign
            </button>
            <button
              type="button"
              onClick={handleRemoveSavedSignature}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-700 px-1.5 py-1 rounded hover:bg-red-50 transition-colors whitespace-nowrap"
              aria-label={`Clear ${title} signature`}
              title="Remove saved signature"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Signature Box: Locked preview OR active drawing canvas */}
      {isEditing ? (
        <div className="space-y-2">
          <div className="relative border-2 border-red-700/70 rounded-md bg-white overflow-hidden">
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              className="w-full h-28 block cursor-crosshair touch-none"
            />
            {!hasDraftStrokes && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <PenLine className="w-3.5 h-3.5" />
                <span>Draw signature now, then click Save Signature</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleClearDraft}
                disabled={!hasDraftStrokes}
                className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap"
              >
                <Eraser className="w-3.5 h-3.5" />
                Clear
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-md transition-colors whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>

            <button
              type="button"
              onClick={handleSaveSignature}
              disabled={!hasDraftStrokes}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              Save Signature
            </button>
          </div>
        </div>
      ) : value.signatureDataUrl ? (
        <div className="space-y-1.5">
          <div className="relative h-28 border border-slate-200 rounded-md bg-slate-50/60 flex items-center justify-center p-2 select-none overflow-hidden">
            <img
              src={value.signatureDataUrl}
              alt={`${title} saved signature`}
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain pointer-events-none select-none"
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-emerald-700 font-medium">
            <span className="inline-flex items-center gap-1">
              <Lock className="w-3 h-3 shrink-0" />
              Signature saved &amp; locked (protected from mistouch)
            </span>
          </div>
        </div>
      ) : (
        <div className="h-28 border border-dashed border-slate-300 rounded-md bg-slate-50/70 flex flex-col items-center justify-center gap-2 px-3 text-center">
          {readOnly ? (
            <span className="text-xs text-slate-400 italic">
              Signature pending (view-only)
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setHasDraftStrokes(false);
                  setIsEditing(true);
                }}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:border-red-700 hover:text-red-700 rounded-md shadow-2xs transition-colors"
              >
                <PenLine className="w-3.5 h-3.5" />
                Tap to Sign
              </button>
              <span className="text-[11px] text-slate-400">
                Locked until tapped to prevent accidental marks
              </span>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Printed Name
          </span>
          <input
            type="text"
            value={value.printedName}
            disabled={readOnly}
            onChange={(e) =>
              onChange({ ...value, printedName: e.target.value })
            }
            placeholder="Full name"
            className="w-full h-9 px-2.5 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-600 border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 transition-colors"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Date
          </span>
          <input
            type="date"
            value={value.date}
            disabled={readOnly}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            className="w-full h-9 px-2.5 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-600 border border-slate-300 rounded-md text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 transition-colors"
          />
        </label>
      </div>
    </div>
  );
}
