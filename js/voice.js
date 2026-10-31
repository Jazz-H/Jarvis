// voice.js - Speak instead of typing: a mic in Console's box and in Home's quick add.
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
    else if (v.heard.trim())
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") voiceCancel();
});
