const socket = io({ query: { role: "poll-participant" } });

const joinCard = document.getElementById("joinCard");
const waitCard = document.getElementById("waitCard");
const questionCard = document.getElementById("questionCard");
const endCard = document.getElementById("endCard");

const joinStatus = document.getElementById("joinStatus");

const questionText = document.getElementById("questionText");
const questionPill = document.getElementById("questionPill");
const questionBody = document.getElementById("questionBody");
const answerStatus = document.getElementById("answerStatus");
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

let joined = false;
let totalQuestions = 0;
let currentQuestionIndex = -1;
let currentQuestion = null;
let answeredThisQuestion = false;
let queuedQuestion = null;

if (joinStatus) {
  joinStatus.textContent = "Verbinde ...";
}

function showCard(card) {
  [joinCard, waitCard, questionCard, endCard].forEach((c) => {
    c.style.display = c === card ? "block" : "none";
  });
}

function renderQuestionPill() {
  if (currentQuestionIndex >= 0 && totalQuestions > 0) {
    questionPill.textContent = `Frage ${currentQuestionIndex + 1} von ${
      totalQuestions
    }`;
  } else {
    questionPill.textContent = "";
  }
}

function setAnswerStatus(text) {
  answerStatus.textContent = text || "";
}

function setupDragList(listEl) {
  let dragged = null;

  listEl.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    dragged = li;
    e.dataTransfer.effectAllowed = "move";
  });

  listEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    const li = e.target.closest("li");
    if (!li || li === dragged) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    listEl.insertBefore(dragged, before ? li : li.nextSibling);
  });

  listEl.addEventListener("drop", (e) => {
    e.preventDefault();
    dragged = null;
  });
}

function renderWordcloudQuestion(q) {
  questionBody.innerHTML = "";
  const limit = q.maxWordsPerUser || 1;
  const form = document.createElement("form");
  form.className = "wordcloud-form";

  for (let i = 0; i < limit; i++) {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = `Wort ${i + 1}`;
    input.name = `word-${i}`;
    form.appendChild(input);
  }

  const btn = document.createElement("button");
  btn.type = "submit";
  btn.textContent = "Senden";
  form.appendChild(btn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (answeredThisQuestion) return;
    const words = [];
    form.querySelectorAll("input").forEach((inp) => {
      const value = inp.value.trim();
      if (value) words.push(value);
    });
    if (!words.length) {
      setAnswerStatus("Bitte mindestens ein Wort eingeben.");
      return;
    }
    answeredThisQuestion = true;
    setAnswerStatus("Antwort gesendet.");
    socket.emit("poll-answer", {
      questionIndex: currentQuestionIndex,
      words,
    });
    form.querySelectorAll("input, button").forEach((el) => {
      el.disabled = true;
    });
  });

  questionBody.appendChild(form);
}

function renderSingleQuestion(q) {
  questionBody.innerHTML = "";
  const answersDiv = document.createElement("div");
  answersDiv.className = "answers";
  q.options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => {
      if (answeredThisQuestion) return;
      answeredThisQuestion = true;
      setAnswerStatus("Antwort gesendet.");
      socket.emit("poll-answer", {
        questionIndex: currentQuestionIndex,
        choice: opt,
      });
      answersDiv.querySelectorAll("button").forEach((b) => (b.disabled = true));
    });
    answersDiv.appendChild(btn);
  });
  questionBody.appendChild(answersDiv);
}

function renderImportanceQuestion(q) {
  questionBody.innerHTML = "";
  const info = document.createElement("p");
  info.className = "status";
  info.textContent = "Ziehe die Begriffe in die Reihenfolge der Wichtigkeit.";
  questionBody.appendChild(info);

  const list = document.createElement("ul");
  list.className = "drag-list";
  q.options.forEach((opt) => {
    const li = document.createElement("li");
    li.textContent = opt;
    li.draggable = true;
    list.appendChild(li);
  });
  setupDragList(list);
  questionBody.appendChild(list);

  const btn = document.createElement("button");
  btn.textContent = "Reihenfolge senden";
  btn.addEventListener("click", () => {
    if (answeredThisQuestion) return;
    const order = Array.from(list.querySelectorAll("li")).map(
      (el) => el.textContent
    );
    answeredThisQuestion = true;
    setAnswerStatus("Antwort gesendet.");
    socket.emit("poll-answer", {
      questionIndex: currentQuestionIndex,
      ranking: order,
    });
    btn.disabled = true;
  });

  questionBody.appendChild(btn);
}

function renderQuestion(q) {
  if (!q) return;
  currentQuestion = q;
  currentQuestionIndex = q.index;
  answeredThisQuestion = false;
  setAnswerStatus("");
  questionText.textContent = q.question;
  totalQuestions = q.total || totalQuestions;
  renderQuestionPill();

  if (q.type === "wordcloud") {
    renderWordcloudQuestion(q);
  } else if (q.type === "single") {
    renderSingleQuestion(q);
  } else if (q.type === "importance") {
    renderImportanceQuestion(q);
  }

  showCard(questionCard);
}

socket.on("poll-joined", ({ name }) => {
  joined = true;
  joinStatus.textContent = name ? `Anonym verbunden (${name})` : "Anonym verbunden.";
  showCard(waitCard);
  if (queuedQuestion) {
    renderQuestion(queuedQuestion);
  }
});

socket.on("poll-status", (status) => {
  totalQuestions = status.totalQuestions || 0;
  queuedQuestion = status.pollInProgress ? status.currentQuestion : null;
  if (joined && status.pollInProgress && status.currentQuestion) {
    renderQuestion(status.currentQuestion);
  }
});

socket.on("poll-started", () => {
  if (!joined) return;
  showCard(waitCard);
});

socket.on("poll-question", (payload) => {
  if (!joined) return;
  renderQuestion(payload);
});

socket.on("poll-answer-accepted", () => {
  setAnswerStatus("Danke, Antwort erfasst.");
});

socket.on("poll-answer-rejected", ({ reason }) => {
  setAnswerStatus(reason || "Antwort wurde nicht angenommen.");
  answeredThisQuestion = false;
});

socket.on("poll-ended", () => {
  queuedQuestion = null;
  currentQuestion = null;
  currentQuestionIndex = -1;
  answeredThisQuestion = false;
  showCard(endCard);
});
