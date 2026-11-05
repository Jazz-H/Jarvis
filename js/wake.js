// wake.js - "Hey Jarvis": hands-free voice while the app is open.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- HEY JARVIS ----------
// A switch on Home turns it on (a tap is needed: browsers won't start the mic or speech by
// themselves). While it's on, the phrase is listened for on this device by openWakeWord's
// "hey jarvis" model (vendor/wake, ONNX Runtime Web): no audio leaves the device for it. Once it's
// heard, a chime plays, the mic is handed to the browser's speech recognition for one command (in
// Chrome that's Google's servers, like the mic in Console), and the answer is read aloud on the
// device. Commands are matched by code (wakeMatch): no model, no cost, nothing sent to Jarvis.
// It stops when the app goes to the background and after 15 minutes without "Hey Jarvis".
// The model files (about 15 MB) load the first time it's turned on, then come from the cache.
const WAKE_DIR = "vendor/wake/";
const WAKE_THRESHOLD = 0.5; // the model's score (0–1) that counts as "Hey Jarvis"
const WAKE_IDLE_MS = 15 * 60 * 1000;
const WAKE_CHUNK = 1280; // 80 ms of 16 kHz audio
const WAKE_OVERLAP = 480; // 3 mel frames carried over between chunks
let wake = null; // the running listener (wakeStart)
let wakeSessions = null; // the three ONNX models, once loaded
let wakeStarting = false;
let wakeStoppedAway = false; // turned off because the app went to the background

function wakeSupported() {
  return (
    typeof window.AudioWorkletNode === "function" &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
    typeof window.WebAssembly === "object" &&
    speakSupported()
  );
}
// The round button beside the greeting, and a line under the greeting that says what to do next.
// One look per state: off (outline), starting, waiting for "Hey Jarvis" (soft fill, bars at rest),
// hearing a command (solid, bars moving), talking (solid, a stop square: a tap stops the reading).
let wakePhase = "idle"; // idle (waiting for the phrase) | command (listening for one) | speaking
const WAKE_BARS =
  '<svg class="jv-wake-bars" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 10v4"/><path d="M9.5 7v10"/><path d="M14.5 5v14"/><path d="M19 9v6"/></svg>';
const WAKE_STOP =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>';
function wakeState() {
  if (wakeStarting) return "starting";
  if (!wake) return "off";
  if (wakePhase === "command") return "command";
  return speakingKey === "wake" ? "speaking" : "idle";
}
const WAKE_STATES = {
  off: { label: "Turn on hands-free: say Hey Jarvis", hint: "" },
  starting: { label: "Starting hands-free", hint: "Starting…" },
  idle: { label: "Hands-free is on. Tap to turn it off", hint: "Say “Hey Jarvis”" },
  command: { label: "Listening for a command", hint: "Listening… try “read my briefing”" },
  speaking: { label: "Stop reading", hint: "Speaking · tap ■ to stop" },
};
function wakeChipHtml() {
  if (!wakeSupported()) return "";
  const s = wakeState();
  return `<button type="button" class="jv-wake jv-wake-${s}" id="jv-wake" data-action="wake-toggle" aria-pressed="${s !== "off" && s !== "starting"}" aria-label="${WAKE_STATES[s].label}">${s === "speaking" ? WAKE_STOP : WAKE_BARS}</button>`;
}
function wakeHintHtml() {
  if (!wakeSupported()) return "";
  return `<div class="jv-wake-hint" id="jv-wake-hint" aria-live="polite">${WAKE_STATES[wakeState()].hint}</div>`;
}
function wakeUi() {
  const el = document.getElementById("jv-wake");
  if (el) {
    const s = wakeState();
    if (!el.classList.contains("jv-wake-" + s)) el.outerHTML = wakeChipHtml();
  }
  const hint = document.getElementById("jv-wake-hint");
  if (hint) hint.textContent = WAKE_STATES[wakeState()].hint;
}

function wakeToggle() {
  if (wakeStarting) return;
  if (wakeState() === "speaking") {
    speakStop(); // the first tap stops the reading; hands-free stays on
    return;
  }
  if (wake) {
    wakeStop();
    showToast("Hands-free is off");
    liveAnnounce("Hands-free is off");
  } else wakeStart();
}

function wakeLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("couldn't load " + src));
    document.head.appendChild(s);
  });
}
async function wakeLoadModels() {
  if (wakeSessions) return wakeSessions;
  if (!window.ort) await wakeLoadScript(WAKE_DIR + "ort.wasm.min.js");
  ort.env.wasm.wasmPaths = new URL(WAKE_DIR, location.href).href;
  ort.env.wasm.numThreads = 1; // GitHub Pages can't turn on cross-origin isolation
  const opt = { executionProviders: ["wasm"] };
  const [mel, emb, kw] = await Promise.all(
    ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"].map((f) =>
      ort.InferenceSession.create(WAKE_DIR + "models/" + f, opt),
    ),
  );
  wakeSessions = { mel, emb, kw };
  return wakeSessions;
}

async function wakeStart() {
  wakeStarting = true;
  wakeUi();
  const w = { queue: [], raw: [], mel: [], embs: [], busy: false, cool: 0, paused: false };
  try {
    await wakeLoadModels();
    w.ctx = new AudioContext({ sampleRate: 16000 });
    await w.ctx.audioWorklet.addModule(WAKE_DIR + "worklet.js");
    w.node = new AudioWorkletNode(w.ctx, "wake-tap");
    await wakeOpenMic(w);
  } catch (e) {
    wakeStarting = false;
    wakeRelease(w);
    wakeUi();
    const blocked = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    const msg = blocked ? "Microphone blocked: allow it in your browser settings" : "Hands-free couldn't start";
    showToast(msg, true);
    liveAnnounce(msg);
    return;
  }
  w.node.port.onmessage = (e) => {
    if (wake !== w || w.paused) return;
    w.queue.push(e.data);
    wakePump(w);
  };
  try {
    if (navigator.wakeLock) w.lock = await navigator.wakeLock.request("screen"); // listening needs the screen on
  } catch (e) {}
  wake = w;
  wakeStarting = false;
  wakeStoppedAway = false;
  wakeIdle();
  wakeUi();
  liveAnnounce("Hands-free is on. Say Hey Jarvis.");
}
async function wakeOpenMic(w) {
  w.stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  w.source = w.ctx.createMediaStreamSource(w.stream);
  w.source.connect(w.node);
}
function wakeCloseMic(w) {
  try {
    if (w.source) w.source.disconnect();
  } catch (e) {}
  if (w.stream) w.stream.getTracks().forEach((t) => t.stop());
  w.source = w.stream = null;
}
function wakeRelease(w) {
  wakeCloseMic(w);
  try {
    if (w.ctx) w.ctx.close();
  } catch (e) {}
  if (w.lock) w.lock.release().catch(() => {});
  clearTimeout(w.idle);
}
function wakeStop() {
  if (!wake) return;
  const w = wake;
  wake = null;
  wakePhase = "idle";
  wakeRelease(w);
  wakeUi();
}
// Turns itself off after WAKE_IDLE_MS without "Hey Jarvis"
function wakeIdle() {
  const w = wake;
  if (!w) return;
  clearTimeout(w.idle);
  w.idle = setTimeout(() => {
    if (wake !== w) return;
    wakeStop();
    showToast("Hands-free turned off after 15 quiet minutes");
  }, WAKE_IDLE_MS);
}

// mel spectrogram (x/10 + 2) -> 76-frame windows -> embeddings -> the last 16 -> the hey_jarvis score
async function wakeScore(w, chunk) {
  const { mel, emb, kw } = wakeSessions;
  for (let i = 0; i < chunk.length; i++) w.raw.push(chunk[i]);
  if (w.raw.length > WAKE_CHUNK + WAKE_OVERLAP) w.raw.splice(0, w.raw.length - WAKE_CHUNK - WAKE_OVERLAP);
  if (w.raw.length < WAKE_CHUNK + WAKE_OVERLAP) return 0;
  const m = (await mel.run({ input: new ort.Tensor("float32", Float32Array.from(w.raw), [1, w.raw.length]) })).output;
  for (let f = 0; f < m.dims[2]; f++) w.mel.push(Array.from(m.data.slice(f * 32, f * 32 + 32), (x) => x / 10 + 2));
  if (w.mel.length > 120) w.mel.splice(0, w.mel.length - 120);
  if (w.mel.length < 76) return 0;
  const e = await emb.run({
    input_1: new ort.Tensor("float32", Float32Array.from(w.mel.slice(-76).flat()), [1, 76, 32, 1]),
  });
  w.embs.push(Array.from(e.conv2d_19.data));
  if (w.embs.length > 16) w.embs.shift();
  if (w.embs.length < 16) return 0;
  const k = await kw.run({ "x.1": new ort.Tensor("float32", Float32Array.from(w.embs.flat()), [1, 16, 96]) });
  return k["53"].data[0];
}
async function wakePump(w) {
  if (w.busy) return;
  w.busy = true;
  try {
    while (wake === w && !w.paused && w.queue.length) {
      if (w.queue.length > 6) w.queue.splice(0, w.queue.length - 1); // fell behind: keep the newest
      const s = await wakeScore(w, w.queue.shift());
      if (s >= WAKE_THRESHOLD && Date.now() > w.cool) {
        w.cool = Date.now() + 2000;
        await wakeHeard();
      }
    }
  } catch (e) {
    console.error("hands-free", e);
  }
  w.busy = false;
}

function wakeChime() {
  const w = wake;
  try {
    const c = w.ctx,
      o = c.createOscillator(),
      g = c.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.25);
  } catch (e) {}
}
// "Hey Jarvis" was heard: chime, hand the mic to speech recognition for one command, take it back,
// then answer. Listening for the phrase goes on while it talks, so "Hey Jarvis, stop" works.
async function wakeHeard() {
  const w = wake;
  if (!w) return;
  speakStop();
  wakeIdle();
  w.paused = true;
  wakeChime();
  wakeCloseMic(w); // Android lets one listener have the mic at a time
  wakePhase = "command";
  wakeUi();
  await new Promise((r) => setTimeout(r, 300)); // the chime
  const heard = await wakeListen();
  wakePhase = "idle";
  wakeUi();
  if (wake !== w) return;
  try {
    await wakeOpenMic(w);
  } catch (e) {
    wakeStop();
    showToast("Hands-free stopped: the microphone wasn't available", true);
    return;
  }
  w.queue.length = w.raw.length = w.mel.length = w.embs.length = 0;
  w.paused = false;
  wakeHandle(heard);
}
// One command through the browser's speech recognition; "" when nothing was understood
function wakeListen() {
  const Api = voiceApi();
  if (!Api) return Promise.resolve("");
  return new Promise((resolve) => {
    let text = "";
    let rec;
    try {
      rec = new Api();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
    } catch (e) {
      resolve("");
      return;
    }
    rec.onresult = (e) => {
      text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
    };
    rec.onerror = () => {};
    rec.onend = () => resolve(text.trim());
    try {
      rec.start();
    } catch (e) {
      resolve("");
    }
  });
}

// ---- commands: matched by code, answered from this device's data ----
const WAKE_HELP =
  "You can say: read my briefing, read everything, weather, my day, top 3, inbox, tomorrow, news, add a to-do, or stop.";
function wakeMatch(said) {
  let t = String(said || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'$-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey )?jarvis\s*/, "")
    .replace(/^(please|can you|could you|would you)\s+/, "");
  if (!t) return { kind: "briefing" }; // just "Hey Jarvis"
  if (/^(stop|cancel|quiet|be quiet|shut up|never ?mind|that's all|that is all)\b/.test(t)) return { kind: "stop" };
  const add =
    /^(?:add|put|new|create)(?: an?)?(?: to ?-?do| task| reminder)?(?: to my list)?(?: to| that)?[:\s]+(.+)$|^remind me to (.+)$|^to ?-?do[:\s]+(.+)$/.exec(
      t,
    );
  if (add) return { kind: "add", rest: (add[1] || add[2] || add[3]).trim() };
  if (/\b(home|everything|all of it|whole thing|full briefing)\b/.test(t)) return { kind: "home" };
  if (/\btop (3|three)\b|\bpriorit/.test(t)) return { kind: "top3" };
  if (/\b(weather|forecast|rain|temperature|outside|umbrella|jacket)\b/.test(t))
    return { kind: "weather", tomorrow: /\btomorrow\b/.test(t) };
  if (/\btomorrow\b/.test(t)) return { kind: "tomorrow" };
  if (/\b(news|headlines?|stories)\b/.test(t)) return { kind: "news" };
  if (/\b(inbox|emails?|e mails?|mail)\b/.test(t)) return { kind: "inbox" };
  if (/\b(brief|briefing|summary|morning|update)\b/.test(t)) return { kind: "briefing" };
  if (/\b(my day|schedule|calendar|agenda|today|plans?|to ?-?dos?)\b/.test(t)) return { kind: "day" };
  return { kind: "help" };
}
function wakeHandle(said) {
  const cmd = wakeMatch(said);
  if (said) showToast(`Heard: “${said.slice(0, 80)}”`);
  if (cmd.kind === "stop") {
    speakStop();
    return cmd;
  }
  if (cmd.kind === "add") {
    wakeAddTodo(cmd.rest);
    return cmd;
  }
  const say = {
    briefing: wakeSayBriefing,
    home: wakeSayHome,
    top3: wakeSayTop3,
    weather: () => wakeSayWeather(cmd.tomorrow),
    tomorrow: wakeSayTomorrow,
    news: wakeSayNews,
    inbox: wakeSayInbox,
    day: wakeSayDay,
    help: () => [said ? `Sorry, I didn't catch that. ${WAKE_HELP}` : WAKE_HELP],
  }[cmd.kind];
  wakeSpeak(say());
  return cmd;
}
function wakeSpeak(parts) {
  const list = parts.flat().map(wakeClean).filter(Boolean);
  speakStop(); // a new answer replaces what's being read (speakText alone would treat it as "stop")
  if (list.length) speakText(list, "wake");
}
// Times, degrees and symbols the way they're said
function wakeClean(s) {
  return String(s || "")
    .replace(
      /\b(\d{1,2})(?::(\d\d))?([ap])\b/g,
      (m, h, mm, ap) => `${h}${mm && mm !== "00" ? ":" + mm : ""} ${ap === "a" ? "AM" : "PM"}`,
    )
    .replace(/(\d)\s*[–—-]\s*(\d)/g, "$1 to $2")
    .replace(/ (AM|PM)\s*[–—]\s*/g, " $1 to ")
    .replace(/°/g, " degrees")
    .replace(/\s*·\s*/g, ", ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}
const wakeList = (a) =>
  a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")}${a.length > 2 ? "," : ""} and ${a[a.length - 1]}`;
const wakeEnd = (s) => (/[.!?]$/.test(s) ? s : s + ".");

function wakeSayBriefing() {
  const b = loadBriefing();
  if (!b) return ["There's no briefing yet. It arrives each morning once Jarvis is set up."];
  const out = ["Here's your briefing."];
  if (b.date !== addDaysIso(0))
    out.push(
      `Today's briefing hasn't arrived. This one is from ${noonOf(b.date).toLocaleDateString("en-US", { weekday: "long" })}.`,
    );
  if (b.headline) out.push(wakeEnd(b.headline));
  b.summary.forEach((s) => out.push(wakeEnd(s.text)));
  return [...out, ...wakeSayTop3(true)];
}
function wakeSayTop3(quietIfNone = false) {
  const b = loadBriefing();
  const picks =
    b && b.date === addDaysIso(0) ? b.top3.map((x) => todoList.find((t) => t.id === x.id)).filter(Boolean) : [];
  if (!picks.length) return quietIfNone ? [] : ["There's no Top 3 for today."];
  const open = picks.filter((t) => !t.done);
  if (!open.length) return ["Your Top 3 are all done."];
  return [`Your top ${open.length === 1 ? "one" : open.length}: ${wakeList(open.map((t) => t.text))}.`];
}
function wakeSayWeather(tomorrow = false) {
  const b = loadBriefing();
  const w = b && b.date === addDaysIso(0) ? dashToday(b.weather) : null;
  if (!w) return ["I don't have today's forecast."];
  if (tomorrow) {
    const t = w.tomorrow;
    if (!t) return ["I don't have tomorrow's forecast."];
    return [
      `Tomorrow: ${t.conditions}, high ${t.highF}°, low ${t.lowF}°${t.rainChanceMax ? `, ${t.rainChanceMax}% chance of rain` : ""}.`,
    ];
  }
  const now = wxNow(w).tempF;
  const rain = jvRainWindow(w.hourlyRain);
  return [
    `${now != null ? `It's ${now}° now. ` : ""}Today: ${w.conditions}, high ${w.highF}°, low ${w.lowF}°.`,
    w.rainChanceMax ? `${w.rainChanceMax}% chance of rain${rain ? `, most likely ${rain}` : ""}.` : "",
  ];
}
function wakeSayDay() {
  const b = loadBriefing();
  const rows = dashDayRows(b, { todo: dashTodoData(), skin: dashSkinData() });
  if (!rows.length) return ["Nothing is scheduled today."];
  return ["Your day.", ...rows.map((r) => wakeEnd(`${r.time}: ${r.title}${r.sub ? `, ${r.sub}` : ""}`))];
}
function wakeSayInbox() {
  const b = loadBriefing();
  const x = b && b.date === addDaysIso(0) ? dashToday(b.inbox) : null;
  if (!x) return [b && b.inbox ? "Your inbox isn't available right now." : "Gmail isn't connected."];
  const out = [`${x.unread} new email${x.unread === 1 ? "" : "s"}.`];
  // senders only: the mail itself stays on the screen
  if (x.urgent.length) out.push(`Urgent from ${wakeList([...new Set(x.urgent.map((u) => u.from))])}.`);
  if (x.needsReply.length) out.push(`${x.needsReply.length} need${x.needsReply.length === 1 ? "s" : ""} a reply.`);
  return out;
}
function wakeSayTomorrow() {
  const iso = addDaysIso(1);
  const day = homeDayItems(iso);
  const todos = [...day.open, ...(day.repeats || [])];
  const dayBills = billsOnDay(iso);
  const billList = [...dayBills.open, ...dayBills.projected];
  const out = [
    `Tomorrow, ${noonOf(iso).toLocaleDateString("en-US", { weekday: "long" })}.`,
    ...wakeSayWeather(true)
      .filter((s) => s.startsWith("Tomorrow:"))
      .map((s) => s.replace(/^Tomorrow: /, "Weather: ")),
  ];
  out.push(
    todos.length
      ? `${todos.length} to-do${todos.length === 1 ? "" : "s"}: ${wakeList(todos.slice(0, 3).map((t) => t.text))}${todos.length > 3 ? ", and more" : ""}.`
      : "No to-dos yet.",
  );
  if (billList.length) out.push(`Bills: ${wakeList(billList.map((x) => x.name))}.`);
  if (day.wash) out.push("It's wash day.");
  if (workoutsOn(iso).length) out.push(`Workouts: ${wakeList(workoutsOn(iso).map((x) => x.name))}.`);
  return out;
}
function wakeSayNews() {
  const b = loadBriefing();
  const n = b && b.news && b.news.status === "ok" ? b.news.data.stories : [];
  if (!n.length) return ["I don't have today's news."];
  return ["Top stories.", ...n.slice(0, 3).map((s) => wakeEnd(s.title))];
}
// Everything on Home, top to bottom
function wakeSayHome() {
  const h = new Date().getHours();
  const out = [`${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${JARVIS_OWNER}.`];
  out.push(...wakeSayBriefing(), ...wakeSayWeather(), ...wakeSayDay(), ...wakeSayInbox());
  if (h >= DASH_EVENING_HOUR) out.push(...wakeSayTomorrow());
  out.push(...wakeSayNews());
  return out;
}

// "Hey Jarvis, add call mom tomorrow": the same parsing as Quick add, read back, with Undo
function wakeAddTodo(said) {
  const raw = String(said || "")
    .trim()
    .slice(0, TODO_MAX_LEN);
  if (!raw) {
    wakeSpeak(["What should I add? Say Hey Jarvis, add, then the to-do."]);
    return;
  }
  const before = dataSnapshot();
  const { text, due } = parseQuickAdd(raw);
  const t = {
    id: genId("todo"),
    text: text.charAt(0).toUpperCase() + text.slice(1),
    done: false,
    due,
    starred: false,
    subitems: [],
    completedAt: null,
  };
  const at = todoList.findIndex((x) => !x.done && todoGroup(x) === todoGroup(t));
  if (at >= 0) todoList.splice(at, 0, t);
  else todoList.push(t);
  saveContent("todo-content", todoList, { toast: false });
  renderHome();
  const after = dataSnapshot();
  showUndoToast(due ? `Added for ${dueLabel(due)}: ${t.text}` : `Added: ${t.text}`, () => {
    undoTo(before, after);
    renderHome();
  });
  wakeSpeak([`Added ${t.text}${due ? ` for ${dueLabel(due)}` : ""}.`]);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" && wake) {
    wakeStop(); // a web app can't listen in the background
    wakeStoppedAway = true;
  } else if (document.visibilityState === "visible" && wakeStoppedAway) {
    wakeStoppedAway = false;
    showToast("Hands-free turned off while the app was closed");
  }
});
