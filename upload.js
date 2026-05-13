const { google } = require("googleapis");
const fs = require("fs");

// ════════════════════════════════════════════════════════════
// CONTENT LISTS — edit these to customize
// ════════════════════════════════════════════════════════════

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
  "\u{1F602}", "\u{1F923}", "\u{1F480}", "\u{1F62D}", "\u{1F525}", "\u{1F4AF}",
  "\u2728", "\u{1F37F}", "\u{1F92F}", "\u{1F921}", "\u2705", "\u{1F947}",
];

const COMMENTS = [
  "Rate this 1-10! \u{1F602}\u{1F447}",
  "Who else would do this? \u{1F480}",
  "Tag a friend who needs to see this! \u{1F525}",
  "What was your favorite part? \u{1F447}",
  "Follow for more like this! \u{1F525}",
  "Drop a \u{1F602} if you laughed!",
];

const DAILY_LIMIT = 5;

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function pick(arr, n) {
  const c = [...arr];
  const r = [];
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
    .replace(/^PRO_[a-zA-Z0-9]+_/, "")
    .replace(/_/g, " ")
    .trim() || "Untitled";
}

function buildTags() {
  const all = [...new Set([...pick(HASHTAGS, 5), ...EXTRA_TAGS, "SamShorts"])];
  return all.sort(() => Math.random() - 0.5).slice(0, 15);
}

function buildTitle(raw) {
  return (raw + " " + pickOne(EMOJIS)).slice(0, 100);
}

function buildDescription(tags) {
  const hs = tags.slice(0, 6).map(function (t) { return "#" + t; }).join(" ");
  const em = pickOne(EMOJIS) + pickOne(EMOJIS);
  return hs + "\n\nEnjoy! " + em + "\n\nLike & Subscribe for more! \u{1F514}";
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

// ════════════════════════════════════════════════════════════
// QUOTA TRACKING
// ════════════════════════════════════════════════════════════

function getQuota() {
  try {
    const data = JSON.parse(fs.readFileSync("quota.json", "utf8"));
    if (data.date === todayStr()) return data.count;
  } catch (e) {}
  return 0;
}

function saveQuota(count) {
  fs.writeFileSync(
    "quota.json",
    JSON.stringify({ date: todayStr(), count: count }, null, 2)
  );
}

// ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════

async function main() {
  // Random skip — spreads 5 uploads across the day
  if (Math.random() > 0.15) {
    console.log("Random skip — will try again in 30 minutes.");
    return;
  }

  var quota = getQuota();
  console.log("Quota today: " + quota + "/" + DAILY_LIMIT);

  if (quota >= DAILY_LIMIT) {
    console.log("Daily limit reached. Nothing to do.");
    return;
  }

  // Auth
  var auth = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

  var drive = google.drive({ version: "v3", auth: auth });
  var youtube = google.youtube({ version: "v3", auth: auth });

  // List pending videos
  var res = await drive.files.list({
    q: "'" + process.env.DRIVE_FOLDER_ID + "' in parents and mimeType contains 'video' and trashed=false",
    fields: "files(id, name, size)",
    pageSize: 100,
  });

  var files = res.data.files || [];
  console.log("Pending videos: " + files.length);

  if (files.length === 0) {
    console.log("No videos to upload.");
    return;
  }

  // Pick one random video
  var file = pickOne(files);
  var rawTitle = titleFromFilename(file.name);
  var sizeMB = (parseInt(file.size || 0) / 1024 / 1024).toFixed(1);

  console.log("");
  console.log("--- Picked ---");
  console.log("File: " + file.name);
  console.log("Size: " + sizeMB + " MB");
  console.log("Clean title: " + rawTitle);

  // Download from Drive to /tmp
  console.log("");
  console.log("Downloading from Drive...");
  var tmpPath = "/tmp/video.mp4";
  var dest = fs.createWriteStream(tmpPath);

  await new Promise(function (resolve, reject) {
    drive.files
      .get({ fileId: file.id, alt: "media" }, { responseType: "stream" })
      .then(function (resp) {
        resp.data.pipe(dest);
        dest.on("finish", resolve);
        dest.on("error", reject);
      })
      .catch(reject);
  });

  var downloadedSize = fs.statSync(tmpPath).size;
  console.log("Downloaded: " + (downloadedSize / 1024 / 1024).toFixed(1) + " MB");

  // Build metadata
  var title = buildTitle(rawTitle);
  var tags = buildTags();
  var desc = buildDescription(tags);

  console.log("");
  console.log("--- YouTube Metadata ---");
  console.log("Title: " + title);
  console.log("Tags: " + tags.join(", "));

  // Upload to YouTube
  console.log("");
  console.log("Uploading to YouTube...");
  var uploadRes = await youtube.videos.insert({
    part: "snippet,status",
    requestBody: {
      snippet: {
        title: title,
        description: desc,
        tags: tags,
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

  var videoId = uploadRes.data.id;
  var videoUrl = "https://youtube.com/shorts/" + videoId;
  console.log("Uploaded! " + videoUrl);

  // Post engagement comment
  var comment = pickOne(COMMENTS);
  try {
    await youtube.commentThreads.insert({
      part: "snippet",
      requestBody: {
        snippet: {
          videoId: videoId,
          topLevelComment: { snippet: { textOriginal: comment } },
        },
      },
    });
    console.log("Comment: " + comment);
  } catch (err) {
    console.log("Comment failed (non-fatal): " + err.message);
  }

  // Move to posted folder
  await drive.files.update({
    fileId: file.id,
    addParents: process.env.POSTED_FOLDER_ID,
    removeParents: process.env.DRIVE_FOLDER_ID,
    fields: "id, parents",
  });
  console.log("Moved to posted/ folder");

  // Update quota
  var newCount = quota + 1;
  saveQuota(newCount);
  console.log("Quota: " + newCount + "/" + DAILY_LIMIT);

  // Summary
  console.log("");
  console.log("========================================");
  console.log("DONE");
  console.log("Video: " + videoUrl);
  console.log("Title: " + title);
  console.log("Remaining: " + (files.length - 1) + " videos");
  console.log("========================================");
}

main().catch(function (err) {
  console.error("FATAL ERROR:", err.message);
  process.exit(1);
});
