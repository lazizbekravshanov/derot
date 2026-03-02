/* ── derot Page Cleanup Content Script ── */

/* ── Allowlist — never clean up learning & productivity platforms ── */

const CLEANUP_ALLOWED = [
  "chatgpt.com", "chat.openai.com", "openai.com",
  "claude.ai", "anthropic.com",
  "gemini.google.com", "bard.google.com",
  "copilot.microsoft.com", "perplexity.ai",
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

(async function () {
  const host = location.hostname.replace(/^www\./, "");
  for (const allowed of CLEANUP_ALLOWED) {
    if (host === allowed || host.endsWith("." + allowed)) return;
  }

  const { state } = await chrome.storage.local.get("state");
  if (!state?.focusActive || !state?.cleanupEnabled) return;

  applyCleanup();

  /* ── Watch for state changes ── */
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.state) return;
    const newState = changes.state.newValue;
    if (newState?.focusActive && newState?.cleanupEnabled) {
      applyCleanup();
    } else {
      removeCleanup();
    }
  });

  function applyCleanup() {
    if (document.documentElement.classList.contains("derot-cleanup-active")) return;

    document.documentElement.classList.add("derot-cleanup-active");

    // Build combined selectors
    const selectors = [
      ...getGenericSelectors(),
      ...getSiteSelectors()
    ];

    if (selectors.length === 0) return;

    const style = document.createElement("style");
    style.id = "derot-cleanup-style";
    style.textContent = selectors.join(",\n") + " { display: none !important; }";
    document.head.appendChild(style);

    // Pause autoplay videos
    pauseAutoplayVideos();
    observeAutoplayVideos();
  }

  function removeCleanup() {
    document.documentElement.classList.remove("derot-cleanup-active");
    const style = document.getElementById("derot-cleanup-style");
    if (style) style.remove();
  }

  function getGenericSelectors() {
    return [
      // Ads
      '[id*="ad-"]',
      '[class*="ad-container"]',
      "ins.adsbygoogle",
      '[class*="sponsored"]',
      "[data-ad]",
      // Cookie popups
      '[class*="cookie-banner"]',
      '[class*="cookie-consent"]',
      '[id*="cookie"]',
      '[class*="gdpr"]',
      "#CybotCookiebotDialog",
      '[class*="cc-banner"]',
      // Notification prompts
      '[class*="notification-badge"]',
      '[class*="push-notification"]',
      '[class*="newsletter-popup"]',
      '[class*="subscribe-popup"]',
      // Chat widgets
      '[id*="intercom"]',
      '[class*="drift-"]',
      "#hubspot-messages-iframe-container",
      '[class*="crisp-client"]'
    ];
  }

  function getSiteSelectors() {
    const host = location.hostname.replace(/^www\./, "");
    const siteRules = {
      "youtube.com": [
        "#secondary",
        "ytd-ad-slot-renderer",
        "#related",
        "ytd-promoted-sparkles-web-renderer",
        "#masthead-ad",
        "#guide"
      ],
      "google.com": [
        "#rhs",
        ".commercial-unit-desktop",
        "#tads",
        "#bottomads"
      ],
      "linkedin.com": [
        ".ad-banner-container",
        ".right-rail-card"
      ],
      "stackoverflow.com": [
        "#sidebar",
        ".s-sidebarwidget"
      ],
      "github.com": [
        '[class*="feed-"]',
        ".dashboard-sidebar"
      ]
    };

    for (const [domain, selectors] of Object.entries(siteRules)) {
      if (host === domain || host.endsWith("." + domain)) {
        return selectors;
      }
    }

    return [];
  }

  function pauseAutoplayVideos() {
    document.querySelectorAll("video[autoplay]").forEach((video) => {
      video.pause();
      video.removeAttribute("autoplay");
    });
  }

  function observeAutoplayVideos() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "VIDEO" && node.hasAttribute("autoplay")) {
            node.pause();
            node.removeAttribute("autoplay");
          }
          node.querySelectorAll?.("video[autoplay]").forEach((v) => {
            v.pause();
            v.removeAttribute("autoplay");
          });
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
