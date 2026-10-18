/**
 * The ARGraphics mark and wordmark. Kept in a file of their own so the public guest page
 * (/s/:code) can show the brand without loading the partner dashboard shell.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span className="owner-mark grid shrink-0 place-items-center rounded-[10px]" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Wordmark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <span className="text-[15px] font-bold tracking-[.02em]">ARGraphics</span>
    </span>
  );
}
