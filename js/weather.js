// Weather detail (Home → Weather, under the tile), laid out like a phone weather app in the
// Reactor theme: a hero (now, conditions, high/low, feels like) over a glow that follows the sky,
// National Weather Service alerts, Jarvis's summary and what to wear, an hourly strip with a
// temperature line, the 16-day list with day and night icons, then the long-range outlook,
// sunrise and sunset, and detail tiles ending with Location (whose forecast it is). It all comes from this morning's
// briefing, except NWS alerts: with a saved location the app checks those itself while it's open.

const WX_WORDS = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms with hail",
  99: "Thunderstorms with hail",
};

// ---- icons: a WMO code (or, in older briefings, the words) → a kind → a line icon ----
function wxKind(code, text) {
  if (code != null) {
    if (code <= 0) return "clear";
    if (code <= 2) return "partly";
    if (code === 3) return "cloudy";
    if (code === 45 || code === 48) return "fog";
    if (code >= 51 && code <= 57) return "drizzle";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if (code >= 95) return "storm";
    return "cloudy";
  }
  const t = String(text || "").toLowerCase();
  if (/thunder/.test(t)) return "storm";
  if (/snow/.test(t)) return "snow";
  if (/drizzle/.test(t)) return "drizzle";
  if (/rain|shower/.test(t)) return "rain";
  if (/fog/.test(t)) return "fog";
  if (/partly|mostly clear|mostly sunny/.test(t)) return "partly";
  if (/clear|sunny/.test(t)) return "clear";
  return "cloudy";
}
const WX_SUN =
  '<g class="sun"><circle cx="16" cy="16" r="5.5"/><path d="M24.5 16h3M22 22l2.1 2.1M16 24.5v3M10 22l-2.1 2.1M7.5 16h-3M10 10L7.9 7.9M16 7.5v-3M22 10l2.1-2.1"/></g>';
const WX_MOON = '<path class="moon" d="M24 19.5A9.5 9.5 0 1 1 12.5 8a7.5 7.5 0 0 0 11.5 11.5z"/>';
const WX_SUN_SMALL =
  '<g class="sun"><circle cx="11" cy="11" r="3.8"/><path d="M11 3.5v2M4.5 11h2M6.4 6.4l1.4 1.4M15.6 6.4l-1.4 1.4M6.4 15.6l1.4-1.4"/></g>';
const WX_MOON_SMALL = '<path class="moon" d="M15.5 13.5A5.5 5.5 0 1 1 8.5 6.5a4.5 4.5 0 0 0 7 7z"/>';
const WX_CLOUD = '<path class="cloud" d="M10 25h13a5.5 5.5 0 0 0 .6-11A7.5 7.5 0 0 0 9.3 16.2 4.5 4.5 0 0 0 10 25z"/>';
const WX_CLOUD_LOW = '<path class="cloud" d="M13 27h11a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.4 1.9A3.6 3.6 0 0 0 13 27z"/>';
const WX_CLOUD_UP =
  '<path class="cloud" d="M10 20h13a5.5 5.5 0 0 0 .6-11A7.5 7.5 0 0 0 9.3 11.2 4.5 4.5 0 0 0 10 20z"/>';
const WX_ICON_PARTS = {
  clear: (day) => (day ? WX_SUN : WX_MOON),
  partly: (day) => (day ? WX_SUN_SMALL : WX_MOON_SMALL) + WX_CLOUD_LOW,
  cloudy: () => WX_CLOUD,
  fog: () => WX_CLOUD_UP + '<path class="fog" d="M6 24h20M9 28h14"/>',
  drizzle: () => WX_CLOUD_UP + '<path class="drop" d="M11 24v.5M16 25v.5M21 24v.5M13.5 28v.5M18.5 28v.5"/>',
  rain: () => WX_CLOUD_UP + '<path class="drop" d="M11 23l-1.5 4M16 23l-1.5 4M21 23l-1.5 4"/>',
  snow: () => WX_CLOUD_UP + '<path class="flake" d="M11 23.5v4M9 25.5h4M21 23.5v4M19 25.5h4M16 26.5v3M14.5 28h3"/>',
  storm: () => WX_CLOUD_UP + '<path class="bolt" d="M17 21l-3 5h4l-3 5"/>',
};
function wxIcon(kind, isDay = true, cls = "") {
  const parts = (WX_ICON_PARTS[kind] || WX_ICON_PARTS.cloudy)(isDay);
  return `<svg class="wx-i${cls ? " " + cls : ""}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${parts}</svg>`;
}
const WX_UMBRELLA =
  '<svg class="wx-umb" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2.5a6 6 0 0 1 6 5.5H2a6 6 0 0 1 6-5.5zM8 8v4.5a1.5 1.5 0 0 1-3 0"/></svg>';
const WX_PIN =
  '<svg class="wx-pin" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
const WX_WARN =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.2"/></svg>';

// ---- times: local "HH:MM" → "5:27 PM"; an ISO time → "1:45 PM" (Eastern), with the day if not today ----
function wxClock(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
}
function wxEnds(iso) {
  const d = new Date(iso);
  const opts = { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" };
  const day = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return day === addDaysIso(0)
    ? d.toLocaleTimeString("en-US", opts)
    : d.toLocaleString("en-US", { ...opts, weekday: "short" });
}
const wxHourKey = (d = new Date()) => `${addDaysIso(0)}T${String(d.getHours()).padStart(2, "0")}`;

// ---- now: this hour from the briefing's 48 hours, else the figures from when it ran ----
function wxNow(w) {
  const h = (w.hours || []).find((x) => x.time.slice(0, 13) === wxHourKey());
  const n = w.now || {};
  if (h)
    return {
      tempF: h.tempF,
      feelsF: h.feelsF != null ? h.feelsF : null,
      code: h.code,
      isDay: h.isDay,
      humidityPct: h.humidityPct,
      windMph: h.windMph,
      windDir: h.windDir,
      gustMph: null, // gusts are only measured at the run
      hourly: true,
    };
  return {
    tempF: w.currentF,
    feelsF: n.feelsF != null ? n.feelsF : null,
    code: w.code != null ? w.code : null,
    isDay: n.isDay !== false,
    humidityPct: n.humidityPct != null ? n.humidityPct : w.humidityPct,
    windMph: n.windMph != null ? n.windMph : null,
    windDir: n.windDir || null,
    gustMph: n.gustMph != null ? n.gustMph : null,
    hourly: false,
  };
}

// ---- NWS alerts: the briefing's, or fresher ones fetched here for a saved location ----
const WX_SEVERITY = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];
// Untrusted: [{event, severity, headline, ends}], most severe first, at most 5
function weatherAlerts(list) {
  const str = (v, n) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && typeof a === "object" && str(a.event, 80))
    .map((a) => ({
      event: str(a.event, 80),
      severity: WX_SEVERITY.includes(a.severity) ? a.severity : "Unknown",
      headline: str(a.headline, 240),
      ends: typeof a.ends === "string" && !isNaN(Date.parse(a.ends)) ? a.ends : null,
    }))
    .sort((a, b) => WX_SEVERITY.indexOf(a.severity) - WX_SEVERITY.indexOf(b.severity))
    .slice(0, 5);
}
let wxLive = null; // {key, at, alerts: [...] | null}
function wxRefreshAlerts() {
  const l = jarvisSettings.location;
  if (!l || typeof fetch !== "function") return;
  const key = `${l.lat},${l.lon}`;
  if (wxLive && wxLive.key === key && Date.now() - wxLive.at < 10 * 60 * 1000) return;
  wxLive = { key, at: Date.now(), alerts: wxLive && wxLive.key === key ? wxLive.alerts : null };
  fetch(`https://api.weather.gov/alerts/active?point=${l.lat.toFixed(4)},${l.lon.toFixed(4)}`, {
    headers: { Accept: "application/geo+json" },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j || !Array.isArray(j.features) || !wxLive || wxLive.key !== key) return;
      wxLive.alerts = weatherAlerts(
        j.features
          .map((f) => (f && f.properties) || {})
          .filter((p) => p.status !== "Test" && p.messageType !== "Cancel")
          .map((p) => ({ event: p.event, severity: p.severity, headline: p.headline, ends: p.ends || p.expires })),
      );
      if (typeof dashOpenKey !== "undefined" && dashOpenKey === "weather") renderHome();
    })
    .catch(() => {});
}
function wxAlertsHtml(w) {
  const live =
    wxLive && jarvisSettings.location && wxLive.key === `${jarvisSettings.location.lat},${jarvisSettings.location.lon}`
      ? wxLive.alerts
      : null;
  const list = (live || w.alerts || []).filter((a) => !a.ends || Date.parse(a.ends) > Date.now());
  return list
    .map(
      (a) => `<div class="wx-alert wx-alert-${a.severity.toLowerCase()}">
        <span class="wx-alert-ic">${WX_WARN}</span>
        <div><b>${escapeHtml(a.event)}</b>${a.ends ? ` <span class="wx-alert-until">until ${escapeHtml(wxEnds(a.ends))}</span>` : ""}
          ${a.headline ? `<p>${escapeHtml(a.headline)}</p>` : ""}
          <span class="wx-alert-src">National Weather Service${live ? "" : " · as of this morning"}</span></div>
      </div>`,
    )
    .join("");
}

// ---- the hero ----
function wxHeroHtml(w, now) {
  const kind = wxKind(now.code, now.code == null ? w.conditions : "");
  const words = now.code != null && WX_WORDS[now.code] ? WX_WORDS[now.code] : w.conditions;
  const place = w.location === "Your location" ? "Your location" : w.location || "Forecast";
  return `<div class="wx-hero wx-sky-${kind}${now.isDay ? "" : " wx-night"}">
    <div class="wx-place-pill">${WX_PIN}<span>${escapeHtml(place)}</span></div>
    <div class="wx-hero-main">
      <div>
        <div class="wx-now">${now.tempF != null ? `${now.tempF}<span class="wx-deg">°</span>` : "—"}</div>
        <div class="wx-cond">${escapeHtml(words)}</div>
        <div class="wx-hilo"><span aria-label="High">↑${w.highF}°</span> / <span aria-label="Low">↓${w.lowF}°</span></div>
        ${now.feelsF != null ? `<div class="wx-feels">Feels like ${now.feelsF}°</div>` : ""}
      </div>
      ${wxIcon(kind, now.isDay, "wx-hero-i")}
    </div>
  </div>`;
}

// ---- hourly: the hours from now, sideways, with a temperature line ----
function wxHourLabel(time, first) {
  if (first) return "Now";
  const h = Number(time.slice(11, 13));
  if (h === 0) return new Date(time.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}
function wxHourlyHtml(w) {
  const key = wxHourKey();
  let hrs = (w.hours || []).filter((h) => h.time.slice(0, 13) >= key).slice(0, 25);
  let fromNow = hrs.length && hrs[0].time.slice(0, 13) === key;
  if (hrs.length < 2) {
    // older briefings: today's waking hours
    hrs = (w.date === addDaysIso(0) ? w.hourlyRain : [])
      .filter((h) => h.tempF != null)
      .map((h) => ({
        time: `${w.date}T${String(h.hour).padStart(2, "0")}:00`,
        tempF: h.tempF,
        chance: h.chance,
        code: null,
        words: h.conditions,
        isDay: h.hour >= 7 && h.hour < 18,
      }));
    fromNow = false;
  }
  if (hrs.length < 2) return "";
  const COL = 60,
    H = 58;
  const temps = hrs.map((h) => h.tempF);
  const max = Math.max(...temps),
    span = max - Math.min(...temps) || 1;
  const pts = hrs.map((h, i) => [i * COL + COL / 2, Math.round(22 + ((max - h.tempF) / span) * 28)]);
  const cols = hrs
    .map((h, i) => {
      const words = h.code != null ? WX_WORDS[h.code] || "" : h.words || "";
      const label = wxHourLabel(h.time, i === 0 && fromNow);
      return `<li class="wx-hr" aria-label="${escapeAttr(`${label}: ${h.tempF}°, ${h.chance}% rain${words ? ", " + words : ""}`)}">
        <span class="wx-hr-t">${escapeHtml(label)}</span>${wxIcon(wxKind(h.code, words), h.isDay)}
        <span class="wx-hr-r${h.chance >= 50 ? " wet" : ""}">${WX_UMBRELLA}${h.chance}%</span></li>`;
    })
    .join("");
  const line = `<svg class="wx-hr-line" width="${hrs.length * COL}" height="${H}" viewBox="0 0 ${hrs.length * COL} ${H}" aria-hidden="true" focusable="false">
    <polyline points="${pts.map((p) => p.join(",")).join(" ")}"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5"/><text x="${p[0]}" y="${p[1] - 9}">${hrs[i].tempF}°</text>`).join("")}
  </svg>`;
  return `<div class="wx-head">Hourly</div>
    <div class="wx-hourly" tabindex="0" role="region" aria-label="Hour by hour (scrolls sideways)">
      <div class="wx-hourly-track"><ol class="wx-hrs">${cols}</ol>${line}</div>
    </div>`;
}

// ---- daily: the forecast days with day and night icons, then the long-range outlook ----
function wxDayRow(d, today) {
  const name =
    d.date === today ? "Today" : new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
  const dayKind = wxKind(d.code, d.code == null ? d.conditions : "");
  const night =
    d.nightCode != null ? wxIcon(wxKind(d.nightCode), false) : '<span class="wx-i" aria-hidden="true"></span>';
  const words = (d.code != null && WX_WORDS[d.code]) || d.conditions || "";
  const nightWords = d.nightCode != null ? WX_WORDS[d.nightCode] || "" : "";
  return `<li class="wx-day" aria-label="${escapeAttr(`${name}: ${words}${nightWords ? `, then ${nightWords.toLowerCase()} overnight` : ""}, high ${d.highF}°, low ${d.lowF}°, ${d.rainChance}% rain`)}">
    <span class="wx-day-n">${escapeHtml(name)}</span>
    <span class="wx-day-r${d.rainChance >= 50 ? " wet" : ""}">${WX_UMBRELLA}${d.rainChance}%</span>
    ${wxIcon(dayKind, true)}${night}
    <span class="wx-day-hi">${d.highF}°</span><span class="wx-day-lo">${d.lowF}°</span>
  </li>`;
}
function wxDailyHtml(w) {
  const today = addDaysIso(0);
  const days = (w.outlook || []).filter((d) => d.kind === "forecast" && d.date >= today);
  const later = (w.outlook || []).filter((d) => d.kind === "outlook" && d.date > today);
  const first = days
    .slice(0, 7)
    .map((d) => wxDayRow(d, today))
    .join("");
  const rest = days
    .slice(7)
    .map((d) => wxDayRow(d, today))
    .join("");
  return `${days.length ? `<div class="wx-head">Daily</div><ol class="wx-days">${first}</ol>` : ""}
    ${rest ? `<details class="wx-more"><summary>${days.length}-day forecast</summary><ol class="wx-days">${rest}</ol></details>` : ""}
    ${wxOutlookHtml(later)}`;
}
// Past the forecast (about day 17 to 90): by week, with every day under "Day by day". A trend, and it says so.
function jvDayLabel(iso, withDow = true) {
  return new Date(iso + "T12:00:00").toLocaleDateString(
    "en-US",
    withDow ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" },
  );
}
function jvDayRow(d) {
  return `<div class="jv-hour jv-day" role="row">
    <span role="cell" class="jv-hour-t">${escapeHtml(jvDayLabel(d.date))}</span>
    <span role="cell" class="jv-hour-temp">${d.highF}° <small>${d.lowF}°</small></span>
    <span role="cell" class="jv-hour-cond">${escapeHtml(d.conditions || (d.rainChance >= 50 ? "Leans wet" : "Leans dry"))}</span>
    <span role="cell" class="jv-hour-rain${d.rainChance >= 50 ? " wet" : ""}">${d.rainChance}%</span>
  </div>`;
}
function jvShiftIso(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function wxOutlookHtml(later) {
  if (!later.length) return "";
  const weeks = []; // Monday to Sunday
  for (const d of later) {
    const monday = jvShiftIso(d.date, -((new Date(d.date + "T12:00:00Z").getUTCDay() + 6) % 7));
    if (!weeks.length || weeks[weeks.length - 1].monday !== monday) weeks.push({ monday, days: [] });
    weeks[weeks.length - 1].days.push(d);
  }
  const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const weekRows = weeks
    .map((wk) => {
      const wet = wk.days.filter((d) => d.rainChance >= 50).length;
      return `<div class="jv-hour jv-day jv-week" role="row">
        <span role="cell" class="jv-hour-t">${escapeHtml(jvDayLabel(wk.days[0].date, false))}</span>
        <span role="cell" class="jv-hour-temp">${avg(wk.days.map((d) => d.highF))}° <small>${avg(wk.days.map((d) => d.lowF))}°</small></span>
        <span role="cell" class="jv-hour-cond">${wet ? `${wet} of ${wk.days.length} days lean wet` : "Leans dry"}</span>
      </div>`;
    })
    .join("");
  return `<details class="jv-outlook">
      <summary>Outlook to ${escapeHtml(jvDayLabel(later[later.length - 1].date, false))}</summary>
      <div class="jv-hours" role="table" aria-label="Outlook by week">${weekRows}</div>
      <details class="jv-outlook jv-outlook-days">
        <summary>Day by day</summary>
        <div class="jv-hours" role="table" aria-label="Outlook day by day">${later.map(jvDayRow).join("")}</div>
      </details>
    </details>`;
}

// ---- detail tiles ----
function wxTilesHtml(w, now) {
  const tiles = [];
  if (now.feelsF != null && now.tempF != null) {
    const diff = now.feelsF - now.tempF;
    tiles.push({
      label: "Feels like",
      value: `${now.feelsF}°`,
      sub:
        diff >= 3
          ? "Warmer than the actual temperature"
          : diff <= -3
            ? "Colder than the actual temperature"
            : "Close to the actual temperature",
    });
  }
  if (now.windMph != null)
    tiles.push({
      label: "Wind",
      value: `${now.windMph} mph`,
      sub:
        [now.windDir ? `From the ${now.windDir}` : "", now.gustMph ? `gusts ${now.gustMph} mph` : ""]
          .filter(Boolean)
          .join(", ") || "Calm",
    });
  if (now.humidityPct != null)
    tiles.push({
      label: "Humidity",
      value: `${now.humidityPct}%`,
      sub: now.humidityPct < 30 ? "Dry" : now.humidityPct < 60 ? "Comfortable" : "Humid",
    });
  if (w.uvMax != null)
    tiles.push({
      label: "UV index",
      value: `${w.uvMax}`,
      sub: `${jvUvLevel(w.uvMax)}${w.uvHigh ? `, ${jvHourLabel(w.uvHigh.from)}–${jvHourLabel(w.uvHigh.to % 24)}` : ""}: ${jvUvAdvice(w.uvMax)}`,
      warn: w.uvMax >= 6,
    });
  if (w.aqi != null) tiles.push({ label: "Air quality", value: `${w.aqi}`, sub: jvAqiLevel(w.aqi), warn: w.aqi > 100 });
  return `<div class="wx-tiles">${tiles
    .map(
      (t) =>
        `<div class="wx-tile${t.warn ? " warn" : ""}"><span class="wx-tile-l">${t.label}</span><b class="wx-tile-v">${escapeHtml(t.value)}</b><span class="wx-tile-s">${escapeHtml(t.sub)}</span></div>`,
    )
    .join("")}${jvPlaceHtml(w)}</div>`;
}

// ---- sunrise and sunset, with the sun's place on its arc ----
function wxSunHtml(w) {
  const sun = w.sun || [];
  const today = sun.find((s) => s.date === addDaysIso(0));
  const tomorrow = sun.find((s) => s.date === addDaysIso(1));
  if (!today) return "";
  const mins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const d = new Date();
  const nowM = d.getHours() * 60 + d.getMinutes(),
    rise = mins(today.rise),
    set = mins(today.set);
  let label, text, frac;
  if (nowM < rise) [label, text, frac] = ["Sunrise", `Sunrise will be at ${wxClock(today.rise)}`, 0];
  else if (nowM < set)
    [label, text, frac] = ["Sunset", `Sunset will be at ${wxClock(today.set)}`, (nowM - rise) / (set - rise)];
  else
    [label, text, frac] = [
      "Sunrise",
      tomorrow ? `Sunrise tomorrow at ${wxClock(tomorrow.rise)}` : `The sun set at ${wxClock(today.set)}`,
      1,
    ];
  const a = Math.PI * (1 - frac);
  const x = (60 + 48 * Math.cos(a)).toFixed(1),
    y = (56 - 48 * Math.sin(a)).toFixed(1);
  const up = frac > 0 && frac < 1;
  return `<div class="wx-sun">
    <div class="wx-sun-text"><span class="wx-tile-l">${label}</span><b>${escapeHtml(text)}</b></div>
    <svg class="wx-sun-arc" viewBox="0 0 120 72" aria-hidden="true" focusable="false">
      <path class="arc" d="M12 56A48 48 0 0 1 108 56"/>
      ${frac > 0 ? `<path class="arc-done" d="M12 56A48 48 0 0 1 ${x} ${y}"/>` : ""}
      <path class="horizon" d="M2 56h116"/>
      <circle class="sun-dot${up ? "" : " down"}" cx="${x}" cy="${y}" r="5"/>
      <text class="l" x="2" y="70">${wxClock(today.rise)}</text><text class="r" x="118" y="70">${wxClock(today.set)}</text>
    </svg>
  </div>`;
}

// ---- the Location tile: whose forecast it is, and the location buttons (coordinates are never shown) ----
function jvPlaceHtml(w) {
  const saved = jarvisSettings.location;
  const mine = w.location === "Your location";
  const sub = saved && !mine ? "Saved: the next briefing uses it" : mine ? "From your phone" : "The default city";
  return `<div class="wx-tile wx-loc jv-place"><span class="wx-tile-l">Location</span>
    <b class="wx-loc-v">${escapeHtml(w.location || "Not set")}</b><span class="wx-tile-s">${sub}</span>
    <div class="wx-loc-btns"><button type="button" class="jv-place-btn" data-action="wx-locate">${saved ? "Update" : "Use my location"}</button>
    ${saved ? `<button type="button" class="jv-place-btn" data-action="wx-unlocate">Forget</button>` : ""}</div></div>`;
}

function jarvisWeatherDetail(c) {
  if (!c) return "";
  if (c.status !== "ok") return jvErrorBody(c);
  const w = c.data;
  wxRefreshAlerts();
  const now = wxNow(w);
  return `${wxAlertsHtml(w)}${wxHeroHtml(w, now)}
    <p class="jv-lede wx-summary">${escapeHtml(w.summary)}</p>
    ${w.wear ? `<p class="jv-line"><b>Wear:</b> ${escapeHtml(w.wear)}</p>` : ""}
    ${w.washDay && w.washDayNote ? `<p class="jv-line jv-wash">${DROPLET_ICON}<span>${escapeHtml(w.washDayNote)}</span></p>` : ""}
    ${wxHourlyHtml(w)}${wxDailyHtml(w)}${wxSunHtml(w)}${wxTilesHtml(w, now)}${jvMeta(c)}`;
}
