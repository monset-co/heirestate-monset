import logoUrl from "@/brand/heir-estates-logo.svg";

// The official mark: a gold key turning through a lit skyline, "Heir Estates" set under the arc.
// Its colours are fixed, so it reads the same on navy and on paper.
export function Mark({ className = "" }) {
  return <img src={logoUrl} alt="" aria-hidden="true" draggable="false" className={`w-auto select-none ${className}`} />;
}

export default function Logo({ className = "" }) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      <Mark className="h-14" />
      <span className="sr-only">Heir Estates</span>
    </span>
  );
}
