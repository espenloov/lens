"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { cn } from "@/lib/utils";

type LivingDashboardProps = {
  readonly children: ReactNode;
  readonly className?: string;
  readonly title: string;
};

export function LivingDashboard({
  children,
  className,
  title,
}: LivingDashboardProps) {
  const [expanded, setExpanded] = useState(false);
  const controlRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    controlRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  return (
    <section
      aria-label={expanded ? `${title} exploration field` : undefined}
      aria-modal={expanded || undefined}
      className={cn(
        "living-dashboard",
        expanded && "is-expanded",
        className,
      )}
      role={expanded ? "dialog" : undefined}
    >
      <div className="living-dashboard-toolbar">
        {expanded && (
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#697cc7]">
              Exploration field
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-[var(--ink)]">
              {title}
            </p>
          </div>
        )}
        <button
          aria-expanded={expanded}
          className="living-dashboard-toggle"
          onClick={() => setExpanded((current) => !current)}
          ref={controlRef}
          type="button"
        >
          {expanded ? (
            <Minimize2 aria-hidden="true" className="size-3.5" />
          ) : (
            <Maximize2 aria-hidden="true" className="size-3.5" />
          )}
          {expanded ? "Return to dashboard" : "Open exploration field"}
        </button>
      </div>
      <div className="living-dashboard-stage">{children}</div>
    </section>
  );
}
