"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getPredictionSeason, upsertPrediction } from "@/server/repositories/prediction-repository";

export interface PredictionFormState {
  message: string | null;
  ok: boolean;
}

const schema = z.object({
  seasonId: z.string().min(1),
  standings: z.array(z.string().min(1)).min(1),
  championManagerId: z.string().min(1, "Pick a champion."),
  lastManagerId: z.string().min(1, "Pick a last-place finisher."),
  bustManagerId: z.string().min(1, "Pick a bust of the year."),
  predictedOwnWins: z.coerce.number().int().min(0).max(30),
  predictedOwnLosses: z.coerce.number().int().min(0).max(30),
  boldTake: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function submitPredictionAction(
  _prev: PredictionFormState,
  formData: FormData,
): Promise<PredictionFormState> {
  const session = await auth();
  const user = session?.user;
  if (!user) return { ok: false, message: "You must be signed in to predict." };
  if (!user.managerId) {
    return { ok: false, message: "Only managers linked to an account can submit predictions." };
  }

  const info = await getPredictionSeason();
  if (!info) return { ok: false, message: "There is no season to predict for." };
  if (info.locked) {
    return { ok: false, message: "Predictions are locked — the deadline has passed." };
  }

  const parsed = schema.safeParse({
    seasonId: formData.get("seasonId"),
    standings: formData.getAll("standings"),
    championManagerId: formData.get("championManagerId"),
    lastManagerId: formData.get("lastManagerId"),
    bustManagerId: formData.get("bustManagerId"),
    predictedOwnWins: formData.get("predictedOwnWins"),
    predictedOwnLosses: formData.get("predictedOwnLosses"),
    boldTake: formData.get("boldTake") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Please complete all required fields.",
    };
  }

  // Guard against a season mismatch between the rendered form and current season.
  if (parsed.data.seasonId !== info.season.id) {
    return { ok: false, message: "This form is out of date — please reload and try again." };
  }

  try {
    await upsertPrediction({
      seasonId: info.season.id,
      managerId: user.managerId,
      userId: user.id,
      predictedStandings: parsed.data.standings,
      predictedChampionManagerId: parsed.data.championManagerId,
      predictedLastManagerId: parsed.data.lastManagerId,
      bustManagerId: parsed.data.bustManagerId,
      predictedOwnWins: parsed.data.predictedOwnWins,
      predictedOwnLosses: parsed.data.predictedOwnLosses,
      boldTake: parsed.data.boldTake || null,
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not save your prediction.",
    };
  }

  revalidatePath("/predictions");
  revalidatePath("/predictions/submit");
  return { ok: true, message: "Your prediction is locked in. Good luck." };
}
