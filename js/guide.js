// guide.js — Guida dell'app, in un pannello laterale che si apre dal "?"
// nell'intestazione. Non compare mai da sola: si legge quando serve.
// Sezioni a fisarmonica (<details>): l'indice si vede tutto, si apre solo il pezzo
// che interessa. È fuori dal flusso quotidiano, quindi qui un pannello va bene.

import { el } from './util.js';
import { icon } from './icons.js';
import { openDrawer } from './ui.js';

// Una sezione richiudibile. `open` la lascia aperta all'apertura della guida.
function section(title, paragraphs, { open = false } = {}) {
  return el('details', { class: 'guide-sec', ...(open ? { open: 'open' } : {}) },
    el('summary', { class: 'guide-sum' }, title),
    el('div', { class: 'guide-txt' }, ...paragraphs.map((p) => (typeof p === 'string' ? el('p', {}, p) : p))),
  );
}

// Elenco puntato dentro una sezione.
function list(items) {
  return el('ul', { class: 'guide-list' }, ...items.map((t) => el('li', {}, t)));
}

// I quattro momenti, con la loro icona: sono il vocabolario dell'app.
function moments() {
  const rows = [
    ['start', 'Inizio effetto', 'quando senti che ha cominciato a fare qualcosa.'],
    ['peak', 'Picco', 'il punto più alto, quando l\'effetto è al massimo.'],
    ['decline', 'Inizio calo', 'quando cominci a sentire che sta scendendo.'],
    ['end', 'Effetto finito', 'quando non lo senti più.'],
  ];
  return el('div', { class: 'guide-moments' },
    ...rows.map(([key, label, desc]) => el('div', { class: 'guide-moment' },
      el('span', { class: 'guide-moment-ico' }, icon('m-' + key, { size: 15 })),
      el('span', {}, el('strong', {}, label), ' — ' + desc),
    )),
  );
}

export function openGuide() {
  const body = el('div', { class: 'guide' });

  body.append(el('p', { class: 'guide-intro' },
    'Questa app serve a ricostruire la curva reale del tuo farmaco: quando inizia a fare effetto, quando è al massimo, quando finisce. Non su uno schema teorico, ma su quello che registri tu, dose dopo dose.'));

  body.append(section('Come si comincia', [
    'Non c\'è niente da configurare prima: il farmaco nasce dalla prima dose.',
    list([
      'Vai su Giorno › Dose, scrivi il nome del farmaco e i mg, e salva.',
      'Da lì in poi il nome è già lì e i mg diventano un pulsante rapido.',
      'Per cambiare nome, aggiungere farmaci o altre dosi rapide: Impostazioni › Farmaci.',
    ]),
    'Ogni voce chiede solo l\'ora, perché il giorno lo scegli una volta sola in alto.',
  ], { open: true }));

  body.append(section('La curva e i quattro momenti', [
    'La curva è il filo che lega le tue registrazioni: sale, arriva al picco, scende. I quattro momenti sono le tappe che la disegnano.',
    moments(),
    'Si timbrano da "Come mi sento": scegli un momento solo (quello che stai vivendo adesso) e viene registrato all\'ora che hai scritto. Se non è una tappa, lascia stare: è facoltativo.',
  ]));

  body.append(section('Come mi sento', [
    'È la registrazione del momento: quattro cursori da 0 a 10 — intensità dell\'effetto, concentrazione, energia, umore.',
    'Falla quando la senti, non a fine giornata a memoria: è tutto il senso dell\'app. Più punti registri, più la curva è vera.',
  ]));

  body.append(section('Coda ed effetti collaterali', [
    'La coda è l\'esaurimento dell\'effetto: stanchezza, irritabilità, calo di umore quando il farmaco se ne va. Registrala quando arriva.',
    'Gli effetti collaterali sono un\'altra cosa: sposti solo i cursori di quelli presenti, gli altri restano a 0 e non vengono salvati. La lista si modifica da Impostazioni › Effetti collaterali.',
  ]));

  body.append(section('Promemoria nel calendario', [
    'Si attivano da Impostazioni › Promemoria effetto, e sono facoltativi.',
    'Quando registri una dose, l\'app ti propone "Aggiungi al calendario": crea gli appuntamenti nei momenti che hai scelto (di serie il picco e la fine), così il telefono ti avvisa di registrare come stai anche con l\'app chiusa.',
    'Sono eventi del tuo calendario, non notifiche dell\'app: funzionano senza server e senza che nulla esca dal telefono. Il prezzo è un tocco per dose — il browser non può scrivere nel calendario da solo.',
    'Con qualche dose registrata compare anche un pulsante per adottare i tuoi tempi medi reali al posto di quelli proposti.',
  ]));

  body.append(section('Le viste', [
    list([
      'Giorno: dove registri tutto e vedi la curva della giornata.',
      'Settimana: le dosi assunte lun-dom, giorno per giorno. Tocca un giorno per aprirlo.',
      'Confronto: più dosi sovrapposte sullo stesso grafico, per vedere se si somigliano.',
      'Diario: tutto quello che hai registrato, con i filtri.',
      'Statistiche: le medie per farmaco e gli effetti collaterali più frequenti.',
    ]),
  ]));

  body.append(section('I dati e i backup', [
    'I dati stanno solo su questo dispositivo: nessun account, nessun server, niente che parta da qui. Se cancelli i dati del browser, spariscono.',
    'Per averli anche altrove: Impostazioni › Dati e backup, scarica (o invia) il backup da un dispositivo e importalo sull\'altro.',
    list([
      'Unisci: aggiunge e aggiorna senza cancellare niente. Per ogni voce vince la versione più recente. È quella da usare quasi sempre.',
      'Sostituisci tutto: butta i dati di questo dispositivo e tiene solo quelli del backup.',
    ]),
  ]));

  body.append(el('p', { class: 'guide-legal' },
    'Questa app è uno strumento personale di osservazione: non è uno strumento diagnostico e non dà consigli medici o sul dosaggio. Ogni modifica alla terapia va discussa col medico.'));

  openDrawer('Guida', body);
}
