import type { Route } from "next";
import Link from "next/link";

export function DetailPageNav({
  items,
}: {
  items: Array<{
    label: string;
    href?: Route;
  }>;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]" aria-label="详情页导航">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div className="flex items-center gap-2" key={`${item.label}-${index}`}>
            {item.href && !isLast ? (
              <Link
                className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                href={item.href}
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={`rounded-full px-3 py-1.5 ${
                  isLast ? "bg-[var(--panel)] text-[var(--text)] ring-1 ring-[var(--line)]" : ""
                }`}
              >
                {item.label}
              </span>
            )}
            {!isLast ? <span className="text-[var(--muted)]/60">/</span> : null}
          </div>
        );
      })}
    </nav>
  );
}
