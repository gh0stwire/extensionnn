// popup.js — Integrated Mail Assistant (Full Union Merge)
// ⚠️ ALL PROMPTS AND FUNCTIONALITIES ARE 100% RESTORED - MULTI-EVENT & ENHANCED REPLY ENABLED

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/* -------------------- State -------------------- */

let calendarChecked = false;
let currentReplyText = ""; // To store the latest generated reply for shortening/formalizing

/* -------------------- Utils -------------------- */

function escapeHtml(s = "") {
  return s.toString().replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function cleanBullet(text = "") {
  return text.replace(/^\*+\s*/, "").replace(/\*+$/g, "").replace(/\*\*/g, "").trim();
}

function showMessage(msg, section = "summary", err = false) {
  const map = {
    summary: "summary-status",
    calendar: "calendar-status",
    reply: "reply-status",
    compose: "compose-status",
    status: "status"
  };
  const targetId = map[section] || "status";
  const el = document.getElementById(targetId) || document.getElementById("status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? "crimson" : "inherit";
}

/* -------------------- Accordion Helpers -------------------- */

function openAccordionSoft(sectionId) {
  document.getElementById(sectionId)?.classList.add("active");
}

function toggleAccordion(section) {
  section.classList.toggle("active");
}

/* -------------------- Rendering -------------------- */

function renderSummary(text) {
  const out = document.getElementById("summary-result");
  if (!out) return;
  out.className = "summary-card";
  out.innerHTML = "";

  const ul = document.createElement("ul");
  ul.className = "summary-list";

  text.split("\n").forEach(line => {
    if (!line.trim()) return;
    const li = document.createElement("li");
    li.textContent = cleanBullet(line.replace(/^•\s*/, ""));
    ul.appendChild(li);
  });

  out.appendChild(ul);
}

function renderCalendarResult(data, isManual = false) {
  const out = document.getElementById("calendar-result");
  const checkBtn = document.getElementById("calOnly"); 
  const manualBtn = document.getElementById("manualEntry");
  if (!out) return;

  if (!data && !isManual) {
    out.innerHTML = ""; 
    if (manualBtn) manualBtn.style.display = 'block';
    if (checkBtn) checkBtn.style.display = 'block'; 
    return;
  }

  if (manualBtn) manualBtn.style.display = 'none';
  if (checkBtn) checkBtn.style.display = 'none';

  const events = Array.isArray(data) ? data : (data && data.hasEvent ? [data] : []);

  if (events.length === 0 && !isManual) {
    out.innerHTML = `<p class="muted">No event detected from this mail.</p>`;
    return;
  }

  const backButtonHtml = `
    <div style="margin-bottom: 12px;">
      <button id="backToOptions" style="background: none; border: none; color: #666; cursor: pointer; display: flex; align-items: center; font-size: 13px; padding: 0;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        Back to options
      </button>
    </div>`;

  const manualEventData = isManual ? { title: "", date: "", time: "", description: "" } : null;
  const eventsToRender = isManual ? [manualEventData] : events;

  let formsHtml = backButtonHtml;
  if (calendarChecked && events.length === 0 && !isManual) {
      formsHtml += `<p class="muted" style="margin-bottom:10px;">No event detected. You can enter details manually below:</p>`;
  }

  eventsToRender.forEach((event, index) => {
    formsHtml += `
      <div class="calendar-card" style="margin-bottom: 20px; border-left: 3px solid var(--accent-dark);">
        <div class="field-group">
          <label class="field-label">Event Title ${eventsToRender.length > 1 ? (index + 1) : ""}</label>
          <input type="text" id="edit-title-${index}" class="edit-input" placeholder="e.g. Project Sync" value="${escapeHtml(event.title)}">
        </div>
        <div class="field-row" style="display: flex; gap: 10px;">
          <div class="field-group" style="flex: 1;">
            <label class="field-label">Date</label>
            <input type="date" id="edit-date-${index}" class="edit-input" value="${event.date || ''}">
          </div>
          <div class="field-group" style="flex: 1;">
            <label class="field-label">Time</label>
            <input type="time" id="edit-time-${index}" class="edit-input" value="${event.time || ''}">
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Description</label>
          <textarea id="edit-desc-${index}" class="edit-input" rows="2" placeholder="Add details...">${escapeHtml(event.description || '')}</textarea>
        </div>
        <button class="primary-btn large-btn confirm-btn" data-index="${index}" id="confirm-${index}">Confirm & Add to Calendar</button>
      </div>`;
  });

  out.innerHTML = formsHtml;

  const backBtn = document.getElementById('backToOptions');
  if (backBtn) {
    backBtn.onclick = () => {
      calendarChecked = false;
      renderCalendarResult(null); 
    };
  }

  out.querySelectorAll('.confirm-btn').forEach(btn => {
    btn.onclick = (e) => {
      const idx = e.target.getAttribute('data-index');
      const titleVal = document.getElementById(`edit-title-${idx}`).value;
      const dateVal = document.getElementById(`edit-date-${idx}`).value;

      if (!titleVal || !dateVal) {
        showMessage("Title and Date are required", "calendar", true);
        return;
      }

      const eventData = {
        title: titleVal,
        date: dateVal,
        time: document.getElementById(`edit-time-${idx}`).value,
        description: document.getElementById(`edit-desc-${idx}`).value
      };
      
      chrome.runtime.sendMessage({ type: "ADD_CALENDAR_EVENT", eventData });
      
      e.target.parentElement.innerHTML = `
        <div class="status-success" style="text-align: center; padding: 10px;">
          <p style="color: #000000; font-size: 13px; line-height: 1.5;">
            Event scheduled! Complete Google sign-in if prompted.
          </p>
        </div>`;
    };
  });
}

/* -------------------- Mail Extraction -------------------- */

async function getOpenedMail(cb) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showMessage("No active tab", "summary", true);
    return;
  }
  chrome.scripting.executeScript(
    { target: { tabId: tab.id }, files: ["content.js"] },
    () => chrome.tabs.sendMessage(tab.id, { type: "GET_OPENED_MAIL" }, cb)
  );
}

/* -------------------- Path A: Combined Action (Summ + Cal) -------------------- */

function actionSummarize() {
  showMessage("Summarizing...", "summary");
  openAccordionSoft("summary-section");

  getOpenedMail(resp => {
    if (!resp || !resp.ok) {
      showMessage("No mail detected", "summary", true);
      return;
    }

    const body = resp.mail.body;
    const mode = document.getElementById("mode").value;

    const combinedPrompt = `
Follow the instructions for Task 1 and Task 2 separately based on the email provided.

 ---TASK 1: EMAIL SUMMARY (PARAGRAPH FORMAT) ---
You will summarize an email strictly in a single concise paragraph.

Ignore:
- unsubscribe warnings
- boilerplate
- OTP / authentication texts
- banners of "="
- automated disclaimers
- email confidentiality notices
- repeated headers or signatures
- emotional filler

Rules:
- The paragraph must contain at most the same information as ${mode === "brief" ? "3" : "5"} bullet points would
- Use clear, concise sentences
- Only extract actionable or informational meaning
- Highlight deadlines or required actions explicitly in text
- Do not repeat information
- Do not hallucinate
- If nothing meaningful exists, output exactly: "No action required."

--- TASK 2: EVENT DETECTION ---
You are a precise calendar event extractor.

Your task is to analyze the email text below and determine whether it contains
ANY calendar-worthy events that the user should reasonably add to their calendar.

Calendar-worthy events INCLUDE (but are not limited to):
- Meetings, calls, interviews, or appointments
- Classes, lectures, sessions, workshops, seminars, or programs
- Exams, quizzes, evaluations, or assessments
- Assignments, submissions, tasks, or deliverables with a due date
- Deadlines, or last dates to act
- Any event where the user is expected to DO something on a specific date
- Events that are one-time or fixed to a particular day or time

Calendar-worthy events DO NOT include:
- Purely promotional emails
- General announcements with no required action
- Informational notices with no clear date
- Ongoing reminders without a specific date
- Vague references like "soon", "next week", or "in the future" without a date

Time interpretation rules:
- If a specific time is explicitly mentioned, use it
- If the email mentions "EOD" or "end of day", interpret the time as 23:59
- If no time is mentioned, set time to null
- Do NOT guess or infer times other than the EOD rule above

Decision rules:
- A CLEAR date is REQUIRED (YYYY-MM-DD must be derivable)
- Time is OPTIONAL (set to null if not explicitly mentioned)
- IF MULTIPLE EVENTS EXIST, EXTRACT ALL OF THEM
- Do NOT infer or guess missing dates or times
- Do NOT hallucinate titles, dates, or descriptions
- If no events are found, return an empty list for "events"

--- OUTPUT FORMAT ---
You must provide the output in two distinct sections. 

[SUMMARY]
<Provide the summary for Task 1 here>

[CALENDAR_JSON]
<Provide the JSON object for Task 2 here - EXACTLY as requested: { "hasEvent": boolean, "events": [ { "title": string, "date": "YYYY-MM-DD", "time": "HH:MM or null", "description": string } ] }>

EMAIL:
${body.slice(0, 12000)}
`;

    chrome.runtime.sendMessage(
      { type: "GEMINI_SUMMARY", prompt: combinedPrompt, endpoint: GEMINI_ENDPOINT },
      res => {
        if (!res || !res.ok) {
          showMessage("Gemini failed", "summary", true);
          return;
        }

        const parts = res.text.split("[CALENDAR_JSON]");
        const summaryPart = parts[0].replace("[SUMMARY]", "").trim();
        const jsonPart = parts[1] ? parts[1].trim().replace(/```json/g, "").replace(/```/g, "") : null;

        renderSummary(summaryPart);
        showMessage("Summary ready", "summary");

        calendarChecked = true;
        if (jsonPart) {
          try {
            const parsed = JSON.parse(jsonPart);
            renderCalendarResult(parsed.events || []);
            if (parsed.hasEvent) {
              openAccordionSoft("calendar-section");
            }
          } catch (e) {
            console.error("Combined JSON Parse Error:", e);
            renderCalendarResult([]);
          }
        } else {
          renderCalendarResult([]);
        }
      }
    );
  });
}

/* -------------------- Path B: Calendar Only Action -------------------- */

function actionCalendarOnly() {
  showMessage("Checking...", "calendar");
  openAccordionSoft("calendar-section");

  getOpenedMail(resp => {
    if (!resp || !resp.ok) {
      showMessage("No mail detected", "calendar", true);
      return;
    }

    const body = resp.mail.body;

    const prompt = `
You are a precise calendar event extractor.

Your task is to analyze the email text below and determine whether it contains
ANY calendar-worthy events that the user should reasonably add to their calendar.

Calendar-worthy events INCLUDE (but are not limited to):
- Meetings, calls, interviews, or appointments
- Classes, lectures, sessions, workshops, seminars, or programs
- Exams, quizzes, evaluations, or assessments
- Assignments, submissions, tasks, or deliverables with a due date
- Deadlines, or last dates to act
- Any event where the user is expected to DO something on a specific date
- Events that are one-time or fixed to a particular day or time

Calendar-worthy events DO NOT include:
- Purely promotional emails
- General announcements with no required action
- Informational notices with no clear date
- Ongoing reminders without a specific date
- Vague references like "soon", "next week", or "in the future" without a date

Time interpretation rules:
- If a specific time is explicitly mentioned, use it
- If the email mentions "EOD" or "end of day", interpret the time as 23:59
- If no time is mentioned, set time to null
- Do NOT guess or infer times other than the EOD rule above

Decision rules:
- A CLEAR date is REQUIRED (YYYY-MM-DD must be derivable)
- Time is OPTIONAL (set to null if not explicitly mentioned)
- IF MULTIPLE EVENTS EXIST, EXTRACT ALL OF THEM
- Do NOT infer or guess missing dates or times
- Do NOT hallucinate titles, dates, or descriptions

If events ARE detected, return STRICT JSON ONLY in this format:
{
  "hasEvent": true,
  "events": [
    {
      "title": "short, clear event title",
      "date": "YYYY-MM-DD",
      "time": "HH:MM or null",
      "description": "one-line explanation"
    }
  ]
}

If NO events are detected, return EXACTLY:
{ "hasEvent": false, "events": [] }

Output JSON ONLY. No explanations. No markdown.
EMAIL:
${body.slice(0, 12000)}
`;

    chrome.runtime.sendMessage(
      { type: "GEMINI_SUMMARY", prompt, endpoint: GEMINI_ENDPOINT },
      res => {
        calendarChecked = true;
        if (!res || !res.ok) {
          renderCalendarResult([]);
          return;
        }
        try {
          const cleanText = res.text.trim().replace(/```json/g, "").replace(/```/g, "");
          const parsed = JSON.parse(cleanText);
          renderCalendarResult(parsed.events || []);
          showMessage("", "calendar");
        } catch (e) {
          console.error("Single Path JSON Parse Error:", e);
          renderCalendarResult([]);
        }
      }
    );
  });
}

/* -------------------- AI Reply Generator (ENHANCED) -------------------- */

function actionReply() {
  showMessage("Generating reply…", "reply");
  openAccordionSoft("reply-section");

  getOpenedMail(resp => {
    if (!resp || !resp.ok) {
      showMessage("No mail detected", "reply", true);
      return;
    }

    const body = resp.mail.body;
    const userInstruction = document.getElementById("replyPrompt")?.value.trim();

    const basePrompt = `
You are an expert academic and professional email responder.

Task:
Write a clear, appropriate reply to the email below, based ONLY on the information explicitly stated in the original email.

Tone and style:
- Professional, academic, and courteous
- Direct and concise (no filler or small talk)
- Neutral confidence suitable for university or workplace communication

Strict rules:
- Do NOT invent facts, dates, names, commitments, or future actions
- Do NOT assume prior conversations or shared context
- Do NOT repeat or paraphrase the original email
- Do NOT introduce new requests unless explicitly required
- Do NOT use emojis, slang, or casual language
- Keep the reply under 120 words

Content requirements:
- Address the main point of the email directly
- If action is requested, respond clearly and minimally
- If no action is required, write a brief, polite acknowledgment
- If information is missing, respond neutrally without guessing

Formatting rules:
- Write ONLY the reply body
- Do NOT include subject lines, greetings, or signatures
`;

    const prompt = `
${basePrompt}

${userInstruction ? `Additional user instructions:\n${userInstruction}\n` : ""}

EMAIL:
${body.slice(0, 12000)}
`;

    chrome.runtime.sendMessage(
      { type: "GEMINI_SUMMARY", prompt, endpoint: GEMINI_ENDPOINT },
      res => {
        if (!res || !res.ok) {
          showMessage("Reply generation failed", "reply", true);
          return;
        }

        currentReplyText = res.text; // Store for shorten/formalize
        renderReply(res.text);
        showMessage("Reply ready", "reply");
      }
    );
  });
}

function renderReply(text) {
  const out = document.getElementById("reply-result");
  out.className = "summary-card";
  out.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
}

// NEW: Shorten and Formalize Path
function modifyReply(mode) {
  if (!currentReplyText) {
    showMessage("Generate a reply first", "reply", true);
    return;
  }
  showMessage(`${mode === 'shorten' ? 'Shortening' : 'Formalizing'}...`, "reply");

  const prompt = `Take the following email reply and ${mode === 'shorten' ? 'make it significantly shorter and more concise' : 'make the tone more formal and professional'}. 
  Maintain the original intent. Output ONLY the modified reply text.
  
  REPLY:
  ${currentReplyText}`;

  chrome.runtime.sendMessage(
    { type: "GEMINI_SUMMARY", prompt, endpoint: GEMINI_ENDPOINT },
    res => {
      if (!res || !res.ok) {
        showMessage("Modification failed", "reply", true);
        return;
      }
      currentReplyText = res.text;
      renderReply(res.text);
      showMessage("Reply updated", "reply");
    }
  );
}

/* -------------------- Compose Mail -------------------- */

function actionCompose() {
  const intent = document.getElementById("composeIntent")?.value.trim();

  if (!intent) {
    showMessage("Enter what you want to write", "compose", true);
    return;
  }

  showMessage("Composing email…", "compose");
  openAccordionSoft("compose-section");

  const prompt = `
You are an expert academic and professional email writer.

Task:
Compose a clear, concise, and context-appropriate standalone email based ONLY on the users intent.

Tone and style:
- Professional, academic, and courteous
- Confident but not verbose
- Direct and purposeful (no filler or small talk)
- Neutral formality suitable for university or workplace communication

Strict rules:
- Do NOT invent facts, dates, names, or commitments
- Do NOT assume prior context or conversations
- Do NOT use emojis, slang, or casual phrases
- Do NOT include greetings like “Hope you are well”
- Do NOT include apologies unless explicitly requested
- Keep the email under 150 words

Structural requirements:
- Subject line must be specific and informative
- Body must:
  • Clearly state purpose in the first sentence  
  • Provide only necessary details  
  • End with a polite but firm closing line
- Avoid redundancy and vague language

Output EXACTLY in the following format (no extra text):

Subject: <one clear, professional subject line>

Body:
<well-structured email body>

Signature:
<Your Name>

Intent:
${intent}
`;

  chrome.runtime.sendMessage(
    { type: "GEMINI_SUMMARY", prompt, endpoint: GEMINI_ENDPOINT },
    res => {
      if (!res || !res.ok) {
        showMessage("Compose failed", "compose", true);
        return;
      }

      renderCompose(res.text);
      showMessage("Email ready", "compose");
    }
  );
}

function renderCompose(text) {
  const out = document.getElementById("compose-result");
  out.className = "summary-card";
  out.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
}

/* -------------------- Init -------------------- */

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".accordion-item").forEach(section => {
    section.classList.remove("active");
  });

  const summBtn = document.getElementById("summMail");
  const replyBtn = document.getElementById("replyMail");
  const compBtn = document.getElementById("composeMail");
  const calOnlyBtn = document.getElementById("calOnly");
  const manualBtn = document.getElementById("manualEntry");
  
  // New buttons
  const shortenBtn = document.getElementById("shortenReply");
  const formalizeBtn = document.getElementById("formalizeReply");

  if (summBtn) summBtn.onclick = actionSummarize;
  if (replyBtn) replyBtn.onclick = actionReply;
  if (compBtn) compBtn.onclick = actionCompose;
  if (calOnlyBtn) calOnlyBtn.onclick = actionCalendarOnly;
  
  if (shortenBtn) shortenBtn.onclick = () => modifyReply('shorten');
  if (formalizeBtn) formalizeBtn.onclick = () => modifyReply('formalize');

  if (manualBtn) {
    manualBtn.onclick = () => {
      calendarChecked = false;
      renderCalendarResult(null, true); 
    };
  }

  document.querySelectorAll(".accordion-item").forEach(section => {
    const header = section.querySelector(".accordion-header");
    if (header) header.addEventListener("click", () => toggleAccordion(section));
  });

  renderCalendarResult(null);
});
