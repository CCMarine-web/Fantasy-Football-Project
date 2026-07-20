import { PageHeader } from "@/components/shared/page-header";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { AdminPredictionForm } from "./admin-prediction-form";

export const metadata = { title: "Backfill Predictions" };

export default async function AdminPredictionsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const [seasons, managers] = await Promise.all([
    prisma.season.findMany({ select: { id: true, year: true }, orderBy: { year: "desc" } }),
    prisma.manager.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Backfill Predictions"
        description="Manually enter a past prediction for any season and manager. This bypasses the deadline lock and overwrites any existing entry for that season + manager."
      />

      <div className="mt-8">
        <AdminPredictionForm
          seasons={seasons.map((s) => ({ id: s.id, label: String(s.year) }))}
          managers={managers.map((m) => ({ id: m.id, label: m.displayName }))}
        />
      </div>
    </div>
  );
}
