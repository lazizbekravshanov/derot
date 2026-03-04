/* ── derot New Tab Controller ── */

const $ = (sel) => document.querySelector(sel);

const QUOTES = [
  "The secret of getting ahead is getting started.",
  "Deep work is the ability to focus without distraction on a cognitively demanding task.",
  "What we fear doing most is usually what we most need to do.",
  "Discipline is choosing between what you want now and what you want most.",
  "Your future self will thank you for the focus you build today.",
  "Almost everything will work again if you unplug it for a few minutes — including you.",
  "The successful warrior is the average man, with laser-like focus.",
  "Energy flows where attention goes.",
  "You don't need more time. You need more focus.",
  "Small disciplines repeated with consistency every day lead to great achievements.",
  "It's not that I'm so smart, it's just that I stay with problems longer.",
  "Concentrate all your thoughts upon the work at hand.",
  "The one thing you can't recycle is wasted time.",
  "Focus on being productive instead of busy."
];

let state = {};
let stats = {};

document.addEventListener("DOMContentLoaded", async () => {
  // Check if new tab is enabled
  const { state: s } = await chrome.storage.local.get("state");
  if (s && s.newTabEnabled === false) {
    // Can't restore Chrome default new tab, so show a clean redirect
    document.body.style.cssText = "display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui;color:#86868b;";
    document.body.innerHTML = '<p>derot new tab is disabled. <a href="chrome://bookmarks" style="color:#5856d6;">Open bookmarks</a> or re-enable in <a href="' + chrome.runtime.getURL("pages/settings.html") + '" style="color:#5856d6;">settings</a>.</p>';
    return;
  }

  const res = await chrome.runtime.sendMessage({ type: "getState" });
  state = res.state;
  stats = res.stats;

  applyTheme(state.theme);
  updateClock();
  updateGreeting();
  renderStats();
  renderGoalRing();
  renderChallenges();
  renderQuote();
  renderFocusBtn();
  renderScore();

  setInterval(updateClock, 1000);
});

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme || "light");
}

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  $("#clock").textContent = `${h}:${m}`;
}

function updateGreeting() {
  const hour = new Date().getHours();
  let greeting = "Good evening";
  if (hour < 12) greeting = "Good morning";
  else if (hour < 17) greeting = "Good afternoon";
  $("#greeting").textContent = greeting;
}

function renderStats() {
  const d = new Date().toISOString().split("T")[0];
  const focusMins = stats.dailyFocus?.[d] || 0;
  const blocked = stats.dailyBlocked?.[d] || 0;
  const goal = state.focusGoal || 120;
  const pct = Math.min(100, Math.round((focusMins / goal) * 100));

  if (focusMins >= 60) {
    const h = Math.floor(focusMins / 60);
    const m = focusMins % 60;
    $("#ntFocusTime").textContent = m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else {
    $("#ntFocusTime").textContent = `${focusMins}m`;
  }

  $("#ntBlocked").textContent = blocked;
  $("#ntStreak").textContent = stats.currentStreak || 0;
  $("#ntGoalPct").textContent = `${pct}%`;
}

function renderGoalRing() {
  const d = new Date().toISOString().split("T")[0];
  const focusMins = stats.dailyFocus?.[d] || 0;
  const goal = state.focusGoal || 120;
  const pct = Math.min(100, Math.round((focusMins / goal) * 100));
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (pct / 100) * circumference;
  $("#ntRingFg").setAttribute("stroke-dashoffset", offset);
}

async function renderChallenges() {
  const { challenges } = await chrome.storage.local.get("challenges");
  const container = $("#ntChallenges");
  container.innerHTML = "";

  if (!challenges || !challenges.active || challenges.active.length === 0) return;

  const active = challenges.active.filter(c => !c.completed).slice(0, 2);
  if (active.length === 0) return;

  for (const ch of active) {
    const el = document.createElement("div");
    el.className = "nt-challenge";
    const pct = Math.min(100, Math.round((ch.progress / ch.target) * 100));
    el.innerHTML = `<span class="nt-ch-name">${ch.name}</span><span class="nt-ch-progress">${pct}%</span>`;
    container.appendChild(el);
  }
}

function renderQuote() {
  $("#ntQuote").textContent = `"${QUOTES[Math.floor(Math.random() * QUOTES.length)]}"`;
}

async function renderScore() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "getProductivityScore" });
    const el = $("#ntScore");
    if (res.score === null || res.score === undefined) {
      el.textContent = "--";
      el.style.color = "";
    } else {
      el.textContent = res.score;
      el.style.color = res.score < 40 ? "var(--danger, #ff3b30)" : res.score <= 70 ? "#ff9500" : "var(--success, #34c759)";
    }
  } catch { /* ignore */ }
}

function renderFocusBtn() {
  const btn = $("#ntFocusBtn");
  if (state.focusActive) {
    btn.textContent = "Focus Active";
    btn.classList.add("active");
  }

  btn.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "toggleFocus" });
    state = res.state;
    if (res.stats) stats = res.stats;
    if (state.focusActive) {
      btn.textContent = "Focus Active";
      btn.classList.add("active");
    } else {
      btn.textContent = "Start Focus";
      btn.classList.remove("active");
    }
    renderStats();
    renderGoalRing();
  });
}
