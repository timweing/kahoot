const socket = io({ query: { role: "poll-display" } });

const displayStatus = document.getElementById("displayStatus");
const displayQuestion = document.getElementById("displayQuestion");
const displayResult = document.getElementById("displayResult");

let currentQuestion = null;
let currentAggregate = null;

function setStatus(text) {
  displayStatus.textContent = text;
}

function renderWordcloud(aggregate) {
  displayResult.innerHTML = "";
  const container = document.createElement("div");
  container.className = "wordcloud";
  const entries = aggregate.entries || [];
  if (!entries.length) {
    setStatus("Noch keine Wörter eingereicht.");
    return;
  }
  const maxCount = Math.max(...entries.map((e) => e.count));
  entries.forEach((entry) => {
    const span = document.createElement("span");
    const factor = maxCount ? entry.count / maxCount : 0;
    const minSize = 18;
    const maxSize = 48;
    const size = minSize + factor * (maxSize - minSize);
    span.textContent = entry.word;
    span.style.fontSize = size.toFixed(0) + "px";
    container.appendChild(span);
  });
  displayResult.appendChild(container);
  setStatus(`Einsendungen: ${aggregate.totalSubmissions || 0}`);
}

function renderSingle(aggregate) {
  displayResult.innerHTML = "";
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
    barInner.style.width = (opt.count / maxCount) * 100 + "%";
    barInner.textContent = `${opt.count}`;

    barOuter.appendChild(barInner);
    row.appendChild(label);
    row.appendChild(barOuter);
    list.appendChild(row);
  });
  displayResult.appendChild(list);
  setStatus(`Einsendungen: ${aggregate.totalSubmissions || 0}`);
}

function renderImportance(aggregate) {
  displayResult.innerHTML = "";
  const list = document.createElement("ol");
  list.className = "importance-list";
  (aggregate.options || []).forEach((opt) => {
    const li = document.createElement("li");
    const avg =
      opt.avgRank && opt.avgRank > 0
        ? ` · ⌀ Rang ${opt.avgRank.toFixed(2)}`
        : "";
    li.innerHTML = `<div class="importance-row"><span>${opt.text}</span><span class="badge">Score: ${opt.score}${avg}</span></div>`;
    list.appendChild(li);
  });
  displayResult.appendChild(list);
  setStatus(`Einsendungen: ${aggregate.totalSubmissions || 0}`);
}

function renderAggregate() {
  if (!currentAggregate) {
    displayResult.innerHTML = "";
    return;
  }
  if (currentAggregate.type === "wordcloud") {
    renderWordcloud(currentAggregate);
  } else if (currentAggregate.type === "single") {
    renderSingle(currentAggregate);
  } else if (currentAggregate.type === "importance") {
    renderImportance(currentAggregate);
  }
}

socket.on("poll-status", (status) => {
  currentQuestion = status.currentQuestion || null;
  currentAggregate = status.currentAggregate || null;
  if (currentQuestion) {
    displayQuestion.textContent = currentQuestion.question;
    renderAggregate();
  } else {
    displayQuestion.textContent = "";
    setStatus(
      status.pollLoaded
        ? "Umfrage geladen, wartet auf Start ..."
        : "Noch keine Umfrage geladen."
    );
  }
});

socket.on("poll-question", (payload) => {
  currentQuestion = payload;
  displayQuestion.textContent = payload.question;
  displayResult.innerHTML = "";
  setStatus("Sammle Antworten ...");
});

socket.on("poll-aggregate", (aggregate) => {
  currentAggregate = aggregate;
  renderAggregate();
});

socket.on("poll-ended", ({ results }) => {
  currentQuestion = null;
  currentAggregate = null;
  displayQuestion.textContent = "Umfrage beendet.";
  displayResult.innerHTML = "";
  if (Array.isArray(results) && results.length) {
    const summary = document.createElement("div");
    summary.className = "result-summary";
    results.forEach((res) => {
      const block = document.createElement("div");
      block.className = "result-block";
      const title = document.createElement("h3");
      title.textContent = res.question;
      block.appendChild(title);
      if (res.summary) {
        if (res.summary.type === "wordcloud") {
          const holder = document.createElement("div");
          holder.className = "wordcloud";
          res.summary.entries.forEach((e) => {
            const span = document.createElement("span");
            span.textContent = e.word;
            span.style.fontSize = `${12 + e.count * 2}px`;
            holder.appendChild(span);
          });
          block.appendChild(holder);
        } else if (res.summary.type === "single") {
          const holder = document.createElement("div");
          holder.className = "result-bars";
          res.summary.options.forEach((opt) => {
            const row = document.createElement("div");
            row.className = "result-bar-row";
            const label = document.createElement("div");
            label.className = "result-label";
            label.textContent = opt.text;
            const outer = document.createElement("div");
            outer.className = "result-bar-outer";
            const inner = document.createElement("div");
            inner.className = "result-bar-inner";
            inner.style.width = `${opt.count * 10 + 20}px`;
            inner.textContent = opt.count;
            outer.appendChild(inner);
            row.appendChild(label);
            row.appendChild(outer);
            holder.appendChild(row);
          });
          block.appendChild(holder);
        } else if (res.summary.type === "importance") {
          const holder = document.createElement("ol");
          holder.className = "importance-list";
          res.summary.options.forEach((opt) => {
            const li = document.createElement("li");
            li.innerHTML = `<div class="importance-row"><span>${opt.text}</span><span class="badge">Score: ${opt.score}</span></div>`;
            holder.appendChild(li);
          });
          block.appendChild(holder);
        }
      }
      summary.appendChild(block);
    });
    displayResult.appendChild(summary);
  }
  setStatus("Umfrage beendet.");
});
