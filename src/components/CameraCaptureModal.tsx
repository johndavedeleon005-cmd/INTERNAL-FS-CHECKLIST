import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Clock,
  Loader2,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import type { PhotoProof } from '../types/inspection';
import {
  compressDrawableToDataUrl,
  compressImageFile,
  extractPhotoTakenTimestamp,
  formatTakenTimestamp,
  generatePhotoId,
} from '../utils/imageUtils';

interface CameraCaptureModalProps {
  itemNumber: number;
  itemText: string;
  onCaptureComplete: (photo: PhotoProof) => void;
  onClose: () => void;
}

export function CameraCaptureModal({
  itemNumber,
  itemText,
  onCaptureComplete,
  onClose,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment'
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isProcessingNativePhoto, setIsProcessingNativePhoto] = useState(false);
  const [liveClock, setLiveClock] = useState(() => new Date().toISOString());

  const [capturedPreview, setCapturedPreview] = useState<{
    dataUrl: string;
    capturedAt: string;
  } | null>(null);
  const [caption, setCaption] = useState('');

  // Keep live timestamp ticking while camera is open
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveClock(new Date().toISOString());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Start / stop webcam stream
  useEffect(() => {
    if (capturedPreview) return;

    let cancelled = false;
    setIsStarting(true);
    setIsVideoReady(false);
    setCameraError(null);

    const stopStream = () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
    };

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Live camera preview is not supported in this browser. Use the Device Camera button below.'
        );
        setIsStarting(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setIsStarting(false);
      } catch {
        if (!cancelled) {
          setCameraError(
            'Camera access was blocked or unavailable. You can still take a photo using the Device Camera button below.'
          );
          setIsStarting(false);
        }
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, capturedPreview]);

  const handleTakePhoto = () => {
    const video = videoRef.current;
    if (
      !video ||
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      setCameraError(
        'Camera preview is still initializing. Wait a moment or tap Device Camera.'
      );
      return;
    }

    try {
      const dataUrl = compressDrawableToDataUrl(
        video,
        video.videoWidth,
        video.videoHeight
      );
      const capturedAt = new Date().toISOString();

      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }

      setCapturedPreview({ dataUrl, capturedAt });
    } catch {
      setCameraError(
        'Could not capture video frame. Try again or use Device Camera.'
      );
    }
  };

  const handleNativeCameraFallback = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingNativePhoto(true);
    setCameraError(null);
    try {
      const [dataUrl, taken] = await Promise.all([
        compressImageFile(file),
        extractPhotoTakenTimestamp(file, true),
      ]);
      onCaptureComplete({
        id: generatePhotoId(),
        dataUrl,
        caption: caption.trim(),
        capturedAt: taken.iso,
        takenAtSource: taken.source,
        fileName: file.name || `camera-item-${itemNumber}.jpg`,
      });
      onClose();
    } catch (err) {
      setCameraError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not process photo from device camera.'
      );
    } finally {
      setIsProcessingNativePhoto(false);
      if (nativeCameraInputRef.current) {
        nativeCameraInputRef.current.value = '';
      }
    }
  };

  const handleConfirmCapture = () => {
    if (!capturedPreview) return;
    const stampSlug = capturedPreview.capturedAt
      .replace(/[^0-9]/g, '')
      .slice(0, 14);
    onCaptureComplete({
      id: generatePhotoId(),
      dataUrl: capturedPreview.dataUrl,
      caption: caption.trim(),
      capturedAt: capturedPreview.capturedAt,
      takenAtSource: 'camera',
      fileName: `camera_item${itemNumber}_${stampSlug}.jpg`,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Take camera photo for Item ${itemNumber}`}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 max-w-xl w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold text-slate-600 tabular-nums">
              Camera Capture · Item #{itemNumber}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
              {itemText}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close camera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Viewport or Captured Preview */}
        <div className="relative bg-slate-950 aspect-[4/3] flex items-center justify-center overflow-hidden">
          {capturedPreview ? (
            <img
              src={capturedPreview.dataUrl}
              alt="Captured preview"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          ) : cameraError ? (
            <div className="p-6 text-center max-w-sm">
              <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2.5" />
              <p className="text-xs text-slate-200 leading-relaxed">
                {cameraError}
              </p>
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Open Device Camera
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                onLoadedMetadata={() => setIsVideoReady(true)}
                onPlaying={() => setIsVideoReady(true)}
                className="w-full h-full object-cover"
              />
              {(isStarting || isProcessingNativePhoto) && (
                <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center gap-2 text-xs text-slate-200">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {isProcessingNativePhoto
                      ? 'Preparing photo for upload…'
                      : 'Starting camera…'}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Recorded timestamp scrim */}
          <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-950/75 text-white text-[11px] font-mono tabular-nums">
              <Clock className="w-3 h-3 shrink-0" />
              <span>
                Taken:{' '}
                {formatTakenTimestamp(
                  capturedPreview ? capturedPreview.capturedAt : liveClock
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Hidden native camera capture input fallback */}
        <input
          ref={nativeCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleNativeCameraFallback}
          className="hidden"
        />

        {/* Controls Footer */}
        <div className="p-4 bg-white border-t border-slate-200 space-y-3">
          {capturedPreview ? (
            <>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">
                  Photo Caption (optional)
                </span>
                <input
                  type="text"
                  maxLength={500}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Describe this photo proof…"
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-700"
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setCapturedPreview(null)}
                  className="inline-flex items-center gap-1.5 px-3.5 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Retake
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCapture}
                  className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Use &amp; Upload Photo
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setFacingMode((prev) =>
                    prev === 'environment' ? 'user' : 'environment'
                  )
                }
                disabled={Boolean(cameraError)}
                className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Flip Camera
              </button>

              <button
                type="button"
                onClick={handleTakePhoto}
                disabled={
                  isStarting ||
                  !isVideoReady ||
                  isProcessingNativePhoto ||
                  Boolean(cameraError)
                }
                className="inline-flex items-center gap-2 px-5 h-10 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
              >
                <Camera className="w-4 h-4" />
                Capture Photo
              </button>

              <button
                type="button"
                disabled={isProcessingNativePhoto}
                onClick={() => nativeCameraInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                {isProcessingNativePhoto ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Processing…
                  </>
                ) : (
                  'Device Camera'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
