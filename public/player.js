const socket = io({ query: { role: "player" } });

const playerHeading = document.getElementById("playerHeading");
const joinCard = document.getElementById("joinCard");
const waitCard = document.getElementById("waitCard");
const questionCard = document.getElementById("questionCard");
const endCard = document.getElementById("endCard");

const joinTitle = document.getElementById("joinTitle");
const joinSubtitle = document.getElementById("joinSubtitle");
const waitTitle = document.getElementById("waitTitle");
const waitSubtitle = document.getElementById("waitSubtitle");

const playerNameInput = document.getElementById("playerName");
const joinBtn = document.getElementById("joinBtn");
const joinStatus = document.getElementById("joinStatus");

const questionText = document.getElementById("questionText");
const questionPill = document.getElementById("questionPill");
const timerLabel = document.getElementById("timerLabel");
const timerBar = document.getElementById("timerBar");

const answersDiv = document.getElementById("answers");
const answerStatus = document.getElementById("answerStatus");
const endTitle = document.getElementById("endTitle");
const endText = document.getElementById("endText");

const translations = {
  de: {
    heading: "Live Quiz",
    joinTitle: "Beitreten",
    joinSubtitle:
      "W\u00e4hle einen Anzeigenamen, der in der Rangliste erscheint.",
    namePlaceholder: "Dein Name",
    joinButton: "Beitreten",
    joinRequired: "Bitte gib einen Namen ein.",
    joinedAs: (name) => `Beigetreten als: ${name}`,
    waitTitle: "Bereit machen \ud83c\udfb9",
    waitSubtitle: "Du bist dabei! Warte, bis der Admin das Quiz startet.",
    questionPill: (index, total) => `Frage ${index} von ${total}`,
    answerSending: "Antwort gesendet. Warte auf Auswertung...",
    answerCorrect: "Richtig! \u2705",
    answerWrong: (correctAnswer) =>
      `Falsch. \u274c Richtige Antwort: ${correctAnswer}`,
    timeoutNoAnswer: "Zeit abgelaufen! \u23f0 Du hast nicht geantwortet.",
    endTitle: "Quiz beendet",
    endDefault: "Quiz beendet.",
    endPlacement: (rank, score, medal) =>
      `${medal ? medal + " " : ""}Du bist auf Platz ${rank} mit ${score} Punkt${
        score === 1 ? "" : "en"
      }.`,
    endMissing: "Deine Ergebnisse wurden nicht gefunden.",
  },
  en: {
    heading: "Live Quiz",
    joinTitle: "Join",
    joinSubtitle: "Pick a display name for the leaderboard.",
    namePlaceholder: "Your name",
    joinButton: "Join",
    joinRequired: "Please enter a name.",
    joinedAs: (name) => `Joined as: ${name}`,
    waitTitle: "Get ready \ud83c\udfb9",
    waitSubtitle: "You're in! Wait for the host to start the quiz.",
    questionPill: (index, total) => `Question ${index} of ${total}`,
    answerSending: "Answer sent. Waiting for result...",
    answerCorrect: "Correct! \u2705",
    answerWrong: (correctAnswer) =>
      `Wrong. \u274c Correct answer: ${correctAnswer}`,
    timeoutNoAnswer: "Time is up! \u23f0 You did not answer.",
    endTitle: "Quiz finished",
    endDefault: "Quiz finished.",
    endPlacement: (rank, score, medal) =>
      `${medal ? medal + " " : ""}You finished #${rank} with ${score} point${
        score === 1 ? "" : "s"
      }.`,
    endMissing: "We could not find your results.",
  },
};

function t(key, ...args) {
  const langPack = translations[uiLanguage] || translations.de;
  const value = langPack[key];
  if (typeof value === "function") {
    return value(...args);
  }
  return value || "";
}

function medalForRank(rank) {
  if (rank === 1) return "\ud83e\udd47";
  if (rank === 2) return "\ud83e\udd48";
  if (rank === 3) return "\ud83e\udd49";
  return "\ud83c\udfc1";
}

let uiLanguage = "de";
let joined = false;
let currentQuestionIndex = -1;
let totalQuestions = 0;
let answeredThisQuestion = false;
let countdownInterval = null;
let lastChosenAnswer = null;
let lastJoinStatus = null;
let lastAnswerStatus = null;
let lastEndInfo = null;

function showCard(card) {
  [joinCard, waitCard, questionCard, endCard].forEach((c) => {
    c.style.display = c === card ? "block" : "none";
  });
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function startCountdown(timeLimitSeconds) {
  stopCountdown();

  let remaining = timeLimitSeconds;
  timerLabel.textContent = remaining + "s";
  timerBar.style.transition = "none";
  timerBar.style.transform = "scaleX(1)";
  void timerBar.offsetWidth;
  timerBar.style.transition = `transform ${remaining}s linear`;
  requestAnimationFrame(() => {
    timerBar.style.transform = "scaleX(0)";
  });

  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      timerLabel.textContent = "0s";
      stopCountdown();
    } else {
      timerLabel.textContent = remaining + "s";
    }
  }, 1000);
}

function renderJoinStatus() {
  if (!lastJoinStatus) {
    joinStatus.textContent = "";
    return;
  }
  if (lastJoinStatus.type === "error") {
    joinStatus.textContent = t("joinRequired");
  } else if (lastJoinStatus.type === "joined") {
    joinStatus.textContent = t("joinedAs", lastJoinStatus.name);
  }
}

function renderAnswerStatus() {
  if (!lastAnswerStatus) {
    answerStatus.textContent = "";
    return;
  }
  if (lastAnswerStatus.type === "sending") {
    answerStatus.textContent = t("answerSending");
  } else if (lastAnswerStatus.type === "correct") {
    answerStatus.textContent = t("answerCorrect");
  } else if (lastAnswerStatus.type === "wrong") {
    answerStatus.textContent = t("answerWrong", lastAnswerStatus.correctAnswer);
  } else if (lastAnswerStatus.type === "timeout") {
    answerStatus.textContent = t("timeoutNoAnswer");
  }
}

function renderEndText() {
  if (!lastEndInfo) {
    endText.textContent = "";
    return;
  }
  if (lastEndInfo.type === "placement") {
    const medal = medalForRank(lastEndInfo.rank);
    endText.textContent = t(
      "endPlacement",
      lastEndInfo.rank,
      lastEndInfo.score,
      medal
    );
    return;
  }
  if (lastEndInfo.type === "missing") {
    endText.textContent = `${t("endDefault")} ${t("endMissing")}`;
    return;
  }
  endText.textContent = t("endDefault");
}

function renderQuestionPill() {
  if (currentQuestionIndex >= 0 && totalQuestions > 0) {
    questionPill.textContent = t(
      "questionPill",
      currentQuestionIndex + 1,
      totalQuestions
    );
  } else {
    questionPill.textContent = "";
  }
}

function applyLanguage(lang) {
  if (!translations[lang]) return;
  uiLanguage = lang;
  document.documentElement.lang = lang;
  playerHeading.textContent = t("heading");
  joinTitle.textContent = t("joinTitle");
  joinSubtitle.textContent = t("joinSubtitle");
  playerNameInput.placeholder = t("namePlaceholder");
  joinBtn.textContent = t("joinButton");
  waitTitle.textContent = t("waitTitle");
  waitSubtitle.textContent = t("waitSubtitle");
  endTitle.textContent = t("endTitle");
  renderQuestionPill();
  renderJoinStatus();
  renderAnswerStatus();
  renderEndText();
}

applyLanguage(uiLanguage);

// Beitreten
joinBtn.addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    lastJoinStatus = { type: "error" };
    renderJoinStatus();
    return;
  }
  socket.emit("join", name);
});

socket.on("joined", ({ name }) => {
  joined = true;
  lastJoinStatus = { type: "joined", name };
  renderJoinStatus();
  showCard(waitCard);
});

// Quiz startet
socket.on("quiz-started", () => {
  answeredThisQuestion = false;
  lastAnswerStatus = null;
  renderAnswerStatus();
  lastEndInfo = null;
  renderEndText();
  showCard(questionCard);
});

// Neue Frage
socket.on("question", (data) => {
  currentQuestionIndex = data.index;
  totalQuestions = data.total || totalQuestions;
  answeredThisQuestion = false;
  lastChosenAnswer = null;
  lastAnswerStatus = null;
  renderAnswerStatus();

  questionText.textContent = data.question;
  renderQuestionPill();
  timerLabel.textContent = data.timeLimit + "s";

  answersDiv.innerHTML = "";

  data.answers.forEach((ansText) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = ansText;
    btn.dataset.answer = ansText;

    btn.addEventListener("click", () => {
      if (answeredThisQuestion) return;
      answeredThisQuestion = true;
      lastChosenAnswer = ansText;
      lastAnswerStatus = { type: "sending" };
      renderAnswerStatus();

      document
        .querySelectorAll(".answer-btn")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");

      socket.emit("answer", {
        questionIndex: currentQuestionIndex,
        answer: ansText,
      });

      document
        .querySelectorAll(".answer-btn")
        .forEach((b) => (b.disabled = true));
    });

    answersDiv.appendChild(btn);
  });

  startCountdown(data.timeLimit);
  showCard(questionCard);
});

// Antwort-Ergebnis
socket.on("answer-result", ({ correct, correctAnswer }) => {
  stopCountdown();

  const buttons = document.querySelectorAll(".answer-btn");
  buttons.forEach((btn) => {
    const answerText = btn.dataset.answer;
    if (answerText === correctAnswer) {
      btn.classList.add("correct");
    }
    if (lastChosenAnswer && answerText === lastChosenAnswer && !correct) {
      btn.classList.add("wrong");
    }
  });

  if (correct) {
    lastAnswerStatus = { type: "correct" };
  } else {
    lastAnswerStatus = { type: "wrong", correctAnswer };
  }
  renderAnswerStatus();
});

// Zeit abgelaufen
socket.on("question-timeout", ({ index }) => {
  if (index === currentQuestionIndex) {
    stopCountdown();
    if (!answeredThisQuestion) {
      lastAnswerStatus = { type: "timeout" };
      renderAnswerStatus();
    }
    document
      .querySelectorAll(".answer-btn")
      .forEach((b) => (b.disabled = true));
  }
});

// Quiz beendet
socket.on("quiz-ended", ({ ranking }) => {
  stopCountdown();
  let endInfo = { type: "default" };

  if (ranking && ranking.length) {
    const myName = playerNameInput.value.trim();
    const me = ranking.find((r) => r.name === myName);
    if (me) {
      endInfo = { type: "placement", rank: me.rank, score: me.score };
    } else {
      endInfo = { type: "missing" };
    }
  }

  lastEndInfo = endInfo;
  renderEndText();
  showCard(endCard);
});

socket.on("language", ({ lang }) => {
  applyLanguage(lang);
});
