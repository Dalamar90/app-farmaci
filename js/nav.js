// nav.js — piccolo "ponte" di navigazione condiviso, per evitare import circolari.
// app.js assegna le funzioni reali; le viste chiamano nav.go(...) / nav.refresh().
export const nav = {
  go: (_name) => {},      // naviga a una vista ('home' | 'chart' | 'diary' | 'stats')
  refresh: () => {},      // ridisegna la vista corrente
};
