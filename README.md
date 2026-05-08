# ISS Bluesky Bot

A bot that fetches International Space Station sighting data from NASA and posts visibility alerts to Bluesky for 7 locations in Newfoundland & Labrador.

## Features

- **Daily sighting alerts** — Posts at noon (or on start with `--post`) for visible passes the following day
- **Multiple passes per post** — All sightings for a location on the same day are consolidated into one post
- **Countdown replies** — Replies to the alert 1 hour before, 30 minutes before, and at the time of each sighting
- **7 Newfoundland locations** — St. John's, Corner Brook, Grand Falls, Goose Bay, Baie Verte, Hants Harbour, Trout River

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

| Command                          | Description                                                  |
| -------------------------------- | ------------------------------------------------------------ |
| `npm start`                      | Start persistent bot (cron only, no immediate post)          |
| `npm run start-bot -- --post`    | Start persistent bot with immediate fetch-and-post cycle     |
| `npm run run-job`                | Run one fetch-and-post cycle immediately                     |
| `npm run dry-run`                | Run one cycle without posting (logs what would be sent)      |
| `npm run test-reply`             | Test the reply system with a fake sighting 55 min out        |
| `npm run print-locations`        | Fetch and print fresh sighting data                          |

## Docker

### Prerequisites

- [Docker](https://docs.docker.com/engine/install/) & [Docker Compose](https://docs.docker.com/compose/install/) v2+
- `.env` file in project root (see [Setup](#setup))

### Profiles

Two Compose services are defined — one with and one without the immediate `--post` on start:

| Command | Service | Starts | Immediate post? |
|---|---|---|---|
| `docker compose up -d --build` | `bot` | Cron only | No |
| `docker compose --profile post up -d --build` | `bot-post` | Cron + fetch & post | Yes |

Use the `post` profile when you want the bot to immediately fetch and post today's sightings on startup (e.g. first deploy or after a long downtime). Without it, the bot only runs on its noon daily cron.

### Common commands

| Command | Description |
|---|---|
| `docker compose up -d --build` | Build and start as daemon (cron only) |
| `docker compose --profile post up -d --build` | Build and start with immediate post |
| `docker compose down` | Stop the container |
| `docker compose logs -f` | Tail live logs |
| `docker compose logs --tail=100` | View last 100 log lines |

The container mounts `./data:/app/data`, so runtime files (`bot.log`, `locations.json`, `pending-replies.json`) persist on the host. A health check (`pgrep` on the bot process) reports status to monitoring tools like Beszel.

## Architecture

1. NASA data is fetched from `iss-sts.hqmce.nasa.gov/iss-sts-cities-html/` — pre-rendered HTML tables served from S3
2. The daily cron (12:00 PM) parses the tables, finds all sightings for the next day, and posts one consolidated alert per location
3. Every 10 minutes, a second cron checks if any upcoming sighting is 1 hour away, 30 minutes away, or happening now, and posts a reply to the original alert with the appropriate countdown message
4. All posts use `RichText` from `@atproto/api` to ensure hashtags render correctly on Bluesky

## Data files

| File                           | Purpose                         | Git     |
| ------------------------------ | ------------------------------- | ------- |
| `data/locations.json`          | Cached sighting data from NASA  | Ignored |
| `data/pending-replies.json`    | Queue of scheduled reply alerts | Ignored |
| `data/bot.log`                 | Timestamped activity log        | Ignored |
| `.env`                         | Bluesky credentials             | Ignored |
