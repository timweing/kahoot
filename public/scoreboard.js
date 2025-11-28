const socket = io({ query: { role: "scoreboard" } });

const headingEl = document.getElementById("scoreboardHeading");
const statusEl = document.getElementById("scoreboardStatus");
const tableEl = document.getElementById("scoreboardTable");
const bodyEl = document.getElementById("scoreboardBody");
const rankHeader = document.getElementById("rankHeader");
const nameHeader = document.getElementById("nameHeader");
const scoreHeader = document.getElementById("scoreHeader");
const themeToggle = document.getElementById("themeToggle");

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

const translations = {
  de: {
    heading: "Rangliste",
    waiting: "Warte auf Quizstart oder erste Antworten ...",
    noQuiz: "Noch kein Quiz geladen.",
    quizPrepared: "Quiz vorbereitet, wartet auf Start.",
    quizRunning: "Quiz l\u00e4uft \u00b7 Live-Rangliste.",
    liveRanking: "Live-Rangliste \u00b7 Quiz l\u00e4uft ...",
    finalRanking: "Finale Rangliste",
    noPlayers: "Noch keine Spieler mit Punkten.",
    rankHeader: "Platz",
    nameHeader: "Name",
    scoreHeader: "Punkte",
    scoreCell: (score) => `${score} Punkte`,
  },
  en: {
    heading: "Leaderboard",
    waiting: "Waiting for quiz start or first answers...",
    noQuiz: "No quiz loaded yet.",
    quizPrepared: "Quiz ready, waiting to start.",
    quizRunning: "Quiz running \u00b7 Live leaderboard.",
    liveRanking: "Live leaderboard \u00b7 Quiz running...",
    finalRanking: "Final leaderboard",
    noPlayers: "No players with points yet.",
    rankHeader: "Rank",
    nameHeader: "Name",
    scoreHeader: "Points",
    scoreCell: (score) => `${score} points`,
  },
};

let uiLanguage = "de";
let lastRanking = [];
let lastRankingFinal = false;
let currentStatusKey = "waiting";

function t(key, ...args) {
  const langPack = translations[uiLanguage] || translations.de;
  const value = langPack[key];
  if (typeof value === "function") {
    return value(...args);
  }
  return value || "";
}

function setStatus(key) {
  currentStatusKey = key;
  statusEl.textContent = t(key);
}

function renderRanking(ranking, final = false, skipStatus = false) {
  lastRanking = ranking || [];
  lastRankingFinal = final;

  if (!ranking || !ranking.length) {
    tableEl.style.display = "none";
    bodyEl.innerHTML = "";
    if (!skipStatus) {
      setStatus("noPlayers");
    }
    return;
  }

  if (!skipStatus) {
    setStatus(final ? "finalRanking" : "liveRanking");
  }

  tableEl.style.display = "table";
  bodyEl.innerHTML = "";

  ranking.forEach((row) => {
    const tr = document.createElement("tr");

    if (row.rank === 1) tr.classList.add("rank-1");
    if (row.rank === 2) tr.classList.add("rank-2");
    if (row.rank === 3) tr.classList.add("rank-3");

    const tdRank = document.createElement("td");
    const tdName = document.createElement("td");
    const tdScore = document.createElement("td");

    let medal = "";
    if (row.rank === 1) medal = "\ud83e\udd47";
    else if (row.rank === 2) medal = "\ud83e\udd48";
    else if (row.rank === 3) medal = "\ud83e\udd49";

    tdRank.textContent = medal
      ? `${row.rank}. ${medal}`
      : `${row.rank}.`;

    tdName.textContent = row.name;
    tdScore.textContent = t("scoreCell", row.score);

    tr.appendChild(tdRank);
    tr.appendChild(tdName);
    tr.appendChild(tdScore);

    bodyEl.appendChild(tr);
  });
}

function applyLanguage(lang) {
  if (!translations[lang]) return;
  uiLanguage = lang;
  document.documentElement.lang = lang;
  headingEl.textContent = t("heading");
  rankHeader.textContent = t("rankHeader");
  nameHeader.textContent = t("nameHeader");
  scoreHeader.textContent = t("scoreHeader");
  setStatus(currentStatusKey);
  renderRanking(lastRanking, lastRankingFinal, true);
}

applyLanguage(uiLanguage);

// Initialstatus vom Server
socket.on("quiz-status", (status) => {
  applyLanguage(status.language);

  if (!status.quizLoaded) {
    lastRanking = [];
    lastRankingFinal = false;
    tableEl.style.display = "none";
    bodyEl.innerHTML = "";
    setStatus("noQuiz");
    return;
  }

  if (status.quizInProgress) {
    setStatus("quizRunning");
  } else {
    setStatus("quizPrepared");
  }
});

// Wenn Quiz startet
socket.on("quiz-started", () => {
  setStatus("quizRunning");
});

// Live-Scores nach jeder Antwort
socket.on("scores", (ranking) => {
  renderRanking(ranking, false);
});

// Finale Rangliste nach dem Ende
socket.on("quiz-ended", ({ ranking }) => {
  renderRanking(ranking, true);
});

socket.on("language", ({ lang }) => {
  applyLanguage(lang);
});
