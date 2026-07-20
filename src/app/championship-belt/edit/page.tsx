import Link from "next/link";
import { Trophy } from "lucide-react";
import { auth } from "@/auth";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { getCurrentChampion } from "@/server/repositories/championship-belt-repository";
import { VictorySpeechForm } from "./victory-speech-form";

export const metadata = { title: "Edit Championship Belt" };

export default async function EditChampionshipBeltPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");

  const champion = await getCurrentChampion();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Edit Championship Belt"
        description="Update the reigning champion's victory speech."
        actions={
          <Button render={<Link href="/championship-belt" />} nativeButton={false} variant="outline" size="sm">
            View Championship Belt
          </Button>
        }
      />

      <div className="mt-8">
        {!champion ? (
          <EmptyState
            icon={Trophy}
            title="No champion to edit yet"
            description="A champion appears once a season is completed and its title is recorded."
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Editing the {champion.year} champion:{" "}
              <span className="font-medium text-foreground">{champion.managerName}</span> ·{" "}
              {champion.teamName}
            </p>
            <VictorySpeechForm seasonId={champion.seasonId} initialSpeech={champion.victorySpeech ?? ""} />
          </div>
        )}
      </div>
    </div>
  );
}
