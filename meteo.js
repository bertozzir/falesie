// ==================================================
// meteo.js - calcolo dell'indice di bagnatura nel browser
// Traduzione dello script Google "Meteo_Crags.gs"
// ==================================================
(function () {

  var FUSO = "Europe/Rome";
  var URL_STORICO = "https://historical-forecast-api.open-meteo.com/v1/forecast";
  var URL_PREVISIONI = "https://api.open-meteo.com/v1/forecast";
  var DIM_GRUPPO = 10; // falesie per ogni richiesta

  var VARIABILI = [
    "rain",
    "wind_speed_10m",
    "wind_direction_10m",
    "evapotranspiration",
    "shortwave_radiation",
    "temperature_2m",
    "relative_humidity_2m"
  ];

  // --------------------------------------------------
  // FUNZIONI DI UTILITA
  // --------------------------------------------------

  function valido(v) {
    return typeof v === "number" && isFinite(v);
  }

  function somma(a) {
    return a.filter(valido).reduce(function (s, v) { return s + v; }, 0);
  }

  function media(a) {
    var validi = a.filter(valido);
    return validi.length
      ? validi.reduce(function (s, v) { return s + v; }, 0) / validi.length
      : null;
  }

  function arrotonda(v, decimali) {
    if (!valido(v)) return null;
    var m = Math.pow(10, decimali);
    return Math.round(v * m) / m;
  }

  // Media circolare: gestisce direzioni del vento come 350 e 10 gradi.
  function mediaCircolare(a) {
    var validi = a.filter(valido);
    if (!validi.length) return null;
    var x = 0, y = 0;
    validi.forEach(function (g) {
      x += Math.cos(g * Math.PI / 180);
      y += Math.sin(g * Math.PI / 180);
    });
    if (Math.hypot(x, y) < 1e-8) return null;
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // Data "yyyy-MM-dd" nel fuso italiano.
  function dataIso(ms) {
    return new Date(ms).toLocaleDateString("sv-SE", { timeZone: FUSO });
  }

  // Data e ora "dd/MM/yyyy<sep>HH:mm" nel fuso italiano.
  function dataOraIt(ms, sep) {
    var p = {};
    new Intl.DateTimeFormat("it-IT", {
      timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p.day + "/" + p.month + "/" + p.year + sep + p.hour + ":" + p.minute;
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

  // --------------------------------------------------
  // RICHIESTE A OPEN-METEO
  // --------------------------------------------------

  function attendi(ms) {
    return new Promise(function (ok) { setTimeout(ok, ms); });
  }

  async function scarica(url) {
    var ultimoErrore;
    for (var tentativo = 0; tentativo < 2; tentativo++) {
      try {
        var r = await fetch(url);
        if (!r.ok) {
          var t = await r.text();
          throw new Error("Errore API " + r.status + ": " + t.slice(0, 200));
        }
        return await r.json();
      } catch (e) {
        ultimoErrore = e;
        await attendi(1000);
      }
    }
    throw ultimoErrore;
  }

  // Chiede i dati orari per un gruppo di falesie in una sola richiesta.
  async function richiesta(endpoint, gruppoFalesie, parametri) {
    var url = endpoint +
      "?latitude=" + gruppoFalesie.map(function (f) { return f.lat; }).join(",") +
      "&longitude=" + gruppoFalesie.map(function (f) { return f.lon; }).join(",") +
      "&elevation=" + gruppoFalesie.map(function (f) {
        var q = leggiFalesia(f.esp).quota;
        return q === null ? 500 : q;
      }).join(",") +
      "&hourly=" + VARIABILI.join(",") +
      "&timezone=" + encodeURIComponent(FUSO) +
      "&timeformat=unixtime" +
      parametri;

    var json = await scarica(url);
    var elenco = Array.isArray(json) ? json : [json];

    if (elenco.length !== gruppoFalesie.length) {
      throw new Error("Risposta incompleta dal servizio meteo");
    }
    return elenco.map(function (x) {
      if (!x.hourly || !x.hourly.time) throw new Error("Serie orarie non disponibili");
      return x.hourly;
    });
  }

  // Trasforma le serie in una mappa indicizzata per timestamp (millisecondi).
  function indicizza(h) {
    var mappa = {};
    h.time.forEach(function (t, i) {
      var ts = Number(t) * 1000;
      if (!isFinite(ts)) return;
      var riga = {};
      VARIABILI.forEach(function (v) {
        riga[v] = h[v] && h[v][i] !== undefined ? h[v][i] : null;
      });
      mappa[ts] = riga;
    });
    return mappa;
  }

  // Ricostruisce le serie ordinate (tempo in secondi) da una mappa.
  function serieDaMappa(tempi, mappa) {
    var serie = { time: tempi.map(function (ts) { return ts / 1000; }) };
    VARIABILI.forEach(function (v) {
      serie[v] = tempi.map(function (ts) { return mappa[ts][v]; });
    });
    return serie;
  }

  // --------------------------------------------------
  // MODELLO INDICATIVO DI BAGNATURA E ASCIUGATURA
  // Indice 0 = probabilmente asciutta, 100 = molto bagnata
  // --------------------------------------------------

  function fattoreEsposizione(azimut) {
    if (azimut === null) return 1;
    return 0.70 + 0.30 * Math.max(0, -Math.cos(azimut * Math.PI / 180));
  }

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
      var quota = falesia.quota === null ? 500 : falesia.quota;
      var penalitaQuota = Math.max(0, Math.min(0.35, (quota - 500) / 4000));

      var asciugatura =
        0.35 +
        1.5 * contributoSole +
        0.7 * contributoTemperatura +
        0.45 * contributoVento -
        0.8 * penalitaUmidita -
        0.4 * penalitaQuota;

      indice -= Math.max(0.05, asciugatura);
    }
    return Math.max(0, Math.min(100, indice));
  }

  // Pioggia totale prevista nelle ore indicate (mm). null = dati insufficienti.
  function pioggiaNelleProssimeOre(previsioni, daMs, ore) {
    var limiteMs = daMs + ore * 3600000;
    var totale = 0, conteggio = 0;
    for (var i = 0; i < previsioni.time.length; i++) {
      var timestamp = Number(previsioni.time[i]) * 1000;
      if (!isFinite(timestamp) || timestamp <= daMs || timestamp > limiteMs) continue;
      if (valido(previsioni.rain[i])) {
        totale += Math.max(0, previsioni.rain[i]);
        conteggio++;
      }
    }
    return conteggio > 0 ? totale : null;
  }

  // Stima quando la falesia tornerà asciutta, simulando anche la pioggia futura.
  function descrizioneAsciugatura(indice, previsioni, falesia, adessoMs) {
    if (!previsioni || !previsioni.time || previsioni.time.length === 0) {
      return "Stima impossibile: previsioni non disponibili";
    }

    var pioggiaVicino = pioggiaNelleProssimeOre(previsioni, adessoMs, 3);

    if (indice < 35 && pioggiaVicino !== null && pioggiaVicino < 0.2) {
      return "Asciutta";
    }

    var simulato = indice;
    if (indice < 35 && pioggiaVicino !== null && pioggiaVicino >= 0.2) {
      simulato = 35;
    }

    var ultimoTimestamp = 0;
    var ultimoTimestampPrevisione = 0;
    var oreValide = 0;

    for (var i = 0; i < previsioni.time.length; i++) {
      var timestamp = Number(previsioni.time[i]) * 1000;

      if (!isFinite(timestamp) || timestamp <= adessoMs || timestamp <= ultimoTimestamp) {
        continue;
      }
      ultimoTimestamp = timestamp;
      ultimoTimestampPrevisione = timestamp;

      if (!valido(previsioni.rain[i]) ||
          !valido(previsioni.temperature_2m[i]) ||
          !valido(previsioni.relative_humidity_2m[i]) ||
          !valido(previsioni.wind_speed_10m[i]) ||
          !valido(previsioni.shortwave_radiation[i])) {
        continue;
      }

      simulato = aggiornaIndice(simulato, previsioni, i, falesia);

      if (previsioni.rain[i] >= 0.2) {
        simulato = Math.max(simulato, 35);
      }
      oreValide++;

      var pioggiaNelPeriodo = pioggiaNelleProssimeOre(previsioni, timestamp - 3600000, 3);

      if (simulato < 35 &&
          previsioni.rain[i] < 0.2 &&
          pioggiaNelPeriodo !== null &&
          pioggiaNelPeriodo < 0.2) {
        return "Asciugatura stimata: " + dataOraIt(timestamp, " alle ");
      }
    }

    if (oreValide === 0) {
      return "Stima impossibile: dati previsionali insufficienti";
    }
    return "Stimata asciutta entro " + dataOraIt(ultimoTimestampPrevisione, " alle ");
  }

  // --------------------------------------------------
  // ELABORAZIONE DI UNA FALESIA
  // --------------------------------------------------

  function elabora(f, storico, previsione, ctx) {
    var falesia = leggiFalesia(f.esp);

    if (!valido(f.lat) || !valido(f.lon) || Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180) {
      throw new Error("Coordinate non valide");
    }

    var mappaStorico = indicizza(storico);
    var mappaPrevisioni = indicizza(previsione);

    // Se manca l'ora corrente nello storico, la prendo dalla previsione.
    if (!mappaStorico[ctx.oraCorrente] && mappaPrevisioni[ctx.oraCorrente]) {
      mappaStorico[ctx.oraCorrente] = mappaPrevisioni[ctx.oraCorrente];
    }

    var tempiPassati = Object.keys(mappaStorico).map(Number)
      .filter(function (ts) { return ts >= ctx.inizioPeriodo && ts <= ctx.oraCorrente; })
      .sort(function (a, b) { return a - b; });

    if (!tempiPassati.length) {
      throw new Error("Nessun dato disponibile nelle ultime 72 ore");
    }

    var hPassato = serieDaMappa(tempiPassati, mappaStorico);

    var tempiFuturi = Object.keys(mappaPrevisioni).map(Number)
      .filter(function (ts) { return ts > ctx.oraCorrente; })
      .sort(function (a, b) { return a - b; });

    var hFuturo = serieDaMappa(tempiFuturi, mappaPrevisioni);

    // Ricostruisce l'indice dalle ore piu' vecchie alle piu' recenti.
    var indice = 0;
    for (var j = 0; j < hPassato.time.length; j++) {
      indice = aggiornaIndice(indice, hPassato, j, falesia);
    }

    var pioggia3h = pioggiaNelleProssimeOre(hFuturo, ctx.adessoMs, 3);

    return {
      p72: arrotonda(somma(hPassato.rain), 1),
      vento: arrotonda(media(hPassato.wind_speed_10m), 1),
      dir: arrotonda(mediaCircolare(hPassato.wind_direction_10m), 0),
      evapo: arrotonda(somma(hPassato.evapotranspiration), 2),
      rad: arrotonda(media(hPassato.shortwave_radiation), 1),
      temp: arrotonda(media(hPassato.temperature_2m), 1),
      um: arrotonda(media(hPassato.relative_humidity_2m), 1),
      indice: Math.round(indice),
      p3h: arrotonda(pioggia3h, 1),
      stima: descrizioneAsciugatura(indice, hFuturo, falesia, ctx.adessoMs)
    };
  }

  // --------------------------------------------------
  // FUNZIONE PRINCIPALE, chiamata dalla pagina
  // calcolaMeteo(falesie, progresso) -> Promise
  // --------------------------------------------------

  window.calcolaMeteo = async function (falesie, progresso) {
    var adessoMs = Date.now();
    var oraCorrente = Math.floor(adessoMs / 3600000) * 3600000;
    var ctx = {
      adessoMs: adessoMs,
      oraCorrente: oraCorrente,
      inizioPeriodo: oraCorrente - 72 * 3600000
    };
    var dataInizio = dataIso(ctx.inizioPeriodo);
    var dataFine = dataIso(oraCorrente);

    var risultati = [];
    var errori = [];

    for (var da = 0; da < falesie.length; da += DIM_GRUPPO) {
      var gruppoFalesie = falesie.slice(da, da + DIM_GRUPPO);

      if (progresso) progresso(da, falesie.length);

      try {
        var risposte = await Promise.all([
          richiesta(URL_STORICO, gruppoFalesie,
            "&start_date=" + dataInizio + "&end_date=" + dataFine),
          richiesta(URL_PREVISIONI, gruppoFalesie, "&forecast_days=4")
        ]);

        gruppoFalesie.forEach(function (f, k) {
          try {
            risultati.push(Object.assign({}, f, elabora(f, risposte[0][k], risposte[1][k], ctx)));
          } catch (e) {
            errori.push(f.nome + ": " + e.message);
            risultati.push(Object.assign({}, f, { indice: null, p3h: null, stima: "Errore nel calcolo" }));
          }
        });
      } catch (e) {
        gruppoFalesie.forEach(function (f) {
          errori.push(f.nome + ": " + e.message);
          risultati.push(Object.assign({}, f, { indice: null, p3h: null, stima: "Errore nel calcolo" }));
        });
      }
    }

    if (progresso) progresso(falesie.length, falesie.length);

    return {
      aggiornato: dataOraIt(adessoMs, " "),
      falesie: risultati,
      errori: errori
    };
  };

})();
