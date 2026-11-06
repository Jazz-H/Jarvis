// voice.js - Speak instead of typing: a mic in Console's box, Home's quick add and the desktop command bar.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- VOICE INPUT ----------
// The browser's Web Speech API turns speech into text (in Chrome that's done by Google's servers;
// Safari uses Apple's). What's heard streams into the box as you speak; listening stops on silence
// or a second tap. Nothing is ever sent or added by voice: you check the text, then tap send / +.
// Where the API isn't there the mic is hidden (the keyboard's own dictation still works).
const VOICE_TARGETS = {
  console: { input: "console-input", changed: () => consoleTextChanged() },
  quick: {
    input: "jv-quick",
    changed: (el) => {
      dashQuickText = el.value; // kept across Home re-renders
    },
  },
  desk: { input: "desk-cmd", changed: () => {} }, // big screens' command bar (Enter sends, as when typed)
};
const VOICE_ERRORS = {
  "not-allowed": "Microphone blocked: allow it in your browser settings",
  "service-not-allowed": "Microphone blocked: allow it in your browser settings",
  "no-speech": "Didn't hear anything. Tap the mic and try again",
  network: "Voice needs an internet connection. You can still type",
  "audio-capture": "No microphone found. You can still type",
  "language-not-supported": "Voice isn't available in English here. You can still type",
};
const VOICE_FAILED = "Voice input didn't start. You can still type";
const VOICE_LISTENING_HINT = "Listening… tap the mic to stop. In Chrome, Google turns your speech into text.";
const VOICE_MIC_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
let voice = null; // {target, rec, base, heard, error, stopping} while a recognition runs
let voiceSaid = ""; // what the last recognition put in Console's box (a question sent as-is was spoken)

function voiceApi() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
function voiceSupported() {
  return typeof voiceApi() === "function";
}
function voiceListening(target) {
  return !!voice && !voice.stopping && (!target || voice.target === target);
}
function voiceMicHtml(target) {
  if (!voiceSupported() || !VOICE_TARGETS[target]) return "";
  const on = voiceListening(target);
  return `<button type="button" class="vc-mic${on ? " on" : ""}" id="vc-mic-${target}" data-action="voice-toggle" data-target="${target}" aria-pressed="${on}" aria-label="${on ? "Stop listening" : "Speak instead of typing"}">${VOICE_MIC_SVG}</button>`;
}
// The mic's look and the box's hint follow the state
function voiceUi(target) {
  const on = voiceListening(target);
  const btn = document.getElementById("vc-mic-" + target);
  if (btn) {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Stop listening" : "Speak instead of typing");
  }
  if (target === "console") consoleRefreshBox();
  if (target === "quick") {
    const input = document.getElementById("jv-quick");
    if (input) input.placeholder = on ? "Listening…" : "Add a to-do";
  }
  if (target === "desk") {
    const input = document.getElementById("desk-cmd");
    if (input) input.placeholder = on ? "Listening…" : "Ask Jarvis or add a to-do…";
  }
}
function voiceToggle(target) {
  if (!VOICE_TARGETS[target]) return;
  if (voice && voice.target === target && !voice.stopping) {
    voice.stopping = true; // a final result can still arrive before it ends
    try {
      voice.rec.stop();
    } catch (e) {}
    voiceUi(target);
    return;
  }
  voiceCancel();
  voiceStart(target);
}
function voiceFill(target, base, heard) {
  const cfg = VOICE_TARGETS[target];
  const input = document.getElementById(cfg.input);
  if (!input) return;
  const max = Number(input.getAttribute("maxlength")) || 1000;
  input.value = [base, heard.trim()].filter(Boolean).join(" ").slice(0, max);
  cfg.changed(input);
}
function voiceStart(target) {
  const Api = voiceApi(),
    cfg = VOICE_TARGETS[target];
  const input = document.getElementById(cfg.input);
  if (!Api || !input) return;
  let rec;
  try {
    rec = new Api();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false; // stops by itself after a pause
    rec.maxAlternatives = 1;
  } catch (e) {
    voiceFail("");
    return;
  }
  const base = input.value.trim();
  if (target === "console" && !base) consoleMode = null; // the Ask / Capture guess runs on what's said
  const v = { target, rec, base, heard: "", error: "", stopping: false };
  rec.onresult = (e) => {
    if (voice !== v) return;
    let heard = "";
    for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
    v.heard = heard;
    voiceFill(target, base, heard);
  };
  rec.onerror = (e) => {
    if (voice === v) v.error = (e && e.error) || "unknown";
  };
  rec.onend = () => {
    if (voice !== v) return;
    voice = null;
    voiceUi(target);
    if (v.error && v.error !== "aborted") voiceFail(v.error);
    if (target === "console" && v.heard.trim()) {
      const box = document.getElementById(cfg.input);
      voiceSaid = box ? box.value.trim() : "";
    }
    if (!v.error && v.heard.trim())
      liveAnnounce(
        target === "console" ? "Done listening. Check the text, then send." : "Done listening. Check it, then add.",
      );
    const el = document.getElementById(cfg.input);
    if (el) el.focus({ preventScroll: true }); // ready to review (nothing is sent)
  };
  voice = v;
  try {
    rec.start();
  } catch (e) {
    voice = null;
    voiceFail("");
    voiceUi(target);
    return;
  }
  voiceUi(target);
  liveAnnounce("Listening");
}
// ---- reading aloud (Web Speech synthesis, on the device; nothing is sent anywhere) ----
let speakingKey = null; // which answer or briefing is being read
function speakSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
}
// Reads the text aloud, or stops if this same thing is already being read. Returns true if it started.
// A list is read one part after another (the browser queues them), so long readings aren't cut off.
function speakText(text, key) {
  if (!speakSupported()) return false;
  const synth = window.speechSynthesis;
  const same = speakingKey === key && synth.speaking;
  synth.cancel();
  speakingKey = null;
  speakUi();
  const parts = (Array.isArray(text) ? text : [text]).map((p) => speakClean(p).slice(0, 3000)).filter(Boolean);
  if (same || !parts.length) return false;
  const v = speakVoice();
  const { rate } = speakPrefs();
  speakingKey = key;
  parts.forEach((t, i) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = v ? v.lang : "en-US";
    u.rate = rate;
    u.pitch = 1;
    if (v) u.voice = v;
    const last = i === parts.length - 1;
    u.onend = u.onerror = (e) => {
      if (!last && !(e && e.error)) return; // the next part follows
      if (speakingKey === key) speakingKey = null;
      speakUi();
    };
    synth.speak(u);
  });
  speakUi();
  return true;
}
// Text the way it should sound: no emoji, brackets as a pause, symbols as words
function speakClean(s) {
  return String(s || "")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, "")
    .replace(/\s*\(([^()]{1,80})\)\s*/g, ", $1, ")
    .replace(/\s*[·•|]\s*/g, ", ")
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/\s*&\s*/g, " and ")
    .replace(/≠/g, " differs from ")
    .replace(/~\s*(?=\d|\$)/g, "about ")
    .replace(/\bw\/\s*/gi, "with ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*([.;:!?])/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}
// The reading voice and speed, chosen in Jarvis's brain (this device only: voices differ per device)
const SPEAK_PREFS_KEY = "speak-voice"; // {voice: name or "", rate}
const SPEAK_RATES = { Slower: 0.9, Natural: 1, Faster: 1.12 };
function speakPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(SPEAK_PREFS_KEY) || "null");
    const rate = v && Object.values(SPEAK_RATES).includes(v.rate) ? v.rate : SPEAK_RATES.Natural;
    return { voice: v && typeof v.voice === "string" ? v.voice.slice(0, 200) : "", rate };
  } catch (e) {
    return { voice: "", rate: SPEAK_RATES.Natural };
  }
}
function speakSavePrefs(p) {
  try {
    localStorage.setItem(SPEAK_PREFS_KEY, JSON.stringify(p));
  } catch (e) {}
}
// English voices, best first: neural / natural / online ones sound most like a person
function speakVoices() {
  if (!speakSupported()) return [];
  const score = (x) =>
    (/^en(-|_)US/i.test(x.lang) ? 4 : 0) +
    (/natural|neural|wavenet|premium|enhanced|online/i.test(x.name) ? 3 : 0) +
    (/google/i.test(x.name) ? 2 : 0) +
    (x.localService === false ? 1 : 0);
  return window.speechSynthesis
    .getVoices()
    .filter((x) => /^en(-|_)/i.test(x.lang))
    .sort((a, b) => score(b) - score(a));
}
function speakVoice() {
  const list = speakVoices();
  const { voice } = speakPrefs();
  return (voice && list.find((x) => x.name === voice)) || list[0] || null;
}
if (speakSupported()) window.speechSynthesis.getVoices(); // some browsers load the list on first ask
function speakStop() {
  if (!speakSupported()) return;
  window.speechSynthesis.cancel();
  speakingKey = null;
  speakUi();
}
// 🔊 buttons show which one is reading (data-speak-key)
function speakUi() {
  document.querySelectorAll("[data-speak-key]").forEach((b) => {
    const on = b.getAttribute("data-speak-key") === speakingKey;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Stop reading" : b.getAttribute("data-speak-label") || "Read aloud");
  });
  wakeUi(); // the hands-free button shows when Jarvis is talking (wake.js)
}
function speakBtnHtml(key, action, attrs, label) {
  if (!speakSupported()) return "";
  const on = speakingKey === key;
  return `<button type="button" class="jv-speak${on ? " on" : ""}" data-action="${action}" ${attrs} data-speak-key="${escapeAttr(key)}" data-speak-label="${escapeAttr(label)}" aria-pressed="${on}" aria-label="${escapeAttr(on ? "Stop reading" : label)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>`;
}
function voiceFail(code) {
  const msg = VOICE_ERRORS[code] || VOICE_FAILED;
  showToast(msg, true);
  liveAnnounce(msg);
}
// Stops without a message (switching tabs, the app going to the background)
function voiceCancel() {
  if (!voice) return;
  const v = voice;
  voice = null;
  try {
    v.rec.abort();
  } catch (e) {}
  voiceUi(v.target);
}
// Big screens: the same mic in the header's command bar (its box is in jazz2.0.html)
(function () {
  const box = document.getElementById("desk-cmd");
  if (box && !document.getElementById("vc-mic-desk")) box.insertAdjacentHTML("afterend", voiceMicHtml("desk"));
})();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") speakStop(); // never keeps talking in the background
  if (document.visibilityState !== "visible") voiceCancel();
});
