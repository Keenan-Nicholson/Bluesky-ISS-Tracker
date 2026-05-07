# ISS Bluesky Bot

A bot that fetches International Space Station sighting data from NASA and posts visibility alerts to Bluesky for 7 locations in Newfoundland & Labrador.

## Features

- **Daily sighting alerts** — Posts at noon for visible passes the following day
- **Countdown replies** — Replies to the alert 1 hour before, 30 minutes before, and at the time of each sighting
- **7 Newfoundland locations** — St. John's, Corner Brook, Grand Falls, Goose Bay, Baie Verte, Hants Harbour, Trout River
- **Rich text** — Hashtags, links, and mentions are properly formatted via AT Protocol facets
- **Persistent logging** — All activity written to `bot.log` with timestamps

## Prerequisites

- [Node.js](https://nodejs.org/) v18+ (for built-in `fetch`)
- A Bluesky account

## Setup

```bash
git clone <repo-url>
cd BlueSky_ISS_Bot
npm install
```

Create `.env` in the project root:

```
ISS_BOT_BLUESKY_HANDLE=your-handle.bsky.social
ISS_BOT_BLUESKY_PASSWORD=your-app-password
```

Use an [App Password](https://bsky.app/settings/app-passwords), not your main password.

## Usage

| Command | Description |
|---|---|
| `npm start` | Start persistent bot (immediate run, then daily at 12:00 PM) |
| `npm run run-job` | Run one fetch-and-post cycle immediately |
| `npm run dry-run` | Run one cycle without posting (logs what would be sent) |
| `npm run test-reply` | Test the reply system with a fake sighting 55 min out |
| `npm run write-locations` | Fetch and cache sighting data from NASA |
| `npm run print-locations` | Fetch and print fresh sighting data |

## Architecture

1. NASA data is fetched from `iss-sts.hqmce.nasa.gov/iss-sts-cities-html/` — pre-rendered HTML tables served from S3
2. The daily cron (12:00 PM) parses the tables, finds sightings for the next day, and posts alerts
3. Every 10 minutes, a second cron checks if any upcoming sighting is 1 hour away, 30 minutes away, or happening now, and posts a reply to the original alert with the appropriate countdown message
4. All posts use `RichText` from `@atproto/api` to ensure hashtags render correctly on Bluesky

## Data files

| File | Purpose | Git |
|---|---|---|
| `locations.json` | Cached sighting data from NASA | Ignored |
| `pending-replies.json` | Queue of scheduled reply alerts | Ignored |
| `bot.log` | Timestamped activity log | Ignored |
| `.env` | Bluesky credentials | Ignored |
