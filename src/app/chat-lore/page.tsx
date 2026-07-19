import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  Eye,
  FileWarning,
  Quote,
  Tags,
  Upload,
  UserCheck,
  Users,
} from "lucide-react";

export const metadata = { title: "Chat Lore Import" };

const STEPS = [
  {
    icon: Upload,
    title: "1. Upload a chat export",
    description:
      "Upload a raw export file from iMessage, WhatsApp, GroupMe, Discord, or a plain-text/CSV/JSON file. Nothing is sent to an AI provider at this step — the file is only parsed and stored.",
  },
  {
    icon: Eye,
    title: "2. Preview parsed messages",
    description:
      "Review every message the parser extracted — timestamp, sender, text, and attachments — before anything is committed.",
  },
  {
    icon: Users,
    title: "3. Map participants to managers",
    description:
      "Match each raw sender name/number to a league Manager. Unmatched participants are excluded automatically.",
  },
  {
    icon: FileWarning,
    title: "4. Exclude & mark sensitive content",
    description:
      "Remove messages that shouldn't be kept at all, and flag anything sensitive so it's permanently excluded from AI context, regardless of approval status.",
  },
  {
    icon: Tags,
    title: "5. Tag quotes & classify receipts",
    description:
      "Tag messages as jokes, predictions, receipts, trade talk, or arguments to make them discoverable later on manager and rivalry pages.",
  },
  {
    icon: UserCheck,
    title: "6. Approve for AI use",
    description:
      "Only messages explicitly approved here are ever eligible to be retrieved as context for AI-generated content — and only a narrow, relevant slice at generation time, never the full archive.",
  },
];

export default function ChatLorePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin Only"
        title="Chat Lore Import"
        description="The pipeline for turning years of group-chat history into searchable league lore — safely, and only with explicit approval."
      />

      <Card className="mt-8 border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            This page is a preview of the import workflow. Uploading is not yet wired to a live
            parser run in this build, but the underlying provider-based parser architecture (plain
            text, WhatsApp, GroupMe, Discord, CSV, JSON, with iMessage pending a real export sample)
            already exists in <code>src/server/chat-import</code>.
          </p>
        </CardContent>
      </Card>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {STEPS.map((step) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm uppercase">
                <step.icon className="h-4 w-4 text-primary" />
                {step.title}
              </CardTitle>
              <CardDescription>{step.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="uppercase">Upload a New Export</CardTitle>
          <CardDescription>Disabled in this build — placeholder for the real upload flow.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="platform">Source Platform</Label>
            <select
              id="platform"
              disabled
              className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm opacity-60"
            >
              <option>Plain Text</option>
              <option>WhatsApp</option>
              <option>GroupMe</option>
              <option>Discord</option>
              <option>CSV</option>
              <option>JSON</option>
              <option>iMessage (coming soon)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="file">Export File</Label>
            <input
              id="file"
              type="file"
              disabled
              className="block w-full max-w-xs text-sm text-muted-foreground opacity-60"
            />
          </div>
          <Button disabled>Upload &amp; Parse</Button>
          <Badge variant="outline">Coming soon</Badge>
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 uppercase">
            <Quote className="h-4 w-4" /> Sample Parsed Preview
          </CardTitle>
          <CardDescription>What the preview/mapping step will look like once wired up.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">Sender</th>
                  <th className="px-3 py-2 text-left">Message</th>
                  <th className="px-3 py-2 text-left">Manager</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-muted-foreground">
                <tr>
                  <td className="px-3 py-2">2024-09-08 21:04</td>
                  <td className="px-3 py-2">Marcus</td>
                  <td className="px-3 py-2">&ldquo;bury your kicker, Kevin&rdquo;</td>
                  <td className="px-3 py-2">Marcus Cole</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px]">
                      Pending review
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
