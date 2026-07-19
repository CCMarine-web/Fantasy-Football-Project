import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { Badge } from "@/components/ui/badge";
import { listManagerSummaries } from "@/server/repositories/manager-repository";
import { Users } from "lucide-react";
import { BRAND } from "@/lib/branding";

export const metadata = { title: "Managers" };

export default async function ManagersPage() {
  const managers = await listManagerSummaries();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The League"
        title="Managers"
        description={`Every manager who has ever fielded a team in ${BRAND.longName}.`}
      />
      <div className="mt-8">
        {managers.length === 0 ? (
          <EmptyState icon={Users} title="No managers yet" description="Managers will appear here once the league is synced or seeded." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {managers.map((m) => (
              <Link key={m.managerId} href={`/managers/${m.managerId}`}>
                <Card className="h-full transition-colors hover:border-primary/60">
                  <CardContent className="flex items-start gap-4">
                    <TeamAvatar name={m.displayName} imageUrl={m.avatarUrl} className="h-12 w-12" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-heading text-lg font-semibold uppercase">
                        {m.displayName}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">{m.currentTeamName}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {m.careerWins}-{m.careerLosses}
                          {m.careerTies ? `-${m.careerTies}` : ""}
                        </Badge>
                        {m.championships > 0 ? (
                          <Badge className="bg-gold text-gold-foreground">
                            {m.championships}&times; Champion
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
