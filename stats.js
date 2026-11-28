/* Statistics and the wagering simulation. No page code here, so it can be tested in Node. */
(function (root) {
  "use strict";

  // ---- data ---------------------------------------------------------------
  // Game rows are arrays (see build_site.py). prepare() turns them into objects.
  function prepare(json) {
    var leagues = json.leagues, teams = json.teams, hasPrices = json.source === "odds";
    var games = json.games.map(function (r, i) {
      var g = {
        i: i, date: r[0], kick: r[1] || "", li: r[2], hi: r[3], ai: r[4],
        league: leagues[r[2]][1], home: teams[r[3]][1], away: teams[r[4]][1],
        h: [r[5], r[7], r[9], r[11]], a: [r[6], r[8], r[10], r[12]], hf: r[13], af: r[14], ot: r[15],
        p: null, id: null
      };
      var t = Date.parse(r[0] + "T" + (r[1] && /^\d\d:\d\d/.test(r[1]) ? r[1].slice(0, 5) : "12:00") + ":00Z");
      g.ts = t;
      var dow = new Date(Date.parse(r[0] + "T12:00:00Z")).getUTCDay();
      g.dow = dow;
      g.weekend = dow === 0 || dow === 6;
      if (hasPrices) {
        var x = r.slice(16);
        g.p = {
          q: [[x[0], x[1]], [x[2], x[3]], [x[4], x[5]], [x[6], x[7]]],
          q1w: [x[8], x[9]], ml: [x[10], x[11]], draw: x[12]
        };
        g.id = x[13];
        if (g.p.q.every(function (pair) { return pair[0] == null && pair[1] == null; })) g.p = null;
      }
      return g;
    });
    games.sort(function (a, b) { return a.ts - b.ts || a.i - b.i; });
    return { source: json.source, games: games, leagues: leagues, teams: teams };
  }

  // 1 = home won the quarter, -1 = away, 0 = tied
  function qres(g, q) {
    var d = g.h[q - 1] - g.a[q - 1];
    return d > 0 ? 1 : d < 0 ? -1 : 0;
  }

  function wilson(k, n) {
    if (!n) return [0, 0];
    var z = 1.96, p = k / n, d = 1 + z * z / n;
    var c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return [(c - m) / d, (c + m) / d];
  }

  // ---- league view ----------------------------------------------------------
  // split: date string; games before it are "before", on or after are "after".
  function leagueTable(games, q, split) {
    var by = {};
    games.forEach(function (g) {
      var r = by[g.li] || (by[g.li] = { li: g.li, league: g.league, n: 0, hw: 0, aw: 0, t: 0,
        b: { n: 0, hw: 0, aw: 0 }, f: { n: 0, hw: 0, aw: 0 }, pn: 0, imp: 0, act: 0 });
      var res = qres(g, q);
      r.n++;
      if (res > 0) r.hw++; else if (res < 0) r.aw++; else r.t++;
      if (split) {
        var s = g.date < split ? r.b : r.f;
        s.n++;
        if (res > 0) s.hw++; else if (res < 0) s.aw++;
      }
      var pr = g.p && g.p.q[q - 1];
      if (pr && pr[0] && pr[1] && res !== 0) {         // price fairness: no-margin probability vs result
        var ih = 1 / pr[0], ia = 1 / pr[1];
        r.pn++;
        r.imp += ih / (ih + ia);
        r.act += res > 0 ? 1 : 0;
      }
    });
    return Object.keys(by).map(function (k) {
      var r = by[k], dec = r.hw + r.aw;
      r.homePct = r.n ? r.hw / r.n : 0;
      r.awayPct = r.n ? r.aw / r.n : 0;
      r.tiePct = r.n ? r.t / r.n : 0;
      r.homeEx = dec ? r.hw / dec : 0;                 // home share of decided quarters
      r.ci = wilson(r.hw, dec);
      r.impPct = r.pn ? r.imp / r.pn : null;
      r.actPct = r.pn ? r.act / r.pn : null;
      return r;
    });
  }

  // ---- team view ---------------------------------------------------------------
  function teamTable(games, q, leagueSet) {
    var by = {};
    function rec(id, name, league) {
      return by[id] || (by[id] = { id: id, team: name, leagues: {}, seq: [], n: 0, w: 0, l: 0, t: 0,
        hn: 0, hw: 0, an: 0, aw: 0, wdn: 0, wdw: 0, wen: 0, wew: 0, afterLoss: 0, afterLossWin: 0 });
    }
    games.forEach(function (g) {
      if (leagueSet && !leagueSet[g.li]) return;
      var res = qres(g, q);
      [[g.hi, g.home, 1], [g.ai, g.away, -1]].forEach(function (s) {
        var r = rec(s[0], s[1]);
        r.leagues[g.league] = (r.leagues[g.league] || 0) + 1;
        var out = res === 0 ? 0 : res === s[2] ? 1 : -1;       // 1 win, -1 loss, 0 tie
        var prev = r.seq.length ? r.seq[r.seq.length - 1] : null;
        if (prev === -1 && out !== 0) { r.afterLoss++; if (out === 1) r.afterLossWin++; }
        r.seq.push(out);
        r.n++;
        if (out === 1) r.w++; else if (out === -1) r.l++; else r.t++;
        if (s[2] === 1) { r.hn++; if (out === 1) r.hw++; } else { r.an++; if (out === 1) r.aw++; }
        if (g.weekend) { r.wen++; if (out === 1) r.wew++; } else { r.wdn++; if (out === 1) r.wdw++; }
      });
    });
    return Object.keys(by).map(function (k) {
      var r = by[k], run = 0, bw = 0, bl = 0, cw = 0, cl = 0;
      r.seq.forEach(function (o) {
        if (o === 1) { cw++; cl = 0; if (cw > bw) bw = cw; }
        else if (o === -1) { cl++; cw = 0; if (cl > bl) bl = cl; }
        else { cw = 0; cl = 0; }                              // a tie breaks both streaks
      });
      run = cw > 0 ? cw : cl > 0 ? -cl : 0;
      r.cur = run; r.bestWin = bw; r.bestLoss = bl;
      r.pct = r.n ? r.w / r.n : 0;
      r.ci = wilson(r.w, r.n);
      r.homePct = r.hn ? r.hw / r.hn : null;
      r.awayPct = r.an ? r.aw / r.an : null;
      r.wdPct = r.wdn ? r.wdw / r.wdn : null;
      r.wePct = r.wen ? r.wew / r.wen : null;
      r.afterLossPct = r.afterLoss ? r.afterLossWin / r.afterLoss : null;
      r.league = Object.keys(r.leagues).sort(function (a, b) { return r.leagues[b] - r.leagues[a]; })[0];
      delete r.seq;
      return r;
    });
  }

  // ---- picks and simulation ------------------------------------------------------
  // A running record per team, updated game by game, so a pick never sees the game it is for.
  function formTracker() {
    var rec = {};
    return {
      get: function (id) { return rec[id] || { n: 0, w: 0 }; },
      add: function (g, q) {
        var res = qres(g, q);
        [[g.hi, 1], [g.ai, -1]].forEach(function (s) {
          var r = rec[s[0]] || (rec[s[0]] = { n: 0, w: 0 });
          r.n++;
          if (res === s[1]) r.w++;
        });
      }
    };
  }

  // Returns {side: 1|-1, price} or {skip: reason}.
  function pick(g, form, o) {
    var q = o.q, side, price;
    if (o.rule === "home") side = 1;
    else if (o.rule === "away") side = -1;
    else if (o.rule === "form") {
      var h = form.get(g.hi), a = form.get(g.ai);
      if (h.n < o.minForm || a.n < o.minForm) return { skip: "not enough history" };
      var hp = h.w / h.n, ap = a.w / a.n;
      if (hp === ap) return { skip: "no pick" };
      side = hp > ap ? 1 : -1;
    } else {                                            // fav / dog: by the quarter price
      var pr = g.p && g.p.q[q - 1];
      if (!pr || !pr[0] || !pr[1]) return { skip: "no price" };
      if (pr[0] === pr[1]) return { skip: "no pick" };
      var favSide = pr[0] < pr[1] ? 1 : -1;
      side = o.rule === "fav" ? favSide : -favSide;
    }
    if (o.fixedPrice) price = o.fixedPrice;
    else {
      var pp = g.p && (o.tie === "lose" && q === 1 && g.p.q1w[0] ? g.p.q1w : g.p.q[q - 1]);
      price = pp ? pp[side === 1 ? 0 : 1] : null;
      if (!price) return { skip: "no price" };
    }
    if (o.priceMin && price < o.priceMin) return { skip: "price outside range" };
    if (o.priceMax && price > o.priceMax) return { skip: "price outside range" };
    return { side: side, price: price };
  }

  function stakeFor(o, loss, price) {
    if (o.prog === "flat") return o.base;
    if (o.prog === "principal") return o.base + loss;
    return (loss + o.base) / (price - 1);               // recover every loss plus one unit
  }

  /* o: q, rule, minForm, fixedPrice, priceMin, priceMax, tie ("push"|"lose"),
        leagues (set or null), days ("all"|"weekday"|"weekend"), from, to,
        gap (minutes), prog ("recover"|"principal"|"flat"), base, cap, maxSteps,
        screen {minGames, minRate} (leagues chosen from games before `from`) */
  function simulate(games, o) {
    var form = formTracker(), allowed = o.leagues, events = [], skipped = {}, loss = 0, step = 0;
    var cum = 0, peak = 0, maxDD = 0, staked = 0, wins = 0, losses = 0, pushes = 0, busts = 0;
    var maxStake = 0, run = 0, runs = {}, longest = 0, lastTs = -1, priceSum = 0, taken = 0;
    var screen = null;
    if (o.screen && o.from) screen = screenLeagues(games, o);
    function skip(reason) { skipped[reason] = (skipped[reason] || 0) + 1; }
    games.forEach(function (g) {
      var inRange = (!o.from || g.date >= o.from) && (!o.to || g.date <= o.to);
      var candidate = inRange && (!allowed || allowed[g.li]) && (o.days === "all" || (o.days === "weekend") === g.weekend);
      if (candidate && screen && !screen[g.li]) { skip("league screened out"); candidate = false; }
      if (candidate) {
        var pk = pick(g, form, o);
        if (pk.skip) skip(pk.skip);
        else if (o.gap && g.kick && lastTs >= 0 && g.ts < lastTs + o.gap * 60000) skip("overlaps previous bet");
        else {
          var stake = stakeFor(o, loss, pk.price);
          if (o.cap && stake > o.cap) skip("wager above limit");
          else {
            var res = qres(g, o.q), out = res === 0 ? 0 : res === pk.side ? 1 : -1, pl;
            if (out === 0 && o.tie === "push") out = 2;       // stake returned
            else if (out === 0) out = -1;                       // 3-way market: a tie loses
            if (out === 1) { pl = stake * (pk.price - 1); wins++; }
            else if (out === 2) { pl = 0; pushes++; }
            else { pl = -stake; losses++; }
            staked += stake; taken++; priceSum += 1 / pk.price;
            if (stake > maxStake) maxStake = stake;
            cum += pl;
            if (cum > peak) peak = cum;
            if (peak - cum > maxDD) maxDD = peak - cum;
            var bust = false;
            if (out === 1) { loss = 0; step = 0; if (run) { runs[run] = (runs[run] || 0) + 1; run = 0; } }
            else if (out === -1) {
              loss += stake; step++; run++;
              if (run > longest) longest = run;
              if (o.maxSteps && step >= o.maxSteps) { bust = true; busts++; loss = 0; step = 0; runs[run] = (runs[run] || 0) + 1; run = 0; }
            }
            lastTs = g.ts;
            events.push({ g: g, side: pk.side, price: pk.price, stake: stake, out: out, pl: pl, cum: cum, step: step, bust: bust });
          }
        }
      }
      form.add(g, o.q);
    });
    if (run) runs[run] = (runs[run] || 0) + 1;
    var decided = wins + losses, avgBE = taken ? priceSum / taken : null;
    return {
      events: events, skipped: skipped, taken: taken, wins: wins, losses: losses, pushes: pushes, busts: busts,
      pl: cum, staked: staked, roi: staked ? cum / staked : null, maxStake: maxStake, maxDD: maxDD,
      longest: longest, runs: runs, winRate: decided ? wins / decided : null, ci: wilson(wins, decided),
      breakEven: avgBE
    };
  }

  // Which leagues passed the screen on the games before o.from (same rule, no staking).
  function screenLeagues(games, o) {
    var form = formTracker(), tally = {}, ok = {};
    var base = {}; for (var k in o) base[k] = o[k];
    base.gap = 0;
    games.forEach(function (g) {
      if (g.date < o.from) {
        var pk = pick(g, form, base);
        if (!pk.skip) {
          var res = qres(g, o.q), t = tally[g.li] || (tally[g.li] = { n: 0, w: 0 });
          if (res !== 0) { t.n++; if (res === pk.side) t.w++; }
        }
        form.add(g, o.q);
      }
    });
    Object.keys(tally).forEach(function (li) {
      var t = tally[li];
      if (t.n >= o.screen.minGames && t.w / t.n >= o.screen.minRate) ok[li] = true;
    });
    return ok;
  }

  // ---- board -----------------------------------------------------------------------
  // board.json (built by board.py) holds, per upcoming game and market, the five rating components,
  // the anchor probability, Bet365's prices and sample sizes. The weights and trust are applied here
  // so the rules can be changed on the page. Same arithmetic as board.py.
  var KIND = { q1: "q", q2: "q", q3: "q", q4: "q", h1: "h1", ml: "ml" };
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function logit(p) { p = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return Math.log(p / (1 - p)); }
  function shift(w, c, trust, cap) {
    var s = 0;
    for (var i = 0; i < w.length; i++) s += w[i] * c[i];
    return Math.max(-cap, Math.min(cap, trust * s));
  }

  /* o: markets (set or null), date, league, trust {q,h1,ml}, mult (five weight multipliers),
        minLeague, minTeam, pmin, pmax, minEv, base, carried, cap (wager limit) */
  function boardRows(board, o) {
    var model = board.model, rows = [];
    board.games.forEach(function (g) {
      if (o.date && g.date !== o.date) return;
      if (o.league && g.league !== o.league) return;
      Object.keys(g.m).forEach(function (m) {
        if (o.markets && !o.markets[m]) return;
        var e = g.m[m];
        [0, 1].forEach(function (idx) {
          var r = { g: g, m: m, idx: idx, price: e.pr[idx], why: [], src: e.src, p: null, ev: null, nl: null, nt: null };
          if (m === "total") {
            r.team = (idx ? "Under " : "Over ") + e.line;
            if (e.po == null) r.why.push("no reference price");
            else { r.p = idx ? 1 - e.po : e.po; r.ev = r.p * r.price - 1; }
          } else {
            var k = KIND[m], w = model.weights[k].map(function (x, i) { return x * o.mult[i]; });
            var ph = sigmoid(logit(e.pm) + shift(w, e.c, o.trust[k], model.max_shift));
            r.p = idx ? 1 - ph : ph;
            r.ev = (1 - e.pt) * (r.p * r.price - 1);
            r.team = idx ? g.away : g.home;
            r.nl = e.nl; r.nt = e.nt;
            if (e.nl < o.minLeague) r.why.push("league sample");
            if (e.nt < o.minTeam) r.why.push("team sample");
          }
          if (r.p != null) { r.be = 1 / r.price; r.edge = r.p - r.be; }
          if ((o.pmin && r.price < o.pmin) || (o.pmax && r.price > o.pmax)) r.why.push("price range");
          if (r.price > 1) {
            r.stake = (o.carried + o.base) / (r.price - 1);           // wager that recovers the carried loss plus one unit
            if (o.cap && r.stake > o.cap) r.why.push("wager above limit");
          }
          r.eligible = r.why.length === 0;
          r.pick = r.eligible && r.ev != null && r.ev >= o.minEv;
          rows.push(r);
        });
      });
    });
    rows.filter(function (r) { return r.eligible && r.ev != null; })
      .sort(function (a, b) { return b.ev - a.ev; })
      .forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  // American odds shown for a decimal price, and the reverse. Decimal 2.50 is +150; 1.50 is -200.
  function usOdds(d) {
    if (!(d > 1)) return "–";
    var a = d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
    return (a > 0 ? "+" : "") + a;
  }
  function decOdds(a) {
    a = Number(a);
    if (!isFinite(a) || Math.abs(a) < 100) return NaN;
    return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
  }

  // Progressive wager over recommended picks, in start order. Every pick is bet. The wager is sized when the game
  // starts: (loss carried + base) / (price - 1), where the loss carried holds only results already known by then.
  // Every bet is meant to earn one base stake, so a loss adds the money lost plus the base it failed to earn.
  // An earlier bet still in play at that moment does not stop the bet; if it loses, its loss goes into the next game
  // that has not started when its result comes in. The debt a bet is staked to recover rides on that bet: the next
  // bet to start while it is in play (or the next one listed at the same start) stakes the base only.
  // Minutes from the start until a result is known, kept on the long side.
  var RESULT_MIN = { q1: 35, q2: 65, h1: 70, q3: 100, q4: 150, ml: 150, total: 150 };
  // Why a pick is not fit to carry a loss, or "" when it is. R: { pMin (0-1), priceMin, priceMax, minTeam, maxWarn, maxWorse },
  // each 0 or missing to switch it off. p: win chance, price: decimal, nTeam: games the weaker-history team has on record,
  // warn: sweep warning level of the team backed (0, 1, 2, or null/"" when unknown).
  // minTeam does not apply to moneylines: their win chance is the market price, with no team-history input.
  // maxWorse (0-1): a moneyline pick is skipped when the team backed has a win share this season that many points or more
  // below its opponent's. gap: that difference (negative = backed team worse), standing: "5-5 v 9-2", market: "ml", "h1", ...
  // The game-winner model has no team-record input (its trust is 0), so only moneylines are held to this.
  function recoveryFail(p, R) {
    if (!R) return "";
    if (R.pMin && p.p != null && p.p < R.pMin) return "win chance " + Math.round(p.p * 100) + "% is under " + Math.round(R.pMin * 100) + "%";
    if (R.priceMin && p.price < R.priceMin) return "price " + p.price.toFixed(2) + " is under " + R.priceMin.toFixed(2);
    if (R.priceMax && p.price > R.priceMax) return "price " + p.price.toFixed(2) + " is over " + R.priceMax.toFixed(2);
    if (R.minTeam && p.market !== "ml" && p.nTeam != null && !isNaN(p.nTeam) && p.nTeam < R.minTeam) return "only " + p.nTeam + " games of history (needs " + R.minTeam + ")";
    if (R.maxWarn && p.warn != null && p.warn !== "" && +p.warn >= R.maxWarn) return "sweep warning level " + p.warn + " on the team backed";
    if (R.maxWorse && p.market === "ml" && p.gap != null && p.gap !== "" && !isNaN(+p.gap) && +p.gap <= -R.maxWorse)
      return "the team backed has the worse record this season (" + (p.standing || "") + ", " + Math.round(-p.gap * 100) + " points of win share behind)";
    return "";
  }

  // o.partial (optional, with o.cap): a wager that would be over the limit is placed at the limit instead of skipped, so
  // part of the loss is recovered if it wins; the loss it was staked to recover stays assigned to that bet.
  // o.recover (optional): while a loss is carried (the bet would stake it), a pick that does not pass recoveryFail is
  // skipped and the loss stays carried. With nothing carried every pick is bet.
  // o.bank (optional, a what-if layer that is off when missing; delete this option and the lines marked BANK to remove it):
  //   { start, basePct, share, capPct, writeOff, stopAt, resumeAt } as fractions of the starting bank.
  //   base and limit come from the bank (start x basePct, start x capPct); each wager stakes only `share` of the carried
  //   loss plus the base; a carried loss over writeOff x start is written off; when the bank falls under stopAt x start
  //   the carried loss is dropped and flat base stakes are placed until it climbs back to resumeAt x start.
  function progressive(picks, o) {
    var cents = function (v) { return Math.round(v * 100) / 100; };   // money moves in whole cents, so every figure adds up
    var bk = o.bank && o.bank.start > 0 && o.bank.basePct > 0 ? o.bank : null;                                            // BANK
    var base = bk ? cents(bk.start * bk.basePct) : o.base > 0 ? o.base : 1;                                               // BANK
    var cap = bk ? (bk.capPct > 0 ? cents(bk.start * bk.capPct) : Infinity) : o.cap > 0 ? o.cap : Infinity;              // BANK
    var share = bk && bk.share > 0 && bk.share < 1 ? bk.share : 1, flat = false;                                          // BANK
    var order = picks.map(function (p, i) { return i; }).sort(function (a, b) { return picks[a].start - picks[b].start || a - b; });
    var rows = picks.map(function () { return { state: "", wager: null, before: null, profit: null, pnl: null, after: null }; });
    var pending = [], carried = 0, pnl = 0, sum = { bets: 0, w: 0, l: 0, t: 0, open: 0, skipCap: 0, capped: 0, skipRule: 0, waiting: 0, maxWager: 0, maxCarried: 0, lost: 0,
      lowBank: bk ? bk.start : null, stops: 0, writeOffs: 0, writtenOff: 0, flatBets: 0 };                           // BANK
    var STALE = 48 * 3600000;   // a result still missing two days after its game is treated as void so it cannot block later picks
    function claimed() { return pending.reduce(function (a, b) { return a + b.claim; }, 0); }
    // BANK: after each result, check the stop-loss and the write-off line, and say what happened on that row.
    function guard(b) {
      var bank = cents(bk.start + pnl), row = rows[b.i], gone = carried;
      sum.lowBank = Math.min(sum.lowBank, bank);
      if (flat) {
        if (bank >= bk.resumeAt * bk.start) { flat = false; row.bkEvent = { type: "resume", bank: bank }; }
      } else if (bank < bk.stopAt * bk.start) {
        flat = true; sum.stops++; sum.writtenOff = cents(sum.writtenOff + gone); carried = 0;
        pending.forEach(function (x) { x.claim = 0; });
        row.bkEvent = { type: "stop", amount: gone, bank: bank };
      } else if (carried > bk.writeOff * bk.start && bk.writeOff > 0) {
        sum.writeOffs++; sum.writtenOff = cents(sum.writtenOff + gone); carried = 0;
        pending.forEach(function (x) { x.claim = 0; });
        row.bkEvent = { type: "writeoff", amount: gone, bank: bank };
      }
    }
    function known(p) { return p.result === "W" || p.result === "L" || p.result === "T" || p.result === "void"; }
    // Results that are known by time t are applied in order of game start, so the running total and the loss
    // carried read down the list the way the games were played.
    function settle(t) {
      var ready = [], keep = [];
      pending.forEach(function (b) {
        var p = picks[b.i];
        if (!known(p)) {
          if (isFinite(t) && b.end + STALE <= t) { sum.lost++; rows[b.i].profit = 0; rows[b.i].after = carried; rows[b.i].lost = true; }
          else keep.push(b);
        } else if (b.end > t) keep.push(b);
        else ready.push(b);
      });
      ready.sort(function (a, b) { return picks[a.i].start - picks[b.i].start || a.i - b.i; });
      ready.forEach(function (b) {
        var p = picks[b.i];
        var gain = p.result === "W" ? cents(b.wager * (p.price - 1)) : p.result === "L" ? -b.wager : 0;
        pnl = cents(pnl + gain);
        // Every bet is meant to earn one base stake. A loss therefore adds the money lost plus the base stake it
        // failed to earn. A win pays down only the debt it was staked to recover (b.claim), so a win staked on a
        // clean slate never cancels another game's loss.
        var flatNow = bk && (flat || b.flat);                                                                        // BANK
        if (gain < 0) { if (!flatNow) carried = cents(carried - gain + base); }
        else if (gain > 0 && !flatNow) carried = cents(carried - Math.min(b.claim, bk ? Math.max(0, gain - base) : gain, carried));
        sum[p.result === "W" ? "w" : p.result === "L" ? "l" : "t"]++;
        rows[b.i].profit = gain; rows[b.i].after = carried;
        sum.maxCarried = Math.max(sum.maxCarried, carried);
        if (bk) guard(b);                                                                                            // BANK
      });
      pending = keep;
    }
    for (var g = 0; g < order.length;) {
      var t = picks[order[g]].start, grp = [];
      while (g < order.length && picks[order[g]].start === t) grp.push(order[g++]);
      settle(t);
      var avail = cents(carried - claimed());     // owed and not already riding on a bet in play
      var inPlay = pending.filter(function (b) { return b.end > t; }).map(function (b) { return b.i; });
      var unknown = pending.some(function (b) { return b.end <= t && !known(picks[b.i]); });
      grp.forEach(function (i) {
        var p = picks[i], r = rows[i];
        if (unknown) { r.state = "wait"; sum.waiting++; return; }
        var flatBet = bk && flat;                                                                                    // BANK
        if (o.recover && avail > 0) {
          var bad = recoveryFail(p, o.recover);
          if (bad) { r.state = "rule"; r.reason = bad; r.before = avail; sum.skipRule++; return; }
        }
        var w = flatBet ? base : Math.ceil((share * avail + base) / (p.price - 1) * 100 - 1e-9) / 100;   // rounded up to the cent
        if (w > cap && !flatBet) {
          if (!o.partial) { r.state = "cap"; r.before = avail; r.wager = w; sum.skipCap++; return; }
          r.capped = true; r.full = w; w = cap; sum.capped++;        // bet the limit; the loss is only partly recovered if it wins
        }
        r.state = "bet"; r.inPlay = inPlay; r.before = avail; r.wager = w; sum.bets++; sum.maxWager = Math.max(sum.maxWager, w);
        if (flatBet) { r.flat = true; sum.flatBets++; }                                                              // BANK
        pending.push({ i: i, end: t + (RESULT_MIN[p.market] || 150) * 60000, wager: w, claim: avail, flat: flatBet });
        avail = 0;                               // this bet now carries the debt; the next bet to start stakes the base only
      });
    }
    settle(Infinity);
    var cum = 0;                                  // running total down the list, in start order
    order.forEach(function (i) { if (rows[i].profit != null && !rows[i].lost) { cum = cents(cum + rows[i].profit); rows[i].pnl = cum; if (bk) rows[i].bank = cents(bk.start + cum); } });
    sum.open = pending.length; sum.pnl = pnl; sum.owed = carried; sum.claimed = cents(claimed()); sum.carried = cents(carried - claimed());
    sum.exposure = pending.reduce(function (a, b) { return a + b.wager; }, 0);
    sum.bank = bk ? cents(bk.start + pnl) : null; sum.inFlat = !!(bk && flat); sum.startBank = bk ? bk.start : null;       // BANK
    return { rows: rows, sum: sum };
  }

  // Figures for the progressive wager view. items: one per pick in the replay, with ts, state ("bet" when placed),
  // wager, price, res (W, L, T, void or ""), profit, pnl and after (set when settled), p (model win chance), day, label.
  function progressiveStats(items, resultMin) {
    var min = resultMin || RESULT_MIN;
    var placed = items.filter(function (r) { return r.state === "bet"; });
    var done = placed.filter(function (r) { return r.profit != null && !r.lost && (r.res === "W" || r.res === "L" || r.res === "T"); })
      .sort(function (a, b) { return a.ts - b.ts; });
    var o = { placed: placed.length, settled: done.length, w: 0, l: 0, t: 0, open: placed.filter(function (r) { return r.res === "" ; }).length,
              streakW: 0, streakL: 0, cur: { type: "", n: 0 }, staked: 0, best: null, worst: null, peak: 0, maxDD: 0, days: [] };
    var runW = 0, runL = 0, total = 0, expSum = 0, dayMap = {};
    done.forEach(function (r) {
      if (r.res === "W") { o.w++; runW++; runL = 0; } else if (r.res === "L") { o.l++; runL++; runW = 0; } else o.t++;
      if (r.res !== "T") { o.staked += r.wager; expSum += r.p; }
      o.streakW = Math.max(o.streakW, runW); o.streakL = Math.max(o.streakL, runL);
      if (r.res !== "T") o.cur = runW ? { type: "W", n: runW } : { type: "L", n: runL };
      total = r.pnl; o.peak = Math.max(o.peak, total); o.maxDD = Math.max(o.maxDD, o.peak - total);
      if (!o.best || r.profit > o.best.v) o.best = { v: r.profit, label: r.label };
      if (!o.worst || r.profit < o.worst.v) o.worst = { v: r.profit, label: r.label };
    });
    var decided = o.w + o.l;
    o.winRate = decided ? o.w / decided : null; o.expRate = decided ? expSum / decided : null;
    o.pnl = done.length ? done[done.length - 1].pnl : 0; o.roi = o.staked ? o.pnl / o.staked : null;
    o.maxWager = null; o.minWager = null; var ws = 0, ps = 0;
    placed.forEach(function (r) {
      ws += r.wager; ps += r.price;
      if (!o.maxWager || r.wager > o.maxWager.v) o.maxWager = { v: r.wager, label: r.label };
      if (!o.minWager || r.wager < o.minWager.v) o.minWager = { v: r.wager, label: r.label };
    });
    o.avgWager = placed.length ? ws / placed.length : null; o.avgPrice = placed.length ? ps / placed.length : null;
    placed.forEach(function (r) {
      var d = dayMap[r.day] || (dayMap[r.day] = { day: r.day, ts: r.ts, bets: 0, w: 0, l: 0, t: 0, open: 0, pl: 0, total: null, carried: null, last: -1 });
      d.bets++; if (r.res === "") d.open++;
    });
    done.forEach(function (r, i) {
      var d = dayMap[r.day]; d[r.res.toLowerCase()]++; d.pl = Math.round((d.pl + r.profit) * 100) / 100;
      d.total = r.pnl; d.carried = r.after;
    });
    o.days = Object.keys(dayMap).sort().map(function (k) { return dayMap[k]; });
    return o;
  }

  var api = {
    recoveryFail: recoveryFail, progressive: progressive, progressiveStats: progressiveStats, RESULT_MIN: RESULT_MIN, prepare: prepare, qres: qres, wilson: wilson, leagueTable: leagueTable, teamTable: teamTable,
              simulate: simulate, screenLeagues: screenLeagues, boardRows: boardRows, usOdds: usOdds, decOdds: decOdds };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== "undefined" ? window : this);
