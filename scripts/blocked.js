/* ── derot Blocked Page Controller ── */

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
  "Small disciplines repeated with consistency every day lead to great achievements."
];

let breakInterval = null;

/* ── Init ── */

document.addEventListener("DOMContentLoaded", async () => {
  // Read theme from storage
  const { state } = await chrome.storage.local.get("state");
  if (state?.theme) {
    document.body.setAttribute("data-theme", state.theme);
  }

  const params = new URLSearchParams(window.location.search);
  const site = params.get("site") || "this site";

  // Focus duration
  let focusMinutes = 0;
  if (state?.focusStartTime) {
    focusMinutes = Math.floor((Date.now() - state.focusStartTime) / 60000);
  }

  const focusText = focusMinutes > 0
    ? `You've been focused for <strong>${formatDuration(focusMinutes)}</strong>. Keep going.`
    : "You just started your focus session. Keep going.";

  $("#message").innerHTML =
    `You blocked <strong>${site}</strong> during focus mode. ${focusText}`;

  // Random quote
  $("#footnote").textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];

  // Check if already on break
  if (state?.breakActive && state?.breakEndTime) {
    showBreakOverlay(state.breakEndTime);
  }
});

function formatDuration(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins} minutes`;
}

/* ── Actions ── */

$("#goBackBtn").addEventListener("click", () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.close();
  }
});

$("#breakBtn").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "startBreak" });
  if (res?.state?.breakEndTime) {
    showBreakOverlay(res.state.breakEndTime);
  }
});

$("#endBreakBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "endBreak" });
  clearInterval(breakInterval);
  location.reload();
});

/* ── Break Overlay ── */

function showBreakOverlay(endTime) {
  const overlay = $("#breakOverlay");
  overlay.classList.remove("hidden");

  function updateCountdown() {
    const remaining = Math.max(0, endTime - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    $("#breakCountdown").textContent =
      `${mins}:${String(secs).padStart(2, "0")}`;

    if (remaining <= 0) {
      clearInterval(breakInterval);
      location.reload();
    }
  }

  updateCountdown();
  breakInterval = setInterval(updateCountdown, 1000);
}

/* ── Listen for break end ── */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "breakEnded") {
    clearInterval(breakInterval);
    location.reload();
  }
  if (msg.type === "themeChanged") {
    document.body.setAttribute("data-theme", msg.theme);
  }
});
