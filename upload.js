const { google } = require("googleapis");
const fs = require("fs");

// ════════════════════════════════════════════
// HARDCODED CONTENT LISTS
// ════════════════════════════════════════════

const HASHTAGS = [
  "Shorts", "viral", "trending", "fyp", "explore",
  "youtubeshorts", "funny", "comedy", "memes", "humor",
  "lol", "funnyshorts", "comedyshorts", "relatable",
  "memesdaily", "funnyvideo", "waitforit",
];

const EXTRA_TAGS = [
  "funny moments", "viral video", "best shorts",
  "comedy shorts", "try not to laugh",
];

const EMOJIS = [
  "😂", "🤣", "💀", "😭", "🔥", "💯",
  "✨", "🍿", "🤯", "🤡", "✅", "🥇",
];

const COMMENTS = [
  "Rate this 1-10! 😂👇",
  "Who else would do this? 💀",
  "Tag a friend who needs to see this! 🔥",
  "What was your favorite part? 👇",
  "Follow for more like this! 🔥",
  "Drop a 😂 if you laughed!",
];

const DAILY_LIMIT = 5;

// ════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════

function pick(arr, n) {
  const c = [...arr], r = [];
  for (let i = 0; i < Math.min(n, c.length); i++) {
    r.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  }
  return r;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function titleFromFilename(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/^PRO_/, "")
    .replace(/_/g, " ")
    .trim() || "Untitled";
}

function buildTags() {
  const all = [...new Set([...pick(HASHTAGS, 5), ...EXTRA_TAGS, "SamShorts"])];
  return all.sort(() => Math.random() - 0.5).slice(0, 15);
}

function buildTitle(raw) {
  return `${raw} ${pickOne(EMOJIS)}`.slice(0, 100);
}

function buildDescription(tags) {
  const hs = tags.slice(0, 6).map((t) => `#${t}`).join(" ");
  return `${hs}\n\nEnjoy! ${pickOne(EMOJIS)}${pickOne(EMOJIS)}\n\nLike & Subscribe for more! 🔔`;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

// ════════════════════════════════════════════
// QUOTA TRACKING (via local file, committed by workflow)
// ════════════════════════════════════════════

function getQuota() {
  try {
    const data = JSON.parse(fs.readFileSync("quota.json", "utf8"));
    if (data.date === todayStr()) return data.count;
  } catch {}
  return 0;
}

function saveQuota(count) {
  fs.writeFileSync(
    "quota.json",
    JSON.stringify({ date: todayStr(), count }, null, 2)
  );
}

// ════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════

async function main() {
  const quota = getQuota();
  console.log(`Quota today: ${quota}/${DAILY_LIMIT}`);

  if (quota >= DAILY_LIMIT) {
    console.log("Daily limit reached. Nothing to do.");
    return;
  }

  // Auth
  const auth = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

  const drive = google.drive({ version: "v3", auth });
  const youtube = google.youtube({ version: "v3", auth });

  // List pending videos in Drive folder
  const res = await drive.files.list({
    q: `'${process.env.DRIVE_FOLDER_ID}' in parents and mimeType contains 'video' and trashed=false`,
    fields: "files(id, name, size)",
    pageSize: 100,
  });

  const files = res.data.files || [];
  console.log(`Pending videos: ${files.length}`);

  if (files.length === 0) {
    console.log("No videos to upload.");
    return;
  }

  // Pick ONE random video
  const file = pickOne(files);
  const rawTitle = titleFromFilename(file.name);
  const sizeMB = (parseInt(file.size || 0) / 1024 / 1024).toFixed(1);

  console.log(`\n--- Picked ---`);
  console.log(`File: ${file.name}`);
  console.log(`Size: ${sizeMB} MB`);
  console.log(`Title: ${rawTitle}`);

  // Download to /tmp
  console.log("\nDownloading from Drive...");
  const tmpPath = "/tmp/video.mp4";
  const dest = fs.createWriteStream(tmpPath);

  await new Promise((resolve, reject) => {
    drive.files
      .get({ fileId: file.id, alt: "media" }, { responseType: "stream" })
      .then((resp) => {
        resp.data.pipe(dest);
        dest.on("finish", resolve);
        dest.on("error", reject);
      })
      .catch(reject);
  });

  const downloadedSize = fs.statSync(tmpPath).size;
  console.log(`Downloaded: ${(downloadedSize / 1024 / 1024).toFixed(1)} MB`);

  // Build metadata
  const title = buildTitle(rawTitle);
  const tags = buildTags();
  const desc = buildDescription(tags);

  console.log(`\n--- YouTube Metadata ---`);
  console.log(`Title: ${title}`);
  console.log(`Tags: ${tags.join(", ")}`);
  console.log(`Description preview: ${desc.substring(0, 80)}...`);

  // Upload to YouTube
  console.log("\nUploading to YouTube...");
  const uploadRes = await youtube.videos.insert({
    part: "snippet,status",
    requestBody: {
      snippet: {
        title,
        description: desc,
        tags,
        categoryId: "23",
        defaultLanguage: "en",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
        embeddable: true,
        publicStatsViewable: true,
      },
    },
    media: {
      body: fs.createReadStream(tmpPath),
    },
  });

  const videoId = uploadRes.data.id;
  const videoUrl = `https://youtube.com/shorts/${videoId}`;
  console.log(`✓ Uploaded! ${videoUrl}`);

  // Post engagement comment
  const comment = pickOne(COMMENTS);
  try {
    await youtube.commentThreads.insert({
      part: "snippet",
      requestBody: {
        snippet: {
          videoId,
          topLevelComment: { snippet: { textOriginal: comment } },
        },
      },
    });
    console.log(`✓ Comment: ${comment}`);
  } catch (err) {
    console.log(`⚠ Comment failed (non-fatal): ${err.message}`);
  }

  // Move file to posted folder in Drive
  await drive.files.update({
    fileId: file.id,
    addParents: process.env.POSTED_FOLDER_ID,
    removeParents: process.env.DRIVE_FOLDER_ID,
    fields: "id, parents",
  });
  console.log("✓ Moved to posted/ folder");

  // Save quota
  const newCount = quota + 1;
  saveQuota(newCount);
  console.log(`✓ Quota: ${newCount}/${DAILY_LIMIT}`);

  // Output summary for GitHub Actions log
  console.log(`\n══════════════════════════════════════`);
  console.log(`✅ DONE`);
  console.log(`Video: ${videoUrl}`);
  console.log(`Title: ${title}`);
  console.log(`Remaining: ${files.length - 1} videos`);
  console.log(`══════════════════════════════════════`);
}

main().catch((err) => {
  console.error("\n✗ FATAL ERROR:", err.message);
  process.exit(1);
});
