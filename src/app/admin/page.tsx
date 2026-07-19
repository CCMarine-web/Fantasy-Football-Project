import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getAdminOverview } from "@/server/repositories/admin-repository";
import { isAIConfigured, isSleeperConfigured } from "@/lib/env";
import {
  ClipboardEdit,
  MessageSquareWarning,
  RefreshCw,
  Settings2,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";

export const metadata = { title: "Admin" };

function StatusBadge({ ok, onLabel, offLabel }: { ok: boolean; onLabel: string; offLabel: string }) {
  return (
    <Badge className={ok ? "bg-field text-field-foreground" : ""} variant={ok ? "default" : "outline"}>
      {ok ? onLabel : offLabel}
    </Badge>
  );
}

export default async function AdminPage() {
  const overview = await getAdminOverview();
  const sleeperConfigured = isSleeperConfigured();
  const aiConfigured = isAIConfigured();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Commissioner Tools"
        title="Admin Dashboard"
        description="League configuration, data sync, AI settings, and content review — visible only to admins."
      />

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Settings2 className="h-4 w-4" /> Sleeper League Configuration
            </CardTitle>
            <CardDescription>{overview.league?.name ?? "No league configured yet"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sleeper connection</span>
              <StatusBadge ok={sleeperConfigured} onLabel="Connected" offLabel="Using mock provider" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sleeper league ID</span>
              <span className="font-mono">{overview.league?.sleeperLeagueId ?? "—"}</span>
            </div>
            <Button size="sm" variant="outline" disabled>
              Configure League ID
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <RefreshCw className="h-4 w-4" /> Data Synchronization
            </CardTitle>
            <CardDescription>Recent sync runs, most recent first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.recentSyncLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No syncs recorded yet.</p>
            ) : (
              overview.recentSyncLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm">
                  <span>{log.syncType.replace("_", " ")}</span>
                  <Badge
                    variant={log.status === "SUCCESS" ? "default" : log.status === "FAILED" ? "destructive" : "outline"}
                    className={log.status === "SUCCESS" ? "bg-field text-field-foreground" : ""}
                  >
                    {log.status}
                  </Badge>
                </div>
              ))
            )}
            <Button size="sm" className="mt-2" disabled>
              Run New Sync
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Users className="h-4 w-4" /> Manager Identity Mapping
            </CardTitle>
            <CardDescription>{overview.managerCount} managers on record.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Map Sleeper user IDs and future chat-export participants to canonical Manager records.
            </p>
            <Button size="sm" variant="outline" className="mt-3" disabled>
              Manage Mappings
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="uppercase">Season Management</CardTitle>
            <CardDescription>{overview.seasonCount} seasons on record.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Create seasons, set playoff structure, and mark the current season.
            </p>
            <Button size="sm" variant="outline" className="mt-3" disabled>
              Manage Seasons
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Sparkles className="h-4 w-4" /> AI Generation Settings
            </CardTitle>
            <CardDescription>
              <StatusBadge ok={aiConfigured} onLabel="OpenAI connected" offLabel="Using mock provider" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Default humor level</span>
              <span className="font-mono">{overview.league?.defaultHumorLevel ?? 3} / 5</span>
            </div>
            <div>
              <span className="text-muted-foreground">Sensitive-topic exclusions</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {(overview.league?.sensitiveTopics ?? []).map((topic) => (
                  <Badge key={topic} variant="outline" className="text-[10px]">
                    {topic}
                  </Badge>
                ))}
              </div>
            </div>
            <Button size="sm" variant="outline" disabled>
              Edit AI Settings
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Upload className="h-4 w-4" /> Group-Chat Imports
            </CardTitle>
            <CardDescription>
              {overview.pendingChatMessages} messages pending approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.chatImports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No imports yet.</p>
            ) : (
              overview.chatImports.map((imp) => (
                <div key={imp.id} className="flex items-center justify-between text-sm">
                  <span>{imp.originalFileName}</span>
                  <Badge variant="outline">{imp.status}</Badge>
                </div>
              ))
            )}
            <Button size="sm" variant="outline" className="mt-2" disabled>
              Go to Chat Lore Import
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <MessageSquareWarning className="h-4 w-4" /> Article Review
            </CardTitle>
            <CardDescription>{overview.pendingGenerations} generations awaiting review.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Approve, edit, or regenerate AI-drafted articles before they publish to `/news`.
            </p>
            <Button size="sm" variant="outline" className="mt-3" disabled>
              Review Queue
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <ClipboardEdit className="h-4 w-4" /> Manual Data Corrections
            </CardTitle>
            <CardDescription>Fix scores, rosters, or records that synced incorrectly.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" disabled>
              Open Corrections Tool
            </Button>
          </CardContent>
        </Card>
      </div>

      <Separator className="my-8" />
      <p className="text-xs text-muted-foreground">
        Most actions on this page are placeholders for this build — the underlying services (sync,
        AI generation, chat import) already exist under <code>src/server/</code> and will be wired
        to these controls in a subsequent phase.
      </p>
    </div>
  );
}
