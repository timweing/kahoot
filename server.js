const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin";

// Static Files
app.use(express.static(path.join(__dirname, "public")));

// Multer für CSV-Upload (im Speicher)
const upload = multer({ storage: multer.memoryStorage() });

// Quiz-Daten
let quizQuestions = []; // [{question, correct, wrong:[...], time}]
let quizInProgress = false;
let currentQuestionIndex = -1;
let questionTimer = null;
let questionStats = [];
let uiLanguage = "de";

// Umfrage-Daten
const VALID_POLL_TYPES = ["wordcloud", "single", "importance"];
let pollQuestions = [];
let pollInProgress = false;
let currentPollIndex = -1;
let pollAggregates = [];
const pollParticipants = new Map();
const pollAnswersPerQuestion = new Map();
let pollAnonymousCounter = 1;

function registerAnonymousPollParticipant(socket) {
  const name = `Teilnehmer #${pollAnonymousCounter++}`;
  pollParticipants.set(socket.id, { id: socket.id, name });
  socket.emit("poll-joined", { name });
  broadcastPollParticipants();
}

// Spieler: Map socketId -> { name, score }
const players = new Map();

// Zum Verfolgen, wer welche Frage schon beantwortet hat
// answersPerQuestion[questionIndex] = Set(socketId)
const answersPerQuestion = new Map();

// Hilfsfunktion: Array mischen (Fisher-Yates)
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Spieler-Liste an alle Admins schicken
function broadcastPlayerList() {
  const list = Array.from(players.values()).map((p) => ({
    name: p.name,
    score: p.score,
  }));
  io.to("admins").emit("players", list);
}

// Rangliste erstellen
function getRanking() {
  return Array.from(players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, index) => ({
      rank: index + 1,
      name: p.name,
      score: p.score,
    }));
}

// --- Umfrage-Helper ---
function initPollAggregate(question) {
  if (question.type === "wordcloud") {
    return { submissions: 0, counts: {} };
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
      positions: base,
    };
  }
  return null;
}

function pollWordcloudAnswer(question, aggregate, words) {
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

function pollSingleAnswer(question, aggregate, choice) {
  if (typeof choice !== "string") return false;
  const trimmed = choice.trim();
  if (!question.options.includes(trimmed)) return false;
  aggregate.counts[trimmed] = (aggregate.counts[trimmed] || 0) + 1;
  aggregate.submissions += 1;
  return true;
}

function pollImportanceAnswer(question, aggregate, ranking) {
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

function pollAggregateForClient(index) {
  const question = pollQuestions[index];
  const aggregate = pollAggregates[index];
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

function pollQuestionPayload(question, index) {
  return {
    index,
    total: pollQuestions.length,
    type: question.type,
    question: question.question,
    options: question.options,
    maxWordsPerUser: question.maxWordsPerUser,
  };
}

function broadcastPollParticipants() {
  const list = Array.from(pollParticipants.values()).map((p) => ({
    name: p.name,
  }));
  io.to("poll-admins").emit("poll-participants", list);
}

function broadcastPollAggregate(index) {
  const aggregate = pollAggregateForClient(index);
  if (!aggregate) return;
  io.to("poll-admins").emit("poll-aggregate", aggregate);
  io.to("poll-displays").emit("poll-aggregate", aggregate);
}

function endPoll() {
  pollInProgress = false;
  const payload = pollQuestions.map((q, idx) => ({
    question: q.question,
    type: q.type,
    summary: pollAggregateForClient(idx),
  }));

  io.emit("poll-ended", { results: payload });
  currentPollIndex = -1;
}

function goToNextPollQuestion() {
  currentPollIndex += 1;
  if (currentPollIndex >= pollQuestions.length) {
    endPoll();
    return;
  }

  pollAnswersPerQuestion.set(currentPollIndex, new Set());
  const q = pollQuestions[currentPollIndex];
  const payload = pollQuestionPayload(q, currentPollIndex);
  io.to("poll-participants").emit("poll-question", payload);
  io.to("poll-displays").emit("poll-question", payload);
  io.to("poll-admins").emit("poll-question", payload);
  broadcastPollAggregate(currentPollIndex);
}

function sendPollStatus(socket) {
  const statusPayload = {
    pollLoaded: pollQuestions.length > 0,
    pollInProgress,
    totalQuestions: pollQuestions.length,
    currentQuestionIndex: currentPollIndex,
    currentQuestion:
      pollInProgress && currentPollIndex >= 0
        ? pollQuestionPayload(pollQuestions[currentPollIndex], currentPollIndex)
        : null,
    currentAggregate:
      pollInProgress && currentPollIndex >= 0
        ? pollAggregateForClient(currentPollIndex)
        : null,
  };
  socket.emit("poll-status", statusPayload);
}

function parsePollCsv(content) {
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
    throw new Error("Header braucht mindestens 'type' und 'question'.");
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

    if (!VALID_POLL_TYPES.includes(type)) {
      console.warn("Ungültiger Poll-Typ, Zeile übersprungen:", lines[i]);
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
        type === "wordcloud" ? (maxWords && maxWords > 0 ? maxWords : 3) : null,
    });
  }

  if (!parsed.length) {
    throw new Error("Keine gültigen Umfragefragen gefunden.");
  }

  return parsed;
}

function sendCurrentQuestion() {
  if (
    currentQuestionIndex < 0 ||
    currentQuestionIndex >= quizQuestions.length
  ) {
    return;
  }

  const q = quizQuestions[currentQuestionIndex];
  const allAnswers = shuffle([
    q.correct,
    ...q.wrong.filter((x) => x && x.length > 0),
  ]);

  // Antworten der Spieler für diese Frage zurücksetzen
  answersPerQuestion.set(currentQuestionIndex, new Set());

  io.emit("question", {
    index: currentQuestionIndex,
    total: quizQuestions.length,
    question: q.question,
    answers: allAnswers,
    timeLimit: q.time,
  });

  // Timer für nächste Frage
  if (questionTimer) {
    clearTimeout(questionTimer);
  }
  const timeMs = (q.time || 20) * 1000;
  questionTimer = setTimeout(() => {
    io.emit("question-timeout", {
      index: currentQuestionIndex,
    });
    nextQuestion();
  }, timeMs);
}

function endQuiz() {
  quizInProgress = false;
  if (questionTimer) {
    clearTimeout(questionTimer);
    questionTimer = null;
  }

  const ranking = getRanking();
  const questionRanking = quizQuestions.map((q, index) => {
    const stats = questionStats[index] || { correct: 0, total: 0 };
    const total = stats.total || 0;
    const correct = stats.correct || 0;
    const accuracy = total > 0 ? correct / total : 0;

    return {
      index,
      question: q.question,
      correct,
      total,
      accuracy,
    };
  });

  questionRanking.sort((a, b) => {
    if (a.accuracy !== b.accuracy) {
      return a.accuracy - b.accuracy;
    }
    if (a.total !== b.total) {
      return b.total - a.total;
    }
    return a.index - b.index;
  });

  io.emit("quiz-ended", {
    ranking,
    questionRanking,
  });
}

function nextQuestion() {
  currentQuestionIndex++;

  if (currentQuestionIndex >= quizQuestions.length) {
    endQuiz();
    return;
  }

  sendCurrentQuestion();
}

// CSV Upload Route
app.post("/upload-csv", upload.single("file"), (req, res) => {
  const providedPassword = req.headers["x-admin-password"];
  if (!providedPassword || providedPassword !== ADMIN_PASSWORD) {
    return res
      .status(401)
      .json({ success: false, message: "Admin-Passwort falsch." });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: "Keine Datei" });
  }

  const content = req.file.buffer.toString("utf-8");
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "CSV ist leer." });
  }

  // Annahme: es gibt eine Kopfzeile
  const HAS_HEADER = true;
  const startIndex = HAS_HEADER ? 1 : 0;

  const parsedQuestions = [];

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];

    // Trennzeichen erkennen
    const sep = line.includes(";") ? ";" : ",";

    const parts = line.split(sep).map((p) => p.trim());
    if (parts.length < 6) {
      console.warn("Zeile übersprungen (zu wenige Spalten):", line);
      continue;
    }

    const [question, correct, wrong1, wrong2, wrong3, timeStr] = parts;
    const time = parseInt(timeStr, 10) || 20;

    parsedQuestions.push({
      question,
      correct,
      wrong: [wrong1, wrong2, wrong3],
      time,
    });
  }

  quizQuestions = parsedQuestions;
  quizInProgress = false;
  currentQuestionIndex = -1;
  questionStats = [];

  io.to("admins").emit("quiz-loaded", {
    totalQuestions: quizQuestions.length,
  });

  res.json({
    success: true,
    totalQuestions: quizQuestions.length,
  });
});

// Poll CSV Upload Route
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
    pollQuestions = parsePollCsv(csvContent);
    pollInProgress = false;
    currentPollIndex = -1;
    pollAggregates = pollQuestions.map((q) => initPollAggregate(q));
    pollAnswersPerQuestion.clear();

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
  const requestedRole = socket.handshake.query.role || "player";
  const adminPassword = socket.handshake.query.adminPassword || "";
  const isAdmin = requestedRole === "admin" && adminPassword === ADMIN_PASSWORD;
  const isPollAdmin =
    requestedRole === "poll-admin" && adminPassword === ADMIN_PASSWORD;
  const isPollDisplay = requestedRole === "poll-display";
  const isPollParticipant = requestedRole === "poll-participant";

  // Poll-Clients zuerst behandeln
  if (requestedRole.startsWith("poll-")) {
    if (requestedRole === "poll-admin" && !isPollAdmin) {
      socket.emit("poll-admin-auth-failed");
      socket.disconnect();
      return;
    }

    if (isPollAdmin) {
      socket.join("poll-admins");
      sendPollStatus(socket);
      broadcastPollParticipants();
    } else if (isPollDisplay) {
      socket.join("poll-displays");
      sendPollStatus(socket);
    } else if (isPollParticipant) {
      socket.join("poll-participants");
      sendPollStatus(socket);
    }

    socket.on("poll-start", () => {
      if (!isPollAdmin) return;
      if (!pollQuestions.length) return;

      pollInProgress = true;
      currentPollIndex = -1;
      pollAggregates = pollQuestions.map((q) => initPollAggregate(q));
      pollAnswersPerQuestion.clear();

      io.emit("poll-started");
      goToNextPollQuestion();
    });

    socket.on("poll-next", () => {
      if (!isPollAdmin || !pollInProgress) return;
      goToNextPollQuestion();
    });

    socket.on("poll-join", (name) => {
      const existing = pollParticipants.get(socket.id);
      if (existing) {
        socket.emit("poll-joined", { name: existing.name });
        return;
      }

      const trimmed = (name || "").trim();
      if (trimmed) {
        pollParticipants.set(socket.id, { id: socket.id, name: trimmed });
        socket.emit("poll-joined", { name: trimmed });
        broadcastPollParticipants();
        return;
      }

      registerAnonymousPollParticipant(socket);
    });

    socket.on("poll-answer", (payload) => {
      const participant = pollParticipants.get(socket.id);
      if (!participant || !pollInProgress) return;

      const { questionIndex } = payload || {};
      if (questionIndex !== currentPollIndex) return;

      const question = pollQuestions[questionIndex];
      const aggregate = pollAggregates[questionIndex];
      if (!question || !aggregate) return;

      const answeredSet =
        pollAnswersPerQuestion.get(questionIndex) || new Set();
      if (answeredSet.has(socket.id)) {
        return;
      }

      let accepted = false;
      if (question.type === "wordcloud") {
        accepted = pollWordcloudAnswer(
          question,
          aggregate,
          Array.isArray(payload.words) ? payload.words : []
        );
      } else if (question.type === "single") {
        accepted = pollSingleAnswer(question, aggregate, payload.choice || "");
      } else if (question.type === "importance") {
        accepted = pollImportanceAnswer(
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
      pollAnswersPerQuestion.set(questionIndex, answeredSet);
      socket.emit("poll-answer-accepted", { questionIndex });
      broadcastPollAggregate(questionIndex);
    });

    socket.on("disconnect", () => {
      if (pollParticipants.has(socket.id)) {
        pollParticipants.delete(socket.id);
        broadcastPollParticipants();
      }
    });

    return;
  }

  if (requestedRole === "admin" && !isAdmin) {
    socket.emit("admin-auth-failed");
    socket.disconnect();
    return;
  }

  const role = isAdmin ? "admin" : requestedRole;

  if (role === "admin") {
    socket.join("admins");
    socket.emit("quiz-status", {
      quizLoaded: quizQuestions.length > 0,
      totalQuestions: quizQuestions.length,
      quizInProgress,
      currentQuestionIndex,
      language: uiLanguage,
    });
    broadcastPlayerList();
  } else if (role === "scoreboard") {
    // Nur lesender Scoreboard-Client
    socket.join("scoreboards");
    socket.emit("quiz-status", {
      quizLoaded: quizQuestions.length > 0,
      totalQuestions: quizQuestions.length,
      quizInProgress,
      currentQuestionIndex,
      language: uiLanguage,
    });
    // Falls schon Scores existieren, gleich schicken
    const ranking = getRanking();
    if (ranking.length) {
      socket.emit("scores", ranking);
    }
  } else {
    // Spieler
    socket.on("join", (name) => {
      const playerName = (name || "").trim();
      if (!playerName) return;

      players.set(socket.id, {
        id: socket.id,
        name: playerName,
        score: 0,
      });

      socket.emit("joined", { name: playerName });
      broadcastPlayerList();
    });
  }

  socket.emit("language", { lang: uiLanguage });

  socket.on("set-language", (lang) => {
    if (role !== "admin") return;
    if (lang !== "de" && lang !== "en") return;
    if (lang === uiLanguage) return;
    uiLanguage = lang;
    io.emit("language", { lang: uiLanguage });
  });

  // Admin: Quiz starten
  socket.on("start-quiz", () => {
    if (role !== "admin") return;
    if (!quizQuestions.length) return;

    // Reset
    players.forEach((p) => (p.score = 0));
    quizInProgress = true;
    currentQuestionIndex = -1;
    answersPerQuestion.clear();
    questionStats = quizQuestions.map(() => ({ correct: 0, total: 0 }));

    io.emit("quiz-started");
    nextQuestion();
  });

  // Spieler: Antwort
  socket.on("answer", (payload) => {
    const player = players.get(socket.id);
    if (!player) return;
    if (!quizInProgress) return;

    const { questionIndex, answer } = payload || {};
    if (questionIndex !== currentQuestionIndex) return;

    const q = quizQuestions[questionIndex];
    if (!q) return;

    const answeredSet =
      answersPerQuestion.get(questionIndex) || new Set();
    if (answeredSet.has(socket.id)) {
      return; // schon beantwortet
    }

    answeredSet.add(socket.id);
    answersPerQuestion.set(questionIndex, answeredSet);

    const isCorrect =
      typeof answer === "string" && answer === q.correct;

    const statsEntry = questionStats[questionIndex];
    if (statsEntry) {
      statsEntry.total += 1;
      if (isCorrect) {
        statsEntry.correct += 1;
      }
    }

    if (isCorrect) {
      player.score += 1;
    }

    socket.emit("answer-result", {
      correct: isCorrect,
      correctAnswer: q.correct,
    });

    // Zwischenstand an Admins UND Scoreboards senden
    const ranking = getRanking();
    io.to("admins").emit("scores", ranking);
    io.to("scoreboards").emit("scores", ranking);
  });

  socket.on("disconnect", () => {
    if (players.has(socket.id)) {
      players.delete(socket.id);
      broadcastPlayerList();
    }
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
