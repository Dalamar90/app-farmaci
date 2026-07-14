// ics.js — genera un file calendario (.ics) coi promemoria e lo consegna al
// dispositivo. Il calendario nativo (iPhone/Android) fa suonare gli avvisi in
// modo affidabile ANCHE con l'app chiusa, senza bisogno di alcun server.
//
// Sono solo solleciti a registrare "come mi sento": NON sono consigli medici.

function pad(n) { return String(n).padStart(2, '0'); }

// Data in formato ICS UTC: 20260713T143000Z
function toICSDate(d) {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}

// Caratteri speciali da proteggere nei campi di testo ICS.
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// events: [{ uid, at (ISO), summary, description }]
export function buildIcs(events) {
  const now = toICSDate(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//app-farmaci//promemoria effetto//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const ev of events) {
    const start = new Date(ev.at);
    const end = new Date(start.getTime() + 5 * 60000); // eventino di 5 minuti
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + ev.uid,
      'DTSTAMP:' + now,
      'DTSTART:' + toICSDate(start),
      'DTEND:' + toICSDate(end),
      'SUMMARY:' + esc(ev.summary),
      ev.description ? 'DESCRIPTION:' + esc(ev.description) : null,
      // Avviso che suona esattamente all'ora dell'evento.
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + esc(ev.summary),
      'TRIGGER;VALUE=DATE-TIME:' + toICSDate(start),
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.filter((l) => l != null).join('\r\n');
}

// Consegna il file: sul telefono prova la condivisione (così puoi scegliere
// "Calendario"); altrimenti (o su PC) scarica il .ics, che il sistema apre col
// calendario. Ritorna 'shared' | 'downloaded' | 'cancelled'.
export async function addToCalendar(filename, ics) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const file = (typeof File !== 'undefined') ? new File([blob], filename, { type: 'text/calendar' }) : null;

  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Promemoria effetto' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // qualunque altro errore: proviamo il download qui sotto
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
