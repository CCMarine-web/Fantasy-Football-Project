import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/auth";
import { MediaCategory } from "@/generated/prisma/client";
import { listMediaAssets, type MediaAssetView } from "@/server/repositories/admin-review-repository";
import {
  approveMediaAction,
  rejectMediaAction,
  togglePublishMediaAction,
  changeCategoryAction,
  setAsManagerPhotoAction,
} from "./actions";

export const metadata = { title: "Review Media" };

export const dynamic = "force-dynamic";

const CATEGORY_VALUES = Object.values(MediaCategory);

const STATUS_VARIANT = {
  PENDING: "secondary",
  APPROVED: "outline",
  REJECTED: "destructive",
} as const;

const STATUS_GROUPS = ["PENDING", "APPROVED", "REJECTED"] as const;

export default async function AdminMediaPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const assets = await listMediaAssets();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Review Media"
        description="Approve, categorize, and publish imported images. Publishing makes an image PUBLICLY visible."
      />

      <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Warning: publishing an image makes it publicly visible on the site. Only publish images you
        are certain are safe to show. Images of identifiable people should stay unpublished unless
        approved.
      </p>

      {assets.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No media imported yet"
            description="Imported images will appear here for review, categorization, and publishing."
          />
        </div>
      ) : (
        STATUS_GROUPS.map((group) => {
          const groupAssets = assets.filter((a) => a.approvalStatus === group);
          return (
            <section key={group} className="mt-10">
              <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
                {group} ({groupAssets.length})
              </h2>
              {groupAssets.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {groupAssets.map((asset) => (
                    <MediaCard key={asset.id} asset={asset} />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function MediaCard({ asset }: { asset: MediaAssetView }) {
  return (
    <Card className="gap-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.url}
        alt={asset.originalFilename}
        className="aspect-video w-full bg-muted object-contain"
      />
      <CardContent className="space-y-3 py-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={asset.originalFilename}>
            {asset.originalFilename}
          </span>
          <Badge variant={STATUS_VARIANT[asset.approvalStatus]}>{asset.approvalStatus}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{asset.category}</Badge>
          {asset.isPublished ? (
            <Badge className="bg-field text-field-foreground">Published</Badge>
          ) : (
            <Badge variant="secondary">Unpublished</Badge>
          )}
          {asset.category === "PROFILE" && asset.managerName ? (
            <span className="text-xs text-muted-foreground">for {asset.managerName}</span>
          ) : null}
        </div>

        {asset.notes ? <p className="text-xs text-muted-foreground">{asset.notes}</p> : null}

        <form action={changeCategoryAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={asset.id} />
          <select
            name="category"
            defaultValue={asset.category}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          >
            {CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="submit" className="text-xs font-medium text-primary hover:underline">
            Set category
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {asset.approvalStatus !== "APPROVED" ? (
            <form action={approveMediaAction}>
              <input type="hidden" name="id" value={asset.id} />
              <button type="submit" className="text-xs font-medium text-field hover:underline">
                Approve
              </button>
            </form>
          ) : null}
          {asset.approvalStatus !== "REJECTED" ? (
            <form action={rejectMediaAction}>
              <input type="hidden" name="id" value={asset.id} />
              <button type="submit" className="text-xs font-medium text-destructive hover:underline">
                Reject
              </button>
            </form>
          ) : null}
          <form action={togglePublishMediaAction}>
            <input type="hidden" name="id" value={asset.id} />
            <input type="hidden" name="publish" value={asset.isPublished ? "false" : "true"} />
            <button type="submit" className="text-xs font-medium text-primary hover:underline">
              {asset.isPublished ? "Unpublish" : "Publish (public!)"}
            </button>
          </form>
          {asset.category === "PROFILE" && asset.managerId ? (
            <form action={setAsManagerPhotoAction}>
              <input type="hidden" name="id" value={asset.id} />
              <button type="submit" className="text-xs font-medium text-primary hover:underline">
                Set as {asset.managerName ?? "manager"}&apos;s photo
              </button>
            </form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
