"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { updateVictorySpeech } from "@/server/repositories/championship-belt-repository";

const schema = z.object({
  seasonId: z.string().trim().min(1),
  victorySpeech: z.string().trim().max(5000),
});

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

export async function saveVictorySpeechAction(
  _prev: { message: string | null },
  formData: FormData,
): Promise<{ message: string | null }> {
  await requireAdmin();
  const parsed = schema.safeParse({
    seasonId: formData.get("seasonId"),
    victorySpeech: formData.get("victorySpeech") ?? "",
  });
  if (!parsed.success) return { message: "Could not save — please try again." };

  await updateVictorySpeech(parsed.data.seasonId, parsed.data.victorySpeech);
  revalidatePath("/championship-belt");
  revalidatePath("/championship-belt/edit");
  return { message: "Victory speech saved." };
}
