import Image from "next/image";

type BrandMarkProps = {
  readonly className?: string;
  readonly label?: boolean;
  readonly size?: number;
};

export function BrandMark({
  className = "",
  label = false,
  size = 44,
}: BrandMarkProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        alt=""
        aria-hidden="true"
        height={size}
        priority
        src="/lens_logo.png"
        width={size}
      />
      {label && (
        <span className="text-[15px] font-semibold tracking-[-0.03em] text-[var(--ink)]">
          Lens
        </span>
      )}
    </span>
  );
}
