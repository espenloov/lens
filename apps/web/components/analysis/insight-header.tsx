type InsightHeaderProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly explanation: string;
  readonly titleId?: string;
  readonly descriptionId?: string;
};

export function InsightHeader({
  eyebrow,
  title,
  explanation,
  titleId,
  descriptionId,
}: InsightHeaderProps) {
  return (
    <header className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:items-end">
      <div>
        <p className="text-xs font-medium text-[#176f6b]">{eyebrow}</p>
        <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-3xl" id={titleId}>
          {title}
        </h2>
      </div>
      <p className="max-w-2xl text-pretty text-xs leading-5 text-[#66758e]" id={descriptionId}>
        {explanation}
      </p>
    </header>
  );
}
