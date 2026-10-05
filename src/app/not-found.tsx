import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/branding";
import { BrandArt } from "@/components/shared/brand-art";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandArt
        slot="not-found"
        sizes="192px"
        className="h-48 w-48 object-contain"
        fallback={
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SearchX className="h-7 w-7" aria-hidden />
          </span>
        }
      />
      <h1 className="font-heading text-2xl font-semibold tracking-wide uppercase">Nothing here</h1>
      <p className="text-sm text-muted-foreground">
        That page doesn&apos;t exist — or the link is from a season {BRAND.name} has since moved past.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button render={<Link href="/matchups" />} nativeButton={false}>
          This week&apos;s matchups
        </Button>
        <Button render={<Link href="/" />} nativeButton={false} variant="outline">
          Home
        </Button>
      </div>
    </div>
  );
}
