/* ── derot Analytics Controller ── */

const $ = (sel) => document.querySelector(sel);

let data = {};

document.addEventListener("DOMContentLoaded", async () => {
  const { state } = await chrome.storage.local.get("state");
  applyTheme(state?.theme);

  data = await chrome.runtime.sendMessage({ type: "getAnalyticsData" });

  renderScoreRing();
  renderTimeBreakdown();
  renderTopSites();
  renderHeatmap();
  renderScoreTrend();
  renderInsights();
});

/* ── Theme ── */

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme || "light");
  $("#themeToggle").textContent = theme === "dark" ? "☀️" : "🌙";
}

$("#themeToggle").addEventListener("click", async () => {
  const { state } = await chrome.storage.local.get("state");
  const newTheme = state.theme === "dark" ? "light" : "dark";
  state.theme = newTheme;
  applyTheme(newTheme);
  await chrome.runtime.sendMessage({ type: "updateSettings", settings: { theme: newTheme } });
});

/* ── 1. Productivity Score Ring ── */

function renderScoreRing() {
  const score = data.score;
  const el = $("#scoreValue");
  const ring = $("#scoreRingFg");
  const circumference = 2 * Math.PI * 68;

  if (score === null || score === undefined) {
    el.textContent = "--";
    el.style.color = "";
    ring.style.stroke = "var(--border)";
    return;
  }

  el.textContent = score;
  const color = score < 40 ? "var(--danger)" : score <= 70 ? "#ff9500" : "var(--success)";
  el.style.color = color;
  ring.style.stroke = color;

  const offset = circumference - (score / 100) * circumference;
  ring.setAttribute("stroke-dashoffset", offset);
}

/* ── 2. Time Breakdown ── */

function renderTimeBreakdown() {
  const { siteTime, categories } = data;
  let productive = 0, neutral = 0, distracting = 0;

  for (const [domain, mins] of Object.entries(siteTime)) {
    const cat = categories[domain] || "neutral";
    if (cat === "productive") productive += mins;
    else if (cat === "distracting") distracting += mins;
    else neutral += mins;
  }

  const total = productive + neutral + distracting;
  const bar = $("#timeBar");
  const legend = $("#timeLegend");

  if (total === 0) {
    bar.innerHTML = '<div class="time-bar-seg neutral" style="width:100%"></div>';
    legend.innerHTML = '<span class="time-legend-item"><span class="time-legend-dot neutral"></span>No data yet</span>';
    return;
  }

  bar.innerHTML = [
    { cat: "productive", mins: productive },
    { cat: "neutral", mins: neutral },
    { cat: "distracting", mins: distracting }
  ].filter(s => s.mins > 0).map(s =>
    `<div class="time-bar-seg ${s.cat}" style="width:${(s.mins / total * 100).toFixed(1)}%"></div>`
  ).join("");

  legend.innerHTML = [
    { cat: "productive", mins: productive, label: "Productive" },
    { cat: "neutral", mins: neutral, label: "Neutral" },
    { cat: "distracting", mins: distracting, label: "Distracting" }
  ].map(s =>
    `<span class="time-legend-item"><span class="time-legend-dot ${s.cat}"></span>${s.label}: ${formatMins(s.mins)}</span>`
  ).join("");
}

function formatMins(m) {
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r > 0 ? `${h}h ${r}m` : `${h}h`;
  }
  return `${m}m`;
}

/* ── 3. Top Sites ── */

function renderTopSites() {
  const { siteTime, categories } = data;
  const container = $("#topSites");

  const sorted = Object.entries(siteTime)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sorted.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);padding:8px 0;">No site data yet. Browse around and check back!</p>';
    return;
  }

  const maxTime = sorted[0][1];

  container.innerHTML = sorted.map(([domain, mins]) => {
    const cat = categories[domain] || "neutral";
    const pct = (mins / maxTime * 100).toFixed(1);
    return `<div class="top-site-row">
      <span class="top-site-dot ${cat}"></span>
      <span class="top-site-domain">${domain}</span>
      <div class="top-site-bar-wrap">
        <div class="top-site-bar ${cat}" style="width:${pct}%"></div>
      </div>
      <span class="top-site-time">${formatMins(mins)}</span>
    </div>`;
  }).join("");
}

/* ── 4. Distraction Heatmap ── */

function renderHeatmap() {
  const { heatmap, weekDays } = data;
  const container = $("#heatmap");
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Find max value for scaling
  let maxVal = 0;
  for (const v of Object.values(heatmap)) {
    if (v > maxVal) maxVal = v;
  }

  let html = '<div class="heatmap-grid">';

  // Header row
  html += '<div class="heatmap-label"></div>';
  for (let h = 0; h < 24; h++) {
    html += `<div class="heatmap-hour">${h % 6 === 0 ? h : ""}</div>`;
  }

  // Data rows
  weekDays.forEach((day, i) => {
    html += `<div class="heatmap-label">${dayLabels[i]}</div>`;
    for (let h = 0; h < 24; h++) {
      const key = day + "_" + String(h).padStart(2, "0");
      const val = heatmap[key] || 0;
      let level = "";
      if (val > 0 && maxVal > 0) {
        const ratio = val / maxVal;
        if (ratio <= 0.25) level = "h1";
        else if (ratio <= 0.5) level = "h2";
        else if (ratio <= 0.75) level = "h3";
        else level = "h4";
      }
      html += `<div class="heatmap-cell ${level}" title="${dayLabels[i]} ${h}:00 — ${val} blocks"></div>`;
    }
  });

  html += '</div>';
  container.innerHTML = html;
}

/* ── 5. Score Trend ── */

function renderScoreTrend() {
  const { weeklyScores } = data;
  const container = $("#scoreTrend");
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const todayStr = new Date().toISOString().split("T")[0];

  container.innerHTML = weeklyScores.map((entry, i) => {
    const score = entry.score;
    const isToday = entry.date === todayStr;
    const height = score !== null ? Math.max(4, (score / 100) * 150) : 4;
    const colorClass = score === null ? "" : score < 40 ? "red" : score <= 70 ? "yellow" : "green";
    const todayClass = isToday ? " today" : "";
    const label = score !== null ? score : "--";

    return `<div class="chart-col">
      <span class="chart-value">${label}</span>
      <div class="score-bar ${colorClass}${todayClass}" style="height:${height}px"></div>
      <span class="chart-day">${dayNames[i]}</span>
    </div>`;
  }).join("");
}

/* ── 6. Insights ── */

function renderInsights() {
  const { siteTime, categories, weeklyScores } = data;
  const container = $("#insights");
  const insights = [];

  // Best day
  const validScores = weeklyScores.filter(s => s.score !== null);
  if (validScores.length > 0) {
    const best = validScores.reduce((a, b) => (a.score >= b.score ? a : b));
    const dayName = new Date(best.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
    insights.push({ icon: "🏆", text: `Your most productive day was ${dayName} with a score of ${best.score}` });
  }

  // Top distraction
  const distractingSites = Object.entries(siteTime)
    .filter(([d]) => (categories[d] || "neutral") === "distracting")
    .sort((a, b) => b[1] - a[1]);

  if (distractingSites.length > 0) {
    const [site, mins] = distractingSites[0];
    insights.push({ icon: "⚠️", text: `You spent ${formatMins(mins)} on ${site} today — your top distraction` });
  }

  // Peak distraction hour
  const { heatmap } = data;
  let peakHour = -1, peakVal = 0;
  const todayStr = new Date().toISOString().split("T")[0];
  for (let h = 0; h < 24; h++) {
    const key = todayStr + "_" + String(h).padStart(2, "0");
    if ((heatmap[key] || 0) > peakVal) {
      peakVal = heatmap[key];
      peakHour = h;
    }
  }
  if (peakHour >= 0 && peakVal > 0) {
    const period = peakHour >= 12 ? "PM" : "AM";
    const hour12 = peakHour === 0 ? 12 : peakHour > 12 ? peakHour - 12 : peakHour;
    insights.push({ icon: "🕐", text: `Peak distraction time: ${hour12} ${period}` });
  }

  // Score trend
  if (validScores.length >= 2) {
    const recent = validScores[validScores.length - 1].score;
    const earlier = validScores[0].score;
    const diff = recent - earlier;
    if (diff !== 0) {
      const direction = diff > 0 ? "up" : "down";
      insights.push({ icon: diff > 0 ? "📈" : "📉", text: `Score trending ${direction} ${Math.abs(diff)} points since ${new Date(validScores[0].date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}` });
    }
  }

  if (insights.length === 0) {
    insights.push({ icon: "💡", text: "Keep browsing — insights will appear as data accumulates" });
  }

  container.innerHTML = insights.map(ins =>
    `<div class="insight-card"><span class="insight-icon">${ins.icon}</span><span class="insight-text">${ins.text}</span></div>`
  ).join("");
}

/* ── Theme Sync ── */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "themeChanged") {
    applyTheme(msg.theme);
  }
});
