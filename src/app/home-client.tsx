"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

type CreatorMetric = {
  username: string;
  profileUrl: string;
  userId: string;
  followerCount: number;
  engagementRate: number;
  playwrightAverageViews: number;
  playwrightStdDev: number;
  playwrightSdFilteredAverageViews: number;
  playwrightAverageViewsTimeSorted: number;
  playwrightStdDevTimeSorted: number;
  playwrightSdFilteredAverageViewsTimeSorted: number;
  playwrightTopMediaItemsUsed: number;
  playwrightTop10MediaViews: number;
  playwrightTop10MediaViewCounts: number[];
  playwrightTop10MediaShortcodes: string[];
  playwrightPagesFetched: number;
  playwrightItemsScanned: number;
  playwrightClipsFound: number;
  playwrightClipsWithViewsFound: number;
  playwrightStopReason: string;
  rocketAverageViews: number;
  rocketStdDev: number;
  rocketSdFilteredAverageViews: number;
  rocketAverageViewsTimeSorted: number;
  rocketStdDevTimeSorted: number;
  rocketSdFilteredAverageViewsTimeSorted: number;
  rocketTop20AverageViewsTimeSortedSdFiltered: number;
  rocketTop20AverageViewsTimeSortedRaw: number;
  rocketTop60EveryOtherAverageViewsTimeSorted: number;
  rocketTop10MedianViewsTimeSortedSdFiltered: number;
  rocketTopMediaItemsUsed: number;
  rocketTop60MediaViews: number;
  rocketPagesFetched: number;
  rocketItemsScanned: number;
  rocketClipsFound: number;
  rocketClipsWithViewsFound: number;
  rocketStopReason: string;
  last30DaysVideosUsed: number;
  last30DaysAverageViews: number;
  last30DaysStdDev: number;
  last30DaysSdFilteredAverageViews: number;
};

type HomeClientProps = {
  devModeEnabled: boolean;
};

export default function HomeClient({ devModeEnabled }: HomeClientProps) {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<CreatorMetric[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDevMode, setIsDevMode] = useState(devModeEnabled);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);

  const hasRows = rows.length > 0;

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
      }),
    []
  );

  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  );

  function escapeCsvCell(value: string | number): string {
    const text = String(value ?? "");
    const escaped = text.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  }

  function handleExportCsv() {
    if (rows.length === 0) {
      return;
    }

    const headers = [
      "Username",
      "Profile URL",
      "Follower Count",
      "Average View Count (Excl Top 4)",
      "Average View Count (No Exclusion, Raw)",
      "Average View Count (Top 60, Every Other)",
      "Median View Count",
      "Engagement Rate",
    ];

    const lines = [headers.map((header) => escapeCsvCell(header)).join(",")];

    for (const row of rows) {
      const csvRow = [
        row.username,
        row.profileUrl,
        row.followerCount,
        Math.round(row.rocketTop20AverageViewsTimeSortedSdFiltered),
        Math.round(row.rocketTop20AverageViewsTimeSortedRaw),
        Math.round(row.rocketTop60EveryOtherAverageViewsTimeSorted),
        Math.round(row.rocketTop10MedianViewsTimeSortedSdFiltered),
        row.engagementRate.toFixed(2),
      ];

      lines.push(csvRow.map((value) => escapeCsvCell(value)).join(","));
    }

    const csvContent = `${lines.join("\n")}\n`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `instagram-metrics-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setIsStopping(false);
    setError("");
    setRows([]);
    stopRequestedRef.current = false;
    abortRef.current = new AbortController();

    const rawEntries = input
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    const entries = Array.from(new Set(rawEntries));
    if (entries.length === 0) {
      setError("Paste at least one Instagram profile URL or username.");
      setProgress({ done: 0, total: 0 });
      setIsLoading(false);
      setIsStopping(false);
      abortRef.current = null;
      return;
    }

    setProgress({ done: 0, total: entries.length });

    const errors: string[] = [];

    let wasStopped = false;

    try {
      for (let index = 0; index < entries.length; index += 1) {
        if (stopRequestedRef.current) {
          wasStopped = true;
          break;
        }

        const entry = entries[index];

        try {
          const response = await fetch("/api/instagram/metrics", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            signal: abortRef.current?.signal,
            body: JSON.stringify({
              usernamesText: entry,
            }),
          });

          const data = (await response.json()) as { error?: string; rows?: CreatorMetric[] };
          if (!response.ok) {
            throw new Error(data.error || "Request failed.");
          }

          const fetchedRows = data.rows ?? [];
          if (fetchedRows.length > 0) {
            setRows((currentRows) => [...currentRows, ...fetchedRows]);
          }
        } catch (accountError) {
          if (
            (accountError instanceof DOMException || accountError instanceof Error) &&
            accountError.name === "AbortError"
          ) {
            wasStopped = true;
            break;
          }

          const message =
            accountError instanceof Error ? accountError.message : "Unexpected error.";
          errors.push(`${entry}: ${message}`);
        }

        setProgress({ done: index + 1, total: entries.length });
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unexpected error.";
      setError(message);
      setRows([]);
    } finally {
      if (wasStopped) {
        setError("Stopped by user.");
      } else if (errors.length > 0) {
        setError(`Some accounts failed: ${errors.join(" | ")}`);
      }

      abortRef.current = null;
      setIsLoading(false);
      setIsStopping(false);
    }
  }

  function handleStop() {
    if (!isLoading || stopRequestedRef.current) {
      return;
    }

    stopRequestedRef.current = true;
    setIsStopping(true);
    abortRef.current?.abort();
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="min-h-72 w-full rounded-md border border-zinc-300 bg-white p-4 text-base outline-none focus:border-zinc-500"
          placeholder="Paste Instagram profile URLs or usernames (space or newline separated)"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isLoading}
            className="h-11 w-36 rounded-md bg-zinc-900 text-sm font-medium text-white disabled:opacity-60"
          >
            {isLoading ? `Loading ${progress.done}/${progress.total}` : "Submit"}
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={!isLoading}
            className="h-11 w-24 rounded-md border border-zinc-300 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStopping ? "Stopping" : "Stop"}
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex items-center justify-end">
        {devModeEnabled ? (
          <label className="mr-4 inline-flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={isDevMode}
              onChange={(event) => setIsDevMode(event.target.checked)}
              className="h-4 w-4"
            />
            Dev Mode
          </label>
        ) : null}
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!hasRows}
          className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-300 bg-white">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-zinc-100">
            <tr>
              <th className="border-b border-zinc-300 px-4 py-3">Username</th>
              <th className="border-b border-zinc-300 px-4 py-3">Profile URL</th>
              <th className="border-b border-zinc-300 px-4 py-3">Follower Count</th>
              <th className="border-b border-zinc-300 px-4 py-3">Average View Count (Excl Top 4)</th>
              <th className="border-b border-zinc-300 px-4 py-3">Average View Count (No Exclusion, Raw)</th>
              <th className="border-b border-zinc-300 px-4 py-3">Average View Count (Top 60, Every Other)</th>
              <th className="border-b border-zinc-300 px-4 py-3">Median View Count</th>
              <th className="border-b border-zinc-300 px-4 py-3">Engagement Rate</th>
              {isDevMode ? (
                <>
                  <th className="border-b border-zinc-300 px-4 py-3">User ID</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Raw Avg</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Avg Time Sorted</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Std Dev Time Sorted</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket SD-Filtered Time Sorted</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Std Dev</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket60 Avg (SD Filtered)</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Top 10 Median (Time Sorted, SD Filtered)</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Last 30d Avg</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Last 30d Std Dev</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Last 30d SD-Filtered Avg</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Last 30d Videos Used</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Top 60 Views</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Items Used</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Pages Fetched</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Items Scanned</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Clips Found</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Clips With Views</th>
                  <th className="border-b border-zinc-300 px-4 py-3">Rocket Stop Reason</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {hasRows
              ? rows.map((row) => (
                  <tr key={row.username}>
                    <td className="border-b border-zinc-200 px-4 py-3">{row.username}</td>
                    <td className="border-b border-zinc-200 px-4 py-3">
                      <a
                        href={row.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-900 underline"
                      >
                        {row.profileUrl}
                      </a>
                    </td>
                    <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.followerCount)}</td>
                    <td className="border-b border-zinc-200 px-4 py-3">
                      {formatter.format(row.rocketTop20AverageViewsTimeSortedSdFiltered)}
                    </td>
                    <td className="border-b border-zinc-200 px-4 py-3">
                      {formatter.format(row.rocketTop20AverageViewsTimeSortedRaw)}
                    </td>
                    <td className="border-b border-zinc-200 px-4 py-3">
                      {formatter.format(row.rocketTop60EveryOtherAverageViewsTimeSorted)}
                    </td>
                    <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketTop10MedianViewsTimeSortedSdFiltered)}</td>
                    <td className="border-b border-zinc-200 px-4 py-3">{percentFormatter.format(row.engagementRate)}%</td>
                    {isDevMode ? (
                      <>
                        <td className="border-b border-zinc-200 px-4 py-3 font-mono">{row.userId}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketAverageViews)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketAverageViewsTimeSorted)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketStdDevTimeSorted)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketSdFilteredAverageViewsTimeSorted)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketStdDev)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketSdFilteredAverageViews)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketTop10MedianViewsTimeSortedSdFiltered)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.last30DaysAverageViews)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.last30DaysStdDev)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.last30DaysSdFilteredAverageViews)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{row.last30DaysVideosUsed}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{formatter.format(row.rocketTop60MediaViews)}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{row.rocketTopMediaItemsUsed}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{row.rocketPagesFetched}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{row.rocketItemsScanned}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{row.rocketClipsFound}</td>
                        <td className="border-b border-zinc-200 px-4 py-3">{row.rocketClipsWithViewsFound}</td>
                        <td className="border-b border-zinc-200 px-4 py-3 font-mono text-xs">{row.rocketStopReason}</td>
                      </>
                    ) : null}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
