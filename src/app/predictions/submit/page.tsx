import Link from "next/link";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import {
  getPredictionSeason,
  getMyPrediction,
  listManagersForPredictionForm,
} from "@/server/repositories/prediction-repository";
import { PredictionForm } from "../prediction-form";

export const metadata = { title: "Submit Prediction" };

function Shell({ year, children }: { year?: number; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={year ? `${year} Season` : "Preseason"}
        title="Make Your Picks"
        description="Call your shots before the draft. You can edit any time until predictions lock."
        actions={
          <Button render={<Link href="/predictions" />} nativeButton={false} variant="outline" size="sm">
            All predictions
          </Button>
        }
      />
      <div className="mt-8">{children}</div>
    </div>
  );
}

export default async function SubmitPredictionPage() {
  const info = await getPredictionSeason();

  if (!info) {
    return (
      <Shell>
        <EmptyState title="No season yet" description="There is no season open for predictions." />
      </Shell>
    );
  }

  const session = await auth();
  const user = session?.user;

  if (!user) {
    return (
      <Shell year={info.season.year}>
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              You need to be signed in to submit a prediction.
            </p>
            <Button
              render={<Link href="/login?callbackUrl=/predictions/submit" />}
              nativeButton={false}
            >
              Sign in
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (!user.managerId) {
    return (
      <Shell year={info.season.year}>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Your account isn&apos;t linked to a manager yet, so you can&apos;t submit predictions.
            Ask an admin to link your account to your manager profile.
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const existing = await getMyPrediction(user.managerId, info.season.id);

  // Deadline passed — show a read-only, locked view of what they submitted.
  if (info.locked) {
    const standings = Array.isArray(existing?.predictedStandings)
      ? (existing.predictedStandings as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    return (
      <Shell year={info.season.year}>
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                <Lock className="mr-1 h-3 w-3" aria-hidden />
                Locked
              </Badge>
              <span className="text-sm text-muted-foreground">
                The deadline has passed — predictions can no longer be edited.
              </span>
            </div>
            {existing ? (
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground uppercase">Predicted order</dt>
                  <dd>{standings.length} managers ranked</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground uppercase">Own record</dt>
                  <dd className="font-mono tabular-nums">
                    {existing.predictedOwnWins ?? "?"}–{existing.predictedOwnLosses ?? "?"}
                  </dd>
                </div>
                {existing.boldTake ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground uppercase">Bold take</dt>
                    <dd className="italic">“{existing.boldTake}”</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                You didn&apos;t submit a prediction before the deadline.
              </p>
            )}
            <Button render={<Link href="/predictions" />} nativeButton={false} variant="outline" size="sm">
              View the leaderboard
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const managers = await listManagersForPredictionForm();

  return (
    <Shell year={info.season.year}>
      <PredictionForm
        seasonId={info.season.id}
        managers={managers}
        existing={
          existing
            ? {
                predictedStandings: Array.isArray(existing.predictedStandings)
                  ? (existing.predictedStandings as unknown[]).filter(
                      (v): v is string => typeof v === "string",
                    )
                  : [],
                predictedChampionManagerId: existing.predictedChampionManagerId,
                predictedLastManagerId: existing.predictedLastManagerId,
                bustManagerId: existing.bustManagerId,
                predictedOwnWins: existing.predictedOwnWins,
                predictedOwnLosses: existing.predictedOwnLosses,
                boldTake: existing.boldTake,
              }
            : null
        }
      />
    </Shell>
  );
}
