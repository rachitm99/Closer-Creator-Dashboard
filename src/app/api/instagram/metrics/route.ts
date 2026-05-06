import fs from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

const PROFILE_API_URL = "https://v1.rocketapi.io/instagram/user/get_web_profile_info";
const SHORTCODE_INFO_API_URL = "https://v1.rocketapi.io/instagram/media/get_info_by_shortcode";
const CLIPS_API_URL = "https://v1.rocketapi.io/instagram/user/get_clips";
const INSTAGRAM_BASE_URL = "https://www.instagram.com";
const API_RESPONSE_DIR = path.join(process.cwd(), "data", "api-responses");

const PLAYWRIGHT_TOP_COUNT = 10;
const PLAYWRIGHT_DISCOVERY_COUNT = 24;
const PLAYWRIGHT_SCROLL_PASSES = 10;
const PLAYWRIGHT_STAGNATION_LIMIT = 3;
const PLAYWRIGHT_SCROLL_WAIT_MS = 1200;
const PLAYWRIGHT_INITIAL_WAIT_MS = 2500;
const ROCKET_TOP_COUNT = 100;
const ROCKET_PAGE_SIZE = 50;
const ROCKET_MAX_PAGES = 8;
const RECEIVED_ORDER_EXCLUDED_COUNT = 5;
const ROCKET_MEDIAN_TOP_COUNT = 10;
const PLAYWRIGHT_TARGET_COUNT = PLAYWRIGHT_TOP_COUNT + RECEIVED_ORDER_EXCLUDED_COUNT;
const ROCKET_TARGET_COUNT = ROCKET_TOP_COUNT + RECEIVED_ORDER_EXCLUDED_COUNT;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const SD_SIGMA = 1;
const SD_CLIP_MAX_ITERATIONS = 6;
const SD_CLIP_MIN_VALUES = 3;

type ApiBody = {
  usernamesText?: string;
};

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
  rocketTop10MedianViewsTimeSortedSdFiltered: number;
  rocketTopMediaItemsUsed: number;
  rocketTop100MediaViews: number;
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

type ClipMediaItem = {
  shortcode: string;
  viewCount: number;
  takenAt: number;
  likeCount: number;
  commentCount: number;
};

type ApiResponseLog = {
  username: string;
  profileResponse: unknown;
  playwrightResponses: unknown[];
  rocketClipsResponses: unknown[];
  shortcodeInfoResponses: Array<{
    shortcode: string;
    response?: unknown;
    error?: string;
  }>;
};

type PlaywrightStopReason =
  | "enough_clips_found"
  | "insufficient_clips_found"
  | "no_shortcodes_found"
  | "playwright_fallback_rocket_clips"
  | "playwright_error"
  | "shortcode_info_only_errors"
  | "shortcode_info_no_views";

type RocketStopReason =
  | "enough_clips_found"
  | "no_clips_found"
  | "no_more_pages"
  | "duplicate_next_max_id"
  | "max_pages_reached"
  | "rocket_clips_error";

type PlaywrightScrapeResult = {
  items: Array<{ shortcode: string }>;
  raw: {
    source: "playwright_reels";
    url: string;
    shortcodesFound: number;
    passes: number;
  };
};

type ClipsPageResult = {
  items: unknown[];
  nextMaxId?: string;
  moreAvailable: boolean;
  raw: {
    source: "rocket_get_clips";
    itemsFound: number;
    nextMaxId?: string;
    moreAvailable: boolean;
  };
};

function normalizeUsernames(usernamesText: string): string[] {
  const reservedPathPrefixes = new Set([
    "p",
    "reel",
    "reels",
    "tv",
    "stories",
    "explore",
    "accounts",
    "direct",
  ]);

  const extractUsername = (rawInput: string): string | null => {
    const cleanedInput = rawInput
      .trim()
      .replace(/^[\s"'`()\[\]{}<>]+|[\s"'`()\[\]{}<>.,;:!?]+$/g, "");

    if (!cleanedInput) {
      return null;
    }

    const normalizedUrlInput = cleanedInput.match(/^https?:\/\//i)
      ? cleanedInput
      : cleanedInput.match(/^www\./i) || cleanedInput.includes("instagram.com/")
      ? `https://${cleanedInput}`
      : null;

    if (normalizedUrlInput) {
      try {
        const parsedUrl = new URL(normalizedUrlInput);
        const host = parsedUrl.hostname.toLowerCase();

        if (!host.includes("instagram.com")) {
          return null;
        }

        const firstSegment = parsedUrl.pathname
          .split("/")
          .filter(Boolean)[0]
          ?.replace(/^@/, "")
          ?.toLowerCase();

        if (!firstSegment || reservedPathPrefixes.has(firstSegment)) {
          return null;
        }

        return firstSegment;
      } catch {
        return null;
      }
    }

    const plainUsername = cleanedInput.replace(/^@/, "").toLowerCase();
    if (/^[a-z0-9._]+$/.test(plainUsername)) {
      return plainUsername;
    }

    return null;
  };

  const values = usernamesText
    .split(/[\s,]+/)
    .map((item) => extractUsername(item))
    .filter((item): item is string => Boolean(item));

  return Array.from(new Set(values));
}

function getMediaItemViewCount(mediaItem: unknown): number {
  if (!mediaItem || typeof mediaItem !== "object") {
    return 0;
  }

  const media = mediaItem as {
    video_view_count?: number;
    view_count?: number;
    play_count?: number;
  };

  const value = Number(media.video_view_count ?? media.view_count ?? media.play_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getMediaItemLikeCount(mediaItem: unknown): number {
  if (!mediaItem || typeof mediaItem !== "object") {
    return 0;
  }

  const media = mediaItem as {
    like_count?: number;
  };

  const value = Number(media.like_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getMediaItemCommentCount(mediaItem: unknown): number {
  if (!mediaItem || typeof mediaItem !== "object") {
    return 0;
  }

  const media = mediaItem as {
    comment_count?: number;
  };

  const value = Number(media.comment_count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getMediaItemTakenAt(mediaItem: unknown): number {
  if (!mediaItem || typeof mediaItem !== "object") {
    return 0;
  }

  const media = mediaItem as { taken_at?: number };
  const value = Number(media.taken_at ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function getMediaItemShortcode(mediaItem: unknown): string {
  if (!mediaItem || typeof mediaItem !== "object") {
    return "";
  }

  const media = mediaItem as {
    code?: string;
    shortcode?: string;
  };

  const value = String(media.code ?? media.shortcode ?? "").trim();
  return /^[A-Za-z0-9_-]{6,20}$/.test(value) ? value : "";
}

function padWithZeros(values: number[], n: number): number[] {
  if (values.length >= n) {
    return values;
  }

  return [...values, ...Array.from({ length: n - values.length }, () => 0)];
}

function padWithEmpty(values: string[], n: number): string[] {
  if (values.length >= n) {
    return values;
  }

  return [...values, ...Array.from({ length: n - values.length }, () => "")];
}

function getAverage(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getStdDev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const mean = getAverage(values);
  const variance = values.reduce((sum, value) => {
    const diff = value - mean;
    return sum + diff * diff;
  }, 0) / values.length;

  return Math.sqrt(variance);
}

function getSdFilteredAverage(values: number[], sigma = SD_SIGMA): number {
  return getAverage(getSdFilteredValues(values, sigma));
}

function getSdFilteredValues(values: number[], sigma = SD_SIGMA): number[] {
  if (values.length === 0) {
    return [];
  }

  let working = [...values];

  // Iterative sigma clipping prevents a single large outlier from inflating sigma
  // enough to keep other high-deviation points in the filtered set.
  for (let iteration = 0; iteration < SD_CLIP_MAX_ITERATIONS; iteration += 1) {
    if (working.length < SD_CLIP_MIN_VALUES) {
      break;
    }

    const mean = getAverage(working);
    const stdDev = getStdDev(working);
    if (stdDev === 0) {
      return working;
    }

    const min = mean - sigma * stdDev;
    const max = mean + sigma * stdDev;
    const filtered = working.filter((value) => value >= min && value <= max);

    // Stop when clipping stabilizes or would remove everything.
    if (filtered.length === 0 || filtered.length === working.length) {
      break;
    }

    working = filtered;
  }

  return working;
}

function getMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function getFirstNClipMediaItems(items: ClipMediaItem[], n: number, offset = 0): ClipMediaItem[] {
  return items.slice(offset, offset + n);
}

function getTopNClipMediaItemsByTime(items: ClipMediaItem[], n: number): ClipMediaItem[] {
  return [...items]
    .sort((a, b) => b.takenAt - a.takenAt)
    .slice(0, n);
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function safeStringify(value: unknown, maxLength = 6000): string {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length <= maxLength) {
      return json;
    }
    return `${json.slice(0, maxLength)}\n...truncated`;
  } catch {
    return "[unserializable]";
  }
}

function logStep(username: string, step: string, detail?: Record<string, unknown>) {
  const payload = {
    at: new Date().toISOString(),
    username,
    step,
    ...detail,
  };
  console.log("[instagram-metrics]", safeStringify(payload, 2000));
}

async function writeProfileRawResponse(username: string, payload: unknown): Promise<string> {
  const dir = path.join(API_RESPONSE_DIR, "profile-raw");
  await fs.mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `rocketapi-profile-${sanitizeFileSegment(username)}-${sanitizeFileSegment(timestamp)}.json`;
  const outputPath = path.join(dir, fileName);

  let content = "";
  try {
    content = JSON.stringify(payload, null, 2);
  } catch {
    content = String(payload);
  }

  await fs.writeFile(outputPath, content, "utf-8");
  return path.relative(process.cwd(), outputPath);
}

function parseRocketBody(rawBody: unknown): unknown {
  if (typeof rawBody !== "string") {
    return rawBody;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

async function writeApiResponsesToFile(logs: ApiResponseLog[]): Promise<string> {
  await fs.mkdir(API_RESPONSE_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `rocketapi-response-${sanitizeFileSegment(timestamp)}.json`;
  const outputPath = path.join(API_RESPONSE_DIR, fileName);

  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        records: logs,
      },
      null,
      2
    ),
    "utf-8"
  );

  return path.relative(process.cwd(), outputPath);
}

async function fetchProfile(
  token: string,
  username: string
): Promise<{ user: Record<string, unknown>; raw: unknown }> {
  logStep(username, "profile:request");
  const response = await fetch(PROFILE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({ username }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logStep(username, "profile:http_error", { status: response.status, errorText });
    throw new Error(`RocketAPI failed for ${username}: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  const rawProfilePath = await writeProfileRawResponse(username, json);
  logStep(username, "profile:raw_saved", { path: rawProfilePath });
  logStep(username, "profile:raw_response", {
    topLevelKeys: json && typeof json === "object" ? Object.keys(json as Record<string, unknown>) : null,
    hasResponse: Boolean((json as { response?: unknown })?.response),
    responseKeys:
      (json as { response?: Record<string, unknown> })?.response &&
      typeof (json as { response?: Record<string, unknown> }).response === "object"
        ? Object.keys((json as { response: Record<string, unknown> }).response)
        : null,
    responseStatusCode: (json as { response?: { status_code?: number } })?.response?.status_code ?? null,
    responseBodyType: typeof (json as { response?: { body?: unknown } })?.response?.body,
    responseBodyPreview: safeStringify((json as { response?: { body?: unknown } })?.response?.body, 2000),
  });

  if (!(json as { response?: unknown })?.response) {
    const status = (json as { status?: unknown })?.status;
    const message = (json as { message?: unknown })?.message;
    if (status || message) {
      logStep(username, "profile:api_error", {
        status: status ?? null,
        message: message ?? null,
      });
      throw new Error(`RocketAPI error for ${username}: ${String(status ?? "unknown")} ${String(message ?? "unknown")}`);
    }
  }

  const body = parseRocketBody(json?.response?.body);
  logStep(username, "profile:response", {
    hasUser:
      Boolean((body as { data?: { user?: unknown } })?.data?.user) ||
      Boolean((body as { graphql?: { user?: unknown } })?.graphql?.user) ||
      Boolean((body as { user?: unknown })?.user),
    bodyType: typeof body,
    bodyKeys: body && typeof body === "object" ? Object.keys(body as Record<string, unknown>) : null,
  });
  const user =
    (body as { data?: { user?: unknown; users?: unknown[] }; user?: unknown; users?: unknown[] })
      ?.data?.user ??
    (body as { graphql?: { user?: unknown } })?.graphql?.user ??
    (body as { user?: unknown })?.user ??
    (body as { data?: { users?: unknown[] } })?.data?.users?.[0] ??
    (body as { users?: unknown[] })?.users?.[0];

  if (!user) {
    const bodyStatus = (body as { status?: string })?.status;
    const bodyMessage =
      (body as { message?: string })?.message ??
      (body as { error?: string })?.error ??
      (body as { errors?: unknown })?.errors;
    const suffix = bodyStatus || bodyMessage ? ` (${bodyStatus ?? "error"}: ${String(bodyMessage ?? "unknown")})` : "";
    logStep(username, "profile:missing_user", {
      status: bodyStatus ?? null,
      message: bodyMessage ?? null,
      bodyPreview: safeStringify(body, 2000),
    });
    throw new Error(`No user data returned for ${username}${suffix}.`);
  }

  logStep(username, "profile:success", { userId: String((user as { id?: unknown })?.id ?? "") });
  return { user: user as Record<string, unknown>, raw: json };
}

function extractShortcodeFromReelUrl(value: string): string | null {
  const directMatch = /\/reel\/([A-Za-z0-9_-]{6,20})(?:\/|\?|#|$)/.exec(value);
  if (!directMatch?.[1]) {
    return null;
  }

  return directMatch[1];
}

function extractShortcodesFromHtmlText(html: string): string[] {
  const results = new Set<string>();

  for (const match of html.matchAll(/(?:\\\/|\/)reel(?:\\\/|\/)([A-Za-z0-9_-]{6,20})(?:\\\/|\/|\?|"|'|#|&|$)/g)) {
    const shortcode = (match[1] ?? "").trim();
    if (/^[A-Za-z0-9_-]{6,20}$/.test(shortcode)) {
      results.add(shortcode);
    }
  }

  for (const match of html.matchAll(/"(?:shortcode|code)":"([A-Za-z0-9_-]{6,20})"/g)) {
    const shortcode = (match[1] ?? "").trim();
    if (/^[A-Za-z0-9_-]{6,20}$/.test(shortcode)) {
      results.add(shortcode);
    }
  }

  return Array.from(results);
}

async function scrapeReelsViaPlaywright(
  username: string,
  neededCount: number
): Promise<PlaywrightScrapeResult> {
  const playwrightModuleName = "playwright";
  const playwrightModule = await import(playwrightModuleName).catch(() => null);
  if (!playwrightModule || !("chromium" in playwrightModule)) {
    throw new Error("Playwright is not installed on the server runtime.");
  }

  const playwright = playwrightModule as {
    chromium: {
      launch: (options: Record<string, unknown>) => Promise<{
        newContext: () => Promise<{
          newPage: () => Promise<{
            goto: (url: string, options?: Record<string, unknown>) => Promise<void>;
            waitForTimeout: (ms: number) => Promise<void>;
            evaluate: <T>(fn: () => T) => Promise<T>;
            content: () => Promise<string>;
          }>;
          close: () => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };

  const reelsUrl = `${INSTAGRAM_BASE_URL}/${username}/reels/`;
  const maxScrollPasses = Number(process.env.PW_SCROLL_PASSES ?? PLAYWRIGHT_SCROLL_PASSES);
  const stagnationLimit = Number(process.env.PW_STAGNATION_LIMIT ?? PLAYWRIGHT_STAGNATION_LIMIT);
  const scrollWaitMs = Number(process.env.PW_SCROLL_WAIT_MS ?? PLAYWRIGHT_SCROLL_WAIT_MS);
  const initialWaitMs = Number(process.env.PW_INITIAL_WAIT_MS ?? PLAYWRIGHT_INITIAL_WAIT_MS);
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const items: Array<{ shortcode: string }> = [];
  const seen = new Set<string>();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(reelsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(initialWaitMs);

    let pass = 0;
    let stagnantPasses = 0;
    let previousCount = 0;
    while (pass < maxScrollPasses) {
      const hrefs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/reel/']"))
          .map((anchor) => anchor.href)
          .filter(Boolean);
      });

      for (const href of hrefs) {
        const shortcode = extractShortcodeFromReelUrl(href);
        if (!shortcode || seen.has(shortcode)) {
          continue;
        }

        seen.add(shortcode);
        items.push({ shortcode });
      }

      // Some Instagram variants hide reel URLs in script payloads instead of anchors.
      const html = await page.content();
      const htmlShortcodes = extractShortcodesFromHtmlText(html);
      for (const shortcode of htmlShortcodes) {
        if (seen.has(shortcode)) {
          continue;
        }

        seen.add(shortcode);
        items.push({ shortcode });
      }

      if (items.length >= neededCount) {
        break;
      }

      if (items.length <= previousCount) {
        stagnantPasses += 1;
      } else {
        stagnantPasses = 0;
      }
      previousCount = items.length;

      if (stagnantPasses >= stagnationLimit) {
        break;
      }

      await page.evaluate(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
      });
      await page.waitForTimeout(scrollWaitMs);
      pass += 1;
    }

    await context.close();

    return {
      items,
      raw: {
        source: "playwright_reels",
        url: reelsUrl,
        shortcodesFound: items.length,
        passes: pass,
      },
    };
  } finally {
    await browser.close();
  }
}

function getMediaItemFromShortcodeInfoResponse(response: unknown): unknown {
  const payload = response as {
    response?: {
      body?: {
        items?: unknown[];
        data?: {
          items?: unknown[];
        };
      };
    };
  };

  const itemsCandidate = payload?.response?.body?.items ?? payload?.response?.body?.data?.items;
  return Array.isArray(itemsCandidate) ? itemsCandidate[0] : undefined;
}

async function fetchShortcodeInfo(token: string, shortcode: string): Promise<unknown> {
  const response = await fetch(SHORTCODE_INFO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({ shortcode }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `RocketAPI shortcode info failed for ${shortcode}: ${response.status} ${errorText}`
    );
  }

  return response.json();
}

async function fetchPlaywrightTop10ByTime(
  token: string,
  username: string,
  userId: string
): Promise<{
  clipMediaItems: ClipMediaItem[];
  mediaResponses: unknown[];
  shortcodeInfoResponses: ApiResponseLog["shortcodeInfoResponses"];
  debug: {
    pagesFetched: number;
    mediaItemsScanned: number;
    clipsFound: number;
    clipsWithViewsFound: number;
    stopReason: PlaywrightStopReason;
  };
}> {
  const mediaResponses: unknown[] = [];
  const shortcodeInfoResponses: ApiResponseLog["shortcodeInfoResponses"] = [];
  const clipMediaItems: ClipMediaItem[] = [];
  let stopReason: PlaywrightStopReason = "no_shortcodes_found";

  try {
    const discovery = await scrapeReelsViaPlaywright(username, PLAYWRIGHT_DISCOVERY_COUNT);
    mediaResponses.push(discovery.raw);

    if (discovery.items.length === 0) {
      const fallback = await fetchRocketTop100ByTime(token, userId);
      const fallbackItems = getFirstNClipMediaItems(fallback.clipMediaItems, PLAYWRIGHT_TARGET_COUNT);
      mediaResponses.push({
        source: "playwright_fallback_rocket_get_clips",
        fallbackItemsFound: fallbackItems.length,
      });

      return {
        clipMediaItems: fallbackItems,
        mediaResponses,
        shortcodeInfoResponses,
        debug: {
          pagesFetched: mediaResponses.length,
          mediaItemsScanned: fallback.debug.mediaItemsScanned,
          clipsFound: fallbackItems.length,
          clipsWithViewsFound: fallbackItems.length,
          stopReason: fallbackItems.length > 0 ? "playwright_fallback_rocket_clips" : stopReason,
        },
      };
    }

    for (const candidate of discovery.items) {
      try {
        const shortcodeResponse = await fetchShortcodeInfo(token, candidate.shortcode);
        const mediaItem = getMediaItemFromShortcodeInfoResponse(shortcodeResponse);
        shortcodeInfoResponses.push({
          shortcode: candidate.shortcode,
          response: {
            rocketApiResponse: shortcodeResponse,
          },
        });

        const viewCount = getMediaItemViewCount(mediaItem);
        if (viewCount <= 0) {
          continue;
        }

        clipMediaItems.push({
          shortcode: candidate.shortcode,
          viewCount,
          takenAt: getMediaItemTakenAt(mediaItem),
          likeCount: getMediaItemLikeCount(mediaItem),
          commentCount: getMediaItemCommentCount(mediaItem),
        });
      } catch (shortcodeError) {
        const message =
          shortcodeError instanceof Error ? shortcodeError.message : "Unknown shortcode fetch error";
        shortcodeInfoResponses.push({
          shortcode: candidate.shortcode,
          error: message,
        });
      }
    }

    if (clipMediaItems.length >= PLAYWRIGHT_TARGET_COUNT) {
      stopReason = "enough_clips_found";
    } else if (clipMediaItems.length > 0) {
      stopReason = "insufficient_clips_found";
    } else if (shortcodeInfoResponses.length > 0) {
      const hasAtLeastOneSuccess = shortcodeInfoResponses.some((item) => !item.error);
      stopReason = hasAtLeastOneSuccess ? "shortcode_info_no_views" : "shortcode_info_only_errors";
    }

    return {
      clipMediaItems,
      mediaResponses,
      shortcodeInfoResponses,
      debug: {
        pagesFetched: mediaResponses.length,
        mediaItemsScanned: discovery.items.length,
        clipsFound: discovery.items.length,
        clipsWithViewsFound: clipMediaItems.length,
        stopReason,
      },
    };
  } catch (playwrightError) {
    const message = playwrightError instanceof Error ? playwrightError.message : "Unknown Playwright scrape error";
    mediaResponses.push({
      source: "playwright_reels",
      username,
      error: message,
    });

    return {
      clipMediaItems,
      mediaResponses,
      shortcodeInfoResponses,
      debug: {
        pagesFetched: mediaResponses.length,
        mediaItemsScanned: 0,
        clipsFound: 0,
        clipsWithViewsFound: 0,
        stopReason: "playwright_error",
      },
    };
  }
}

async function fetchRocketClipsPage(
  token: string,
  userId: string,
  nextMaxId?: string
): Promise<ClipsPageResult> {
  const payload: Record<string, unknown> = {
    id: Number(userId),
    count: ROCKET_PAGE_SIZE,
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
    const errorText = await response.text();
    throw new Error(
      `RocketAPI get_clips failed for ${userId}: ${response.status} ${errorText}`
    );
  }

  const json = await response.json();
  const body = json?.response?.body;
  const itemsCandidate = body?.items ?? body?.data?.items ?? body?.clips ?? body?.data?.clips;
  const items = Array.isArray(itemsCandidate) ? itemsCandidate : [];
  const pageNextMaxId = body?.paging_info?.max_id ?? body?.data?.paging_info?.max_id;
  const moreAvailable = Boolean(
    body?.paging_info?.more_available ?? body?.data?.paging_info?.more_available
  );

  return {
    items,
    nextMaxId: typeof pageNextMaxId === "string" ? pageNextMaxId : undefined,
    moreAvailable,
    raw: {
      source: "rocket_get_clips",
      itemsFound: items.length,
      nextMaxId: typeof pageNextMaxId === "string" ? pageNextMaxId : undefined,
      moreAvailable,
    },
  };
}

function getClipMediaFromItem(item: unknown): unknown {
  if (!item || typeof item !== "object") {
    return null;
  }

  const typed = item as { media?: unknown };
  return typed.media ?? item;
}

function isPinnedClipMedia(mediaItem: unknown): boolean {
  if (!mediaItem || typeof mediaItem !== "object") {
    return false;
  }

  const typed = mediaItem as {
    is_pinned?: boolean;
    timeline_pinned_user_ids?: unknown[];
    clips_tab_pinned_user_ids?: unknown[];
  };

  if (typed.is_pinned === true) {
    return true;
  }

  if (Array.isArray(typed.timeline_pinned_user_ids) && typed.timeline_pinned_user_ids.length > 0) {
    return true;
  }

  if (Array.isArray(typed.clips_tab_pinned_user_ids) && typed.clips_tab_pinned_user_ids.length > 0) {
    return true;
  }

  return false;
}

async function fetchRocketTop100ByTime(
  token: string,
  userId: string
): Promise<{
  clipMediaItems: ClipMediaItem[];
  mediaResponses: unknown[];
  debug: {
    pagesFetched: number;
    mediaItemsScanned: number;
    clipsFound: number;
    clipsWithViewsFound: number;
    stopReason: RocketStopReason;
  };
}> {
  const mediaResponses: unknown[] = [];
  const clipMediaItems: ClipMediaItem[] = [];
  const seenShortcodes = new Set<string>();
  const seenPageIds = new Set<string>();

  let stopReason: RocketStopReason = "max_pages_reached";
  let itemsScanned = 0;
  let nextMaxId: string | undefined;
  let page = 0;

  while (page < ROCKET_MAX_PAGES && clipMediaItems.length < ROCKET_TARGET_COUNT) {
    let pageData: ClipsPageResult;
    try {
      pageData = await fetchRocketClipsPage(token, userId, nextMaxId);
    } catch (clipsError) {
      const message = clipsError instanceof Error ? clipsError.message : "Unknown rocket get_clips error";
      mediaResponses.push({
        source: "rocket_get_clips",
        userId,
        error: message,
      });
      stopReason = "rocket_clips_error";
      break;
    }

    mediaResponses.push(pageData.raw);

    for (const item of pageData.items) {
      const mediaItem = getClipMediaFromItem(item);
      if (!mediaItem || isPinnedClipMedia(mediaItem)) {
        continue;
      }

      const shortcode = getMediaItemShortcode(mediaItem);
      if (!shortcode || seenShortcodes.has(shortcode)) {
        continue;
      }

      seenShortcodes.add(shortcode);
      itemsScanned += 1;

      const viewCount = getMediaItemViewCount(mediaItem);
      if (viewCount <= 0) {
        continue;
      }

      clipMediaItems.push({
        shortcode,
        viewCount,
        takenAt: getMediaItemTakenAt(mediaItem),
        likeCount: getMediaItemLikeCount(mediaItem),
        commentCount: getMediaItemCommentCount(mediaItem),
      });

      if (clipMediaItems.length >= ROCKET_TARGET_COUNT) {
        break;
      }
    }

    if (clipMediaItems.length >= ROCKET_TARGET_COUNT) {
      stopReason = "enough_clips_found";
      break;
    }

    if (!pageData.moreAvailable || !pageData.nextMaxId) {
      stopReason = clipMediaItems.length > 0 ? "no_more_pages" : "no_clips_found";
      break;
    }

    if (seenPageIds.has(pageData.nextMaxId)) {
      stopReason = "duplicate_next_max_id";
      break;
    }

    seenPageIds.add(pageData.nextMaxId);
    nextMaxId = pageData.nextMaxId;
    page += 1;
  }

  return {
    clipMediaItems,
    mediaResponses,
    debug: {
      pagesFetched: mediaResponses.length,
      mediaItemsScanned: itemsScanned,
      clipsFound: clipMediaItems.length,
      clipsWithViewsFound: clipMediaItems.length,
      stopReason,
    },
  };
}

function computeMetrics(values: number[]): {
  average: number;
  stdDev: number;
  sdFilteredAverage: number;
} {
  return {
    average: getAverage(values),
    stdDev: getStdDev(values),
    sdFilteredAverage: getSdFilteredAverage(values),
  };
}

function getLast30DaysViewCounts(items: ClipMediaItem[]): number[] {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cutoffSeconds = nowSeconds - THIRTY_DAYS_SECONDS;

  return items
    .filter((item) => item.takenAt >= cutoffSeconds)
    .map((item) => item.viewCount)
    .filter((value) => value > 0);
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = process.env.ROCKETAPI_TOKEN;
    if (!token) {
      return Response.json(
        { error: "Missing ROCKETAPI_TOKEN on server." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as ApiBody;
    const usernames = normalizeUsernames(body.usernamesText ?? "");

    if (usernames.length === 0) {
      return Response.json(
        { error: "Provide at least one username." },
        { status: 400 }
      );
    }

    const rows: CreatorMetric[] = [];
    const apiResponses: ApiResponseLog[] = [];

    for (const username of usernames) {
      const startedAt = Date.now();
      logStep(username, "metrics:start");
      const { user, raw: profileRaw } = await fetchProfile(token, username);
      const userId = String(user.id ?? "");
      if (!userId) {
        throw new Error(`Missing user id for ${username}.`);
      }

      logStep(username, "playwright:start", { userId });
      const playwrightResult = await fetchPlaywrightTop10ByTime(token, username, userId);
      logStep(username, "playwright:done", {
        clipsFound: playwrightResult.debug.clipsFound,
        clipsWithViewsFound: playwrightResult.debug.clipsWithViewsFound,
        stopReason: playwrightResult.debug.stopReason,
      });
      const selectedPlaywright10 = getFirstNClipMediaItems(
        playwrightResult.clipMediaItems,
        PLAYWRIGHT_TOP_COUNT,
        RECEIVED_ORDER_EXCLUDED_COUNT
      );
      const playwrightViewCounts = selectedPlaywright10.map((item) => item.viewCount);
      const playwrightShortcodes = selectedPlaywright10.map((item) => item.shortcode);
      const playwrightMetrics = computeMetrics(playwrightViewCounts);
      const timeSortedPlaywright10 = getTopNClipMediaItemsByTime(
        playwrightResult.clipMediaItems,
        PLAYWRIGHT_TOP_COUNT
      );
      const timeSortedPlaywrightViewCounts = timeSortedPlaywright10.map((item) => item.viewCount);
      const timeSortedPlaywrightMetrics = computeMetrics(timeSortedPlaywrightViewCounts);
      const playwrightTop10MediaViews = playwrightViewCounts.reduce((sum, value) => sum + value, 0);

      logStep(username, "rocket:start", { userId });
      const rocketResult = await fetchRocketTop100ByTime(token, userId);
      logStep(username, "rocket:done", {
        clipsFound: rocketResult.debug.clipsFound,
        clipsWithViewsFound: rocketResult.debug.clipsWithViewsFound,
        stopReason: rocketResult.debug.stopReason,
      });
      const selectedRocket100 = getFirstNClipMediaItems(
        rocketResult.clipMediaItems,
        ROCKET_TOP_COUNT,
        RECEIVED_ORDER_EXCLUDED_COUNT
      );
      const rocketViewCounts = selectedRocket100.map((item) => item.viewCount);
      const rocketMetrics = computeMetrics(rocketViewCounts);
      const timeSortedRocket100 = getTopNClipMediaItemsByTime(
        rocketResult.clipMediaItems,
        ROCKET_TOP_COUNT
      );
      const timeSortedRocketViewCounts = timeSortedRocket100.map((item) => item.viewCount);
      const timeSortedRocketMetrics = computeMetrics(timeSortedRocketViewCounts);
      const timeSortedRocketTop10 = getFirstNClipMediaItems(
        getTopNClipMediaItemsByTime(
          rocketResult.clipMediaItems,
          ROCKET_MEDIAN_TOP_COUNT + RECEIVED_ORDER_EXCLUDED_COUNT
        ),
        ROCKET_MEDIAN_TOP_COUNT,
        RECEIVED_ORDER_EXCLUDED_COUNT
      );
      const timeSortedRocketTop10Views = timeSortedRocketTop10.map((item) => item.viewCount);
      const rocketTop10MedianViewsTimeSortedSdFiltered = getMedian(
        getSdFilteredValues(timeSortedRocketTop10Views)
      );
      const rocketTop100MediaViews = rocketViewCounts.reduce((sum, value) => sum + value, 0);
      const selectedRocket10ForEngagement = getFirstNClipMediaItems(
        rocketResult.clipMediaItems,
        ROCKET_MEDIAN_TOP_COUNT,
        RECEIVED_ORDER_EXCLUDED_COUNT
      );
      const rocketLikeCount = selectedRocket10ForEngagement.reduce((sum, item) => sum + item.likeCount, 0);
      const rocketCommentCount = selectedRocket10ForEngagement.reduce(
        (sum, item) => sum + item.commentCount,
        0
      );
      const last30DaysViewCounts = getLast30DaysViewCounts(rocketResult.clipMediaItems);
      const last30DaysMetrics = computeMetrics(last30DaysViewCounts);

      const followerCount = Number((user.edge_followed_by as { count?: number } | undefined)?.count ?? 0);
      const engagementRate =
        followerCount > 0 ? ((rocketLikeCount + rocketCommentCount) / followerCount) * 100 : 0;

      apiResponses.push({
        username,
        profileResponse: profileRaw,
        playwrightResponses: playwrightResult.mediaResponses,
        rocketClipsResponses: rocketResult.mediaResponses,
        shortcodeInfoResponses: playwrightResult.shortcodeInfoResponses,
      });

      const profileUrl = `${INSTAGRAM_BASE_URL}/${username}/`;

      rows.push({
        username,
        profileUrl,
        userId,
        followerCount,
        engagementRate,
        playwrightAverageViews: playwrightMetrics.average,
        playwrightStdDev: playwrightMetrics.stdDev,
        playwrightSdFilteredAverageViews: playwrightMetrics.sdFilteredAverage,
        playwrightAverageViewsTimeSorted: timeSortedPlaywrightMetrics.average,
        playwrightStdDevTimeSorted: timeSortedPlaywrightMetrics.stdDev,
        playwrightSdFilteredAverageViewsTimeSorted: timeSortedPlaywrightMetrics.sdFilteredAverage,
        playwrightTopMediaItemsUsed: selectedPlaywright10.length,
        playwrightTop10MediaViews: playwrightTop10MediaViews,
        playwrightTop10MediaViewCounts: padWithZeros(playwrightViewCounts, PLAYWRIGHT_TOP_COUNT),
        playwrightTop10MediaShortcodes: padWithEmpty(playwrightShortcodes, PLAYWRIGHT_TOP_COUNT),
        playwrightPagesFetched: playwrightResult.debug.pagesFetched,
        playwrightItemsScanned: playwrightResult.debug.mediaItemsScanned,
        playwrightClipsFound: playwrightResult.debug.clipsFound,
        playwrightClipsWithViewsFound: playwrightResult.debug.clipsWithViewsFound,
        playwrightStopReason: playwrightResult.debug.stopReason,
        rocketAverageViews: rocketMetrics.average,
        rocketStdDev: rocketMetrics.stdDev,
        rocketSdFilteredAverageViews: rocketMetrics.sdFilteredAverage,
        rocketAverageViewsTimeSorted: timeSortedRocketMetrics.average,
        rocketStdDevTimeSorted: timeSortedRocketMetrics.stdDev,
        rocketSdFilteredAverageViewsTimeSorted: timeSortedRocketMetrics.sdFilteredAverage,
        rocketTop10MedianViewsTimeSortedSdFiltered,
        rocketTopMediaItemsUsed: selectedRocket100.length,
        rocketTop100MediaViews,
        rocketPagesFetched: rocketResult.debug.pagesFetched,
        rocketItemsScanned: rocketResult.debug.mediaItemsScanned,
        rocketClipsFound: rocketResult.debug.clipsFound,
        rocketClipsWithViewsFound: rocketResult.debug.clipsWithViewsFound,
        rocketStopReason: rocketResult.debug.stopReason,
        last30DaysVideosUsed: last30DaysViewCounts.length,
        last30DaysAverageViews: last30DaysMetrics.average,
        last30DaysStdDev: last30DaysMetrics.stdDev,
        last30DaysSdFilteredAverageViews: last30DaysMetrics.sdFilteredAverage,
      });

      logStep(username, "metrics:done", { elapsedMs: Date.now() - startedAt });
    }

    const savedResponsePath = await writeApiResponsesToFile(apiResponses);
    logStep("batch", "metrics:success", { savedResponsePath, count: rows.length });
    return Response.json({ rows, savedResponsePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error("[instagram-metrics] request_failed", safeStringify({ message, error }, 2000));
    return Response.json({ error: message }, { status: 500 });
  }
}
