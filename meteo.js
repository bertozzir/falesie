// ==================================================
// meteo.js - calcolo dell'indice di bagnatura nel browser
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

  // Ora del giorno (0-23) nel fuso italiano.
  function oraDelGiorno(ms) {
    var parti = new Intl.DateTimeFormat("it-IT", {
      timeZone: FUSO, hour: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(ms));
    for (var i = 0; i < parti.length; i++) {
      if (parti[i].type === "hour") return Number(parti[i].value);
    }
    return null;
  }
  
  // Nome del giorno per i pulsanti: "Oggi", poi "Lun 23", ecc.
  function etichettaGiorno(ms, indiceGiorno) {
    if (indiceGiorno === 0) return "Oggi";
    var testo = new Date(ms).toLocaleDateString("it-IT", {
      timeZone: FUSO, weekday: "short", day: "numeric"
    });
    // Prima lettera maiuscola: "ven 20" diventa "Ven 20"
    return testo.charAt(0).toUpperCase() + testo.slice(1);
  }

  // Calcola, per ognuno dei prossimi 4 giorni:
  //  - l'indice a fine giornata (ore 23)
  //  - la precipitazione totale della giornata
  //  - la pioggia cumulata nelle 72 ore che finiscono a fine giornata
  //  - temperatura, umidita, vento e radiazione del giorno
  function calcolaGiorni(hPassato, hFuturo, indiceAdesso, indiceFuturo, giorniData, oraCorrente, indiciOrari) {
    // 1. Unisco ore passate e ore future in un'unica lista
    var ore = [];
    [hPassato, hFuturo].forEach(function (h) {
      for (var i = 0; i < h.time.length; i++) {
        var ts = Number(h.time[i]) * 1000;
        ore.push({
          ts: ts,
          giorno: dataIso(ts),
          h: oraDelGiorno(ts),
          rain: valido(h.rain[i]) ? Math.max(0, h.rain[i]) : null,
          vento: h.wind_speed_10m[i],
          dir: h.wind_direction_10m[i],
          rad: h.shortwave_radiation[i],
          temp: h.temperature_2m[i],
          um: h.relative_humidity_2m[i]
        });
      }
    });

    // Estrae una colonna (per esempio tutte le temperature) da una lista di ore
    function leggi(lista, campo) {
      return lista.map(function (o) { return o[campo]; });
    }
    // Somma i valori; se non ce n'e' nessuno restituisce null invece di 0
    function sommaOppureNull(lista) {
      var v = lista.filter(valido);
      return v.length ? somma(v) : null;
    }

        // Primo istante per cui abbiamo dati (serve a sapere se le 72 ore sono complete)
    var inizioDati = ore.reduce(function (m, o) { return Math.min(m, o.ts); }, Infinity);

    // Prepara i valori di UN istante: indice, pioggia delle 3 ore che finiscono
    // a quell'ora, pioggia delle 72 ore, e i valori meteo di quell'ora.
    function istante(o, indice) {
      var ultime3 = ore.filter(function (x) {
        return x.ts > o.ts - 3 * 3600000 && x.ts <= o.ts;
      });
      var ultime72 = ore.filter(function (x) {
        return x.ts > o.ts - 72 * 3600000 && x.ts <= o.ts;
      });
      // Se i dati non coprono tutte le 72 ore, meglio dire "n.d." che un numero sbagliato
      var finestraCompleta = inizioDati <= o.ts - 71 * 3600000;
      return {
        ts: o.ts,
        ora: o.h,
        indice: valido(indice) ? Math.round(indice) : null,
        pioggia: arrotonda(sommaOppureNull(leggi(ultime3, "rain")), 1),
        p72: finestraCompleta ? arrotonda(sommaOppureNull(leggi(ultime72, "rain")), 1) : null,
        temp: arrotonda(o.temp, 1),
        um: arrotonda(o.um, 1),
        vento: arrotonda(o.vento, 1),
        dir: arrotonda(o.dir, 0),
        rad: arrotonda(o.rad, 1)
      };
    }

    var r = {
      indici: [], piogge: [], p72: [], temp: [],
      um: [], vento: [], dir: [], rad: [],
      slot: [], adesso: null
    };

    // 2. Per ogni giorno calcolo tutti i valori
    giorniData.forEach(function (giorno, g) {
      var oreGiorno = ore.filter(function (o) { return o.giorno === giorno; });

      // Indice alla fine della giornata (ultima ora prevista di quel giorno)
      var indice = null;
      var fineMs = null;
      oreGiorno.forEach(function (o) {
        if (indiceFuturo[o.ts] !== undefined) {
          indice = indiceFuturo[o.ts];
          fineMs = o.ts;
        }
      });
      // Per "Oggi" se non ci sono ore future uso l'indice attuale
      if (indice === null && g === 0) {
        indice = indiceAdesso;
        fineMs = oraCorrente;
      }

      // Le 72 ore che finiscono alla fine della giornata
      var finestra72 = fineMs === null ? [] : ore.filter(function (o) {
        return o.ts > fineMs - 72 * 3600000 && o.ts <= fineMs;
      });

      r.indici.push(indice === null ? null : Math.round(indice));
      r.piogge.push(arrotonda(sommaOppureNull(leggi(oreGiorno, "rain")), 1));
      r.p72.push(arrotonda(sommaOppureNull(leggi(finestra72, "rain")), 1));
      r.temp.push(arrotonda(media(leggi(oreGiorno, "temp")), 1));
      r.um.push(arrotonda(media(leggi(oreGiorno, "um")), 1));
      r.vento.push(arrotonda(media(leggi(oreGiorno, "vento")), 1));
      r.dir.push(arrotonda(mediaCircolare(leggi(oreGiorno, "dir")), 0));
      r.rad.push(arrotonda(media(leggi(oreGiorno, "rad")), 1));

      // Gli 8 slot di questo giorno: ore 0, 3, 6, 9, 12, 15, 18, 21
      var slotGiorno = [];
      [0, 3, 6, 9, 12, 15, 18, 21].forEach(function (h) {
        var o = oreGiorno.filter(function (x) { return x.h === h; })[0];
        slotGiorno.push(o ? istante(o, indiciOrari[o.ts]) : null);
      });
      r.slot.push(slotGiorno);
    });

    // Lo stato dell'ora corrente (servirà al pulsante "Adesso")
    var oAdesso = ore.filter(function (x) { return x.ts === oraCorrente; })[0];
    r.adesso = oAdesso ? istante(oAdesso, indiceAdesso) : null;

    return r;

  // --------------------------------------------------
  // RICHIESTE A OPEN-METEO
  
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
        var q = Modello.leggiFalesia(f.esp).quota;
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

      simulato = Modello.aggiornaIndice(simulato, previsioni, i, falesia);

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
    var falesia = Modello.leggiFalesia(f.esp);

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

    // Ricostruisce l'indice dalle ore piu' vecchie alle piu' recenti
    // e lo prosegue sulle ore previste (funzione simula di modello.js).
    var sim = Modello.simula(hPassato, hFuturo, falesia);
    var indice = sim.adesso;
    var indiciOrari = Object.assign({}, sim.passato, sim.futuro);
    var gg = calcolaGiorni(hPassato, hFuturo, indice, sim.futuro, ctx.giorniData, ctx.oraCorrente, indiciOrari);
    return {
      indice: Math.round(indice),
      indici: gg.indici,
      pioggeGiorno: gg.piogge,
      p72Giorno: gg.p72,
      tempGiorno: gg.temp,
      umGiorno: gg.um,
      ventoGiorno: gg.vento,
      dirGiorno: gg.dir,
      radGiorno: gg.rad,
      slot: gg.slot,
      adesso: gg.adesso,
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
    var giorniData = [0, 1, 2, 3].map(function (n) {
      return dataIso(adessoMs + n * 86400000);
    });
    var giorniNomi = giorniData.map(function (d, n) {
      return etichettaGiorno(adessoMs + n * 86400000, n);
    });
    var ctx = {
      adessoMs: adessoMs,
      oraCorrente: oraCorrente,
      inizioPeriodo: oraCorrente - 72 * 3600000,
      giorniData: giorniData
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
            risultati.push(Object.assign({}, f, { indice: null, stima: "Errore nel calcolo" }));
          }
        });
      } catch (e) {
        gruppoFalesie.forEach(function (f) {
          errori.push(f.nome + ": " + e.message);
          risultati.push(Object.assign({}, f, { indice: null, stima: "Errore nel calcolo" }));
        });
      }
    }

    if (progresso) progresso(falesie.length, falesie.length);

    return {
      aggiornato: dataOraIt(adessoMs, " "),
      giorni: giorniNomi,
      falesie: risultati,
      errori: errori
    };
  };

})();
