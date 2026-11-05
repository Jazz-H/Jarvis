// Wake-word spike (Phase 0 of the voice plan). Answers, on the real phone:
// does "Hey Jarvis" trigger, how often falsely, how much CPU and battery, does speech recognition
// work after it, and can the page speak after it without a fresh tap.
// Pipeline (checked offline first): 16 kHz audio -> melspectrogram (x/10 + 2) -> 76-frame windows ->
// embedding (96 values) -> the last 16 embeddings -> hey_jarvis score.
/* global ort */
const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  $("log").textContent = `${t}  ${msg}\n` + $("log").textContent;
};
let sessions = null;
let run = null; // {ctx, stream, node, started, hits, busy, queue, mel, embs, ms, n, cool}

async function loadModels() {
  if (sessions) return sessions;
  log("Loading models (about 15 MB the first time)…");
  ort.env.wasm.wasmPaths = "./";
  ort.env.wasm.numThreads = 1; // no cross-origin isolation on GitHub Pages
  const opt = { executionProviders: ["wasm"] };
  const [mel, emb, kw] = await Promise.all(
    ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"].map((f) =>
      ort.InferenceSession.create("models/" + f, opt),
    ),
  );
  sessions = { mel, emb, kw };
  log("Models ready.");
  return sessions;
}

async function score(chunk) {
  const { mel, emb, kw } = sessions;
  const r = run;
  r.raw.push(...chunk);
  if (r.raw.length > 1280 + 480) r.raw.splice(0, r.raw.length - (1280 + 480));
  if (r.raw.length < 1280 + 480) return 0;
  const m = await mel.run({ input: new ort.Tensor("float32", Float32Array.from(r.raw), [1, r.raw.length]) });
  const t = m.output;
  for (let f = 0; f < t.dims[2]; f++) r.mel.push(Array.from(t.data.slice(f * 32, f * 32 + 32), (x) => x / 10 + 2));
  if (r.mel.length > 120) r.mel.splice(0, r.mel.length - 120);
  if (r.mel.length < 76) return 0;
  const e = await emb.run({ input_1: new ort.Tensor("float32", Float32Array.from(r.mel.slice(-76).flat()), [1, 76, 32, 1]) });
  r.embs.push(Array.from(e.conv2d_19.data));
  if (r.embs.length > 16) r.embs.shift();
  if (r.embs.length < 16) return 0;
  const k = await kw.run({ "x.1": new ort.Tensor("float32", Float32Array.from(r.embs.flat()), [1, 16, 96]) });
  return k["53"].data[0];
}

async function pump() {
  const r = run;
  if (!r || r.busy) return;
  r.busy = true;
  while (run === r && r.queue.length) {
    if (r.queue.length > 6) {
      r.dropped += r.queue.length - 1; // the phone fell behind: keep the newest
      r.queue.splice(0, r.queue.length - 1);
    }
    const t0 = performance.now();
    const s = await score(r.queue.shift());
    r.ms += performance.now() - t0;
    r.n++;
    $("score").style.width = Math.round(s * 100) + "%";
    if (s >= Number($("thr").value) && Date.now() > r.cool) {
      r.cool = Date.now() + 2000;
      r.hits++;
      $("s-hits").textContent = r.hits;
      log(`Heard "Hey Jarvis" (score ${s.toFixed(2)})`);
      if ($("cmd").checked) await afterWake();
    }
  }
  r.busy = false;
}

function chime() {
  try {
    const c = run.ctx,
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

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      log("This browser can't speak.");
      return resolve(false);
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    let started = false;
    u.onstart = () => (started = true);
    u.onend = () => resolve(true);
    u.onerror = (e) => {
      log(`Speaking failed: ${e.error}`);
      resolve(false);
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(() => {
      if (!started && !speechSynthesis.speaking) {
        log("Speaking didn't start (the browser may want a tap first).");
        resolve(false);
      }
    }, 3000);
  });
}

// One command through the browser's recognizer, then speak it back
async function afterWake() {
  chime();
  const Api = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Api) {
    log("No speech recognition here: would read the daily briefing instead.");
    await speak("Here is your daily briefing.");
    return;
  }
  run.paused = true;
  run.stream.getTracks().forEach((t) => (t.enabled = false)); // let the recognizer have the mic
  const heard = await new Promise((resolve) => {
    const rec = new Api();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text = "",
      err = "";
    rec.onresult = (e) => (text = e.results[0][0].transcript);
    rec.onerror = (e) => (err = e.error);
    rec.onend = () => resolve({ text, err });
    try {
      rec.start();
      log("Listening for a command…");
    } catch (e) {
      resolve({ text: "", err: "start failed: " + e.message });
    }
  });
  if (run) run.stream.getTracks().forEach((t) => (t.enabled = true));
  if (heard.err) log(`Command not heard (${heard.err}).`);
  else log(`Command: "${heard.text}"`);
  const ok = await speak(heard.text ? `You said: ${heard.text}` : "Here is your daily briefing.");
  log(ok ? "Spoke after the wake phrase without a tap." : "Couldn't speak without a tap.");
  if (run) {
    run.queue.length = 0; // skip what it heard while talking
    run.paused = false;
  }
}

async function start() {
  $("start").disabled = true;
  try {
    await loadModels();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule("worklet.js");
    const node = new AudioWorkletNode(ctx, "wake-tap");
    ctx.createMediaStreamSource(stream).connect(node);
    run = { ctx, stream, node, started: Date.now(), hits: 0, busy: false, queue: [], raw: [], mel: [], embs: [], ms: 0, n: 0, dropped: 0, cool: 0, paused: false };
    node.port.onmessage = (e) => {
      if (!run || run.paused) return;
      run.queue.push(e.data);
      pump();
    };
    if ($("lock").checked && navigator.wakeLock) {
      try {
        run.lock = await navigator.wakeLock.request("screen");
      } catch (e) {
        log("Couldn't keep the screen on: " + e.message);
      }
    }
    try {
      run.batt0 = navigator.getBattery ? (await navigator.getBattery()).level : null;
    } catch (e) {}
    $("state").textContent = 'Listening for "Hey Jarvis"';
    $("state").className = "on";
    $("stop").disabled = false;
    log(`Started (audio at ${ctx.sampleRate} Hz).`);
  } catch (e) {
    log("Couldn't start: " + (e && e.message ? e.message : e));
    stop();
  }
}

function stop() {
  if (run) {
    log(summary());
    run.stream && run.stream.getTracks().forEach((t) => t.stop());
    run.ctx && run.ctx.close();
    run.lock && run.lock.release().catch(() => {});
  }
  run = null;
  $("state").textContent = "Off";
  $("state").className = "";
  $("start").disabled = false;
  $("stop").disabled = true;
  $("score").style.width = "0";
}

function mins() {
  return run ? (Date.now() - run.started) / 60000 : 0;
}
function summary() {
  const r = run;
  return `Summary: ${mins().toFixed(1)} min, heard ${r.hits}x, ${r.n ? (r.ms / r.n).toFixed(1) : "–"} ms per 80 ms chunk, ${r.dropped} chunks dropped, battery ${$("s-batt").textContent}`;
}

setInterval(async () => {
  if (!run) return;
  const s = Math.floor((Date.now() - run.started) / 1000);
  $("s-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (run.n) $("s-ms").textContent = (run.ms / run.n).toFixed(1);
  try {
    if (navigator.getBattery && run.batt0 != null) {
      const b = await navigator.getBattery();
      $("s-batt").textContent = `${Math.round(b.level * 100)}% (−${Math.round((run.batt0 - b.level) * 100)} pts)`;
    }
  } catch (e) {}
}, 1000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" && run) {
    log("App went to the background: stopped (a web app can't listen there).");
    stop();
  }
});
$("start").addEventListener("click", start);
$("stop").addEventListener("click", stop);
$("say").addEventListener("click", () => speak("This is Jarvis. Speaking works on this phone."));
$("copy").addEventListener("click", async () => {
  const text = `${navigator.userAgent}\n${$("log").textContent}`;
  try {
    await navigator.clipboard.writeText(text);
    log("Copied.");
  } catch (e) {
    log("Copy failed: select the log and copy it by hand.");
  }
});
window.__wakeSpike = { score, loadModels, get run() { return run; } }; // for the offline check
