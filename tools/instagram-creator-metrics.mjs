#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const PROFILE_API_URL = "https://v1.rocketapi.io/instagram/user/get_web_profile_info";
const CLIPS_API_URL = "https://v1.rocketapi.io/instagram/user/get_clips";
const CLIPS_EXCLUDED_FROM_TOP = 2;
const CLIPS_SELECTED_COUNT = 10;

function parseArgs(argv) {
  const args = {
    input: "data/instagram-usernames.json",
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
  console.log(`Instagram Creator Metrics Tool (RocketAPI)

Usage:
  node tools/instagram-creator-metrics.mjs --input data/instagram-usernames.json --output data/instagram-report.json

Required env var:
  ROCKETAPI_TOKEN

Input file format:
[
  { "username": "kyliejenner" },
  { "username": "therock" }
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
    if (!row?.username) {
      throw new Error("Each row must contain a username field.");
    }
  }

  return parsed;
}

async function fetchProfile(token, username) {
  const response = await fetch(PROFILE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({ username }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RocketAPI request failed for ${username} (${response.status}): ${text}`);
  }

  const json = await response.json();
  const user =
    json?.response?.body?.data?.user ??
    json?.response?.body?.user ??
    json?.response?.body?.data?.users?.[0] ??
    json?.response?.body?.users?.[0];

  if (!user) {
    throw new Error(`Could not find user object for username ${username}.`);
  }

  return user;
}

async function fetchClipsPage(token, userId, nextMaxId) {
  const payload = {
    id: Number(userId),
    count: 12,
  };

  if (nextMaxId) {
    payload.max_id = nextMaxId;
  }

  const response = await fetch(CLIPS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RocketAPI clips request failed for ${userId} (${response.status}): ${text}`);
  }

  const json = await response.json();
  const body = json?.response?.body;
  const itemsCandidate = body?.items ?? body?.data?.items ?? body?.clips ?? body?.data?.clips;
  const items = Array.isArray(itemsCandidate) ? itemsCandidate : [];
  const pageNextMaxId = body?.paging_info?.max_id ?? body?.data?.paging_info?.max_id;
  const moreAvailable = Boolean(body?.paging_info?.more_available ?? body?.data?.paging_info?.more_available);

  return {
    items,
    nextMaxId: typeof pageNextMaxId === "string" ? pageNextMaxId : undefined,
    moreAvailable,
  };
}

function getClipMediaFromItem(item) {
  return item?.media ?? item;
}

function isPinnedClipMedia(mediaItem) {
  if (mediaItem?.is_pinned === true) {
    return true;
  }

  if (Array.isArray(mediaItem?.timeline_pinned_user_ids) && mediaItem.timeline_pinned_user_ids.length > 0) {
    return true;
  }

  if (Array.isArray(mediaItem?.clips_tab_pinned_user_ids) && mediaItem.clips_tab_pinned_user_ids.length > 0) {
    return true;
  }

  return false;
}

function getMediaItemViewCount(item) {
  const value = Number(item?.video_view_count ?? item?.view_count ?? item?.play_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getMediaItemLikeCount(item) {
  const value = Number(item?.like_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getMediaItemCommentCount(item) {
  const value = Number(item?.comment_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getMediaItemShortcode(item) {
  const value = typeof item?.code === "string" ? item.code.trim() : "";
  return value;
}

function getMediaItemTakenAt(item) {
  const value = Number(item?.taken_at ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getLatestNClipMediaItems(items, n, offset = 0) {
  return [...items]
    .sort((a, b) => b.takenAt - a.takenAt)
    .slice(offset, offset + n);
}

async function fetchTopClipsViews(token, userId, neededCount) {
  const clipMediaItems = [];
  const seenShortcodes = new Set();
  const seenPageIds = new Set();
  const maxPages = 30;

  let nextMaxId;
  let page = 0;

  while (page < maxPages) {
    const mediaPage = await fetchClipsPage(token, userId, nextMaxId);

    for (const item of mediaPage.items) {
      const mediaItem = getClipMediaFromItem(item);
      if (isPinnedClipMedia(mediaItem)) {
        continue;
      }

      const shortcode = getMediaItemShortcode(mediaItem);
      if (!shortcode || seenShortcodes.has(shortcode)) {
        continue;
      }

      const viewCount = getMediaItemViewCount(mediaItem);
      const takenAt = getMediaItemTakenAt(mediaItem);
      if (viewCount > 0) {
        clipMediaItems.push({
          shortcode,
          viewCount,
          takenAt,
          likeCount: getMediaItemLikeCount(mediaItem),
          commentCount: getMediaItemCommentCount(mediaItem),
        });
        seenShortcodes.add(shortcode);
      }
    }

    if (clipMediaItems.length >= neededCount) {
      break;
    }

    if (!mediaPage.moreAvailable || !mediaPage.nextMaxId) {
      break;
    }

    if (seenPageIds.has(mediaPage.nextMaxId)) {
      break;
    }

    seenPageIds.add(mediaPage.nextMaxId);
    nextMaxId = mediaPage.nextMaxId;
    page += 1;
  }

  return clipMediaItems;
}

function padWithZeros(values, n) {
  if (values.length >= n) {
    return values;
  }

  return [...values, ...Array.from({ length: n - values.length }, () => 0)];
}

function getAverage(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

  const token = process.env.ROCKETAPI_TOKEN;
  if (!token) {
    throw new Error("Missing ROCKETAPI_TOKEN environment variable.");
  }

  const absoluteInput = path.resolve(process.cwd(), args.input);
  const rows = await readInput(absoluteInput);

  const result = [];

  for (const row of rows) {
    const user = await fetchProfile(token, row.username);
    const userId = user?.id ?? "";
    if (!userId) {
      throw new Error(`Missing user id for username ${row.username}.`);
    }

    const minimumViableClipsNeeded = CLIPS_EXCLUDED_FROM_TOP + CLIPS_SELECTED_COUNT;
    const clipMediaItems = await fetchTopClipsViews(token, userId, minimumViableClipsNeeded);
    const top10ClipMediaItems = getLatestNClipMediaItems(
      clipMediaItems,
      CLIPS_SELECTED_COUNT,
      CLIPS_EXCLUDED_FROM_TOP
    );
    const top10MediaViewCounts = top10ClipMediaItems.map((item) => item.viewCount);
    const top10MediaShortcodes = top10ClipMediaItems.map((item) => item.shortcode);
    const paddedTop10MediaViewCounts = padWithZeros(top10MediaViewCounts, CLIPS_SELECTED_COUNT);
    const paddedTop10MediaShortcodes = [
      ...top10MediaShortcodes,
      ...Array.from({ length: Math.max(0, CLIPS_SELECTED_COUNT - top10MediaShortcodes.length) }, () => ""),
    ];
    const top10MediaViews = top10MediaViewCounts.reduce((sum, value) => sum + value, 0);
    const averageViews = getAverage(top10MediaViewCounts);
    const totalLikeCount = top10ClipMediaItems.reduce((sum, item) => sum + item.likeCount, 0);
    const totalCommentCount = top10ClipMediaItems.reduce((sum, item) => sum + item.commentCount, 0);
    const followerCount = Number(user?.edge_followed_by?.count ?? 0);
    const engagementRate =
      followerCount > 0 ? ((totalLikeCount + totalCommentCount) / followerCount) * 100 : 0;

    result.push({
      username: row.username,
      userId,
      followerCount,
      top10MediaViews,
      topMediaItemsUsed: top10ClipMediaItems.length,
      top10MediaViewCounts: paddedTop10MediaViewCounts,
      top10MediaShortcodes: paddedTop10MediaShortcodes,
      averageViews,
      engagementRate,
    });
  }

  console.table(
    result.map((row) => {
      const mediaViewColumns = Object.fromEntries(
        row.top10MediaViewCounts.map((count, index) => [`media${index + 1}Views`, formatNumber(count)])
      );
      const mediaShortcodeColumns = Object.fromEntries(
        row.top10MediaShortcodes.map((shortcode, index) => [`media${index + 1}Shortcode`, shortcode || "-"])
      );

      return {
        username: row.username,
        userId: row.userId,
        followerCount: formatNumber(row.followerCount),
        top10MediaViews: formatNumber(row.top10MediaViews),
        topMediaItemsUsed: row.topMediaItemsUsed,
        averageViews: formatNumber(row.averageViews),
        engagementRate: `${row.engagementRate.toFixed(2)}%`,
        ...mediaShortcodeColumns,
        ...mediaViewColumns,
      };
    })
  );

  if (args.output) {
    const absoluteOutput = path.resolve(process.cwd(), args.output);
    await fs.writeFile(absoluteOutput, JSON.stringify(result, null, 2), "utf-8");
    console.log(`Saved report to ${absoluteOutput}`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
