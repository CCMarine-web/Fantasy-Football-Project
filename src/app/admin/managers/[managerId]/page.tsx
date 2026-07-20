import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { ManagerEditForm } from "./manager-edit-form";

export const metadata = { title: "Edit Manager" };

export default async function AdminManagerEditPage({
  params,
}: {
  params: Promise<{ managerId: string }>;
}) {
  const { managerId } = await params;
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    select: { id: true, displayName: true, photoUrl: true, nickname: true, nicknameOrigin: true, signatureMove: true, bio: true, noRoast: true },
  });
  if (!manager) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title={`Edit ${manager.displayName}`}
        description="Photo, nickname, signature move, and bio for the personality layer."
        actions={
          <Button render={<Link href={`/managers/${manager.id}`} />} nativeButton={false} variant="outline" size="sm">
            View profile
          </Button>
        }
      />
      <div className="mt-8">
        <ManagerEditForm manager={manager} />
      </div>
    </div>
  );
}
