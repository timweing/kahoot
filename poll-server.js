const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_PASSWORD = process.env.POLL_ADMIN_PASSWORD || "Admin";
const PORT = process.env.POLL_PORT || 4000;

app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage() });

const VALID_TYPES = ["wordcloud", "single", "importance"];

let pollQuestions = [];
let pollInProgress = false;
let currentPollIndex = -1;
let aggregates = [];

const participants = new Map();
const answersPerQuestion = new Map();
let anonymousCounter = 1;

function registerAnonymousParticipant(socket) {
  const name = `Teilnehmer #${anonymousCounter++}`;
  participants.set(socket.id, { id: socket.id, name });
  socket.emit("poll-joined", { name });
  broadcastParticipants();
}

function initAggregate(question) {
  if (question.type === "wordcloud") {
    return { submissions: 0, counts: {} }; // key -> { display, count }
  }
  if (question.type === "single") {
    return {
      submissions: 0,
      counts: Object.fromEntries(question.options.map((o) => [o, 0])),
    };
  }
  if (question.type === "importance") {
    const base = Object.fromEntries(
      question.options.map((o) => [o, Array(question.options.length).fill(0)])
    );
    return {
      submissions: 0,
      scores: Object.fromEntries(question.options.map((o) => [o, 0])),
      positions: base, // option -> counts per position
    };
  }
  return null;
}

function wordcloudAnswer(question, aggregate, words) {
  if (!Array.isArray(words) || !words.length) return false;
  const limit = question.maxWordsPerUser || 1;
  const cleaned = words
    .slice(0, limit)
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter((w) => w.length > 0 && w.length <= 40);
  if (!cleaned.length) return false;

  cleaned.forEach((word) => {
    const key = word.toLowerCase();
    const entry = aggregate.counts[key] || { display: word, count: 0 };
    if (!entry.display) entry.display = word;
    entry.count += 1;
    aggregate.counts[key] = entry;
  });

  aggregate.submissions += 1;
  return true;
}

function singleChoiceAnswer(question, aggregate, choice) {
  if (typeof choice !== "string") return false;
  const trimmed = choice.trim();
  if (!question.options.includes(trimmed)) return false;
  aggregate.counts[trimmed] = (aggregate.counts[trimmed] || 0) + 1;
  aggregate.submissions += 1;
  return true;
}

function importanceAnswer(question, aggregate, ranking) {
  if (!Array.isArray(ranking)) return false;
  const normalized = ranking.map((r) => (typeof r === "string" ? r.trim() : ""));
  const unique = new Set(normalized);
  if (
    normalized.length !== question.options.length ||
    unique.size !== question.options.length
  ) {
    return false;
  }
  for (const opt of normalized) {
    if (!question.options.includes(opt)) return false;
  }

  const n = question.options.length;
  normalized.forEach((opt, idx) => {
    aggregate.scores[opt] = (aggregate.scores[opt] || 0) + (n - idx);
    const bucket = aggregate.positions[opt] || Array(n).fill(0);
    bucket[idx] = (bucket[idx] || 0) + 1;
    aggregate.positions[opt] = bucket;
  });

  aggregate.submissions += 1;
  return true;
}

function aggregateForClient(index) {
  const question = pollQuestions[index];
  const aggregate = aggregates[index];
  if (!question || !aggregate) return null;

  if (question.type === "wordcloud") {
    const entries = Object.values(aggregate.counts || {}).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.display.localeCompare(b.display);
    });
    return {
      type: "wordcloud",
      questionIndex: index,
      totalSubmissions: aggregate.submissions,
      entries: entries.map((e) => ({ word: e.display, count: e.count })),
    };
  }

  if (question.type === "single") {
    const options = question.options.map((opt) => ({
      text: opt,
      count: aggregate.counts ? aggregate.counts[opt] || 0 : 0,
    }));
    return {
      type: "single",
      questionIndex: index,
      totalSubmissions: aggregate.submissions,
      options,
    };
  }

  if (question.type === "importance") {
    const options = question.options.map((opt) => {
      const positionCounts = aggregate.positions[opt] || [];
      const total = aggregate.submissions || 0;
      const totalRanks = positionCounts.reduce(
        (sum, count, pos) => sum + count * (pos + 1),
        0
      );
      const avgRank = total ? totalRanks / total : 0;
      return {
        text: opt,
        score: aggregate.scores[opt] || 0,
        avgRank,
        positionCounts,
      };
    });

    options.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.avgRank - b.avgRank;
    });

    return {
      type: "importance",
      questionIndex: index,
      totalSubmissions: aggregate.submissions,
      options,
    };
  }

  return null;
}

function questionPayload(question, index) {
  return {
    index,
    total: pollQuestions.length,
    type: question.type,
    question: question.question,
    options: question.options,
    maxWordsPerUser: question.maxWordsPerUser,
  };
}

function broadcastParticipants() {
  const list = Array.from(participants.values()).map((p) => ({ name: p.name }));
  io.to("poll-admins").emit("poll-participants", list);
}

function broadcastAggregate(index) {
  const aggregate = aggregateForClient(index);
  if (!aggregate) return;
  io.to("poll-admins").emit("poll-aggregate", aggregate);
  io.to("poll-displays").emit("poll-aggregate", aggregate);
}

function endPoll() {
  pollInProgress = false;
  const payload = pollQuestions.map((q, idx) => ({
    question: q.question,
    type: q.type,
    summary: aggregateForClient(idx),
  }));

  io.emit("poll-ended", { results: payload });
  currentPollIndex = -1;
}

function goToNextQuestion() {
  currentPollIndex += 1;
  if (currentPollIndex >= pollQuestions.length) {
    endPoll();
    return;
  }

  answersPerQuestion.set(currentPollIndex, new Set());
  const q = pollQuestions[currentPollIndex];
  const payload = questionPayload(q, currentPollIndex);
  io.to("poll-participants").emit("poll-question", payload);
  io.to("poll-displays").emit("poll-question", payload);
  io.to("poll-admins").emit("poll-question", payload);
  broadcastAggregate(currentPollIndex);
}

function sendStatus(socket) {
  const statusPayload = {
    pollLoaded: pollQuestions.length > 0,
    pollInProgress,
    totalQuestions: pollQuestions.length,
    currentQuestionIndex: currentPollIndex,
    currentQuestion:
      pollInProgress && currentPollIndex >= 0
        ? questionPayload(pollQuestions[currentPollIndex], currentPollIndex)
        : null,
    currentAggregate:
      pollInProgress && currentPollIndex >= 0
        ? aggregateForClient(currentPollIndex)
        : null,
  };
  socket.emit("poll-status", statusPayload);
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) {
    throw new Error("CSV ist leer.");
  }

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());

  const colIndex = {
    type: headers.indexOf("type"),
    question: headers.indexOf("question"),
    options: headers.indexOf("options"),
    maxWords: headers.indexOf("maxwordsperuser"),
  };

  if (colIndex.type === -1 || colIndex.question === -1) {
    throw new Error(
      "CSV Header muss mindestens 'type' und 'question' enthalten."
    );
  }

  const parsed = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(sep).map((c) => c.trim());
    const type = (row[colIndex.type] || "").toLowerCase();
    const question = row[colIndex.question] || "";
    const optionsRaw =
      colIndex.options >= 0 ? row[colIndex.options] || "" : "";
    const maxWords =
      colIndex.maxWords >= 0 ? parseInt(row[colIndex.maxWords], 10) : undefined;

    if (!VALID_TYPES.includes(type)) {
      console.warn("Ungültiger Typ, Zeile übersprungen:", lines[i]);
      continue;
    }
    if (!question) {
      console.warn("Leere Frage, Zeile übersprungen:", lines[i]);
      continue;
    }

    const options =
      optionsRaw.length > 0
        ? optionsRaw.split("|").map((o) => o.trim()).filter(Boolean)
        : [];

    if (type !== "wordcloud" && options.length < 2) {
      console.warn("Zu wenige Optionen, Zeile übersprungen:", lines[i]);
      continue;
    }

    parsed.push({
      type,
      question,
      options: type === "wordcloud" ? [] : options,
      maxWordsPerUser:
        type === "wordcloud" ? maxWords && maxWords > 0 ? maxWords : 3 : null,
    });
  }

  if (!parsed.length) {
    throw new Error("Keine gültigen Fragen gefunden.");
  }

  return parsed;
}

app.post("/poll/upload-csv", upload.single("file"), (req, res) => {
  const providedPassword = req.headers["x-admin-password"] || "";
  if (providedPassword !== ADMIN_PASSWORD) {
    return res
      .status(401)
      .json({ success: false, message: "Admin-Passwort falsch." });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: "Keine Datei" });
  }

  try {
    const csvContent = req.file.buffer.toString("utf-8");
    pollQuestions = parseCsv(csvContent);
    pollInProgress = false;
    currentPollIndex = -1;
    aggregates = pollQuestions.map((q) => initAggregate(q));
    answersPerQuestion.clear();

    io.to("poll-admins").emit("poll-loaded", {
      totalQuestions: pollQuestions.length,
    });

    res.json({
      success: true,
      totalQuestions: pollQuestions.length,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({
      success: false,
      message: err.message || "Fehler beim Parsen.",
    });
  }
});

io.on("connection", (socket) => {
  const role = socket.handshake.query.role || "participant";
  const adminPassword = socket.handshake.query.adminPassword || "";
  const isAdmin = role === "poll-admin" && adminPassword === ADMIN_PASSWORD;

  if (role === "poll-admin" && !isAdmin) {
    socket.emit("poll-admin-auth-failed");
    socket.disconnect();
    return;
  }

  if (isAdmin) {
    socket.join("poll-admins");
    sendStatus(socket);
    broadcastParticipants();
  } else if (role === "poll-display") {
    socket.join("poll-displays");
    sendStatus(socket);
  } else {
    socket.join("poll-participants");
    sendStatus(socket);
  }

  socket.on("poll-start", () => {
    if (!isAdmin) return;
    if (!pollQuestions.length) return;
    pollInProgress = true;
    currentPollIndex = -1;
    aggregates = pollQuestions.map((q) => initAggregate(q));
    answersPerQuestion.clear();
    io.emit("poll-started");
    goToNextQuestion();
  });

  socket.on("poll-next", () => {
    if (!isAdmin || !pollInProgress) return;
    goToNextQuestion();
  });

  socket.on("poll-join", () => {
    // Beitritt ist nun anonym und automatisch bei Verbindungsaufbau.
    const participant = participants.get(socket.id);
    if (participant) {
      socket.emit("poll-joined", { name: participant.name });
      return;
    }
    registerAnonymousParticipant(socket);
  });

  socket.on("poll-answer", (payload) => {
    const participant = participants.get(socket.id);
    if (!participant || !pollInProgress) return;

    const { questionIndex } = payload || {};
    if (questionIndex !== currentPollIndex) return;

    const question = pollQuestions[questionIndex];
    const aggregate = aggregates[questionIndex];
    if (!question || !aggregate) return;

    const answeredSet = answersPerQuestion.get(questionIndex) || new Set();
    if (answeredSet.has(socket.id)) return;

    let accepted = false;
    if (question.type === "wordcloud") {
      accepted = wordcloudAnswer(
        question,
        aggregate,
        Array.isArray(payload.words) ? payload.words : []
      );
    } else if (question.type === "single") {
      accepted = singleChoiceAnswer(
        question,
        aggregate,
        payload.choice || ""
      );
    } else if (question.type === "importance") {
      accepted = importanceAnswer(
        question,
        aggregate,
        Array.isArray(payload.ranking) ? payload.ranking : []
      );
    }

    if (!accepted) {
      socket.emit("poll-answer-rejected", { reason: "Ungültige Antwort" });
      return;
    }

    answeredSet.add(socket.id);
    answersPerQuestion.set(questionIndex, answeredSet);
    socket.emit("poll-answer-accepted", { questionIndex });
    broadcastAggregate(questionIndex);
  });

  socket.on("disconnect", () => {
    if (participants.has(socket.id)) {
      participants.delete(socket.id);
      broadcastParticipants();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Umfrage-Server läuft auf Port ${PORT}`);
});
