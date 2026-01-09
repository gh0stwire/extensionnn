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

// Check on every load if there's a pending injection
chrome.storage.local.get(['pendingCompose'], (result) => {
  if (result.pendingCompose) {
    const { subject, body, timestamp } = result.pendingCompose;
    // Only inject if the request is fresh (less than 30 seconds old)
    if (Date.now() - timestamp < 30000) {
      handleNewComposeInjection(subject, body);
    }
    // Clear it so it doesn't double-inject
    chrome.storage.local.remove('pendingCompose');
  }
});

function handleNewComposeInjection(subject, body) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    
    const subjectField = document.querySelector('input[name="_subject"]');
    const bodyIframe = document.getElementById('composebody_ifr'); // TinyMCE Iframe
    const bodyTextarea = document.getElementById('composebody');

    if (subjectField && (bodyIframe || bodyTextarea)) {
      // 1. Fill Subject
      subjectField.value = subject;

      // 2. Fill Body
      if (bodyIframe) {
        try {
          const doc = bodyIframe.contentDocument || bodyIframe.contentWindow.document;
          // Convert newlines to <br> because this is an HTML editor
          doc.body.innerHTML = body.replace(/\n/g, '<br>');
        } catch (e) { console.error("Iframe access blocked", e); }
      } else {
        bodyTextarea.value = body;
      }

      clearInterval(timer);
    }

    if (attempts > 50) clearInterval(timer);
  }, 500);
}

// Keep your existing message listener but add the storage fallback
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "COMPOSE_NEW_MAIL") {
    handleNewComposeInjection(req.subject, req.body);
    sendResponse({ ok: true });
  }
});

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

async function injectNewCompose(subject, body) {
  // 1. Locate the "Compose" button and click it
  const composeBtn = document.getElementById('rcmbtn107') || 
                     document.querySelector('a.compose[title="Create a new message"]');
  
  if (composeBtn) {
    composeBtn.click();
  } else {
    console.error("IITB Assistant: Could not find Compose button.");
    return;
  }

  // 2. Wait for the editor fields to load (Polling)
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    
    const subjectField = document.getElementById('compose-subject') || 
                         document.querySelector('input[name="_subject"]');
    
    // Check for the TinyMCE Iframe (HTML mode)
    const bodyIframe = document.getElementById('composebody_ifr');
    // Check for the Standard Textarea (Plain text mode)
    const bodyTextarea = document.getElementById('composebody');

    if (subjectField && (bodyIframe || bodyTextarea)) {
      clearInterval(timer);

      // Fill Subject
      subjectField.value = subject || "";

      // Fill Body
      if (bodyIframe) {
        try {
          const doc = bodyIframe.contentDocument || bodyIframe.contentWindow.document;
          // Convert newlines to <br> for TinyMCE HTML mode
          const htmlBody = (body || "").replace(/\n/g, '<br>');
          doc.body.innerHTML = htmlBody;
        } catch (e) {
          console.error("Failed to inject into HTML editor:", e);
        }
      } else if (bodyTextarea) {
        bodyTextarea.value = body || "";
      }
      
      console.log("IITB Assistant: Fields injected successfully.");
    }

    if (attempts > 30) {
      clearInterval(timer);
      console.warn("IITB Assistant: Timeout waiting for compose fields.");
    }
  }, 500);
}



/* -------------------- Message Handler -------------------- */

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {

  /* ---------- mail extraction ---------- */
  if (req?.type === "GET_OPENED_MAIL") {
    waitForMailBody().then(body => {
      if (!body) {
        sendResponse({ ok: false, error: "No opened mail detected" });
        return;
      }
      sendResponse({ ok: true, mail: { body } });
    });
    return true; 
  }

  /* ---------- fill reply ---------- */
  if (req?.type === "FILL_REPLY") {
    fillReplyEditor(req.replyText);
    sendResponse({ ok: true });
  }

  /* ---------- Inject New Compose ---------- */
  if (req?.type === "COMPOSE_NEW_MAIL") {
    injectNewCompose(req.subject, req.body);
    sendResponse({ ok: true });
  }

  return true;
});

