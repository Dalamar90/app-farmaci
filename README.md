# Tracciamento effetto farmaci

Web app **mobile-first** (PWA) per tracciare durata e intensità dell'effetto dei farmaci nel tempo.
Tutti i dati restano **sul tuo dispositivo** (IndexedDB): nessun server, nessun account, nessun invio esterno.

## Avvio in locale (sul PC)

Serve un piccolo server web locale (i moduli JS e la PWA non funzionano aprendo il file con doppio clic).

**Con Python** (già installato sul tuo PC), dalla cartella del progetto:

```
python -m http.server 8000
```

Poi apri nel browser: <http://localhost:8000>

**Con Node**, in alternativa:

```
npx serve
```

## Installare sul telefono come app (PWA)

La PWA richiede una connessione sicura (HTTPS) o `localhost`. Due strade:

1. **Più semplice (consigliata)** – Pubblica la cartella su un hosting statico gratuito con HTTPS
   (es. Netlify Drop: trascini la cartella su <https://app.netlify.com/drop>, oppure GitHub Pages).
   Apri il link dal telefono → menu del browser → **"Aggiungi a schermata Home"**.
   I dati restano comunque solo sul telefono: l'hosting serve solo i file dell'app, non vede i tuoi dati.

2. **Solo rete locale** – Tieni il server acceso sul PC e apri l'IP del PC dal telefono
   (es. `http://192.168.1.x:8000`). Funziona, ma senza HTTPS l'installazione PWA e le notifiche
   potrebbero non essere disponibili: in tal caso usa la strada 1 per installarla davvero.

## Backup

Dalle **Impostazioni**: "Backup completo (JSON)" per salvare/ripristinare tutto, oppure
"Export CSV" per aprire i dati in un foglio di calcolo o portarli al medico.
Fai backup periodici: se cancelli i dati del browser, perdi i dati dell'app.

## Struttura

```
index.html              pagina unica (SPA)
manifest.webmanifest    config PWA
service-worker.js       cache offline
css/style.css           stile
lib/chart.umd.min.js    Chart.js (locale, per offline)
icons/                  icone app
js/
  app.js                avvio + navigazione
  db.js                 IndexedDB
  ui.js                 slider, bottom-sheet, toast
  icons.js              set di icone SVG
  util.js               helper
  defaults.js           dati iniziali (Ritalin IR, effetti, ecc.)
  stats.js              calcoli statistici
  reminders.js          promemoria EMA (notifiche)
  exportImport.js       backup JSON + export CSV
  nav.js                ponte di navigazione
  views/                home, forms, chart, diary, stats, settings
```

## Nota importante

App personale di osservazione: **non** è uno strumento diagnostico e **non** dà consigli medici
o sul dosaggio. Ogni modifica alla terapia va discussa con il medico.
