const adminPassword = window.prompt("Bitte Admin-Passwort eingeben:") || "";

if (!adminPassword) {
  window.alert("Ohne Passwort kein Admin-Zugriff.");
  window.location.href = "/";
}

const socket = io({
  query: { role: "poll-admin", adminPassword },
});

const uploadForm = document.getElementById("uploadForm");
const csvFileInput = document.getElementById("csvFile");
const uploadStatus = document.getElementById("uploadStatus");

const startPollBtn = document.getElementById("startPollBtn");
const nextQuestionBtn = document.getElementById("nextQuestionBtn");
const pollInfo = document.getElementById("pollInfo");
const participantsList = document.getElementById("participants");
const questionTitle = document.getElementById("questionTitle");
const liveResult = document.getElementById("liveResult");
const themeToggle = document.getElementById("themeToggle");

let totalQuestions = 0;
let currentQuestionIndex = -1;
let pollRunning = false;
let currentQuestion = null;
let currentAggregate = null;
let lastResults = null;

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

function renderD3Wordcloud(target, entries, opts = {}) {
  const fallback = () => {
    target.innerHTML = "";
    const container = document.createElement("div");
    container.className = "wordcloud-fallback";
    entries.forEach((entry) => {
      const span = document.createElement("span");
      span.textContent = `${entry.word} (${entry.count})`;
      container.appendChild(span);
    });
    target.appendChild(container);
  };

  if (!window.d3 || !d3.layout || !d3.layout.cloud) {
    fallback();
    return;
  }

  target.innerHTML = "";
  if (!entries || !entries.length) {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "Noch keine Wörter eingereicht.";
    target.appendChild(p);
    return;
  }

  const width = target.clientWidth || 620;
  const height = opts.height || 320;
  const maxCount = Math.max(...entries.map((e) => e.count));
  const sizeScale = d3
    .scaleLinear()
    .domain([1, maxCount || 1])
    .range([16, 52]);
  const color = d3.scaleOrdinal(d3.schemeTableau10);

  const words = entries.map((e) => ({
    text: e.word,
    size: sizeScale(e.count),
  }));

  const svg = d3
    .select(target)
    .append("svg")
    .attr("width", "100%")
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  const group = svg
    .append("g")
    .attr("transform", `translate(${width / 2}, ${height / 2})`);

  d3.layout
    .cloud()
    .size([width, height])
    .words(words)
    .padding(4)
    .rotate(() => 0) // nur horizontale Wörter
    .font("system-ui")
    .fontSize((d) => d.size)
    .on("end", (layoutWords) => {
      group
        .selectAll("text")
        .data(layoutWords)
        .enter()
        .append("text")
        .style("font-size", (d) => `${d.size}px`)
        .style("font-family", "system-ui, sans-serif")
        .style("fill", (_, i) => color(i))
        .attr("text-anchor", "middle")
        .attr("transform", (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
        .text((d) => d.text);
    })
    .start();
}

function renderParticipants(list) {
  const count = Array.isArray(list) ? list.length : 0;
  participantsList.textContent = `Teilnehmer: ${count}`;
}

function renderPollInfo() {
  if (!totalQuestions) {
    pollInfo.textContent = "Noch keine Umfrage geladen.";
    return;
  }
  if (pollRunning) {
    const humanIndex =
      currentQuestionIndex >= 0 ? currentQuestionIndex + 1 : 0;
    pollInfo.textContent =
      humanIndex > 0
        ? `Umfrage läuft - Frage ${humanIndex} von ${totalQuestions}`
        : "Umfrage läuft...";
    return;
  }
  pollInfo.textContent = `Fragen geladen: ${totalQuestions}.`;
}

function renderWordcloud(aggregate, target) {
  const entries = aggregate.entries || [];
  renderD3Wordcloud(target, entries);
}

function renderSingle(aggregate, target) {
  target.innerHTML = "";
  const list = document.createElement("div");
  list.className = "result-bars";
  const options = aggregate.options || [];
  const maxCount = Math.max(1, ...options.map((o) => o.count));
  options.forEach((opt) => {
    const row = document.createElement("div");
    row.className = "result-bar-row";

    const label = document.createElement("div");
    label.className = "result-label";
    label.textContent = opt.text;

    const barOuter = document.createElement("div");
    barOuter.className = "result-bar-outer";

    const barInner = document.createElement("div");
    barInner.className = "result-bar-inner";
    const width = (opt.count / maxCount) * 100;
    barInner.style.width = width + "%";
    barInner.textContent = `${opt.count}`;

    barOuter.appendChild(barInner);
    row.appendChild(label);
    row.appendChild(barOuter);
    list.appendChild(row);
  });
  target.appendChild(list);
}

function renderImportance(aggregate, target) {
  target.innerHTML = "";
  const list = document.createElement("ol");
  list.className = "importance-list";
  (aggregate.options || []).forEach((opt) => {
    const li = document.createElement("li");
    li.innerHTML = `<div class="importance-row"><span>${opt.text}</span><span class="badge">Score: ${opt.score}</span></div>`;
    list.appendChild(li);
  });
  target.appendChild(list);
}

function renderAggregate() {
  if (!currentAggregate) {
    questionTitle.textContent = currentQuestion
      ? currentQuestion.question
      : "Keine Frage aktiv.";
    liveResult.innerHTML = "";
    return;
  }

  questionTitle.textContent = `${currentAggregate.type.toUpperCase()} · ${
    currentQuestion ? currentQuestion.question : ""
  }`;

  if (currentAggregate.type === "wordcloud") {
    renderWordcloud(currentAggregate, liveResult);
  } else if (currentAggregate.type === "single") {
    renderSingle(currentAggregate, liveResult);
  } else if (currentAggregate.type === "importance") {
    renderImportance(currentAggregate, liveResult);
  }
}

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = csvFileInput.files[0];
  if (!file) {
    uploadStatus.textContent = "Bitte eine CSV auswählen.";
    return;
  }

  uploadStatus.textContent = "Lade hoch...";
  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/poll/upload-csv", {
      method: "POST",
      body: formData,
      headers: { "x-admin-password": adminPassword },
    });
    const data = await res.json();
    if (data.success) {
      totalQuestions = data.totalQuestions || 0;
      uploadStatus.textContent =
        "CSV geladen. Anzahl Fragen: " + totalQuestions;
      startPollBtn.disabled = totalQuestions === 0;
      nextQuestionBtn.disabled = true;
      pollRunning = false;
      currentQuestion = null;
      currentAggregate = null;
      lastResults = null;
      renderPollInfo();
      renderAggregate();
    } else {
      uploadStatus.textContent = "Fehler: " + (data.message || "Unbekannt");
    }
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Fehler beim Upload.";
  }
});

startPollBtn.addEventListener("click", () => {
  socket.emit("poll-start");
});

nextQuestionBtn.addEventListener("click", () => {
  socket.emit("poll-next");
});

socket.on("poll-admin-auth-failed", () => {
  window.alert("Admin-Passwort ist falsch.");
  window.location.href = "/";
});

socket.on("poll-status", (status) => {
  totalQuestions = status.totalQuestions || 0;
  pollRunning = Boolean(status.pollInProgress);
  currentQuestionIndex = status.currentQuestionIndex ?? -1;
  currentQuestion = status.currentQuestion || null;
  currentAggregate = status.currentAggregate || null;
  startPollBtn.disabled = totalQuestions === 0 || pollRunning;
  nextQuestionBtn.disabled = !pollRunning;
  renderPollInfo();
  renderAggregate();
});

socket.on("poll-loaded", (data) => {
  totalQuestions = data.totalQuestions || 0;
  pollRunning = false;
  currentQuestionIndex = -1;
  startPollBtn.disabled = totalQuestions === 0;
  nextQuestionBtn.disabled = true;
  renderPollInfo();
});

socket.on("poll-started", () => {
  pollRunning = true;
  startPollBtn.disabled = true;
  nextQuestionBtn.disabled = false;
  renderPollInfo();
});

socket.on("poll-question", (payload) => {
  pollRunning = true;
  currentQuestionIndex = payload.index;
  currentQuestion = payload;
  currentAggregate = { type: payload.type, entries: [], options: [] };
  lastResults = null;
  nextQuestionBtn.disabled = false;
  renderPollInfo();
  renderAggregate();
});

socket.on("poll-aggregate", (aggregate) => {
  currentAggregate = aggregate;
  renderAggregate();
});

socket.on("poll-participants", (list) => {
  renderParticipants(list);
});

socket.on("poll-ended", ({ results }) => {
  pollRunning = false;
  currentQuestion = null;
  currentAggregate = null;
  nextQuestionBtn.disabled = true;
  startPollBtn.disabled = false;
  renderPollInfo();
  liveResult.innerHTML = "";
  questionTitle.textContent = "Umfrage beendet.";
  if (Array.isArray(results) && results.length) {
    const summary = document.createElement("div");
    results.forEach((res) => {
      const block = document.createElement("div");
      block.className = "result-block";
      const title = document.createElement("h3");
      title.textContent = res.question;
      block.appendChild(title);
      if (res.summary) {
        if (res.summary.type === "wordcloud") {
          const holder = document.createElement("div");
          renderWordcloud(res.summary, holder);
          block.appendChild(holder);
        } else if (res.summary.type === "single") {
          const holder = document.createElement("div");
          renderSingle(res.summary, holder);
          block.appendChild(holder);
        } else if (res.summary.type === "importance") {
          const holder = document.createElement("div");
          renderImportance(res.summary, holder);
          block.appendChild(holder);
        }
      }
      summary.appendChild(block);
    });
    liveResult.appendChild(summary);
  }
});
