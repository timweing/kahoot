const socket = io({ query: { role: "scoreboard" } });

const statusEl = document.getElementById("scoreboardStatus");
const tableEl = document.getElementById("scoreboardTable");
const bodyEl = document.getElementById("scoreboardBody");

function renderRanking(ranking, final = false) {
  if (!ranking || !ranking.length) {
    statusEl.textContent = "Noch keine Spieler mit Punkten.";
    tableEl.style.display = "none";
    return;
  }

  statusEl.textContent = final
    ? "Finale Rangliste"
    : "Live-Rangliste · Quiz läuft ...";

  tableEl.style.display = "table";
  bodyEl.innerHTML = "";

  ranking.forEach((row) => {
    const tr = document.createElement("tr");

    // Top 3 visuell hervorheben (Styles kommen aus styles.css)
    if (row.rank === 1) tr.classList.add("rank-1");
    if (row.rank === 2) tr.classList.add("rank-2");
    if (row.rank === 3) tr.classList.add("rank-3");

    const tdRank = document.createElement("td");
    const tdName = document.createElement("td");
    const tdScore = document.createElement("td");

    let medal = "";
    if (row.rank === 1) medal = "🥇";
    else if (row.rank === 2) medal = "🥈";
    else if (row.rank === 3) medal = "🥉";

    tdRank.textContent = medal
      ? `${row.rank}. ${medal}`
      : `${row.rank}.`;

    tdName.textContent = row.name;
    tdScore.textContent = row.score + " Punkte";

    tr.appendChild(tdRank);
    tr.appendChild(tdName);
    tr.appendChild(tdScore);

    bodyEl.appendChild(tr);
  });
}

// Initialstatus vom Server
socket.on("quiz-status", (status) => {
  if (!status.quizLoaded) {
    statusEl.textContent = "Noch kein Quiz geladen.";
    tableEl.style.display = "none";
    return;
  }

  if (status.quizInProgress) {
    statusEl.textContent = "Quiz läuft · Live-Rangliste.";
  } else {
    statusEl.textContent = "Quiz vorbereitet, wartet auf Start.";
  }
});

// Wenn Quiz startet
socket.on("quiz-started", () => {
  statusEl.textContent = "Quiz läuft · Live-Rangliste.";
});

// Live-Scores nach jeder Antwort
socket.on("scores", (ranking) => {
  renderRanking(ranking, false);
});

// Finale Rangliste nach dem Ende
socket.on("quiz-ended", ({ ranking }) => {
  renderRanking(ranking, true);
});