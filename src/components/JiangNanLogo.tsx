import { useState } from 'react';

export const JIANG_NAN_LOGO_SRC =
  '/assets/aistudio/JN_LOGO_LANDSCAPE_25408581.png';

interface JiangNanLogoProps {
  className?: string;
  compact?: boolean;
}

export function JiangNanLogo({
  className = '',
  compact = false,
}: JiangNanLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <span
        className={`inline-flex items-center font-bold tracking-wider text-zinc-900 select-none ${
          compact ? 'text-xs' : 'text-sm'
        } ${className}`}
      >
        JIANG NAN
      </span>
    );
  }

  return (
    <div
      className={`inline-flex items-center overflow-hidden shrink-0 select-none ${
        compact ? 'h-8' : 'h-10'
      } ${className}`}
    >
      <img
        src={JIANG_NAN_LOGO_SRC}
        alt="Jiang Nan"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`w-auto object-contain block ${
          compact ? 'h-12 -my-2' : 'h-16 -my-3'
        }`}
      />
    </div>
  );
}
