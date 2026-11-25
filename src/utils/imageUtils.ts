/**
 * Compresses an uploaded image file to a crisp, PDF-friendly JPEG data URL
 * so localStorage persistence and PDF embedding stay fast and reliable.
 */
export function compressImageFile(
  file: File,
  maxDimension = 1200,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Generates a high-resolution PNG data URL of the Jiang Nan brand mark
 * matching the IQAF-005 header logo for crisp vector-like PDF rendering.
 */
export function renderJiangNanLogoDataUrl(): string {
  const scale = 4;
  const width = 132;
  const height = 34;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);

  // Left wordmark: JIANG
  ctx.fillStyle = '#18181B';
  ctx.font = '700 12.5px Georgia, "Times New Roman", serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillText('JIANG', 45, height / 2 + 0.5);

  // Center circular red seal emblem
  const cx = 64;
  const cy = height / 2;
  const r = 13;

  // Outer red ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#B91C1C';
  ctx.fill();

  // Subtle white inner ring
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1.6, 0, Math.PI * 2);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 0.85;
  ctx.stroke();

  // Inner seal vertical divider / calligraphy motif for 江南
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 10px "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('江', cx, cy - 4.4);
  ctx.fillText('南', cx, cy + 5.2);

  // Right wordmark: NAN
  ctx.fillStyle = '#18181B';
  ctx.font = '700 12.5px Georgia, "Times New Roman", serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('NAN', 82, height / 2 + 0.5);

  return canvas.toDataURL('image/png');
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
