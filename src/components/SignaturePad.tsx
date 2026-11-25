import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenLine } from 'lucide-react';
import type { SignOffEntry } from '../types/inspection';

interface SignaturePadProps {
  title: string;
  roleSubtitle: string;
  value: SignOffEntry;
  onChange: (next: SignOffEntry) => void;
}

export function SignaturePad({
  title,
  roleSubtitle,
  value,
  onChange,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Sync existing signature image onto canvas when value.signatureDataUrl changes externally (e.g. reset or load)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetW = Math.max(240, Math.round(rect.width * dpr));
    const targetH = Math.max(100, Math.round(rect.height * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (value.signatureDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = value.signatureDataUrl;
    }
  }, [value.signatureDataUrl]);

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
    setIsDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange({
      ...value,
      signatureDataUrl: canvas.toDataURL('image/png'),
    });
  };

  const handleClearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    onChange({
      ...value,
      signatureDataUrl: null,
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          <p className="text-xs text-slate-500 mt-0.5">{roleSubtitle}</p>
        </div>
        {value.signatureDataUrl && (
          <button
            type="button"
            onClick={handleClearSignature}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Eraser className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      <div className="relative border border-dashed border-slate-300 rounded-md bg-slate-50/70 overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="w-full h-28 block cursor-crosshair touch-none"
        />
        {!value.signatureDataUrl && !isDrawing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <PenLine className="w-3.5 h-3.5" />
            <span>Sign here with mouse or touch</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Printed Name
          </span>
          <input
            type="text"
            value={value.printedName}
            onChange={(e) =>
              onChange({ ...value, printedName: e.target.value })
            }
            placeholder="Full name"
            className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 transition-colors"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Date
          </span>
          <input
            type="date"
            value={value.date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-red-700/20 focus:border-red-700 transition-colors"
          />
        </label>
      </div>
    </div>
  );
}
