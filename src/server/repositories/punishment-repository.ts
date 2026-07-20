import { prisma } from "@/lib/db";

export interface PunishmentView {
  id: string;
  year: number;
  managerId: string | null;
  managerName: string | null;
  description: string;
  photoUrl: string | null;
}

export async function listPunishments(): Promise<PunishmentView[]> {
  const rows = await prisma.punishment.findMany({
    include: { manager: { select: { id: true, displayName: true } } },
    orderBy: { year: "desc" },
  });
  return rows.map((p) => ({
    id: p.id,
    year: p.year,
    managerId: p.manager?.id ?? null,
    managerName: p.manager?.displayName ?? null,
    description: p.description,
    photoUrl: p.photoUrl,
  }));
}

/** Admin upsert of a season's last-place punishment (keyed by year). */
export async function upsertPunishment(input: {
  year: number;
  managerId?: string | null;
  description: string;
  photoUrl?: string | null;
}): Promise<void> {
  const season = await prisma.season.findFirst({ where: { year: input.year }, select: { id: true } });
  await prisma.punishment.upsert({
    where: { year: input.year },
    update: {
      managerId: input.managerId ?? null,
      description: input.description,
      photoUrl: input.photoUrl ?? null,
      seasonId: season?.id ?? null,
    },
    create: {
      year: input.year,
      managerId: input.managerId ?? null,
      description: input.description,
      photoUrl: input.photoUrl ?? null,
      seasonId: season?.id ?? null,
    },
  });
}

export async function deletePunishment(year: number): Promise<void> {
  await prisma.punishment.deleteMany({ where: { year } });
}
