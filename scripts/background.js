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
  focusGoal: 120
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
  dailyPomodoros: {},
  siteTime: {},
  hourlyBlocked: {},
  siteCategories: {}
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

/* ── Theme Broadcast ── */

function broadcastTheme(theme) {
  chrome.runtime.sendMessage({ type: "themeChanged", theme }).catch(() => {});
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "themeChanged", theme }).catch(() => {});
    }
  });
}

/* ── Site Time Tracking ── */

let activeTracking = { domain: null, startTime: null };

function categorizeDomain(domain, siteCategories) {
  if (!domain) return "neutral";
  if (siteCategories && siteCategories[domain]) return siteCategories[domain];
  for (const d of ALLOWED_DOMAINS) {
    if (domain === d || domain.endsWith("." + d)) return "productive";
  }
  for (const s of DEFAULT_BLOCKLIST) {
    if (domain === s.domain || domain.endsWith("." + s.domain)) return "distracting";
  }
  return "neutral";
}

function categorizeDomains(domains, siteCategories) {
  const result = {};
  for (const d of domains) {
    result[d] = categorizeDomain(d, siteCategories);
  }
  return result;
}

async function flushTracking() {
  if (!activeTracking.domain || !activeTracking.startTime) return;
  const elapsed = Math.round((Date.now() - activeTracking.startTime) / 60000);
  if (elapsed < 1) return;
  const d = today();
  const { stats } = await chrome.storage.local.get("stats");
  const s = stats || DEFAULT_STATS;
  if (!s.siteTime) s.siteTime = {};
  if (!s.siteTime[d]) s.siteTime[d] = {};
  s.siteTime[d][activeTracking.domain] = (s.siteTime[d][activeTracking.domain] || 0) + elapsed;
  await chrome.storage.local.set({ stats: s });
  activeTracking.startTime = Date.now();
}

function startTracking(domain) {
  if (!domain) {
    activeTracking = { domain: null, startTime: null };
    return;
  }
  activeTracking = { domain, startTime: Date.now() };
}

async function switchTracking(newDomain) {
  await flushTracking();
  startTracking(newDomain);
}

async function pruneOldData() {
  const { stats } = await chrome.storage.local.get("stats");
  if (!stats) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  let changed = false;
  for (const key of ["siteTime", "hourlyBlocked", "dailyFocus", "dailyBlocked"]) {
    if (!stats[key]) continue;
    for (const dateKey of Object.keys(stats[key])) {
      const dateOnly = dateKey.split("_")[0];
      if (dateOnly < cutoffStr) {
        delete stats[key][dateKey];
        changed = true;
      }
    }
  }
  if (changed) await chrome.storage.local.set({ stats });
}

// Tab switch listener
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const domain = stripDomain(tab.url);
    await switchTracking(domain);
  } catch { /* tab may not exist */ }
});

// Window focus change
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushTracking();
    activeTracking = { domain: null, startTime: null };
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) {
      const domain = stripDomain(tab.url);
      await switchTracking(domain);
    }
  } catch { /* ignore */ }
});

// Idle state change
chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === "idle" || newState === "locked") {
    await flushTracking();
    activeTracking = { domain: null, startTime: null };
  } else if (newState === "active") {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const domain = stripDomain(tab.url);
        startTracking(domain);
      }
    } catch { /* ignore */ }
  }
});

chrome.idle.setDetectionInterval(60);

/* ── Productivity Score ── */

function computeProductivityScore(siteTimeDay, siteCategories) {
  if (!siteTimeDay) return null;
  let productive = 0, distracting = 0;
  for (const [domain, mins] of Object.entries(siteTimeDay)) {
    const cat = categorizeDomain(domain, siteCategories);
    if (cat === "productive") productive += mins;
    else if (cat === "distracting") distracting += mins;
  }
  const total = productive + distracting;
  if (total === 0) return null;
  return Math.round((productive / total) * 100);
}

/* ── Initialization ── */

chrome.runtime.onInstalled.addListener(async () => {
  const { state, stats } = await chrome.storage.local.get(["state", "stats"]);
  await chrome.storage.local.set({
    state: { ...DEFAULT_STATE, ...state },
    stats: { ...DEFAULT_STATS, ...stats }
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
      // Increment blocked count + hourly tracking
      const { stats } = await chrome.storage.local.get("stats");
      const s = stats || DEFAULT_STATS;
      const d = today();
      s.dailyBlocked[d] = (s.dailyBlocked[d] || 0) + 1;
      s.blockedSites[site.domain] = (s.blockedSites[site.domain] || 0) + 1;
      if (!s.hourlyBlocked) s.hourlyBlocked = {};
      const hourKey = d + "_" + String(new Date().getHours()).padStart(2, "0");
      s.hourlyBlocked[hourKey] = (s.hourlyBlocked[hourKey] || 0) + 1;
      await chrome.storage.local.set({ stats: s });

      // Redirect to blocked page
      const blockedUrl = chrome.runtime.getURL(
        `pages/blocked.html?site=${encodeURIComponent(site.domain)}`
      );
      chrome.tabs.update(tabId, { url: blockedUrl });
      return;
    }
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkAndBlock(tabId, changeInfo.url);
    // Track site time on URL change in active tab
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        const domain = stripDomain(changeInfo.url);
        await switchTracking(domain);
      }
    } catch { /* ignore */ }
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    checkAndBlock(details.tabId, details.url);
  }
});

/* ── Focus Time Tracking ── */

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "trackingTick") {
    await flushTracking();
    pruneOldData();
    return;
  }

  if (alarm.name === "focusTick") {
    const { state, stats } = await chrome.storage.local.get(["state", "stats"]);
    if (!state || !state.focusActive) return;
    const s = stats || DEFAULT_STATS;
    const d = today();
    s.dailyFocus[d] = (s.dailyFocus[d] || 0) + 1;
    await chrome.storage.local.set({ stats: s });
    updateBadge(true);
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
    // Track daily pomodoros
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

function updateStreak(stats) {
  const d = today();
  if (stats.lastFocusDate === d) return; // Already counted today

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
}

/* ── Week Days Helper (used by getAnalyticsData) ── */

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

/* ── Core Toggle ── */

async function doToggleFocus() {
  const { state, stats } = await chrome.storage.local.get(["state", "stats"]);
  const s = state || DEFAULT_STATE;
  const st = stats || DEFAULT_STATS;

  s.focusActive = !s.focusActive;
  if (s.focusActive) {
    s.focusStartTime = Date.now();
    chrome.alarms.create("focusTick", { periodInMinutes: 1 });
    updateStreak(st);
    await chrome.storage.local.set({ stats: st });
  } else {
    s.focusStartTime = null;
    s.breakActive = false;
    s.breakEndTime = null;
    s.pomodoroRunning = false;
    s.pomodoroEndTime = null;
    chrome.alarms.clear("focusTick");
    chrome.alarms.clear("breakEnd");
    chrome.alarms.clear("pomodoroEnd");
    await chrome.storage.local.set({ state: s });
    updateBadge(false);
    return { state: s, stats: st };
  }
  await chrome.storage.local.set({ state: s });
  updateBadge(true);
  return { state: s, stats: st };
}

/* ── Keyboard Shortcut ── */

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-focus") {
    const result = await doToggleFocus();
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
      if (msg.settings.theme) {
        broadcastTheme(msg.settings.theme);
      }
      return { state: s };
    }

    case "startPomodoro": {
      s.pomodoroRunning = true;
      s.pomodoroEndTime = Date.now() + s.pomodoroTime * 1000;
      chrome.alarms.create("pomodoroEnd", {
        delayInMinutes: s.pomodoroTime / 60
      });
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "stopPomodoro": {
      s.pomodoroRunning = false;
      s.pomodoroEndTime = null;
      chrome.alarms.clear("pomodoroEnd");
      await chrome.storage.local.set({ state: s });
      return { state: s };
    }

    case "resetStats": {
      const fresh = { ...DEFAULT_STATS };
      await chrome.storage.local.set({ stats: fresh });
      return { stats: fresh };
    }

    case "getSiteTime": {
      const d = msg.date || today();
      return { siteTime: st.siteTime?.[d] || {}, siteCategories: st.siteCategories || {} };
    }

    case "updateSiteCategory": {
      if (!st.siteCategories) st.siteCategories = {};
      st.siteCategories[msg.domain] = msg.category;
      await chrome.storage.local.set({ stats: st });
      return { ok: true };
    }

    case "categorizeDomains": {
      return { categories: categorizeDomains(msg.domains || [], st.siteCategories || {}) };
    }

    case "getProductivityScore": {
      const d = msg.date || today();
      const score = computeProductivityScore(st.siteTime?.[d], st.siteCategories);
      return { score };
    }

    case "getWeeklyScores": {
      const days = getWeekDays();
      const scores = days.map(d => ({
        date: d,
        score: computeProductivityScore(st.siteTime?.[d], st.siteCategories)
      }));
      return { scores };
    }

    case "getAnalyticsData": {
      const d = msg.date || today();
      const days = getWeekDays();
      const siteTimeToday = st.siteTime?.[d] || {};
      const categories = categorizeDomains(Object.keys(siteTimeToday), st.siteCategories || {});
      const weeklyScores = days.map(dd => ({
        date: dd,
        score: computeProductivityScore(st.siteTime?.[dd], st.siteCategories)
      }));
      // Heatmap data: last 7 days x 24 hours
      const heatmap = {};
      for (const dd of days) {
        for (let h = 0; h < 24; h++) {
          const key = dd + "_" + String(h).padStart(2, "0");
          heatmap[key] = st.hourlyBlocked?.[key] || 0;
        }
      }
      return {
        siteTime: siteTimeToday,
        categories,
        score: computeProductivityScore(siteTimeToday, st.siteCategories),
        weeklyScores,
        heatmap,
        siteCategories: st.siteCategories || {},
        weekDays: days
      };
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
    chrome.alarms.create("focusTick", { periodInMinutes: 1 });
  }
  // Always-on tracking tick for site time and pruning
  chrome.alarms.create("trackingTick", { periodInMinutes: 1 });
  // Initialize tracking for current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) startTracking(stripDomain(tab.url));
  } catch { /* ignore */ }
})();
