/**
 * The product's mark: `public/mark-light.svg` on the light theme (dark legs), `public/mark.svg` on the
 * dark one (light legs), swapped by the theme's class, never by script. Files, not inline SVG: the
 * two share gradient ids, and the CSP allows images from the dashboard itself.
 */

const base = import.meta.env.BASE_URL;

/** `size`: its height in pixels, which is also its width (the mark is square). */
export function Mark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      <img src={`${base}mark-light.svg`} alt="" width={size} height={size} draggable={false} className="absolute inset-0 size-full dark:hidden" />
      <img src={`${base}mark.svg`} alt="" width={size} height={size} draggable={false} className="absolute inset-0 hidden size-full dark:block" />
    </span>
  );
}
