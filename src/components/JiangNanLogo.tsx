interface JiangNanLogoProps {
  className?: string;
  compact?: boolean;
}

export function JiangNanLogo({ className = '', compact = false }: JiangNanLogoProps) {
  return (
    <div
      className={`inline-flex items-center select-none ${compact ? 'gap-1' : 'gap-1.5'} ${className}`}
      aria-label="Jiang Nan"
    >
      <span
        className={`font-bold tracking-wider text-zinc-900 ${
          compact ? 'text-[11px]' : 'text-[13px]'
        }`}
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        JIANG
      </span>
      <svg
        viewBox="0 0 36 36"
        className={compact ? 'w-6 h-6 shrink-0' : 'w-8 h-8 shrink-0'}
        aria-hidden="true"
      >
        <circle cx="18" cy="18" r="17" fill="#B91C1C" />
        <circle
          cx="18"
          cy="18"
          r="14.5"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.2"
          strokeOpacity="0.92"
        />
        <text
          x="18"
          y="15.2"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="11.5"
          fontWeight="700"
          fontFamily='"Noto Serif SC", "Songti SC", "SimSun", serif'
        >
          江
        </text>
        <text
          x="18"
          y="27.2"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="11.5"
          fontWeight="700"
          fontFamily='"Noto Serif SC", "Songti SC", "SimSun", serif'
        >
          南
        </text>
      </svg>
      <span
        className={`font-bold tracking-wider text-zinc-900 ${
          compact ? 'text-[11px]' : 'text-[13px]'
        }`}
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        NAN
      </span>
    </div>
  );
}
