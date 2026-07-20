"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { upsertPrediction } from "@/server/repositories/prediction-repository";

export interface AdminPredictionState {
  message: string | null;
  ok: boolean;
}

const schema = z.object({
  seasonId: z.string().min(1, "Pick a season."),
  managerId: z.string().min(1, "Pick a manager."),
  standings: z.array(z.string().min(1)).min(1),
  championManagerId: z.string().optional().or(z.literal("")),
  lastManagerId: z.string().optional().or(z.literal("")),
  bustManagerId: z.string().optional().or(z.literal("")),
  predictedOwnWins: z.coerce.number().int().min(0).max(30).optional(),
  predictedOwnLosses: z.coerce.number().int().min(0).max(30).optional(),
  boldTake: z.string().trim().max(2000).optional().or(z.literal("")),
});

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

export async function saveAdminPredictionAction(
  _prev: AdminPredictionState,
  formData: FormData,
): Promise<AdminPredictionState> {
  await requireAdmin();

  const rawWins = formData.get("predictedOwnWins");
  const rawLosses = formData.get("predictedOwnLosses");
  const parsed = schema.safeParse({
    seasonId: formData.get("seasonId"),
    managerId: formData.get("managerId"),
    standings: formData.getAll("standings"),
    championManagerId: formData.get("championManagerId") ?? "",
    lastManagerId: formData.get("lastManagerId") ?? "",
    bustManagerId: formData.get("bustManagerId") ?? "",
    predictedOwnWins: rawWins ? rawWins : undefined,
    predictedOwnLosses: rawLosses ? rawLosses : undefined,
    boldTake: formData.get("boldTake") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await upsertPrediction({
      seasonId: parsed.data.seasonId,
      managerId: parsed.data.managerId,
      predictedStandings: parsed.data.standings,
      predictedChampionManagerId: parsed.data.championManagerId || null,
      predictedLastManagerId: parsed.data.lastManagerId || null,
      bustManagerId: parsed.data.bustManagerId || null,
      predictedOwnWins: parsed.data.predictedOwnWins ?? null,
      predictedOwnLosses: parsed.data.predictedOwnLosses ?? null,
      boldTake: parsed.data.boldTake || null,
      adminOverride: true,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not save." };
  }

  revalidatePath("/predictions");
  revalidatePath("/admin/predictions");
  return { ok: true, message: "Prediction saved." };
}
