#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://www.googleapis.com/youtube/v3";

function parseArgs(argv) {
  const args = {
    input: "data/channels.json",
    output: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if ((token === "--input" || token === "-i") && next) {
      args.input = next;
      i += 1;
      continue;
    }

    if ((token === "--output" || token === "-o") && next) {
      args.output = next;
      i += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      return args;
    }
  }

  return args;
}

function printHelp() {
  console.log(`YouTube Creator Metrics Tool

Usage:
  node tools/youtube-creator-metrics.mjs --input data/channels.json --output data/report.json

Required env var:
  YOUTUBE_API_KEY

Input file format (JSON array):
[
  { "name": "Ali Abdaal", "channelId": "UCoOae5nYA7VqaXzerajD0lg" },
  { "name": "Colin and Samir", "channelId": "UCu7ttT53TGFw4Mvhx2G5vYg" }
]
`);
}

async function readInput(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Input JSON must be an array.");
  }

  for (const row of parsed) {
    if (!row.channelId || !row.name) {
      throw new Error("Each row must include name and channelId.");
    }
  }

  return parsed;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YouTube API request failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function getFollowerCount(apiKey, channelId) {
  const url = new URL(`${BASE_URL}/channels`);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", channelId);
  url.searchParams.set("key", apiKey);

  const json = await fetchJson(url);
  const channel = json.items?.[0];
  if (!channel?.statistics?.subscriberCount) {
    throw new Error(`No subscriber data found for channel ${channelId}`);
  }

  return Number(channel.statistics.subscriberCount);
}

async function getTop10VideoIds(apiKey, channelId) {
  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set("part", "id");
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "viewCount");
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("key", apiKey);

  const json = await fetchJson(url);
  return (json.items ?? [])
    .map((item) => item?.id?.videoId)
    .filter(Boolean);
}

async function getTotalViewsForVideoIds(apiKey, videoIds) {
  if (videoIds.length === 0) {
    return 0;
  }

  const url = new URL(`${BASE_URL}/videos`);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", apiKey);

  const json = await fetchJson(url);
  return (json.items ?? []).reduce((sum, item) => {
    const views = Number(item?.statistics?.viewCount ?? 0);
    return sum + views;
  }, 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

async function run() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing YOUTUBE_API_KEY environment variable.");
  }

  const absoluteInput = path.resolve(process.cwd(), args.input);
  const channels = await readInput(absoluteInput);

  const rows = [];

  for (const channel of channels) {
    const followerCount = await getFollowerCount(apiKey, channel.channelId);
    const top10VideoIds = await getTop10VideoIds(apiKey, channel.channelId);
    const top10MediaViews = await getTotalViewsForVideoIds(apiKey, top10VideoIds);

    rows.push({
      creator: channel.name,
      channelId: channel.channelId,
      followerCount,
      top10MediaViews,
    });
  }

  console.table(
    rows.map((row) => ({
      creator: row.creator,
      channelId: row.channelId,
      followerCount: formatNumber(row.followerCount),
      top10MediaViews: formatNumber(row.top10MediaViews),
    }))
  );

  if (args.output) {
    const absoluteOutput = path.resolve(process.cwd(), args.output);
    await fs.writeFile(absoluteOutput, JSON.stringify(rows, null, 2), "utf-8");
    console.log(`Saved report to ${absoluteOutput}`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
