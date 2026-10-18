// Calendar + price sync for the Sukna site. Runs every 15 minutes from GitHub Actions.
//  - Imports booked nights from the platforms' iCal links (repo secrets ICAL_HOMEY, ICAL_WAHA, ICAL_OLIVE, ICAL_STUDIO;
//    each secret may hold several links separated by spaces or new lines: Airbnb, Booking.com, Gathern).
//  - Exports the site's own direct bookings as ical/<unit>.ics so the platforms can import them.
//  - Optionally refreshes nightly prices from PriceLabs when PRICELABS_API_KEY is set.
import { readFile, writeFile } from 'node:fs/promises';

const PROJECT = 'sukna-65778';
const UNITS = {
  homey:  { name: 'Homey Inn',    secret: 'ICAL_HOMEY',  pricelabs: { id: '780418002322269786',  pms: 'airbnb' } },
  waha:   { name: 'Waha Grand',   secret: 'ICAL_WAHA',   pricelabs: { id: '1541569659498402861', pms: 'airbnb' } },
  olive:  { name: 'Olive APT',    secret: 'ICAL_OLIVE',  pricelabs: { id: '1641543760096782306', pms: 'airbnb' } },
  studio: { name: 'Olive Studio', secret: 'ICAL_STUDIO', pricelabs: null },
};

const today = new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const icsDate = (v) => v && v.match(/(\d{4})(\d{2})(\d{2})/) ? v.replace(/^(\d{4})(\d{2})(\d{2}).*$/, '$1-$2-$3') : null;

function parseIcs(text) {
  const nights = new Set();
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  for (const ev of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const start = icsDate((ev.match(/DTSTART[^:]*:([0-9TZ]+)/) || [])[1]);
    let end = icsDate((ev.match(/DTEND[^:]*:([0-9TZ]+)/) || [])[1]);
    if (!start) continue;
    if (!end || end <= start) end = addDays(start, 1);
    for (let d = start; d < end; d = addDays(d, 1)) if (d >= today) nights.add(d);
  }
  return nights;
}

async function importCalendars() {
  const blocked = {};
  const status = {};
  for (const [id, u] of Object.entries(UNITS)) {
    const urls = (process.env[u.secret] || '').split(/\s+/).filter(Boolean);
    const set = new Set();
    status[id] = { links: urls.length, ok: 0 };
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'sukna-sync/1.0' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        for (const d of parseIcs(await r.text())) set.add(d);
        status[id].ok++;
      } catch (e) {
        console.warn(`[${id}] calendar failed: ${e.message}`);
      }
    }
    blocked[id] = [...set].sort();
  }
  return { blocked, status };
}

async function directBlocks() {
  const out = {};
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/blocks?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    let r;
    try { r = await fetch(url); } catch (e) { console.warn('Firestore read failed', e.message); break; }
    if (!r.ok) { console.warn('Firestore read failed', r.status); break; }
    const j = await r.json();
    for (const doc of j.documents || []) {
      const f = doc.fields || {};
      const unit = f.unit?.stringValue, date = f.date?.stringValue, code = f.code?.stringValue || 'SUKNA';
      if (!unit || !date || date < today) continue;
      (out[unit] ||= []).push({ date, code });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

function buildIcs(unitId, rows) {
  const u = UNITS[unitId];
  const byCode = {};
  for (const r of rows || []) (byCode[r.code] ||= []).push(r.date);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sukna//Direct bookings//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:Sukna direct - ${u.name}`];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  for (const [code, dates] of Object.entries(byCode)) {
    dates.sort();
    // group consecutive nights into one event
    let start = dates[0], prev = dates[0];
    const flush = (s, last) => {
      lines.push('BEGIN:VEVENT', `UID:${code}-${s}@sukna`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(last, 1).replace(/-/g, '')}`,
        'SUMMARY:Reserved (direct)', 'END:VEVENT');
    };
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] !== addDays(prev, 1)) { flush(start, prev); start = dates[i]; }
      prev = dates[i];
    }
    flush(start, prev);
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

async function refreshPrices() {
  const key = process.env.PRICELABS_API_KEY;
  if (!key) return false;
  const file = JSON.parse(await readFile('data/prices.json', 'utf8'));
  const to = addDays(today, 365);
  let changed = false;
  for (const [id, u] of Object.entries(UNITS)) {
    if (!u.pricelabs) continue;
    try {
      const r = await fetch('https://api.pricelabs.co/v1/listing_prices', {
        method: 'POST',
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ listings: [{ id: u.pricelabs.id, pms: u.pricelabs.pms, dateFrom: today, dateTo: to }] }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const rows = (Array.isArray(j) ? j[0] : j?.data?.[0])?.data || [];
      if (!rows.length) throw new Error('no rows');
      const map = {};
      for (const row of rows) map[row.date] = row.user_price > 0 ? Math.round(row.user_price) : 0;
      file.prices[id] = map;
      changed = true;
    } catch (e) {
      console.warn(`[${id}] PriceLabs failed: ${e.message}`);
    }
  }
  if (changed) {
    file.updated = today;
    file.source = 'PriceLabs (0 = booked on another platform)';
    await writeFile('data/prices.json', JSON.stringify(file, null, 0));
  }
  return changed;
}

const { blocked, status } = await importCalendars();
await writeFile('data/blocked.json', JSON.stringify({ updated: new Date().toISOString(), status, blocked }, null, 1));
const direct = await directBlocks();
for (const id of Object.keys(UNITS)) await writeFile(`ical/${id}.ics`, buildIcs(id, direct[id]));
await refreshPrices();
console.log('sync done', JSON.stringify(status));
