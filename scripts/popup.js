/* ── derot Popup Controller ── */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let state = {};
let blocklist = [];
let stats = {};
let tickInterval = null;

/* ── Init ── */

document.addEventListener("DOMContentLoaded", async () => {
  const res = await msg({ type: "getState" });
  state = res.state;
  blocklist = res.blocklist;
  stats = res.stats;

  applyTheme(state.theme);
  renderFocus();
  renderBreak();
  renderStats();
  renderPomodoro();
  renderSites();
  renderGoalRing();

  startTick();
});

/* ── Messaging ── */

function msg(data) {
  return chrome.runtime.sendMessage(data);
}

/* ── Theme ── */

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  $("#themeToggle").textContent = theme === "dark" ? "☀️" : "🌙";
}

$("#themeToggle").addEventListener("click", async () => {
  const newTheme = state.theme === "dark" ? "light" : "dark";
  state.theme = newTheme;
  applyTheme(newTheme);
  await msg({ type: "updateSettings", settings: { theme: newTheme } });
});

/* ── Focus Toggle ── */

$("#focusToggle").addEventListener("change", async () => {
  const res = await msg({ type: "toggleFocus" });
  state = res.state;
  if (res.stats) stats = res.stats;
  renderFocus();
  renderBreak();
  renderGoalRing();
});

function renderFocus() {
  const active = state.focusActive;
  const card = $("#focusCard");
  const toggle = $("#focusToggle");

  card.classList.toggle("active", active);
  toggle.checked = active;

  $("#focusEmoji").textContent = active ? "🔥" : "😴";
  $("#focusTitle").textContent = active ? "Focus mode on" : "Start focusing";
  $("#focusSub").textContent = active
    ? "Distractions are blocked"
    : "Distractions are allowed";
}

/* ── Break Banner ── */

function renderBreak() {
  const banner = $("#breakBanner");
  if (state.breakActive && state.breakEndTime) {
    banner.classList.remove("hidden");
    updateBreakTimer();
  } else {
    banner.classList.add("hidden");
  }
}

function updateBreakTimer() {
  if (!state.breakActive || !state.breakEndTime) return;
  const remaining = Math.max(0, state.breakEndTime - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  $("#breakTimer").textContent = `${mins}:${String(secs).padStart(2, "0")}`;
}

/* ── Stats ── */

async function renderStats() {
  const d = new Date().toISOString().split("T")[0];
  const blocked = stats.dailyBlocked?.[d] || 0;
  const focus = stats.dailyFocus?.[d] || 0;

  $("#blockedToday").textContent = blocked;

  if (focus >= 60) {
    const h = Math.floor(focus / 60);
    const m = focus % 60;
    $("#focusTime").textContent = m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else {
    $("#focusTime").textContent = `${focus}m`;
  }

  // Fetch and display productivity score
  try {
    const res = await msg({ type: "getProductivityScore" });
    const el = $("#scoreValue");
    if (res.score === null || res.score === undefined) {
      el.textContent = "--";
      el.className = "stat-value";
    } else {
      el.textContent = res.score;
      el.className = "stat-value " + (res.score < 40 ? "score-red" : res.score <= 70 ? "score-yellow" : "score-green");
    }
  } catch { /* ignore */ }
}

/* ── Pomodoro ── */

function renderPomodoro() {
  updatePomodoroDisplay();
  updatePomodoroBtn();
  updatePresetHighlight();
}

function updatePomodoroDisplay() {
  let seconds;
  if (state.pomodoroRunning && state.pomodoroEndTime) {
    seconds = Math.max(0, Math.ceil((state.pomodoroEndTime - Date.now()) / 1000));
  } else {
    seconds = state.pomodoroTime;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  $("#pomodoroDisplay").textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updatePomodoroBtn() {
  $("#pomodoroBtn").textContent = state.pomodoroRunning ? "Stop" : "Start";
}

function updatePresetHighlight() {
  $$(".preset").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.time) === state.pomodoroTime);
  });
}

// Preset buttons
$$(".preset").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (state.pomodoroRunning) return;
    const time = Number(btn.dataset.time);
    state.pomodoroTime = time;
    await msg({ type: "updateSettings", settings: { pomodoroTime: time } });
    renderPomodoro();
  });
});

// Start/Stop
$("#pomodoroBtn").addEventListener("click", async () => {
  if (state.pomodoroRunning) {
    const res = await msg({ type: "stopPomodoro" });
    state = res.state;
  } else {
    const res = await msg({ type: "startPomodoro" });
    state = res.state;
  }
  renderPomodoro();
});

/* ── Goal Progress Ring ── */

function renderGoalRing() {
  const d = new Date().toISOString().split("T")[0];
  const focusMins = stats.dailyFocus?.[d] || 0;
  const goal = state.focusGoal || 120;
  const pct = Math.min(100, Math.round((focusMins / goal) * 100));
  const circumference = 2 * Math.PI * 42; // r=42
  const offset = circumference - (pct / 100) * circumference;

  $("#goalRingFg").setAttribute("stroke-dashoffset", offset);
  $("#goalPct").textContent = `${pct}%`;
}

/* ── Sites ── */

function renderSites() {
  const container = $("#sitesPills");
  container.innerHTML = "";
  blocklist
    .filter((s) => s.enabled)
    .forEach((site) => {
      const pill = document.createElement("span");
      pill.className = "site-pill";
      pill.textContent = site.domain;
      container.appendChild(pill);
    });
}

/* ── Navigation ── */

$("#statsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/dashboard.html") });
});

$("#analyticsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/analytics.html") });
});

$("#editSitesBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("pages/settings.html") });
});

/* ── Tick (1s interval) ── */

function startTick() {
  tickInterval = setInterval(() => {
    if (state.pomodoroRunning) updatePomodoroDisplay();
    if (state.breakActive) updateBreakTimer();
  }, 1000);
}

/* ── Listen for background messages ── */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "breakEnded") {
    state.breakActive = false;
    state.breakEndTime = null;
    renderBreak();
  }
  if (msg.type === "pomodoroEnded") {
    state.pomodoroRunning = false;
    state.pomodoroEndTime = null;
    renderPomodoro();
    renderFocus();
  }
  if (msg.type === "themeChanged") {
    state.theme = msg.theme;
    applyTheme(msg.theme);
  }
});
