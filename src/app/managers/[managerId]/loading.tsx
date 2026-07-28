import { PageSkeleton } from "@/components/shared/page-skeleton";

/** A profile is the heaviest page on the site — a dozen queries deep. */
export default function Loading() {
  return <PageSkeleton rows={8} />;
}
