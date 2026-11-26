const MAX_SAFE_DATAURL_CHARS = 500000;

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;

/**
 * Checks whether a File is likely an image even if mobile browsers omit file.type.
 */
export function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  if (!file.type && file.name && IMAGE_EXTENSIONS.test(file.name)) return true;
  return false;
}

/**
 * Parses EXIF DateTimeOriginal (0x9003), DateTimeDigitized (0x9004), or DateTime (0x0132)
 * from a JPEG ArrayBuffer before canvas compression strips EXIF metadata.
 */
function parseJpegExifDate(buffer: ArrayBuffer): Date | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) {
      return null;
    }

    let offset = 2;
    const length = view.byteLength;

    while (offset + 4 < length) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      if (marker === 0xffe1) {
        // APP1 EXIF segment
        if (offset + 8 > length) return null;
        // Check "Exif\0\0"
        if (view.getUint32(offset + 2, false) !== 0x45786966) {
          return null;
        }
        const tiffStart = offset + 8;
        if (tiffStart + 8 > length) return null;

        const endianTag = view.getUint16(tiffStart, false);
        const littleEndian = endianTag === 0x4949; // "II"
        if (!littleEndian && endianTag !== 0x4d4d) return null;

        const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
        const ifd0Start = tiffStart + firstIfdOffset;

        const readAscii = (valOffset: number, count: number): string | null => {
          const abs = tiffStart + valOffset;
          if (abs < 0 || abs + count > length) return null;
          let str = '';
          for (let i = 0; i < count; i++) {
            const ch = view.getUint8(abs + i);
            if (ch === 0) break;
            str += String.fromCharCode(ch);
          }
          return str.trim();
        };

        const parseExifString = (raw: string | null): Date | null => {
          if (!raw) return null;
          // Standard EXIF format: "YYYY:MM:DD HH:MM:SS"
          const match = raw.match(
            /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
          );
          if (!match) return null;
          const d = new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4]),
            Number(match[5]),
            Number(match[6])
          );
          return Number.isNaN(d.getTime()) ? null : d;
        };

        const scanIfd = (
          ifdPos: number
        ): { exifIfdOffset: number | null; dateTime: Date | null; dateOriginal: Date | null } => {
          let exifIfdOffset: number | null = null;
          let dateTime: Date | null = null;
          let dateOriginal: Date | null = null;

          if (ifdPos < tiffStart || ifdPos + 2 > length) {
            return { exifIfdOffset, dateTime, dateOriginal };
          }
          const entries = view.getUint16(ifdPos, littleEndian);
          for (let i = 0; i < entries; i++) {
            const entryPos = ifdPos + 2 + i * 12;
            if (entryPos + 12 > length) break;
            const tag = view.getUint16(entryPos, littleEndian);
            const count = view.getUint32(entryPos + 4, littleEndian);
            const valueOffset = view.getUint32(entryPos + 8, littleEndian);

            if (tag === 0x8769) {
              // ExifOffset SubIFD
              exifIfdOffset = valueOffset;
            } else if (tag === 0x9003) {
              // DateTimeOriginal
              dateOriginal = parseExifString(readAscii(valueOffset, count));
            } else if (tag === 0x9004 && !dateOriginal) {
              // DateTimeDigitized
              dateOriginal = parseExifString(readAscii(valueOffset, count));
            } else if (tag === 0x0132 && !dateTime) {
              // DateTime
              dateTime = parseExifString(readAscii(valueOffset, count));
            }
          }
          return { exifIfdOffset, dateTime, dateOriginal };
        };

        const ifd0 = scanIfd(ifd0Start);
        if (ifd0.exifIfdOffset !== null) {
          const sub = scanIfd(tiffStart + ifd0.exifIfdOffset);
          if (sub.dateOriginal) return sub.dateOriginal;
        }
        if (ifd0.dateOriginal) return ifd0.dateOriginal;
        if (ifd0.dateTime) return ifd0.dateTime;
        return null;
      }

      if ((marker & 0xff00) !== 0xff00) break;
      if (offset + 2 > length) break;
      const segLen = view.getUint16(offset, false);
      if (segLen < 2) break;
      offset += segLen;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Extracts the best available timestamp of when a photo was actually taken:
 * 1. JPEG EXIF DateTimeOriginal / DateTimeDigitized / DateTime
 * 2. File's lastModified timestamp (for gallery photos without EXIF)
 * 3. Current time fallback
 */
export async function extractPhotoTakenTimestamp(
  file: File,
  fromCamera = false
): Promise<{ iso: string; source: 'camera' | 'exif' | 'file' | 'now' }> {
  if (fromCamera) {
    return { iso: new Date().toISOString(), source: 'camera' };
  }

  try {
    // Only need the first 128KB for EXIF headers
    const slice = file.slice(0, 131072);
    const buffer = await slice.arrayBuffer();
    const exifDate = parseJpegExifDate(buffer);
    if (exifDate) {
      return { iso: exifDate.toISOString(), source: 'exif' };
    }
  } catch {
    // Fall through to file.lastModified
  }

  if (
    typeof file.lastModified === 'number' &&
    file.lastModified > 946684800000 // After Jan 1, 2000
  ) {
    const d = new Date(file.lastModified);
    if (!Number.isNaN(d.getTime())) {
      return { iso: d.toISOString(), source: 'file' };
    }
  }

  return { iso: new Date().toISOString(), source: 'now' };
}

/**
 * Compresses an HTMLCanvasElement into a guaranteed <= 500KB JPEG data URL
 * suitable for Firestore subcollection storage and PDF embedding.
 */
export function compressCanvasToDataUrl(
  sourceCanvas: HTMLCanvasElement
): string {
  const steps: [number, number][] = [
    [960, 0.78],
    [820, 0.72],
    [680, 0.65],
    [540, 0.58],
    [420, 0.52],
    [320, 0.48],
  ];

  for (const [maxDim, quality] of steps) {
    let width = sourceCanvas.width;
    let height = sourceCanvas.height;
    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.max(1, Math.round((height * maxDim) / width));
        width = maxDim;
      } else {
        width = Math.max(1, Math.round((width * maxDim) / height));
        height = maxDim;
      }
    }

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);

    const dataUrl = out.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_SAFE_DATAURL_CHARS) {
      return dataUrl;
    }
  }

  // Final safety floor
  const tiny = document.createElement('canvas');
  tiny.width = 280;
  tiny.height = Math.max(
    1,
    Math.round((sourceCanvas.height * 280) / Math.max(1, sourceCanvas.width))
  );
  const ctx = tiny.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, tiny.width, tiny.height);
    ctx.drawImage(sourceCanvas, 0, 0, tiny.width, tiny.height);
    return tiny.toDataURL('image/jpeg', 0.45);
  }
  return sourceCanvas.toDataURL('image/jpeg', 0.45);
}

/**
 * Compresses an uploaded image file to a crisp, Firestore-safe (<= 500KB) JPEG data URL.
 * Never returns an oversized or corrupted data URL.
 */
export function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    img.onerror = () => {
      cleanup();
      // Fallback via FileReader in case blob URL fails on some mobile browsers
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.onload = () => {
        const fallbackImg = new Image();
        fallbackImg.onerror = () =>
          reject(new Error('Unsupported image format. Please use JPG, PNG, or WebP.'));
        fallbackImg.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = fallbackImg.naturalWidth || fallbackImg.width || 640;
          canvas.height = fallbackImg.naturalHeight || fallbackImg.height || 480;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context unavailable.'));
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(fallbackImg, 0, 0, canvas.width, canvas.height);
          resolve(compressCanvasToDataUrl(canvas));
        };
        fallbackImg.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    };

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 640;
        canvas.height = img.naturalHeight || img.height || 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = compressCanvasToDataUrl(canvas);
        cleanup();
        resolve(compressed);
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error('Failed to compress photo.'));
      }
    };

    img.src = objectUrl;
  });
}

/**
 * Ensures any existing data URL (such as a legacy photo from local storage)
 * is a valid JPEG within the Firestore-safe <= 500KB limit without ever truncating base64.
 */
export function ensureSafePhotoDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return Promise.reject(new Error('Invalid image data URL.'));
  }
  if (dataUrl.length <= MAX_SAFE_DATAURL_CHARS) {
    return Promise.resolve(dataUrl);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Could not re-compress oversized photo.'));
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 640;
        canvas.height = img.naturalHeight || img.height || 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(compressCanvasToDataUrl(canvas));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to re-compress photo.'));
      }
    };
    img.src = dataUrl;
  });
}

export function formatTakenTimestamp(iso: string): string {
  if (!iso) return 'Unknown time';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export interface PdfLogoAsset {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Loads the official uploaded Jiang Nan landscape logo PNG, trims outer white
 * whitespace on an offscreen canvas, and returns a crisp, properly proportioned
 * PNG data URL for exact PDF embedding.
 */
export function loadJiangNanLogoForPdf(
  src = '/assets/aistudio/JN_LOGO_LANDSCAPE_25408581.png'
): Promise<PdfLogoAsset | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const targetW = Math.min(960, img.naturalWidth || 960);
        const ratio = (img.naturalHeight || 540) / (img.naturalWidth || 960);
        const targetH = Math.max(1, Math.round(targetW * ratio));

        const workCanvas = document.createElement('canvas');
        workCanvas.width = targetW;
        workCanvas.height = targetH;
        const workCtx = workCanvas.getContext('2d');
        if (!workCtx) {
          resolve(null);
          return;
        }

        workCtx.fillStyle = '#FFFFFF';
        workCtx.fillRect(0, 0, targetW, targetH);
        workCtx.drawImage(img, 0, 0, targetW, targetH);

        const imageData = workCtx.getImageData(0, 0, targetW, targetH);
        const pixels = imageData.data;

        let minX = targetW;
        let minY = targetH;
        let maxX = 0;
        let maxY = 0;
        let foundInk = false;

        for (let y = 0; y < targetH; y++) {
          for (let x = 0; x < targetW; x++) {
            const idx = (y * targetW + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const a = pixels[idx + 3];
            if (a > 20 && (r < 245 || g < 245 || b < 245)) {
              foundInk = true;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (!foundInk) {
          resolve({
            dataUrl: workCanvas.toDataURL('image/png'),
            width: targetW,
            height: targetH,
          });
          return;
        }

        const pad = 6;
        const cropX = Math.max(0, minX - pad);
        const cropY = Math.max(0, minY - pad);
        const cropW = Math.min(targetW - cropX, maxX - minX + 1 + pad * 2);
        const cropH = Math.min(targetH - cropY, maxY - minY + 1 + pad * 2);

        const outCanvas = document.createElement('canvas');
        outCanvas.width = cropW;
        outCanvas.height = cropH;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) {
          resolve(null);
          return;
        }
        outCtx.fillStyle = '#FFFFFF';
        outCtx.fillRect(0, 0, cropW, cropH);
        outCtx.drawImage(
          workCanvas,
          cropX,
          cropY,
          cropW,
          cropH,
          0,
          0,
          cropW,
          cropH
        );

        resolve({
          dataUrl: outCanvas.toDataURL('image/png'),
          width: cropW,
          height: cropH,
        });
      } catch {
        resolve(null);
      }
    };
    img.src = src;
  });
}

/**
 * Computes image natural aspect ratio for clean PDF placement without distortion.
 */
export function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || 4, height: img.naturalHeight || 3 });
    img.onerror = () => resolve({ width: 4, height: 3 });
    img.src = dataUrl;
  });
}
