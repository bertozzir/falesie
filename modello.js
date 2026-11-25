// ==================================================
// modello.js - modello indicativo di bagnatura e asciugatura
// Qui ci sono SOLO le regole di calcolo (pesi, soglie, formule).
// Il download dei dati meteo sta in meteo.js.
// Indice 0 = probabilmente asciutta, 100 = molto bagnata
// ==================================================
(function () {

  function valido(v) {
    return typeof v === "number" && isFinite(v);
  }

  // Esposizione e quota, per esempio "SSW-700". "Varie" = nessun azimut.
  function leggiFalesia(valore) {
    var s = String(valore || "").trim().toUpperCase();
    var parti = s.split("-");
    // Accetta anche le sigle italiane: SO diventa SW, O diventa W, ecc.
    var esposizione = parti[0].trim().replace(/O/g, "W");
    var quota = parti.length > 1 ? Number(parti[1].trim()) : NaN;

    var direzioni = {
      N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
      E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
      S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
      W: 270, WNW: 292.5, NW: 315, NNW: 337.5
    };

    return {
      quota: valido(quota) && quota >= 0 ? quota : null,
      azimut: direzioni[esposizione] === undefined ? null : direzioni[esposizione]
    };
  }

  function fattoreEsposizione(azimut) {
    if (azimut === null) return 1;
    return 0.70 + 0.30 * Math.max(0, -Math.cos(azimut * Math.PI / 180));
  }

  // Calcola il nuovo indice dopo l'ora i della serie h.
  function aggiornaIndice(indice, h, i, falesia) {
    var pioggia = h.rain[i];
    var t = h.temperature_2m[i];
    var ur = h.relative_humidity_2m[i];
    var vento = h.wind_speed_10m[i];
    var sole = h.shortwave_radiation[i];

    if (valido(pioggia)) {
      indice += Math.min(35, Math.max(0, pioggia) * 13);
    }
    indice = Math.min(100, indice);

    if (valido(t) && valido(ur) && valido(vento) && valido(sole)) {
      var esposizione = fattoreEsposizione(falesia.azimut);
      var contributoSole = Math.max(0, sole) / 500 * esposizione;
      var contributoTemperatura = Math.max(0, Math.min(1, (t - 2) / 20));
      var contributoVento = Math.min(1, Math.max(0, vento) / 25);
      var penalitaUmidita = Math.max(0, Math.min(1, (ur - 55) / 45));
      var asciugatura =
        0.35 +
        1.5 * contributoSole +
        0.7 * contributoTemperatura +
        0.45 * contributoVento -
        0.8 * penalitaUmidita;

      indice -= Math.max(0.05, asciugatura);
    }
    return Math.max(0, Math.min(100, indice));
  }

  // Simula l'indice ora per ora: prima le 72 ore passate, poi le ore previste.
  // Restituisce:
  //   adesso  = indice all'ora corrente
  //   futuro  = mappa { timestamp in millisecondi : indice } per ogni ora prevista
  //   passato = mappa { timestamp : indice } per ogni ora trascorsa
  function simula(hPassato, hFuturo, falesia) {
    var indice = 0;
    var passato = {};
    for (var j = 0; j < hPassato.time.length; j++) {
      indice = aggiornaIndice(indice, hPassato, j, falesia);
      passato[Number(hPassato.time[j]) * 1000] = indice;
    }
    var adesso = indice;

    var futuro = {};
    for (var i = 0; i < hFuturo.time.length; i++) {
      indice = aggiornaIndice(indice, hFuturo, i, falesia);
      futuro[Number(hFuturo.time[i]) * 1000] = indice;
    }
    return { adesso: adesso, passato: passato, futuro: futuro };
  }

  window.Modello = {
    valido: valido,
    leggiFalesia: leggiFalesia,
    aggiornaIndice: aggiornaIndice,
    simula: simula
  };

})();
