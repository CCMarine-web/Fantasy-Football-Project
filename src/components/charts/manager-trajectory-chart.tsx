"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrajectoryPoint {
  year: number;
  finalRank: number | null;
  teamCount: number;
}

export function ManagerTrajectoryChart({ data }: { data: TrajectoryPoint[] }) {
  const maxTeams = Math.max(10, ...data.map((d) => d.teamCount));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="year" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis
            reversed
            domain={[1, maxTeams]}
            allowDecimals={false}
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            labelFormatter={(l) => `${l} season`}
            formatter={(v) => [v == null ? "—" : `Finished #${v}`, "Final rank"]}
          />
          <Line
            type="monotone"
            dataKey="finalRank"
            stroke="var(--primary)"
            strokeWidth={2}
            connectNulls
            dot={{ r: 4, fill: "var(--primary)", strokeWidth: 0 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
