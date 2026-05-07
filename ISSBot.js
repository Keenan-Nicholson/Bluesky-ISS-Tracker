const fs = require("fs/promises");
const { BskyAgent, RichText } = require("@atproto/api");

const cron = require("node-cron");
const minimist = require("minimist");
const dotenv = require("dotenv");

const DATA_DIR = "data";
const LOG_FILE = `${DATA_DIR}/bot.log`;

const log = async (message, type = "INFO") => {
  const line = `[${new Date().toISOString()}] [${type}] ${message}`;
  console.log(line);
  await fs.appendFile(LOG_FILE, line + "\n");
};

dotenv.config();
const argv = minimist(process.argv.slice(2));
const DRY_RUN = argv["dry-run"] ?? false;

const CRON_SCHEDULE = "0 12 * * *";
const REPLY_CRON = "*/10 * * * *";
const PENDING_REPLIES_FILE = `${DATA_DIR}/pending-replies.json`;
const NASA_S3_URL = "https://iss-sts.hqmce.nasa.gov/iss-sts-cities-html/";
const HASHTAGS = "#Newfoundland #Labrador #ISS";

let agent;

const initBluesky = async () => {
  try {
    agent = new BskyAgent({
      service: "https://bsky.social",
    });
    await agent.login({
      identifier: process.env.ISS_BOT_BLUESKY_HANDLE,
      password: process.env.ISS_BOT_BLUESKY_PASSWORD,
    });

    log("Bluesky initialized successfully");
  } catch (error) {
    log(`Failed to initialize Bluesky: ${error.message}`, "ERROR");
    agent = null;
  }
};

const LOCATIONS = {
  "St. Johns": "Saint_Johns",
  "Corner Brook": "Corner_Brook",
  "Grand Falls": "Grand_Falls",
  "Goose Bay": "Goose_Bay",
  "Baie Verte": "Baie_Verte",
  "Hants Harbour": "Hants_Harbour",
  "Trout River": "Trout_River",
};

const getLocation = async (city) => {
  try {
    const html = await (
      await fetch(`${NASA_S3_URL}Canada-Newfoundland-${city}.html`)
    ).text();
    const data = [];
    const rowRe = /<tr[\s>][\s\S]*?<\/tr>/gi;
    const cellRe = /<td>([\s\S]*?)<\/td>/gi;
    let row;
    while ((row = rowRe.exec(html)) !== null) {
      const cells = [];
      let cell;
      while ((cell = cellRe.exec(row[0])) !== null) {
        cells.push(cell[1].trim().replace(/&deg;/g, "°"));
      }
      if (cells.length >= 5) {
        data.push({
          date: cells[0],
          visible: cells[1],
          height: cells[2],
          appears: cells[3],
          disappears: cells[4],
        });
      }
    }
    return data;
  } catch (error) {
    log(`Failed to fetch ${city}: ${error.message}`, "ERROR");
    return [];
  }
};

const getLocations = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(LOCATIONS).map(async ([name, city]) => [
        name,
        await getLocation(city),
      ]),
    ),
  );

const writeLocations = async (locations) =>
  fs.writeFile(
    `${DATA_DIR}/locations.json`,
    JSON.stringify(locations, null, 2),
  );

const formatDate = (date) => {
  const formatted = date.toDateString().slice(4, 10);
  return formatted[4] === "0" ? formatted.replace("0", "") : formatted;
};

const timeToMinutes = (timeStr) => {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const getNewfoundlandMinutes = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/St_Johns",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const [hours, minutes] = formatter.format(now).split(":").map(Number);
  return hours * 60 + minutes;
};

const getNewfoundlandDate = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/St_Johns",
    month: "short",
    day: "numeric",
  });
  return formatter.format(now);
};

const readPendingReplies = async () => {
  try {
    return JSON.parse(await fs.readFile(PENDING_REPLIES_FILE, "utf-8"));
  } catch {
    return [];
  }
};

const writePendingReplies = async (replies) =>
  fs.writeFile(PENDING_REPLIES_FILE, JSON.stringify(replies, null, 2));

const buildReplyPost = (locationName, sighting, type) => {
  const msgs = {
    "1hr": `🛰️ The #ISS will be visible from ${locationName} in about 1 hour (${sighting.time})!\n\nLook ${sighting.direction} at ${sighting.degree} elevation.\n\n${HASHTAGS}`,
    "30min": `🛰️ The #ISS will be visible from ${locationName} in about 30 minutes (${sighting.time})!\n\nLook ${sighting.direction} at ${sighting.degree} elevation.\n\n${HASHTAGS}`,
    now: `🛰️ The #ISS is now visible from ${locationName}! Look ${sighting.direction} at ${sighting.degree} elevation.\n\n${HASHTAGS}`,
  };
  return msgs[type] || msgs.now;
};

const buildVisiblePost = (locationName, date, sightings) => {
  const count = sightings.length;
  const header =
    count > 1
      ? `${locationName} — ${date} (${count})`
      : `${locationName} — ${date}`;

  const stripAbove = (s) => s.replace(" above ", " ");

  const lines = sightings.map(
    (s, i) =>
      `${count > 1 ? `${i + 1}. ` : ""}${s.time} ✦ ${s.duration} ✦ ↑${stripAbove(s.appears)} ✦ ↓${stripAbove(s.disappears)}`,
  );

  return `${header}\n${lines.join("\n")}\n\n${HASHTAGS}`;
};

const postToBluesky = async (text, replyTo = null) => {
  if (!agent) {
    log("Bluesky disabled, not actually posting");
    return null;
  }
  log(`Post: ${text}`);
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  const post = {
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString(),
  };
  if (replyTo) {
    post.reply = {
      parent: { uri: replyTo.uri, cid: replyTo.cid },
      root: { uri: replyTo.uri, cid: replyTo.cid },
    };
  }
  if (DRY_RUN) {
    log("DRY RUN — post skipped");
    return replyTo
      ? { uri: replyTo.uri, cid: replyTo.cid }
      : { uri: "dry-run-uri", cid: "dry-run-cid" };
  }
  try {
    return await agent.post(post);
  } catch (error) {
    log(`Failed to post: ${error.message}`, "ERROR");
    return null;
  }
};

const extractDate = (data) => {
  const match = data.date.match(/(\w+)\s+(\d+)/);
  if (!match) return "";
  return `${match[1]} ${match[2].replace(/^0/, "")}`;
};

const parseSighting = (data) => {
  const timeMatch = data.date.match(/(([01]?[0-9]):([0-5][0-9]) ([AaPp][Mm]))/);
  return {
    time: timeMatch?.[0],
    duration: data.visible,
    degree: data.height,
    appears: data.appears,
    disappears: data.disappears,
    direction: data.appears.replace(/[\d]+°\s+/, ""),
  };
};

const postUpdate = async (locationData, locationName, tomorrow) => {
  log(`Posting updates for ${locationName}`);

  if (DRY_RUN && locationData.length === 0) {
    locationData = [
      {
        date: `Dry ${tomorrow}, 9:30 PM`,
        visible: "4 min",
        height: "12°",
        appears: "12° above SSW",
        disappears: "10° above NE",
      },
    ];
    log(
      `${locationName}: no sightings on NASA page, using seed data (dry-run)`,
    );
  }

  const matches = locationData.filter((data) => extractDate(data) === tomorrow);

  if (matches.length > 0) {
    const sightings = matches.map((d) => ({
      ...parseSighting(d),
      sentAlerts: [],
    }));
    const result = await postToBluesky(
      buildVisiblePost(locationName, tomorrow, sightings),
    );
    if (result?.uri) {
      return {
        uri: result.uri,
        cid: result.cid,
        locationName,
        tomorrowDate: tomorrow,
        sightings,
      };
    }
    return null;
  }

  if (DRY_RUN && locationData.length > 0) {
    const first = locationData.find((d) => extractDate(d));
    if (first) {
      const date = extractDate(first);
      const sighting = { ...parseSighting(first), sentAlerts: [] };
      log(
        `${locationName}: no data for tomorrow, using "${date}" instead (dry-run)`,
      );
      const result = await postToBluesky(
        buildVisiblePost(locationName, date, [sighting]),
      );
      if (result?.uri) {
        return {
          uri: result.uri,
          cid: result.cid,
          locationName,
          tomorrowDate: date,
          sightings: [sighting],
        };
      }
    }
  }

  log(`${locationName}: not visible tomorrow, skipping`);
  return null;
};

const ALERTS = [
  { key: "1hr", window: [-65, -55], label: "1 hour before" },
  { key: "30min", window: [-35, -25], label: "30 minutes before" },
  { key: "now", window: [-5, 5], label: "now" },
];

const checkPendingReplies = async () => {
  const pending = await readPendingReplies();
  if (pending.length === 0) return;

  const nlMinutes = getNewfoundlandMinutes();
  const nlDate = getNewfoundlandDate();
  const remaining = [];

  for (const reply of pending) {
    if (nlDate !== reply.tomorrowDate) {
      remaining.push(reply);
      continue;
    }

    let hasActive = false;

    for (const sighting of reply.sightings) {
      const sightingMinutes = timeToMinutes(sighting.time);
      if (sightingMinutes === null) {
        hasActive = true;
        continue;
      }

      sighting.sentAlerts = sighting.sentAlerts || [];

      for (const alert of ALERTS) {
        if (sighting.sentAlerts.includes(alert.key)) continue;
        const [start, end] = alert.window;
        if (
          nlMinutes >= sightingMinutes + start &&
          nlMinutes <= sightingMinutes + end
        ) {
          const text = buildReplyPost(reply.locationName, sighting, alert.key);
          log(
            `Reply to ${reply.locationName} (${sighting.time}, ${alert.label})`,
          );
          await postToBluesky(text, { uri: reply.uri, cid: reply.cid });
          sighting.sentAlerts.push(alert.key);
        }
      }

      if (sighting.sentAlerts.length < 3 && nlMinutes <= sightingMinutes + 15) {
        hasActive = true;
      }
    }

    if (hasActive) remaining.push(reply);
  }

  await writePendingReplies(remaining);
};

const job = async () => {
  const tomorrow = formatDate(new Date(Date.now() + 86400000));
  log(`Running job for ${tomorrow}`);

  const locations = await getLocations();
  const existing = await readPendingReplies();

  const results = [];
  for (const [name, data] of Object.entries(locations)) {
    if (
      existing.some(
        (e) => e.locationName === name && e.tomorrowDate === tomorrow,
      )
    ) {
      log(`${name}: already posted for ${tomorrow}, skipping`);
      results.push(null);
      continue;
    }
    const result = await postUpdate(data, name, tomorrow);
    results.push(result);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const newReplies = results.filter((r) => r);
  if (newReplies.length > 0) {
    await writePendingReplies([...existing, ...newReplies]);
    log(`Saved ${newReplies.length} pending reply(s)`);
  }

  await writeLocations(locations);
};

const COMMANDS = {
  "start-bot": async () => {
    log(`Starting bot on cron schedule ${CRON_SCHEDULE}`);
    if (argv["post"]) await job();
    cron.schedule(CRON_SCHEDULE, job);
    cron.schedule(REPLY_CRON, checkPendingReplies);
    await checkPendingReplies();
  },
  "run-job": async () => {
    await job();
    await checkPendingReplies();
  },
  "test-reply": async () => {
    const testTime = new Date();
    testTime.setMinutes(testTime.getMinutes() + 55);
    const timeStr = testTime.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    await writePendingReplies([
      {
        uri: "test-uri",
        cid: "test-cid",
        locationName: "Test Location",
        tomorrowDate: getNewfoundlandDate(),
        sightings: [
          {
            time: timeStr,
            duration: "4 min",
            degree: "12°",
            appears: "12° above SSW",
            disappears: "10° above NE",
            direction: "above SSW",
            sentAlerts: [],
          },
        ],
      },
    ]);
    log(`Test pending reply created for ${timeStr} (~55 min from now)`);
    await checkPendingReplies();
    const remaining = await readPendingReplies();
    if (remaining.length === 0) {
      log("Reply was sent!");
    } else {
      log(`Reply not yet sent, ${remaining.length} still pending`);
    }
    await writePendingReplies([]);
  },
  "print-locations": async () => log(JSON.stringify(await getLocations())),
};

const main = async () => {
  await initBluesky();
  const command = argv._[0];
  if (COMMANDS[command]) {
    await COMMANDS[command]();
  } else {
    log("Unknown / missing argument", "ERROR");
    process.exitCode = 1;
  }
};

main();
