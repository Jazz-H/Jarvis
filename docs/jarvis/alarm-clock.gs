// Jarvis alarm clock: a Google Apps Script that starts the briefing on time.
//
// GitHub runs this repo's scheduled workflows only every few hours, so the 6:45am cron is often
// missed. This script runs every 15 minutes in your Google account and asks GitHub to start:
//   - the briefing (jarvis.yml, mode "alarm") at about 6:45am, retried once about 45 minutes later
//   - the Weekly Review (mode "alarm-review") on Sundays at about 5:45pm, retried the same way
//   - check-ins (jarvis-ask.yml) once an hour; a run with nothing due stops in seconds
// Alarm runs are gated like scheduled ones (agents/lib/schedule.ts), so a retry or a late GitHub
// cron run never delivers twice.
//
// Setup: docs/jarvis/SETUP.md section 9. The only secret is GITHUB_TOKEN in Script Properties: a
// fine-grained token for this repo only with Actions read/write. It is never logged.

const REPO = "Jazz-H/Jazz2.0";
const TZ = "America/New_York";
const BRIEFING = "06:45"; // agents/config.ts briefingTime minus briefingLeadMinutes
const REVIEW = "17:45"; // reviewTime minus reviewLeadMinutes, on Sundays
const RETRY_MINUTES = 45;
const GIVE_UP = "12:00"; // no briefing start after this (the next GitHub cron run may still deliver)

// Run once by hand after pasting: makes the 15-minute trigger (and removes old ones)
function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("tick").timeBased().everyMinutes(15).create();
  tick();
}

function tick() {
  const now = new Date();
  const day = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
  const hhmm = Utilities.formatDate(now, TZ, "HH:mm");
  const sunday = Utilities.formatDate(now, TZ, "u") === "7";
  const props = PropertiesService.getScriptProperties();

  if (hhmm >= BRIEFING && hhmm < GIVE_UP) twice(props, "briefing", day, now, () => start("jarvis.yml", { mode: "alarm" }));
  if (sunday && hhmm >= REVIEW && hhmm < "20:00") twice(props, "review", day, now, () => start("jarvis.yml", { mode: "alarm-review" }));

  const hour = day + " " + hhmm.slice(0, 2);
  if (props.getProperty("checkins") !== hour && start("jarvis-ask.yml", { id: "alarm-checkins" })) props.setProperty("checkins", hour);
}

// At most two starts a day per job, RETRY_MINUTES apart; a failed request is tried again next tick
function twice(props, key, day, now, go) {
  const last = JSON.parse(props.getProperty(key) || "{}");
  const n = last.day === day ? last.n : 0;
  if (n >= 2 || (n === 1 && now.getTime() - last.at < RETRY_MINUTES * 60e3)) return;
  if (go()) props.setProperty(key, JSON.stringify({ day, n: n + 1, at: now.getTime() }));
}

function start(workflow, inputs) {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("Add GITHUB_TOKEN in Project Settings → Script Properties");
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    payload: JSON.stringify({ ref: "main", inputs }),
    muteHttpExceptions: true,
  });
  const ok = res.getResponseCode() === 204;
  if (!ok) console.warn(`${workflow}: GitHub said ${res.getResponseCode()}`); // the status only, never the token
  return ok;
}
