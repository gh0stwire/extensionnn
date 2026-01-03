// content.js — robust extraction of opened mail body (SPA-safe)

/* -------------------- Helpers -------------------- */

function cleanMailBody(text) {
  if (!text) return "";
  return text
    .replace(/=+/g, "")
    .replace(/If you reply to mails received.*?\n/gi, "")
    .replace(/please take care.*?\n/gi, "")
    .replace(/NOT\*\*/gi, "")
    .replace(/To unsubscribe.*?\n/gi, "")
    .replace(/Your subscribed address.*?\n/gi, "")
    .replace(/automated message.*?\n/gi, "")
    .replace(/do not reply.*?\n/gi, "")
    .replace(/PLEASE READ BELOW.*?\n/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* -------------------- Core Extraction -------------------- */

function tryExtractMailBody() {
  let body = "";

  const iframes = Array.from(document.querySelectorAll("iframe"));
  for (const f of iframes) {
    try {
      const doc = f.contentDocument;
      if (!doc || !doc.body) continue;

      const text = doc.body.innerText?.trim() || "";
      if (text.length > body.length) body = text;
    } catch {}
  }

  if (!body) {
    const bodyEl = document.querySelector(
      "#message-content, .message-body, .preview-pane, .mail-body, article"
    );
    if (bodyEl) {
      const clone = bodyEl.cloneNode(true);
      clone.querySelectorAll("script, style, iframe").forEach(n => n.remove());
      body = clone.innerText.trim();
    }
  }

  return body ? cleanMailBody(body) : null;
}

/* -------------------- Wait Logic -------------------- */

function waitForMailBody(maxAttempts = 10, interval = 300) {
  return new Promise(resolve => {
    let attempts = 0;

    const timer = setInterval(() => {
      const body = tryExtractMailBody();
      attempts++;

      if (body) {
        clearInterval(timer);
        resolve(body);
      } else if (attempts >= maxAttempts) {
        clearInterval(timer);
        resolve(null);
      }
    }, interval);
  });
}

function findReplyButton(root = document) {
  // STRICT: only "Reply to sender"
  return root.querySelector(
    'a.reply[title="Reply to sender"], a.reply#rcmbtn124'
  );
}


function findReplyEditor(root = document) {
  return (
    root.querySelector('textarea#composebody') ||
    root.querySelector('textarea[name="_message"]') ||
    root.querySelector('textarea[name="body"]') ||
    root.querySelector('textarea')
  );
}


function fillReplyEditor(replyText) {

  // 1️⃣ Find the REAL reply button (from your DOM dump)
  const replyBtn = document.querySelector(
    'a.reply[title="Reply to sender"]'
  );

  if (!replyBtn) {
    console.warn("Reply button not found");
    return;
  }

  // 2️⃣ Trigger Roundcube reply exactly as UI does
  replyBtn.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window
    })
  );

  // 3️⃣ Wait for compose view + editor
  let attempts = 0;
  const maxAttempts = 20;

  const timer = setInterval(() => {
    attempts++;

    // Roundcube compose editor locations
    const editor =
      document.querySelector('textarea#composebody') ||
      document.querySelector('textarea[name="_message"]') ||
      document.querySelector('textarea[name="body"]');

    if (editor) {
      editor.focus();
      editor.value = replyText;
      editor.selectionStart = editor.selectionEnd = editor.value.length;
      clearInterval(timer);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(timer);
      console.warn("Compose editor not found after reply");
    }
  }, 300);
}





/* -------------------- Message Handler -------------------- */

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {

  /* ---------- Existing: mail extraction ---------- */
  if (req?.type === "GET_OPENED_MAIL") {
    waitForMailBody().then(body => {
      if (!body) {
        sendResponse({ ok: false, error: "No opened mail detected" });
        return;
      }

      sendResponse({
        ok: true,
        mail: { body }
      });
    });

    return true;
  }

  /* ---------- NEW: fill reply ---------- */
  if (req?.type === "FILL_REPLY") {
    fillReplyEditor(req.replyText);
  }
});

