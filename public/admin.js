const adminPassword =
  window.prompt("Bitte Admin-Passwort eingeben:") || "";

if (!adminPassword) {
  window.alert("Ohne Passwort gibt es keinen Admin-Zugriff.");
  window.location.href = "/";
}

const socket = io({
  query: { role: "admin", adminPassword },
});

const uploadForm = document.getElementById("uploadForm");
const csvFileInput = document.getElementById("csvFile");
const uploadStatus = document.getElementById("uploadStatus");

const startQuizBtn = document.getElementById("startQuizBtn");
const quizInfo = document.getElementById("quizInfo");
const languageSelect = document.getElementById("languageSelect");

const playersUl = document.getElementById("players");

const rankingTable = document.getElementById("rankingTable");
const rankingBody = document.getElementById("rankingBody");
const rankingStatus = document.getElementById("rankingStatus");
const questionStatsTable = document.getElementById("questionStatsTable");
const questionStatsBody = document.getElementById("questionStatsBody");
const questionStatsStatus = document.getElementById("questionStatsStatus");
const themeToggle = document.getElementById("themeToggle");

let totalQuestions = 0;
let currentQuestionIndex = -1;
let quizRunning = false;
let currentLanguage = "de";

const THEME_KEY = "kahoot-theme";
function setTheme(theme) {
  const value = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", value);
  if (themeToggle) {
    themeToggle.textContent = value === "light" ? "🌞 Light" : "🌙 Dark";
  }
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch (_) {}
}
function initTheme() {
  const stored = (() => {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (_) {
      return null;
    }
  })();
  setTheme(stored || "dark");
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(current === "light" ? "dark" : "light");
  });
}
initTheme();

function renderQuizInfo() {
  if (!totalQuestions) {
    quizInfo.textContent = "Noch kein Quiz geladen.";
    return;
  }

  if (quizRunning) {
    const humanIndex = currentQuestionIndex >= 0 ? currentQuestionIndex + 1 : 0;
    quizInfo.textContent =
      humanIndex > 0
        ? `Quiz läuft - Frage ${humanIndex} von ${totalQuestions}`
        : "Quiz läuft...";
    return;
  }

  quizInfo.textContent = `Fragen geladen: ${totalQuestions}.`;
}

socket.on("admin-auth-failed", () => {
  window.alert("Admin-Passwort ist falsch.");
  window.location.href = "/";
});

function applyLanguage(lang) {
  if (lang !== "de" && lang !== "en") return;
  currentLanguage = lang;
  languageSelect.value = lang;
}

languageSelect.addEventListener("change", () => {
  const lang = languageSelect.value;
  if (lang === currentLanguage) return;
  socket.emit("set-language", lang);
});

// CSV Upload
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = csvFileInput.files[0];
  if (!file) {
    uploadStatus.textContent = "Bitte eine CSV-Datei auswählen.";
    return;
  }

  uploadStatus.textContent = "Lade hoch...";
  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/upload-csv", {
      method: "POST",
      body: formData,
      headers: {
        "x-admin-password": adminPassword,
      },
    });
    const data = await res.json();
    if (data.success) {
      uploadStatus.textContent =
        "CSV geladen. Anzahl Fragen: " + data.totalQuestions;
    } else {
      uploadStatus.textContent = "Fehler: " + (data.message || "Unbekannt");
    }
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Fehler beim Upload.";
  }
});

// Quiz starten
startQuizBtn.addEventListener("click", () => {
  socket.emit("start-quiz");
});

// Socket-Events

socket.on("quiz-status", (status) => {
  totalQuestions = status.totalQuestions || 0;
  currentQuestionIndex = status.currentQuestionIndex ?? -1;
  quizRunning = Boolean(status.quizInProgress);
  applyLanguage(status.language);
  startQuizBtn.disabled = totalQuestions === 0;
  renderQuizInfo();
});

socket.on("quiz-loaded", (data) => {
  totalQuestions = data.totalQuestions || 0;
  currentQuestionIndex = -1;
  quizRunning = false;
  startQuizBtn.disabled = data.totalQuestions === 0;
  renderQuizInfo();
});

socket.on("quiz-started", () => {
  quizRunning = true;
  currentQuestionIndex = -1;
  rankingStatus.textContent = "";
  rankingTable.style.display = "none";
  rankingBody.innerHTML = "";
  questionStatsStatus.textContent = "Quiz läuft … Antworten werden gesammelt.";
  questionStatsTable.style.display = "none";
  questionStatsBody.innerHTML = "";
  startQuizBtn.disabled = true;
  renderQuizInfo();
});

socket.on("language", ({ lang }) => {
  applyLanguage(lang);
});

// Spieler-Liste aktualisieren
socket.on("players", (players) => {
  playersUl.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    const scoreSpan = document.createElement("span");

    nameSpan.textContent = p.name;
    scoreSpan.textContent = p.score + " Punkte";

    li.appendChild(nameSpan);
    li.appendChild(scoreSpan);
    playersUl.appendChild(li);
  });
});

// Zwischenstände (optional)
socket.on("scores", (ranking) => {
  // Nur anzeigen, wenn du willst – hier nix tun oder Debug.
});

socket.on("question", (payload) => {
  if (!payload) return;
  currentQuestionIndex = typeof payload.index === "number" ? payload.index : -1;
  totalQuestions = payload.total || totalQuestions;
  quizRunning = true;
  renderQuizInfo();
});

// Quiz beendet -> Rangliste anzeigen
socket.on("quiz-ended", ({ ranking, questionRanking }) => {
  quizRunning = false;
  currentQuestionIndex = -1;
  if (!ranking || !ranking.length) {
    rankingStatus.textContent = "Keine Spieler oder keine Punkte.";
    rankingTable.style.display = "none";
    rankingBody.innerHTML = "";
  } else {
    rankingStatus.textContent = "Quiz beendet. Finale Rangliste:";
    rankingTable.style.display = "table";
    rankingBody.innerHTML = "";

    ranking.forEach((row) => {
      const tr = document.createElement("tr");

      // Highlight-Klassen für Top 3
      if (row.rank === 1) tr.classList.add("rank-1");
      if (row.rank === 2) tr.classList.add("rank-2");
      if (row.rank === 3) tr.classList.add("rank-3");

      const tdRank = document.createElement("td");
      const tdName = document.createElement("td");
      const tdScore = document.createElement("td");

      let rankIcon = "";
      if (row.rank === 1) rankIcon = "🥇";
      else if (row.rank === 2) rankIcon = "🥈";
      else if (row.rank === 3) rankIcon = "🥉";

      tdRank.textContent = rankIcon ? `${row.rank}. ${rankIcon}` : `${row.rank}.`;
      tdName.textContent = row.name;
      tdScore.textContent = row.score + " Punkte";

      tr.appendChild(tdRank);
      tr.appendChild(tdName);
      tr.appendChild(tdScore);

      rankingBody.appendChild(tr);
    });
  }

  if (questionRanking && questionRanking.length) {
    questionStatsStatus.textContent =
      "Fragen mit den meisten falschen Antworten zuerst:";
    questionStatsTable.style.display = "table";
    questionStatsBody.innerHTML = "";

    questionRanking.forEach((row, index) => {
      const tr = document.createElement("tr");

      const tdRank = document.createElement("td");
      const tdQuestion = document.createElement("td");
      const tdCorrect = document.createElement("td");
      const tdTotal = document.createElement("td");
      const tdRate = document.createElement("td");

      tdRank.textContent = `${index + 1}.`;
      tdQuestion.textContent = row.question || `Frage ${row.index + 1}`;
      if (row.question) {
        tdQuestion.title = row.question;
      }
      tdCorrect.textContent = row.correct.toString();
      tdTotal.textContent = row.total.toString();
      if (row.total > 0) {
        const percent = Math.round(row.accuracy * 1000) / 10;
        tdRate.textContent =
          percent.toFixed(Number.isInteger(percent) ? 0 : 1) + "%";
      } else {
        tdRate.textContent = "–";
      }

      tr.appendChild(tdRank);
      tr.appendChild(tdQuestion);
      tr.appendChild(tdCorrect);
      tr.appendChild(tdTotal);
      tr.appendChild(tdRate);

      questionStatsBody.appendChild(tr);
    });
  } else {
    questionStatsStatus.textContent = "Keine Antworten ausgewertet.";
    questionStatsTable.style.display = "none";
    questionStatsBody.innerHTML = "";
  }

  quizInfo.textContent = "Quiz beendet.";
  startQuizBtn.disabled = false;
});
