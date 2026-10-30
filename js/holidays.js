// holidays.js - US holidays, worked out by rule for any year.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- US holidays ----------
// Worked out by rule, so every year is covered: the 11 federal holidays (with
// the weekday they're observed on when they land on a weekend; banks close)
// plus common observances.
const holidayCache = {};
function holidaysOf(year) {
  if (holidayCache[year]) return holidayCache[year];
  const out = {},
    add = (d, name, federal = false) => {
      const iso = isoDate(d);
      (out[iso] = out[iso] || []).push({ name, federal });
    };
  const on = (m, day) => new Date(year, m, day, 12);
  const nth = (m, dow, n) => {
    const d = on(m, 1);
    d.setDate(1 + ((dow - d.getDay() + 7) % 7) + 7 * (n - 1));
    return d;
  };
  const last = (m, dow) => {
    const d = new Date(year, m + 1, 0, 12);
    d.setDate(d.getDate() - ((d.getDay() - dow + 7) % 7));
    return d;
  };
  // fixed-date federal holidays move to Friday/Monday when they fall on a weekend
  const fixed = (d, name) => {
    add(d, name, true);
    const dow = d.getDay();
    if (dow === 6 || dow === 0) {
      const o = new Date(d);
      o.setDate(d.getDate() + (dow === 6 ? -1 : 1));
      if (o.getFullYear() === year) add(o, `${name} (observed)`, true);
    }
  };
  fixed(on(0, 1), "New Year's Day");
  if (new Date(year + 1, 0, 1, 12).getDay() === 6) add(on(11, 31), "New Year's Day (observed)", true);
  add(nth(0, 1, 3), "Martin Luther King Jr. Day", true);
  add(on(1, 14), "Valentine's Day");
  add(nth(1, 1, 3), "Presidents' Day", true);
  add(on(2, 17), "St. Patrick's Day");
  // Easter (anonymous Gregorian computus)
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  const em = Math.floor((h + l - 7 * m + 114) / 31) - 1,
    ed = ((h + l - 7 * m + 114) % 31) + 1;
  add(on(em, ed), "Easter");
  add(nth(4, 0, 2), "Mother's Day");
  add(last(4, 1), "Memorial Day", true);
  add(nth(5, 0, 3), "Father's Day");
  fixed(on(5, 19), "Juneteenth");
  fixed(on(6, 4), "Independence Day");
  add(nth(8, 1, 1), "Labor Day", true);
  add(nth(9, 1, 2), "Columbus Day", true);
  add(on(9, 31), "Halloween");
  const elect = nth(10, 1, 1);
  elect.setDate(elect.getDate() + 1);
  add(elect, "Election Day");
  fixed(on(10, 11), "Veterans Day");
  add(nth(10, 4, 4), "Thanksgiving", true);
  add(on(11, 24), "Christmas Eve");
  fixed(on(11, 25), "Christmas Day");
  add(on(11, 31), "New Year's Eve");
  return (holidayCache[year] = out);
}
function holidaysOn(iso) {
  return holidaysOf(Number(iso.slice(0, 4)))[iso] || [];
}
