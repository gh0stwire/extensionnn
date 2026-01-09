// background.js
// MV3-safe background service worker
// Gemini Proxy + Google Calendar Handler
// ⚠️ TEMPORARY: hard-coded API keys (internal/demo use only)

const GEMINI_API_KEY = "pastekey";
let cachedToken = null;
/* -------------------- Message Router -------------------- */

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "GEMINI_SUMMARY") {
    handleGeminiProxy(req, sendResponse);
    return true; // ⛔ REQUIRED for async response
  }

  if (req.type === "ADD_CALENDAR_EVENT") {
    handleCalendarFlow(req.eventData);
    // No sendResponse needed (fire-and-forget)
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

/* -------------------- Gemini Logic (UNCHANGED BEHAVIOR) -------------------- */

function handleGeminiProxy(req, sendResponse) {
  fetch(req.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: req.prompt }]
        }
      ]
    })
  })
    .then(res => res.json())
    .then(json => {
      const text =
        json?.candidates?.[0]?.content?.parts
          ?.map(p => p.text)
          .join("\n") || "No summary";

      sendResponse({ ok: true, text });
    })
    .catch(err => {
      sendResponse({ ok: false, error: String(err) });
    });
}

/* -------------------- Google Calendar Logic -------------------- */

async function handleCalendarFlow(eventData) {
  // 1. Try to get token from persistent storage first
  const data = await chrome.storage.local.get(['sessionToken']);
  let token = data.sessionToken;

  if (token) {
    console.log("Using persistent token from storage");
    executeCalendarInsert(token, eventData);
    return;
  }

  // 2. If no token in storage, launch the flow
  const clientId = "451389975470-e42fi26fo0gbde0d9ppafei19ctk63nb.apps.googleusercontent.com";
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scopes = encodeURIComponent("https://www.googleapis.com/auth/calendar.events");

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${clientId}` +
    `&response_type=token` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${scopes}&prompt=select_account`;

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        console.error("Auth failed:", chrome.runtime.lastError);
        return;
      }

      const params = new URLSearchParams(new URL(redirectUrl).hash.substring(1));
      const newToken = params.get("access_token");
      
      if (newToken) {
        // SAVE TOKEN TO PERSISTENT STORAGE
        await chrome.storage.local.set({ sessionToken: newToken });
        executeCalendarInsert(newToken, eventData);
      }
    }
  );
}
async function executeCalendarInsert(token, data) {
  const originalTime = data.time || "09:00";
  const eventDate = new Date(`${data.date}T${originalTime}:00`);

  // 10 minutes early buffer
  const startTime = new Date(eventDate.getTime() - 10 * 60000);
  const endTime = eventDate;

  const event = {
    summary: `[Early] ${data.title}`,
    description: data.description || "Added via IITB Mail Assistant",
    start: {
      dateTime: startTime.toISOString(),
      timeZone: "Asia/Kolkata"
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: "Asia/Kolkata"
    }
  };

  try {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(event)
      }
    );

    if (res.status === 401) {
      // Token expired! Wipe storage so the next click triggers a fresh login
      await chrome.storage.local.remove('sessionToken');
      console.warn("Token expired. Storage cleared. Please try again.");
      return;
    }

    if (res.ok) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Event Scheduled",
        message: `Added: ${data.title}`
      });
    }
  } catch (err) {
    console.error("Calendar Insert Error:", err);
  }
}
