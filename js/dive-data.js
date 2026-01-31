/**
 * Extract dive data from parsed FIT messages.
 */
import { parseFIT, garminTimestampToDate } from './fit-parser.js';

const MESG = {
  SESSION: 18, LAP: 19, RECORD: 20, EVENT: 21,
  DIVE_SUMMARY: 268, DIVE_GAS: 259,
};

// Record field IDs (from actual Garmin Descent dive FIT data)
const F = {
  TIMESTAMP: 253,
  DEPTH: 92,           // uint32, scale 1000 (mm -> m)
  ASCENT_RATE: 127,    // sint32, scale 1000 (mm/s -> m/s)
  TEMPERATURE: 13,     // sint8, °C
  HEART_RATE: 3,
  PRESSURE: 91,        // absolute pressure in Pa
  NDL: 96,
  CNS: 93,
};

// Session field IDs
const SF = {
  TIMESTAMP: 253,
  START_TIME: 2,
  TOTAL_ELAPSED_TIME: 7,
  TOTAL_TIMER_TIME: 8,
  SPORT: 5,
  SUB_SPORT: 6,
};

// Dive summary field IDs (mesgNum 268)
const DS = {
  AVG_DEPTH: 2,   // uint32, scale 1000
  MAX_DEPTH: 3,   // uint32, scale 1000
};

export function extractDiveFromBuffer(arrayBuffer) {
  const messages = parseFIT(arrayBuffer);

  // Filter record messages
  const records = messages.filter(m => m._mesgNum === MESG.RECORD);
  const sessions = messages.filter(m => m._mesgNum === MESG.SESSION);
  const diveSummaries = messages.filter(m => m._mesgNum === MESG.DIVE_SUMMARY);

  if (records.length === 0) {
    throw new Error('No dive records found in FIT file');
  }

  // Build time series
  const firstTs = records[0][F.TIMESTAMP];
  const samples = records.map(r => {
    const ts = r[F.TIMESTAMP];
    const elapsed = ts - firstTs; // seconds from start
    const depth = r[F.DEPTH] != null ? r[F.DEPTH] / 1000 : null; // scale 1000
    const ascentRate = r[F.ASCENT_RATE] != null ? r[F.ASCENT_RATE] / 1000 : null; // scale 1000, m/s
    const temperature = r[F.TEMPERATURE];
    const ndl = r[F.NDL];
    const cns = r[F.CNS];

    return { elapsed, depth, ascentRate, temperature, ndl, cns };
  });

  // Compute ascent rate from depth when not available
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].ascentRate == null && samples[i].depth != null && samples[i - 1].depth != null) {
      const dt = samples[i].elapsed - samples[i - 1].elapsed;
      if (dt > 0) {
        samples[i].ascentRate = (samples[i - 1].depth - samples[i].depth) / dt;
      }
    }
  }

  // Session info
  const session = sessions[0] || {};
  const summary = diveSummaries[0] || {};
  const startDate = garminTimestampToDate(session[SF.START_TIME] || firstTs);
  const totalTime = session[SF.TOTAL_ELAPSED_TIME]
    ? session[SF.TOTAL_ELAPSED_TIME] / 1000
    : samples[samples.length - 1].elapsed;
  const maxDepth = summary[DS.MAX_DEPTH]
    ? summary[DS.MAX_DEPTH] / 1000
    : Math.max(...samples.map(s => s.depth || 0));
  const avgDepth = summary[DS.AVG_DEPTH]
    ? summary[DS.AVG_DEPTH] / 1000
    : null;
  // Get min temp from samples
  const temps = samples.map(s => s.temperature).filter(t => t != null);
  const minTemp = temps.length ? Math.min(...temps) : null;
  const maxTemp = temps.length ? Math.max(...temps) : null;

  return {
    startDate,
    totalTime,    // seconds
    maxDepth,     // meters
    avgDepth,
    minTemp,
    maxTemp,
    samples,
  };
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDate(date) {
  if (!date) return '—';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
