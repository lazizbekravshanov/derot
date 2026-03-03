/* ── derot — Background Service Worker ── */

const DEFAULT_STATE = {
  focusActive: false,
  focusStartTime: null,
  cleanupEnabled: true,
  theme: "light",
  breakActive: false,
  breakEndTime: null,
  pomodoroTime: 1500,
  pomodoroRunning: false,
  pomodoroEndTime: null,
  sessionBlockedCount: 0,
  hardcoreMode: false,
  hardcoreLockUntil: null,
  focusGoal: 120,
  newTabEnabled: true
};

const DEFAULT_BLOCKLIST = [
  { domain: "twitter.com", enabled: true },
  { domain: "x.com", enabled: true },
  { domain: "instagram.com", enabled: true },
  { domain: "reddit.com", enabled: true },
  { domain: "tiktok.com", enabled: true },
  { domain: "youtube.com", enabled: true },
  { domain: "facebook.com", enabled: true },
  { domain: "snapchat.com", enabled: true },
  { domain: "twitch.tv", enabled: false },
  { domain: "netflix.com", enabled: false }
];

const DEFAULT_STATS = {
  dailyFocus: {},
  dailyBlocked: {},
  blockedSites: {},
  currentStreak: 0,
  lastFocusDate: null,
  milestones: [],
  newMilestone: null,
  goalsCompleted: {},
  xp: 0,
  rank: "Apprentice",
  completedChallenges: 0,
  dailyPomodoros: {}
};

/* ── Helpers ── */

function today() {
  return new Date().toISOString().split("T")[0];
}

function stripDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainMatches(hostname, blocked) {
  return hostname === blocked || hostname.endsWith("." + blocked);
}

/* ── Allowlist — never block learning & productivity platforms ── */

const ALLOWED_DOMAINS = [
  "chatgpt.com", "chat.openai.com", "openai.com",
  "claude.ai", "anthropic.com",
  "gemini.google.com", "bard.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "github.com", "gitlab.com", "bitbucket.org",
  "stackoverflow.com", "stackexchange.com",
  "developer.mozilla.org", "docs.google.com",
  "notion.so", "linear.app", "figma.com",
  "coursera.org", "edx.org", "udemy.com", "khanacademy.org",
  "leetcode.com", "hackerrank.com", "codewars.com",
  "wikipedia.org", "scholar.google.com",
  "w3schools.com", "freecodecamp.org",
  "replit.com", "codepen.io", "codesandbox.io"
];

function isDomainAllowed(hostname) {
  for (const allowed of ALLOWED_DOMAINS) {
    if (hostname === allowed || hostname.endsWith("." + allowed)) return true;
  }
  return false;
}

function isBlockedUrl(url) {
  if (!url) return false;
  if (
    url.startsWith("chrome://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://")
  ) return false;
  return true;
}

/* ── Initialization ── */

chrome.runtime.onInstalled.addListener(async () => {
  const { state, stats, challenges } = await chrome.storage.local.get(["state", "stats", "challenges"]);
  // Merge defaults so existing users get new fields
  await chrome.storage.local.set({
    state: { ...DEFAULT_STATE, ...state },
    stats: { ...DEFAULT_STATS, ...stats },
    challenges: challenges || { weekOf: null, active: [], history: [] }
  });
  if (!state) {
    await chrome.storage.local.set({ blocklist: DEFAULT_BLOCKLIST });
  }
});

/* ── Site Blocking ── */

async function checkAndBlock(tabId, url) {
  if (!isBlockedUrl(url)) return;

  const { state, blocklist } = await chrome.storage.local.get(["state", "blocklist"]);
  if (!state || !state.focusActive || state.breakActive) return;
  if (!blocklist) return;

  const hostname = stripDomain(url);
  if (!hostname) return;

  // Never block learning & productivity platforms
  if (isDomainAllowed(hostname)) return;

  for (const site of blocklist) {
    if (site.enabled && domainMatches(hostname, site.domain)) {
      // Increment blocked count
      const { stats } = await chrome.storage.local.get("stats");
      const s = stats || DEFAULT_STATS;
      const d = today();
      s.dailyBlocked[d] = (s.dailyBlocked[d] || 0) + 1;
      s.blockedSites[site.domain] = (s.blockedSites[site.domain] || 0) + 1;
      await chrome.storage.local.set({ stats: s });

      // Track session blocked count
      state.sessionBlockedCount = (state.sessionBlockedCount || 0) + 1;
      await chrome.storage.local.set({ state });

      // Redirect to blocked page
      const blockedUrl = chrome.runtime.getURL(
        `pages/blocked.html?site=${encodeURIComponent(site.domain)}`
      );
      chrome.tabs.update(tabId, { url: blockedUrl });
      return;
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkAndBlock(tabId, changeInfo.url);
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    checkAndBlock(details.tabId, details.url);
  }
});

/* ── Focus Time Tracking ── */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "focusTick") {
    const { state, stats } = await chrome.storage.local.get(["state", "stats"]);
    if (!state || !state.focusActive) return;
    const s = stats || DEFAULT_STATS;
    const d = today();
    s.dailyFocus[d] = (s.dailyFocus[d] || 0) + 1;

    // Check daily goal completion
    const goal = state.focusGoal || 120;
    if (!s.goalsCompleted) s.goalsCompleted = {};
    if (s.dailyFocus[d] >= goal && !s.goalsCompleted[d]) {
      s.goalsCompleted[d] = true;
    }

    await chrome.storage.local.set({ stats: s });
    updateBadge(true);

    // Evaluate challenges
    evaluateChallenges(state, s);
  }

  if (alarm.name === "breakEnd") {
    const { state } = await chrome.storage.local.get("state");
    if (!state) return;
    state.breakActive = false;
    state.breakEndTime = null;
    await chrome.storage.local.set({ state });

    // Notify popup and pages
    chrome.runtime.sendMessage({ type: "breakEnded" }).catch(() => {});
  }

  if (alarm.name === "pomodoroEnd") {
    const { state } = await chrome.storage.local.get("state");
    if (!state) return;
    state.pomodoroRunning = false;
    state.pomodoroEndTime = null;
    state.hardcoreLockUntil = null;
    // Track daily pomodoros for challenges
    const { stats } = await chrome.storage.local.get("stats");
    if (stats) {
      const d = today();
      if (!stats.dailyPomodoros) stats.dailyPomodoros = {};
      stats.dailyPomodoros[d] = (stats.dailyPomodoros[d] || 0) + 1;
      await chrome.storage.local.set({ stats });
    }
    await chrome.storage.local.set({ state });
    // Refresh badge now that pomodoro ended
    if (state.focusActive) updateBadge(true);

    // Send notification
    chrome.notifications.create("pomodoroDone", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "Pomodoro Complete!",
      message: "Great work! Take a break or start another session.",
      priority: 2
    });

    chrome.runtime.sendMessage({ type: "pomodoroEnded" }).catch(() => {});
  }
});

/* ── Badge ── */

async function updateBadge(focusActive) {
  if (!focusActive) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const { state } = await chrome.storage.local.get("state");
  if (!state) return;

  // Pomodoro running → show remaining time
  if (state.pomodoroRunning && state.pomodoroEndTime) {
    const remaining = Math.max(0, Math.ceil((state.pomodoroEndTime - Date.now()) / 60000));
    chrome.action.setBadgeText({ text: `${remaining}m` });
    chrome.action.setBadgeBackgroundColor({ color: "#ff9500" });
    return;
  }

  // Focus active → show elapsed time
  if (state.focusStartTime) {
    const elapsed = Math.floor((Date.now() - state.focusStartTime) / 60000);
    const text = elapsed >= 60 ? `${Math.floor(elapsed / 60)}h` : `${elapsed}m`;
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: "#5856d6" });
    return;
  }

  chrome.action.setBadgeText({ text: "ON" });
  chrome.action.setBadgeBackgroundColor({ color: "#5856d6" });
}

/* ── Streak Logic ── */

const MILESTONES = [3, 7, 14, 30, 60, 100];
const MILESTONE_LABELS = {
  3: "3-Day Spark", 7: "Week Warrior", 14: "Fortnight Focus",
  30: "Monthly Master", 60: "60-Day Legend", 100: "Centurion"
};

function updateStreak(stats) {
  const d = today();
  if (stats.lastFocusDate === d) return; // Already counted today

  if (!stats.milestones) stats.milestones = [];

  const last = stats.lastFocusDate;
  if (last) {
    const lastDate = new Date(last);
    const todayDate = new Date(d);
    const diffDays = Math.floor(
      (todayDate - lastDate) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 1) {
      stats.currentStreak += 1;
    } else if (diffDays > 1) {
      stats.currentStreak = 1;
    }
  } else {
    stats.currentStreak = 1;
  }
  stats.lastFocusDate = d;

  // Check milestones
  for (const m of MILESTONES) {
    if (stats.currentStreak >= m && !stats.milestones.includes(m)) {
      stats.milestones.push(m);
      stats.newMilestone = { days: m, label: MILESTONE_LABELS[m] };
    }
  }
}

/* ── Challenges System ── */

const CHALLENGE_POOL = [
  { id: "early_bird", name: "Early Bird", description: "Start 3 focus sessions before 9 AM", target: 3, xp: 50 },
  { id: "fortress", name: "Fortress", description: "Block 50 distractions this week", target: 50, xp: 40 },
  { id: "marathon", name: "Marathon", description: "Accumulate 10 hours of focus this week", target: 600, xp: 80 },
  { id: "triple_threat", name: "Triple Threat", description: "Complete 3 pomodoros in one day", target: 3, xp: 30 },
  { id: "consistent", name: "Consistency King", description: "Focus every day this week (7 days)", target: 7, xp: 60 },
  { id: "deep_dive", name: "Deep Dive", description: "Have a single focus session lasting 2+ hours", target: 1, xp: 50 },
  { id: "power_hour", name: "Power Hour", description: "Focus for 60+ minutes on 5 different days", target: 5, xp: 60 },
  { id: "goal_crusher", name: "Goal Crusher", description: "Hit your daily focus goal 5 times this week", target: 5, xp: 70 }
];

const RANKS = [
  { name: "Apprentice", xp: 0 }, { name: "Scholar", xp: 100 },
  { name: "Adept", xp: 300 }, { name: "Master", xp: 600 },
  { name: "Sage", xp: 1000 }, { name: "Legend", xp: 2000 }
];

function getWeekDays() {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

function weeklySum(obj) {
  if (!obj) return 0;
  return getWeekDays().reduce((s, d) => s + (obj[d] || 0), 0);
}

function getMonday() {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  return mon.toISOString().split("T")[0];
}

function evaluateChallengeProgress(ch, stats, state) {
  switch (ch.id) {
    case "fortress": return weeklySum(stats.dailyBlocked);
    case "marathon": return weeklySum(stats.dailyFocus);
    case "triple_threat": return (stats.dailyPomodoros || {})[today()] || 0;
    case "consistent": return getWeekDays().filter(d => (stats.dailyFocus?.[d] || 0) > 0).length;
    case "deep_dive":
      if (state.focusActive && state.focusStartTime) {
        return (Date.now() - state.focusStartTime) / 60000 >= 120 ? 1 : 0;
      }
      return 0;
    case "power_hour": return getWeekDays().filter(d => (stats.dailyFocus?.[d] || 0) >= 60).length;
    case "goal_crusher": return getWeekDays().filter(d => (stats.goalsCompleted || {})[d]).length;
    case "early_bird": return ch.progress; // tracked separately on focus start
    default: return ch.progress || 0;
  }
}

async function evaluateChallenges(state, stats) {
  const { challenges } = await chrome.storage.local.get("challenges");
  if (!challenges || !challenges.active) return;

  let xpGained = 0;
  for (const ch of challenges.active) {
    if (ch.completed) continue;
    ch.progress = evaluateChallengeProgress(ch, stats, state);
    if (ch.progress >= ch.target) {
      ch.completed = true;
      xpGained += ch.xp;
      if (!stats.completedChallenges) stats.completedChallenges = 0;
      stats.completedChallenges++;
    }
  }

  if (xpGained > 0) {
    stats.xp = (stats.xp || 0) + xpGained;
    // Update rank
    let rank = "Apprentice";
    for (const r of RANKS) { if (stats.xp >= r.xp) rank = r.name; }
    stats.rank = rank;
    await chrome.storage.local.set({ stats });
  }

  await chrome.storage.local.set({ challenges });
}

async function ensureWeeklyChallenges() {
  const { challenges } = await chrome.storage.local.get("challenges");
  const monday = getMonday();
  if (!challenges || challenges.weekOf !== monday) {
    const shuffled = [...CHALLENGE_POOL].sort(() => Math.random() - 0.5);
    const active = shuffled.slice(0, 4).map(ch => ({
      id: ch.id, name: ch.name, description: ch.description,
      target: ch.target, xp: ch.xp, progress: 0, completed: false
    }));
    const history = challenges?.history || [];
    if (challenges?.active) {
      history.push({ weekOf: challenges.weekOf, challenges: challenges.active });
    }
    await chrome.storage.local.set({
      challenges: { weekOf: monday, active, history: history.slice(-8) }
    });
  }
}

/* ── Core Toggle ── */

async function doToggleFocus(forceOverride = false) {
  const { state, stats } = await chrome.storage.local.get(["state", "stats"]);
  const s = state || DEFAULT_STATE;
  const st = stats || DEFAULT_STATS;

  // Hardcore mode: refuse toggle-off if locked
  if (s.focusActive && s.hardcoreMode && s.hardcoreLockUntil && !forceOverride) {
    if (Date.now() < s.hardcoreLockUntil) {
      return { state: s, stats: st, locked: true };
    }
  }

  s.focusActive = !s.focusActive;
  if (s.focusActive) {
    s.focusStartTime = Date.now();
    s.sessionBlockedCount = 0;
    s.hardcoreLockUntil = null;
    chrome.alarms.create("focusTick", { periodInMinutes: 1 });
    updateStreak(st);
    await chrome.storage.local.set({ stats: st });
    // Track early bird challenge
    if (new Date().getHours() < 9) {
      const { challenges } = await chrome.storage.local.get("challenges");
      if (challenges?.active) {
        const eb = challenges.active.find(c => c.id === "early_bird" && !c.completed);
        if (eb) { eb.progress++; await chrome.storage.local.set({ challenges }); }
      }
    }
  } else {
    const summary = buildSessionSummary(s, st);
    s.focusStartTime = null;
    s.breakActive = false;
    s.breakEndTime = null;
    s.sessionBlockedCount = 0;
    s.pomodoroRunning = false;
    s.pomodoroEndTime = null;
    s.hardcoreLockUntil = null;
    chrome.alarms.clear("focusTick");
    chrome.alarms.clear("breakEnd");
    chrome.alarms.clear("pomodoroEnd");
    await chrome.storage.local.set({ state: s });
    updateBadge(false);
    return { state: s, stats: st, summary };
  }
  await chrome.storage.local.set({ state: s });
  updateBadge(true);
  return { state: s, stats: st };
}

function buildSessionSummary(state, stats) {
  if (!state.focusStartTime) return null;
  const duration = Math.floor((Date.now() - state.focusStartTime) / 60000);
  return {
    duration,
    blockedCount: state.sessionBlockedCount || 0,
    streak: stats.currentStreak || 0
  };
}

/* ── Keyboard Shortcut ── */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-focus") {
    const result = await doToggleFocus();
    if (result.locked) {
      chrome.notifications.create("focusToggle", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: "Hardcore Mode Active",
        message: "Focus is locked until the pomodoro ends.",
        priority: 1
      });
      return;
    }
    const active = result.state.focusActive;
    chrome.notifications.create("focusToggle", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: active ? "Focus Mode On" : "Focus Mode Off",
      message: active ? "Distractions are now blocked." : "Focus session ended.",
      priority: 1
    });
  }
});

/* ── Message Handler ── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    console.error("Message handler error:", err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async
});

async function handleMessage(msg) {
  const { state, blocklist, stats } = await chrome.storage.local.get([
    "state",
    "blocklist",
    "stats"
  ]);
  const s = state || DEFAULT_STATE;
  const bl = blocklist || DEFAULT_BLOCKLIST;
  const st = stats || DEFAULT_STATS;

  switch (msg.type) {
    case "getState":
      return { state: s, blocklist: bl, stats: st };

    case "toggleFocus": {
      return await doToggleFocus();
    }

    case "startBreak": {
      // Hardcore mode: refuse break if locked
      if (s.hardcoreMode && s.hardcoreLockUntil && Date.now() < s.hardcoreLockUntil) {
        return { state: s, locked: true };
      }
      s.breakActive = true;
      s.breakEndTime = Date.now() + 300000; // 5 minutes
      chrome.alarms.create("breakEnd", { delayInMinutes: 5 });
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "endBreak": {
      s.breakActive = false;
      s.breakEndTime = null;
      chrome.alarms.clear("breakEnd");
      await chrome.storage.local.set({ state: s });
      chrome.runtime.sendMessage({ type: "breakEnded" }).catch(() => {});
      return { state: s };
    }

    case "updateBlocklist": {
      await chrome.storage.local.set({ blocklist: msg.blocklist });
      return { blocklist: msg.blocklist };
    }

    case "updateSettings": {
      Object.assign(s, msg.settings);
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "startPomodoro": {
      s.pomodoroRunning = true;
      s.pomodoroEndTime = Date.now() + s.pomodoroTime * 1000;
      // Set hardcore lock until pomodoro ends
      if (s.hardcoreMode) {
        s.hardcoreLockUntil = s.pomodoroEndTime;
      }
      chrome.alarms.create("pomodoroEnd", {
        delayInMinutes: s.pomodoroTime / 60
      });
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "stopPomodoro": {
      // Hardcore mode: refuse stopping pomodoro while locked
      if (s.hardcoreMode && s.hardcoreLockUntil && Date.now() < s.hardcoreLockUntil) {
        return { state: s, locked: true };
      }
      s.pomodoroRunning = false;
      s.pomodoroEndTime = null;
      s.hardcoreLockUntil = null;
      chrome.alarms.clear("pomodoroEnd");
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "hardcoreOverride": {
      return await doToggleFocus(true);
    }

    case "clearMilestone": {
      st.newMilestone = null;
      await chrome.storage.local.set({ stats: st });
      return { ok: true };
    }

    case "resetStats": {
      const fresh = { ...DEFAULT_STATS };
      await chrome.storage.local.set({ stats: fresh });
      return { stats: fresh };
    }

    default:
      return { error: "Unknown message type" };
  }
}

/* ── Startup: restore badge state ── */

(async () => {
  const { state } = await chrome.storage.local.get("state");
  if (state && state.focusActive) {
    updateBadge(true);
    // Re-register focus tick alarm
    chrome.alarms.create("focusTick", { periodInMinutes: 1 });
  }
  // Ensure weekly challenges exist
  ensureWeeklyChallenges();
})();
