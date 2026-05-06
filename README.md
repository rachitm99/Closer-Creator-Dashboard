# Closer Creator Dashboard

A Next.js App Router site for a closer-focused creator dashboard concept.

## Project Overview

- Framework: Next.js (App Router) + React + TypeScript
- Styling: Tailwind CSS v4 (`@import "tailwindcss"`) plus custom global CSS variables
- Fonts: `next/font/google` with `Space Grotesk` and `IBM Plex Mono`
- Goal: Fast, conversion-focused landing page with a custom visual style

## Current Structure

```text
closer-creator-dashboard/
|- src/
|  |- app/
|  |  |- favicon.ico
|  |  |- globals.css      # color system, atmospheric backgrounds, animations
|  |  |- layout.tsx       # root layout + metadata + font wiring
|  |  |- page.tsx         # homepage content
|- public/                # static assets
|- package.json
|- next.config.ts
|- tsconfig.json
```

## Setup

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Build For Production

```bash
npm run build
npm run start
```

## Practical API Tool (Instagram)

This repo now includes a practical CLI tool that calls your RocketAPI endpoint and outputs:

- `userId` (Instagram numeric id)
- `followerCount`
- `top10MediaViews` (sum of highest 10 video view counts available in profile payload)

Files:

- `tools/instagram-creator-metrics.mjs`
- `data/instagram-usernames.json`

Set your API token:

```bash
export ROCKETAPI_TOKEN="your-api-key"
```

Run:

```bash
npm run metrics:instagram
```

The command prints a table and writes JSON to `data/instagram-report.json`.

## Obvious Issues / Next Improvements

- CTA buttons currently use `#` links; replace with real routes or actions.
- No analytics/event tracking is connected yet.
- No test suite is configured yet for UI or route behavior.
- The site is currently single-page; add internal routes for pricing, case studies, and onboarding flows.
