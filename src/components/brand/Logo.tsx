import { WORDMARK_PATH, WORDMARK_VIEWBOX } from "./wordmark-path";

export function Wordmark({ className, title = "fabrikadann" }: { className?: string; title?: string }) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} className={className} fill="currentColor" role="img" aria-label={title}>
      <path fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}

const N_PATH = "M0 28H105V455L573 0V672H468V245L0 700Z";

/** İki N monogramı. animate: iki harf üst üste başlayıp yerine kayar. */
export function Monogram({ className, animate = false }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 1400 700" className={className} fill="currentColor" role="img" aria-label="fabrikadann">
      <path d={N_PATH} className={animate ? "monogram-sol" : undefined} />
      <g className={animate ? "monogram-sag" : undefined}>
        <path d={N_PATH} transform="translate(1400 0) scale(-1 1)" />
      </g>
    </svg>
  );
}
