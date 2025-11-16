const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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


io.on("connection", (socket) => {
  const role = socket.handshake.query.role || "player";

  if (role === "admin") {
    socket.join("admins");
    socket.emit("quiz-status", {
      quizLoaded: quizQuestions.length > 0,
      totalQuestions: quizQuestions.length,
      quizInProgress,
      currentQuestionIndex,
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
