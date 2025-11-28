const socket = io({ query: { role: "poll-display" } });

const displayStatus = document.getElementById("displayStatus");
const displayQuestion = document.getElementById("displayQuestion");
const displayResult = document.getElementById("displayResult");
const themeToggle = document.getElementById("themeToggle");

let currentQuestion = null;
let currentAggregate = null;

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

function setStatus(text) {
  displayStatus.textContent = text;
}

function renderD3Wordcloud(target, entries, opts = {}) {
  if (!entries || !entries.length) {
    target.innerHTML = "";
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = "Noch keine Wörter eingereicht.";
    target.appendChild(p);
    return;
  }

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
  const width = target.clientWidth || 720;
  const height = opts.height || 360;
  const maxCount = Math.max(...entries.map((e) => e.count));
  const sizeScale = d3
    .scaleLinear()
    .domain([1, maxCount || 1])
    .range([18, 56]);
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
    renderD3Wordcloud(displayResult, currentAggregate.entries || []);
    setStatus(`Einsendungen: ${currentAggregate.totalSubmissions || 0}`);
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
          renderD3Wordcloud(holder, res.summary.entries || [], { height: 280 });
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
