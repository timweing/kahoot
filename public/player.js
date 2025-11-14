const socket = io({ query: { role: "player" } });

const joinCard = document.getElementById("joinCard");
const waitCard = document.getElementById("waitCard");
const questionCard = document.getElementById("questionCard");
const endCard = document.getElementById("endCard");

const playerNameInput = document.getElementById("playerName");
const joinBtn = document.getElementById("joinBtn");
const joinStatus = document.getElementById("joinStatus");

const questionText = document.getElementById("questionText");
const questionPill = document.getElementById("questionPill");
const timerLabel = document.getElementById("timerLabel");
const timerBar = document.getElementById("timerBar");

const answersDiv = document.getElementById("answers");
const answerStatus = document.getElementById("answerStatus");
const endText = document.getElementById("endText");

let joined = false;
let currentQuestionIndex = -1;
let answeredThisQuestion = false;
let countdownInterval = null;
let lastChosenAnswer = null;

// Helper zum Umschalten der Karten
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
  timerBar.style.transform = "scaleX(1)";
  // Dauer der Transition = timeLimitSeconds (linear, in CSS already linear)
  timerBar.style.transition = `transform ${remaining}s linear`;
  // kleines Timeout, damit CSS-Transition greift
  setTimeout(() => {
    timerBar.style.transform = "scaleX(0)";
  }, 40);

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

// Beitreten
joinBtn.addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    joinStatus.textContent = "Bitte gib einen Namen ein.";
    return;
  }
  socket.emit("join", name);
});

socket.on("joined", ({ name }) => {
  joined = true;
  joinStatus.textContent = "Beigetreten als: " + name;
  showCard(waitCard);
});

// Quiz startet
socket.on("quiz-started", () => {
  answeredThisQuestion = false;
  answerStatus.textContent = "";
  showCard(questionCard);
});

// Neue Frage
socket.on("question", (data) => {
  currentQuestionIndex = data.index;
  answeredThisQuestion = false;
  lastChosenAnswer = null;
  answerStatus.textContent = "";

  questionText.textContent = data.question;
  questionPill.textContent =
    "Frage " + (data.index + 1) + " von " + data.total;
  timerLabel.textContent = data.timeLimit + "s";

  // Antworten rendern
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

      // Auswahl markieren
      document
        .querySelectorAll(".answer-btn")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");

      // Antwort senden
      socket.emit("answer", {
        questionIndex: currentQuestionIndex,
        answer: ansText,
      });
      answerStatus.textContent = "Antwort gesendet. Warte auf Auswertung...";

      // Buttons deaktivieren
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
    answerStatus.textContent = "Richtig! ✅";
  } else {
    answerStatus.textContent =
      "Falsch. ❌ Richtige Antwort: " + correctAnswer;
  }
});

// Zeit abgelaufen
socket.on("question-timeout", ({ index }) => {
  if (index === currentQuestionIndex) {
    stopCountdown();
    if (!answeredThisQuestion) {
      answerStatus.textContent =
        "Zeit abgelaufen! ⏰ Du hast nicht geantwortet.";
    }
    document
      .querySelectorAll(".answer-btn")
      .forEach((b) => (b.disabled = true));
  }
});

// Quiz beendet
socket.on("quiz-ended", ({ ranking }) => {
  stopCountdown();

  let msg = "Quiz beendet.";
  if (ranking && ranking.length) {
    const myName = playerNameInput.value.trim();
    const me = ranking.find((r) => r.name === myName);
    if (me) {
      const medal =
        me.rank === 1 ? "🥇" : me.rank === 2 ? "🥈" : me.rank === 3 ? "🥉" : "🏁";
      msg =
        `${medal} Du bist auf Platz ${me.rank} mit ` +
        `${me.score} Punkt${me.score === 1 ? "" : "en"}.`;
    } else {
      msg += " Deine Ergebnisse wurden nicht gefunden.";
    }
  }
  endText.textContent = msg;
  showCard(endCard);
});