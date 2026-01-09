// background.js
// MV3-safe background service worker
// Gemini Proxy + Google Calendar Handler
// ⚠️ TEMPORARY: hard-coded API keys (internal/demo use only)

const GEMINI_API_KEY = "AIzaSyA6e0WiWC3VNvH2pJsQ_JN2qjPQlpl3oj4";

/* -------------------- Message Router -------------------- */

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "GEMINI_SUMMARY") {
    handleGeminiProxy(req, sendResponse);
    return true; // ⛔ REQUIRED for async response
  }

  if (req.type === "ADD_CALENDAR_EVENT") {
    // UPDATED: Now passes req.cardId to the flow
    handleCalendarFlow(req.eventData, req.cardId);
  }

  // NEW: Handler for updating existing events to prevent duplicates
  if (req.type === "UPDATE_CALENDAR_EVENT") {
    handleCalendarFlow(req.eventData, req.cardId, req.eventId);
  }
});

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

// MODIFIED: Now accepts optional eventId to differentiate between Insert and Update
async function handleCalendarFlow(eventData, cardId, eventId = null) {
  const clientId = "451389975470-e42fi26fo0gbde0d9ppafei19ctk63nb.apps.googleusercontent.com";
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scopes = encodeURIComponent("https://www.googleapis.com/auth/calendar.events");

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${clientId}` +
    `&response_type=token` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${scopes}`;

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    redirectUrl => {
      if (chrome.runtime.lastError || !redirectUrl) {
        console.error("Auth failed:", chrome.runtime.lastError);
        // UPDATED: Notify popup of Auth failure with specific cardId
        chrome.runtime.sendMessage({ 
          type: "CALENDAR_RESULT", 
          status: "error", 
          message: "Google login failed or was cancelled.",
          cardId: cardId 
        });
        return;
      }

      const params = new URLSearchParams(
        new URL(redirectUrl).hash.substring(1)
      );

      const token = params.get("access_token");
      if (token) {
        // UPDATED: Now passes cardId and eventId to the execute function
        executeCalendarInsert(token, eventData, cardId, eventId);
      }
    }
  );
}

async function executeCalendarInsert(token, data, cardId, eventId = null) {
  const originalTime = data.time || "09:00";
  const eventDate = new Date(`${data.date}T${originalTime}:00`);

  // 30 minutes early buffer
  const startTime = new Date(eventDate.getTime() - 30 * 60000);
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

  // Logic: Use PATCH if eventId exists (Update), otherwise POST (Create)
  const url = eventId 
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  
  const method = eventId ? "PATCH" : "POST";

  try {
    const res = await fetch(url, {
        method: method,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(event)
      }
    );

    if (res.ok) {
      const savedEvent = await res.json();
      
      // UPDATED: Notify popup of Success and SEND BACK the eventId
      chrome.runtime.sendMessage({ 
        type: "CALENDAR_RESULT", 
        status: "success", 
        cardId: cardId,
        eventId: savedEvent.id 
      });

      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: eventId ? "Event Updated" : "Event Scheduled (30m early)",
        message: `Set for ${startTime.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        })}`,
        priority: 2
      });
    } else {
      // UPDATED: Notify popup of API failure with specific cardId
      const errorInfo = await res.json();
      chrome.runtime.sendMessage({ 
        type: "CALENDAR_RESULT", 
        status: "error", 
        message: errorInfo.error?.message || "Google Calendar rejected the event.",
        cardId: cardId 
      });
    }
  } catch (err) {
    console.error("Calendar Insert Error:", err);
    // UPDATED: Notify popup of Network failure with specific cardId
    chrome.runtime.sendMessage({ 
      type: "CALENDAR_RESULT", 
      status: "error", 
      message: "Network error. Could not connect to Google Calendar.",
      cardId: cardId 
    });
  }
}