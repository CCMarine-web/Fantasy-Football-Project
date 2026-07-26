import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Inline link to a manager's profile.
 *
 * `inline-block` plus a little vertical padding is deliberate, not decorative:
 * at `text-sm` these anchors measured 22px tall, just under the 24x24 minimum
 * in WCAG 2.5.8 (Target Size), which is easy to mis-tap on a phone. Padding is
 * the least invasive way to clear the minimum — it leaves the type scale and
 * the surrounding line rhythm alone. `min-h-6` guarantees the floor even where
 * a caller overrides the text size.
 */
export function ManagerLink({
  managerId,
  children,
  className,
}: {
  managerId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/managers/${managerId}`}
      className={cn("hover:text-primary inline-flex min-h-6 items-center py-0.5", className)}
    >
      {children}
    </Link>
  );
}
