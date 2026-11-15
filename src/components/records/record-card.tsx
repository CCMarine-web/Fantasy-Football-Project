import { ManagerLink } from "@/components/shared/manager-link";
import { Card, CardContent } from "@/components/ui/card";
import type { RecordEntry, RankedRow } from "@/server/repositories/computed-records-repository";

function rankLabel(r: RankedRow): string {
  return r.tied ? `T-${r.rank}` : String(r.rank);
}

function Holder({ id, name }: { id: string | null; name: string }) {
  return id ? (
    <ManagerLink managerId={id} name={name.includes(" & ") ? undefined : name}>
      {name}
    </ManagerLink>
  ) : (
    <>{name}</>
  );
}

/**
 * One record: the headline holder as before, plus — when the record has a
 * ranking — a native <details> with the rest of the all-time top 10. Works
 * without JavaScript, and a tie at the top is said on the card itself rather
 * than hidden behind whichever row happened to sort first.
 */
export function RecordCard({ record }: { record: RecordEntry }) {
  const rest = record.top?.slice(1) ?? [];
  const sharedTop = record.top?.[0]?.tied ?? false;
  return (
    <Card>
      <CardContent>
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{record.label}</p>
        <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{record.value}</p>
        <p className="mt-1 text-sm font-medium">
          <Holder id={record.holderManagerId} name={record.holderName} />
        </p>
        <p className="text-xs text-muted-foreground">{record.detail}</p>
        {sharedTop ? (
          <p className="mt-1 text-xs font-medium text-primary">Shared record: tied for #1, see the list.</p>
        ) : null}
        {rest.length > 0 ? (
          <details className="group mt-3 border-t border-border/60 pt-2">
            <summary className="cursor-pointer text-xs font-medium text-primary select-none hover:underline">
              <span className="group-open:hidden">Show the top 10</span>
              <span className="hidden group-open:inline">Hide the top 10</span>
            </summary>
            <ol className="mt-2 space-y-1.5 text-xs">
              {rest.map((r, i) => (
                <li key={`${r.rank}-${i}`} className="grid grid-cols-[2.25rem_1fr_auto] items-baseline gap-x-2">
                  <span className="font-mono text-muted-foreground tabular-nums">{rankLabel(r)}</span>
                  <span className="min-w-0">
                    <span className="font-medium">
                      <Holder id={r.holderManagerId} name={r.holderName} />
                    </span>
                    <span className="block truncate text-muted-foreground" title={r.detail}>
                      {r.detail}
                    </span>
                  </span>
                  <span className="font-mono font-semibold tabular-nums">{r.value}</span>
                </li>
              ))}
            </ol>
            {record.topMoreTied ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                …and {record.topMoreTied} more tied at the last rank shown.
              </p>
            ) : null}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Ties share a rank (T-3); everyone tied at 10th is listed.
            </p>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
