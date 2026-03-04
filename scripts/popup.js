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
  renderRankBadge();
  checkMilestone();

  startTick();
});

/* ── Milestone Check ── */

function checkMilestone() {
  if (stats.newMilestone) {
    showMilestone(stats.newMilestone);
    stats.newMilestone = null;
    msg({ type: "clearMilestone" });
  }
}

function showMilestone(m) {
  $("#milestoneLabel").textContent = m.label;
  $("#milestoneSub").textContent = `${m.days}-day streak reached!`;
  const toast = $("#milestoneToast");
  toast.classList.remove("hidden");
  fireConfetti();
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function fireConfetti() {
  const canvas = $("#confettiCanvas");
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const pieces = [];
  const colors = ["#5856d6", "#ff3b30", "#34c759", "#ff9500", "#af52de", "#007aff"];
  for (let i = 0; i < 60; i++) {
    pieces.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 40,
      y: canvas.height,
      vx: (Math.random() - 0.5) * 10,
      vy: -(Math.random() * 12 + 6),
      size: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      rv: (Math.random() - 0.5) * 10
    });
  }
  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.vy += 0.3;
      p.y += p.vy;
      p.rot += p.rv;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 120) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(draw);
}

/* ── Session Summary ── */

function showSessionSummary(summary) {
  if (!summary || summary.duration < 1) return;
  const d = summary.duration;
  $("#summaryDuration").textContent = d >= 60 ? `${Math.floor(d / 60)}h ${d % 60}m` : `${d}m`;
  $("#summaryBlocked").textContent = summary.blockedCount;
  $("#summaryStreak").textContent = `${summary.streak}d`;
  $("#summaryOverlay").classList.remove("hidden");
}

$("#summaryShare").addEventListener("click", () => {
  const dur = $("#summaryDuration").textContent;
  const blocked = $("#summaryBlocked").textContent;
  const streak = $("#summaryStreak").textContent;
  const text = `Just finished a ${dur} deep work session with derot! Blocked ${blocked} distractions. ${streak} streak. #derot #deepwork`;
  navigator.clipboard.writeText(text).then(() => {
    $("#summaryShare").textContent = "Copied!";
    setTimeout(() => { $("#summaryShare").textContent = "Copy to share"; }, 2000);
  });
});

$("#summaryClose").addEventListener("click", () => {
  $("#summaryOverlay").classList.add("hidden");
});

$("#summaryOverlay").addEventListener("click", (e) => {
  if (e.target === $("#summaryOverlay")) {
    $("#summaryOverlay").classList.add("hidden");
  }
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
  // Hardcore mode check — refuse toggle off if locked
  if (state.focusActive && state.hardcoreLockUntil && Date.now() < state.hardcoreLockUntil) {
    $("#focusToggle").checked = true;
    return;
  }
  const wasFocused = state.focusActive;
  const res = await msg({ type: "toggleFocus" });
  state = res.state;
  if (res.stats) stats = res.stats;
  renderFocus();
  renderBreak();
  renderGoalRing();
  checkMilestone();
  if (wasFocused && res.summary) {
    showSessionSummary(res.summary);
  }
});

function renderFocus() {
  const active = state.focusActive;
  const card = $("#focusCard");
  const toggle = $("#focusToggle");
  const locked = active && state.hardcoreMode && state.hardcoreLockUntil && Date.now() < state.hardcoreLockUntil;

  card.classList.toggle("active", active);
  card.classList.toggle("locked", !!locked);
  toggle.checked = active;
  toggle.disabled = !!locked;

  if (locked) {
    const remaining = Math.max(0, Math.ceil((state.hardcoreLockUntil - Date.now()) / 60000));
    $("#focusEmoji").textContent = "🔒";
    $("#focusTitle").textContent = "Hardcore mode";
    $("#focusSub").innerHTML = `Locked for <strong>${remaining}m</strong> — triple-click to override`;
  } else {
    $("#focusEmoji").textContent = active ? "🔥" : "😴";
    $("#focusTitle").textContent = active ? "Focus mode on" : "Start focusing";
    $("#focusSub").textContent = active
      ? "Distractions are blocked"
      : "Distractions are allowed";
  }
}

/* ── Hardcore Triple-Click Override ── */

let hardcoreClicks = 0;
let hardcoreTimer = null;

$("#focusCard").addEventListener("click", async (e) => {
  if (!state.focusActive || !state.hardcoreMode || !state.hardcoreLockUntil) return;
  if (Date.now() >= state.hardcoreLockUntil) return;
  if (e.target.closest(".toggle")) return; // ignore toggle itself

  hardcoreClicks++;
  clearTimeout(hardcoreTimer);
  hardcoreTimer = setTimeout(() => { hardcoreClicks = 0; }, 800);

  if (hardcoreClicks >= 3) {
    hardcoreClicks = 0;
    const res = await msg({ type: "hardcoreOverride" });
    state = res.state;
    if (res.stats) stats = res.stats;
    renderFocus();
    renderBreak();
    renderPomodoro();
    if (res.summary) showSessionSummary(res.summary);
  }
});

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
  const locked = state.hardcoreMode && state.hardcoreLockUntil && Date.now() < state.hardcoreLockUntil;
  $("#pomodoroBtn").textContent = state.pomodoroRunning ? "Stop" : "Start";
  $("#pomodoroBtn").disabled = !!(state.pomodoroRunning && locked);
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

  // Celebration when goal met
  if (pct >= 100 && !goalCelebrated) {
    goalCelebrated = true;
    fireConfetti();
  }
}

let goalCelebrated = false;

/* ── Rank Badge ── */

function renderRankBadge() {
  const rank = stats.rank || "Apprentice";
  const existing = document.querySelector(".rank-badge");
  if (existing) existing.remove();
  const badge = document.createElement("span");
  badge.className = "rank-badge";
  badge.textContent = rank;
  $(".header-left").appendChild(badge);
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
    // Refresh hardcore lock display
    if (state.hardcoreMode && state.hardcoreLockUntil) {
      if (Date.now() >= state.hardcoreLockUntil) {
        state.hardcoreLockUntil = null;
        renderFocus();
      }
    }
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
    state.hardcoreLockUntil = null;
    renderPomodoro();
    renderFocus();
  }
});
