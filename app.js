(function () {
  "use strict";
  var S = window.Stats;
  var $ = function (id) { return document.getElementById(id); };
  var D = { history: null, odds: null }, meta = {}, last = null, splitTouched = false;
  var sorts = { chase: { k: "ts", d: 1 }, chaseDays: { k: "ts", d: 1 }, leagues: { k: "n", d: -1 }, teams: { k: "n", d: -1 }, games: null, board: { k: "rank", d: 1 }, today: { k: "rank", d: 1 }, history: { k: "start", d: -1 } };
  var tab = "today", B = null, boardLast = null, todayLast = null;

  // ---- helpers ------------------------------------------------------------------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pct(x, d) { return x == null ? "–" : (x * 100).toFixed(d == null ? 1 : d) + "%"; }
  function num(x, d) { return x == null ? "–" : Number(x).toFixed(d == null ? 1 : d); }
  // ---- display format: odds style and currency
  var FMT = { odds: "dec", cur: "units" }, SYM = { usd: "$", eur: "\u20ac" };
  try { var saved = JSON.parse(localStorage.getItem("dashFormat") || "{}"); if (saved.odds === "us") FMT.odds = "us"; if (SYM[saved.cur]) FMT.cur = saved.cur; } catch (e) {}
  function unitWord() { return FMT.cur === "units" ? "units" : SYM[FMT.cur]; }
  function fmtPrice(d) { return FMT.odds === "us" ? Stats.usOdds(d) : Number(d).toFixed(2); }
  function money(x, d) {
    if (x == null || isNaN(x)) return "–";
    if (FMT.cur === "units") return num(x, d);
    return (x < 0 ? "-" : "") + SYM[FMT.cur] + Math.abs(x).toFixed(2);
  }
  function priceIn(id) {
    var v = $(id).value;
    if (v === "" || v == null) return 0;
    return (FMT.odds === "us" ? Stats.decOdds(v) : +v) || 0;
  }
  // P&L on the record tables is per one unit staked; in a currency it is shown for a flat base stake on every pick
  function pnlScale(baseId) { return FMT.cur === "units" ? 1 : (+$(baseId).value || 1); }
  var PRICE_INPUTS = ["b-pmin", "b-pmax", "s-price", "s-pmin", "s-pmax", "ch-rmax"];
  // The minimum price while a loss is carried is a slider in decimal odds; at its lowest stop (1.00) there is no minimum.
  function rminDec() { var v = +$("ch-rmin").value; return v > 1 ? v : 0; }
  function syncRmin() { var v = rminDec(); $("ch-rmin-v").textContent = v ? fmtPrice(v) : "no minimum"; }
  function syncFormat() {
    Array.prototype.forEach.call(document.querySelectorAll(".cu"), function (e) { e.textContent = unitWord(); });
    Array.prototype.forEach.call(document.querySelectorAll(".ou"), function (e) { e.textContent = FMT.odds === "us" ? "American" : "decimal"; });
    document.querySelector('input[name="fmt-odds"][value="' + FMT.odds + '"]').checked = true;
    document.querySelector('input[name="fmt-cur"][value="' + FMT.cur + '"]').checked = true;
    syncRmin();
  }
  function showPriceInputs(decs) {
    PRICE_INPUTS.forEach(function (id, i) {
      var el = $(id);
      el.type = FMT.odds === "us" ? "text" : "number";
      el.value = decs[i] ? (FMT.odds === "us" ? Stats.usOdds(decs[i]) : decs[i].toFixed(2)) : "";
    });
  }
  function saveFormat() { try { localStorage.setItem("dashFormat", JSON.stringify(FMT)); } catch (e) {} }
  function range(ci) { return pct(ci[0], 0) + " to " + pct(ci[1], 0); }
  function cur() { return D[$("g-source").value]; }
  function qn() { return +$("g-q").value; }
  function qname() { return ["first", "second", "third", "fourth"][qn() - 1] + " quarter"; }
  function leagueName(d, li) {
    var l = d.leagues[li];
    if (d.source === "odds") return l[1] + (l[2] ? " (" + l[2] + ")" : "");
    var dup = d.dupNames[l[1]] > 1;
    return l[1] + (dup ? " #" + l[0] : "");
  }
  function prepared(json) {
    var d = S.prepare(json);
    d.dupNames = {};
    d.leagues.forEach(function (l) { d.dupNames[l[1]] = (d.dupNames[l[1]] || 0) + 1; });
    d.games.forEach(function (g) { g.leagueName = leagueName(d, g.li); });
    return d;
  }
  function csv(cols, rows, name) {
    var lines = [cols.map(function (c) { return JSON.stringify(c.h); }).join(",")];
    rows.forEach(function (r) {
      lines.push(cols.map(function (c) { var v = c.t ? c.t(r) : c.f ? c.f(r) : r[c.k]; return JSON.stringify(v == null ? "" : String(v).replace(/<[^>]*>/g, "")); }).join(","));
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = name; a.click();
  }
  function table(el, cols, rows, st, rerender, limit) {
    var data = rows.slice();
    if (st) {
      var c = cols.filter(function (x) { return x.k === st.k; })[0];
      if (c) data.sort(function (a, b) {
        var x = c.v ? c.v(a) : a[c.k], y = c.v ? c.v(b) : b[c.k];
        if (x == null && y == null) return 0;
        if (x == null) return 1; if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * st.d;
      });
    }
    var shown = limit ? data.slice(0, limit) : data;
    el.innerHTML = "<thead><tr>" + cols.map(function (c) {
      var arrow = st && st.k === c.k ? (st.d > 0 ? " ▲" : " ▼") : "";
      return '<th class="' + (c.l ? "l" : "") + '" data-k="' + c.k + '">' + esc(c.h) + arrow + "</th>";
    }).join("") + "</tr></thead><tbody>" + shown.map(function (r) {
      return "<tr>" + cols.map(function (c) { return '<td class="' + (c.l ? "l" : "") + '">' + (c.f ? c.f(r) : esc(r[c.k])) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>";
    if (st) el.querySelectorAll("th").forEach(function (th) {
      th.onclick = function () { var k = th.getAttribute("data-k"); st.d = st.k === k ? -st.d : -1; st.k = k; rerender(); };
    });
    return data;
  }
  var tipEl = $("tip");
  function tip(html, e) {
    if (!html) { tipEl.style.display = "none"; return; }
    tipEl.innerHTML = html; tipEl.style.display = "block";
    tipEl.style.left = Math.min(e.clientX + 12, window.innerWidth - tipEl.offsetWidth - 8) + "px";
    tipEl.style.top = (e.clientY + 14) + "px";
  }
  function dl(s) { var a = document.createElement("a"); a.href = s; return a; }

  // ---- charts -------------------------------------------------------------------
  function niceTicks(lo, hi, n) {
    if (lo === hi) { lo -= 1; hi += 1; }
    var raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = mag;
    [1, 2, 5, 10].some(function (m) { step = m * mag; return step >= raw; });
    var out = [], v = Math.ceil(lo / step) * step;
    for (; ; v += step) { out.push(+v.toFixed(6)); if (v >= hi - 1e-9) break; }   // last tick covers the data
    return out;
  }
  function lineChart(el, pts) {
    if (!pts.length) { el.innerHTML = '<p class="note">No bets to chart.</p>'; return; }
    var W = 560, H = 260, L = 48, R = 12, T = 10, B = 26;
    if (pts.length > 900) { var step = Math.ceil(pts.length / 900); pts = pts.filter(function (p, i) { return i % step === 0 || i === pts.length - 1; }); }
    var ys = pts.map(function (p) { return p.y; }), lo = Math.min(0, Math.min.apply(null, ys)), hi = Math.max(0, Math.max.apply(null, ys));
    var ticks = niceTicks(lo, hi, 4); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    var X = function (i) { return L + (pts.length === 1 ? 0 : i / (pts.length - 1)) * (W - L - R); };
    var Y = function (v) { return T + (hi - v) / (hi - lo || 1) * (H - T - B); };
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Running profit and loss">';
    ticks.forEach(function (t) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="var(--line)" stroke-width="' + (t === 0 ? 1.5 : 1) + '"/>' +
           '<text x="' + (L - 6) + '" y="' + (Y(t) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + t + "</text>";
    });
    s += '<text x="' + L + '" y="' + (H - 6) + '" font-size="11" fill="var(--muted)">' + esc(pts[0].x) + '</text><text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + esc(pts[pts.length - 1].x) + "</text>";
    s += '<polyline fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" points="' + pts.map(function (p, i) { return X(i).toFixed(1) + "," + Y(p.y).toFixed(1); }).join(" ") + '"/>';
    s += '<line id="xh" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><circle id="dot" r="4" fill="var(--s1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>';
    s += '<rect x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent" id="hit"/></svg>';
    el.innerHTML = s;
    var svg = el.querySelector("svg"), hit = el.querySelector("#hit"), xh = el.querySelector("#xh"), dot = el.querySelector("#dot");
    hit.onmousemove = function (e) {
      var r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width * W;
      var i = Math.max(0, Math.min(pts.length - 1, Math.round((fx - L) / (W - L - R) * (pts.length - 1))));
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(pts[i].y)); dot.setAttribute("visibility", "visible");
      tip(esc(pts[i].tip), e);
    };
    hit.onmouseleave = function () { xh.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip(null); };
  }
  function barChart(el, items, xLabel) {
    if (!items.length) { el.innerHTML = '<p class="note">No losing runs.</p>'; return; }
    var W = 560, H = 260, L = 40, R = 12, T = 10, B = 40;
    var ticks = niceTicks(0, Math.max.apply(null, items.map(function (i) { return i.value; })), 4), hi = ticks[ticks.length - 1] || 1;
    var bw = (W - L - R) / items.length, Y = function (v) { return T + (hi - v) / hi * (H - T - B); };
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Losing run lengths">';
    ticks.forEach(function (t) { s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="var(--line)"/><text x="' + (L - 6) + '" y="' + (Y(t) + 4) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + t + "</text>"; });
    items.forEach(function (it, i) {
      var w = Math.min(36, bw - 2), x = L + i * bw + (bw - w) / 2, y = Y(it.value), h = H - B - y, r = Math.min(4, w / 2, h);
      s += '<path class="bar" data-i="' + i + '" fill="var(--s1)" d="M' + x + "," + (H - B) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y + "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (H - B) + 'Z"/>';
      s += '<text x="' + (x + w / 2) + '" y="' + (H - B + 14) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + esc(it.label) + "</text>";
    });
    s += '<text x="' + (L + (W - L - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + esc(xLabel) + "</text></svg>";
    el.innerHTML = s;
    el.querySelectorAll(".bar").forEach(function (b) {
      var it = items[+b.getAttribute("data-i")];
      b.onmousemove = function (e) { tip(esc(it.tip), e); }; b.onmouseleave = function () { tip(null); };
    });
  }

  // ---- leagues --------------------------------------------------------------------
  function leagueCols(d) {
    var cols = [
      { k: "league", h: "League", l: true, f: function (r) { return esc(r.name); } },
      { k: "n", h: "Games", f: function (r) { return r.n; } },
      { k: "homePct", h: "Home won %", f: function (r) { return pct(r.homePct); } },
      { k: "awayPct", h: "Away won %", f: function (r) { return pct(r.awayPct); } },
      { k: "tiePct", h: "Tied %", f: function (r) { return pct(r.tiePct); } },
      { k: "homeEx", h: "Home share of decided", f: function (r) { return pct(r.homeEx); } },
      { k: "ci", h: "95% range", v: function (r) { return r.ci[0]; }, f: function (r) { return range(r.ci); }, t: function (r) { return range(r.ci); } }
    ];
    if ($("g-split").value) cols.push(
      { k: "b", h: "Before: home share (games)", v: function (r) { return r.b.hw + r.b.aw ? r.b.hw / (r.b.hw + r.b.aw) : null; }, f: function (r) { var n = r.b.hw + r.b.aw; return n ? pct(r.b.hw / n) + " (" + r.b.n + ")" : "–"; } },
      { k: "f", h: "After: home share (games)", v: function (r) { return r.f.hw + r.f.aw ? r.f.hw / (r.f.hw + r.f.aw) : null; }, f: function (r) { var n = r.f.hw + r.f.aw; return n ? pct(r.f.hw / n) + " (" + r.f.n + ")" : "–"; } });
    if (d.source === "odds") cols.push(
      { k: "pn", h: "With price", f: function (r) { return r.pn; } },
      { k: "impPct", h: "Bet365 home % (no margin)", f: function (r) { return pct(r.impPct); } },
      { k: "actPct", h: "Actual home % (no ties)", f: function (r) { return pct(r.actPct); } },
      { k: "gap", h: "Actual minus Bet365, pts", v: function (r) { return r.pn ? r.actPct - r.impPct : null; }, f: function (r) { return r.pn ? num((r.actPct - r.impPct) * 100) : "–"; } });
    return cols;
  }
  function leagueRows(d) {
    var rows = S.leagueTable(d.games, qn(), $("g-split").value || null).filter(function (r) { return r.n >= +$("l-min").value; });
    rows.forEach(function (r) { r.name = leagueName(d, r.li); });
    return rows;
  }
  function renderLeagues() {
    var d = cur(); if (!d) return;
    var cols = leagueCols(d), rows = leagueRows(d);
    $("l-note").textContent = "How often the home and away teams win the " + qname() + ", by league. “Home share of decided” leaves out tied quarters; the 95% range shows how much a rate can move by chance at that sample size." +
      (d.source === "odds" ? " The Bet365 columns compare the price with the result: a league where the gap is near zero over many games is priced fairly." : "") +
      ($("g-split").value ? " The before/after columns split games at the test date." : "") + " " + rows.length + " leagues shown.";
    table($("l-table"), cols, rows, sorts.leagues, renderLeagues);
  }

  // ---- teams ----------------------------------------------------------------------
  function teamCols() {
    return [
      { k: "team", h: "Team", l: true, f: function (r) { return esc(r.team); } },
      { k: "league", h: "League", l: true, f: function (r) { return esc(r.leagueName); } },
      { k: "n", h: "Games", f: function (r) { return r.n; } },
      { k: "w", h: "W-L-T", v: function (r) { return r.w; }, f: function (r) { return r.w + "-" + r.l + "-" + r.t; }, t: function (r) { return r.w + "-" + r.l + "-" + r.t; } },
      { k: "pct", h: "Win %", f: function (r) { return pct(r.pct); } },
      { k: "ci", h: "95% range", v: function (r) { return r.ci[0]; }, f: function (r) { return range(r.ci); }, t: function (r) { return range(r.ci); } },
      { k: "homePct", h: "Home win %", f: function (r) { return pct(r.homePct) + " (" + r.hn + ")"; }, t: function (r) { return pct(r.homePct); } },
      { k: "awayPct", h: "Away win %", f: function (r) { return pct(r.awayPct) + " (" + r.an + ")"; }, t: function (r) { return pct(r.awayPct); } },
      { k: "wdPct", h: "Weekday %", f: function (r) { return pct(r.wdPct) + " (" + r.wdn + ")"; }, t: function (r) { return pct(r.wdPct); } },
      { k: "wePct", h: "Weekend %", f: function (r) { return pct(r.wePct) + " (" + r.wen + ")"; }, t: function (r) { return pct(r.wePct); } },
      { k: "afterLossPct", h: "After a loss %", f: function (r) { return pct(r.afterLossPct) + " (" + r.afterLoss + ")"; }, t: function (r) { return pct(r.afterLossPct); } },
      { k: "bestWin", h: "Best win streak", f: function (r) { return r.bestWin; } },
      { k: "bestLoss", h: "Worst loss streak", f: function (r) { return r.bestLoss; } },
      { k: "cur", h: "Now", f: function (r) { return r.cur > 0 ? '<span class="pos">W' + r.cur + "</span>" : r.cur < 0 ? '<span class="neg">L' + -r.cur + "</span>" : "–"; }, t: function (r) { return r.cur; } }
    ];
  }
  function teamRows(d) {
    var sel = $("t-league").value, set = sel === "all" ? null : (function () { var o = {}; o[sel] = true; return o; })();
    var rows = S.teamTable(d.games, qn(), set).filter(function (r) { return r.n >= +$("t-min").value; });
    var byName = {}; d.games.forEach(function (g) { byName[g.league] = g.leagueName; });
    rows.forEach(function (r) { r.leagueName = byName[r.league] || r.league; });
    return rows;
  }
  function fillLeagueSelect(el, d, keep) {
    var all = el.id === "t-league" ? "All leagues" : "All leagues";
    var opts = d.leagues.map(function (l, i) { return [i, leagueName(d, i)]; }).sort(function (a, b) { return a[1].localeCompare(b[1]); });
    el.innerHTML = '<option value="all">' + all + "</option>" + opts.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + "</option>"; }).join("");
    if (keep) el.value = keep;
  }
  function renderTeams() {
    var d = cur(); if (!d) return;
    table($("t-table"), teamCols(), teamRows(d), sorts.teams, renderTeams);
  }

  // ---- strategy -----------------------------------------------------------------------
  function params() {
    var d = cur(), sel = $("s-league").value, o = {
      q: qn(), rule: $("s-rule").value, minForm: +$("s-form").value || 1,
      fixedPrice: $("s-pricemode").value === "fixed" ? (priceIn("s-price") || 1.9) : 0,
      priceMin: priceIn("s-pmin"), priceMax: priceIn("s-pmax"), tie: $("s-tie").value, days: $("s-days").value,
      gap: +$("s-gap").value || 0, prog: $("s-prog").value, base: +$("s-base").value || 1, cap: +$("s-cap").value || 0,
      maxSteps: +$("s-steps").value || 0, leagues: null, from: null, to: null, screen: null
    };
    if (sel !== "all") { o.leagues = {}; o.leagues[sel] = true; }
    var split = $("g-split").value;
    if ($("s-testonly").checked && split) o.from = split;
    if ($("s-screen").checked && split) { o.from = split; o.screen = { minGames: +$("s-sgames").value || 1, minRate: (+$("s-srate").value || 50) / 100 }; }
    return o;
  }
  function describe(o) {
    var d = cur(), rules = { home: "the home team", away: "the away team", form: "the team with the better record so far", fav: "the favourite", dog: "the underdog" };
    var prog = { recover: "each wager recovers all losses plus one unit", principal: "each wager is one unit plus the lost principal", flat: "flat one-unit wagers" };
    var t = "Betting the " + qname() + " on " + rules[o.rule] + (o.fixedPrice ? " at a fixed price of " + fmtPrice(o.fixedPrice) : " at the Bet365 price") +
      "; " + prog[o.prog] + "; wager limit " + (o.cap ? (FMT.cur === "units" ? o.cap + " units" : money(o.cap)) : "none") + "; step limit " + (o.maxSteps || "none") +
      "; a tied quarter " + (o.tie === "push" ? "returns the stake" : "loses") + ".";
    if (o.from) t += " Test period: games from " + o.from + (o.screen ? ", leagues chosen from earlier games with at least " + o.screen.minGames + " decided and a " + pct(o.screen.minRate, 0) + " win rate." : ".");
    return t;
  }
  function tile(label, value, cls, sub) { return '<div class="tile"><span>' + esc(label) + '</span><b class="' + (cls || "") + '">' + value + "</b>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>"; }
  function renderStrategy() {
    var d = cur(); if (!d) return;
    var o = params(), r = S.simulate(d.games, o); last = { o: o, r: r, d: d };
    var skippedN = Object.keys(r.skipped).reduce(function (a, k) { return a + r.skipped[k]; }, 0), warn = "";
    if (($("s-screen").checked) && !$("g-split").value) warn += '<div class="warn">Choose a test period start date at the top to use the league screen.</div>';
    if (r.skipped["wager above limit"] > 5 * Math.max(1, r.taken) && !o.maxSteps) warn += '<div class="warn">After a long losing run the wager needed stays above the limit, so every later game is skipped. Set a step limit so a losing cycle is written off and a new one starts.</div>';
    if (!r.taken) warn += '<div class="warn">No bets matched these settings.</div>';
    if (o.fixedPrice) warn += '<div class="warn">This run assumes a price of ' + fmtPrice(o.fixedPrice) + ' on every bet. Real prices differ by game and by side, so profit here is hypothetical; use the Bet365 data set to test at real prices. The win rate and losing-run figures do not depend on the price.</div>';
    $("s-warn").innerHTML = warn;
    var edge = r.winRate != null && r.breakEven != null ? r.winRate - r.breakEven : null;
    $("s-tiles").innerHTML =
      tile("Bets taken", r.taken, "", r.wins + " won, " + r.losses + " lost, " + r.pushes + " returned") +
      tile("Win rate (ties out)", pct(r.winRate), "", "95% range " + (r.taken ? range(r.ci) : "–")) +
      tile(o.fixedPrice ? "Break-even rate (assumed price)" : "Break-even rate", pct(r.breakEven), "", o.fixedPrice ? "1 divided by the decimal price " + o.fixedPrice.toFixed(2) + (FMT.odds === "us" ? " (" + fmtPrice(o.fixedPrice) + ")" : "") : "from the prices taken") +
      tile("Win rate minus break-even", edge == null ? "–" : (edge * 100).toFixed(1) + " pts", edge == null ? "" : edge >= 0 ? "pos" : "neg") +
      tile(o.fixedPrice ? "Profit or loss (assumed price)" : "Profit or loss (" + unitWord() + ")", money(r.pl, 1), r.pl >= 0 ? "pos" : "neg", "return on staked " + (r.roi == null ? "–" : pct(r.roi)) ) +
      tile("Largest wager", money(r.maxStake, 1), "", FMT.cur === "units" ? "units" : "") +
      tile("Longest losing run", r.longest, "", "bets in a row") +
      tile("Largest drawdown", money(r.maxDD, 1), "", FMT.cur === "units" ? "units from a peak" : "from a peak") +
      tile("Cycles written off", r.busts, "", "hit the step limit") +
      tile("Games skipped", skippedN, "", Object.keys(r.skipped).map(function (k) { return esc(k) + ": " + r.skipped[k]; }).join("<br>"));
    var pts = r.events.map(function (e, i) { return { x: e.g.date, y: +e.cum.toFixed(3), tip: e.g.date + "  bet " + (i + 1) + "  running " + (FMT.cur === "units" ? e.cum.toFixed(1) + " units" : money(e.cum)) }; });
    lineChart($("c-equity"), pts);
    var runs = Object.keys(r.runs).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return { label: String(k), value: r.runs[k], tip: "Losing runs of " + k + ": " + r.runs[k] }; });
    barChart($("c-runs"), runs, "Losses in a row");
    $("s-note").textContent = describe(o) + (FMT.cur === "units" ? " Results are in units of the base stake." : " Results are in " + unitWord() + ", with the base stake as the amount of one unit.") + " A win rate above the break-even rate over many bets, and also in the test period, is what matters; a high rate in the data used to choose the rule is not evidence.";
  }

  // ---- game selector --------------------------------------------------------------------
  function gameCols() {
    var rules = { 1: "Home", "-1": "Away" };
    return [
      { k: "date", h: "Date", l: true, v: function (e) { return e.g.date + e.g.kick; }, f: function (e) { return e.g.date + " " + esc(e.g.kick); }, t: function (e) { return e.g.date + " " + e.g.kick; } },
      { k: "league", h: "League", l: true, v: function (e) { return e.g.leagueName; }, f: function (e) { return esc(e.g.leagueName); } },
      { k: "game", h: "Game", l: true, v: function (e) { return e.g.home; }, f: function (e) { return esc(e.g.home) + " v " + esc(e.g.away); }, t: function (e) { return e.g.home + " v " + e.g.away; } },
      { k: "pick", h: "Pick", l: true, v: function (e) { return e.side; }, f: function (e) { return rules[e.side] + ": " + esc(e.side === 1 ? e.g.home : e.g.away); }, t: function (e) { return rules[e.side] + ": " + (e.side === 1 ? e.g.home : e.g.away); } },
      { k: "price", h: "Price", v: function (e) { return e.price; }, f: function (e) { return fmtPrice(e.price); } },
      { k: "stake", h: "Wager (" + unitWord() + ")", v: function (e) { return e.stake; }, f: function (e) { return money(e.stake, 2); } },
      { k: "score", h: "Quarter score", v: function (e) { return e.g.h[last.o.q - 1] - e.g.a[last.o.q - 1]; }, f: function (e) { return e.g.h[last.o.q - 1] + "-" + e.g.a[last.o.q - 1]; } },
      { k: "out", h: "Result", v: function (e) { return e.out; }, f: function (e) { return e.out === 1 ? '<span class="pos">Won</span>' : e.out === 2 ? "Returned" : '<span class="neg">Lost</span>' + (e.bust ? " (written off)" : ""); }, t: function (e) { return e.out === 1 ? "Won" : e.out === 2 ? "Returned" : e.bust ? "Lost (written off)" : "Lost"; } },
      { k: "pl", h: "Profit or loss", v: function (e) { return e.pl; }, f: function (e) { return money(e.pl, 2); } },
      { k: "cum", h: "Running total", v: function (e) { return e.cum; }, f: function (e) { return money(e.cum, 2); } }
    ];
  }
  function renderGames() {
    if (!cur()) return;
    renderStrategy();
    var st = sorts.games || (sorts.games = { k: "date", d: 1 });
    var rows = last.r.events;
    $("g-note").textContent = rows.length + " bets under the Strategy settings. " + describe(last.o) + " Change the settings on the Strategy tab.";
    table($("g-table"), gameCols(), rows, st, renderGames, $("g-all").checked ? 0 : 500);
  }

  // ---- report ---------------------------------------------------------------------------
  function staticTable(cols, rows) {
    if (!rows.length) return '<p class="note">None meet the minimum yet.</p>';
    return '<div class="tablewrap"><table><thead><tr>' + cols.map(function (c) { return "<th" + (c.l ? ' class="l"' : "") + ">" + esc(c.h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return "<tr>" + cols.map(function (c) { return "<td" + (c.l ? ' class="l"' : "") + ">" + (c.f ? c.f(r) : esc(r[c.k])) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  function buildReport() {
    var d = cur(); if (!d) return;
    var want = {}; document.querySelectorAll(".r-sec").forEach(function (c) { if (c.checked) want[c.value] = true; });
    var m = meta[$("g-source").value] || {}, html = "<h2>Basketball quarter report</h2><p class=\"note\">Prepared " + new Date().toLocaleString() + ". Data: " +
      (d.source === "odds" ? "Bet365 prices dataset" : "history dataset") + ", " + d.games.length + " games" + (m.first ? " from " + m.first + " to " + m.last : "") + (meta.generated ? ", data built " + esc(meta.generated) : "") + ". Quarter studied: " + qname() + ".</p>";
    if (want.settings) html += "<h3>Settings</h3><p>" + esc(describe(params())) + "</p>";
    if (want.leagues) {
      var lr = leagueRows(d).sort(function (a, b) { return b.ci[0] - a.ci[0]; }).slice(0, 20);
      html += "<h3>Leagues with the highest home share of decided " + qname() + "s (ranked by the low end of the 95% range, minimum " + $("l-min").value + " games)</h3>" +
        staticTable(leagueCols(d).filter(function (c) { return c.k !== "b" && c.k !== "f"; }), lr);
    }
    if (want.teams) {
      var tr = teamRows(d).sort(function (a, b) { return b.ci[0] - a.ci[0]; }).slice(0, 25);
      html += "<h3>Teams with the best " + qname() + " record (ranked by the low end of the 95% range, minimum " + $("t-min").value + " games)</h3>" + staticTable(teamCols(), tr);
    }
    renderStrategy();
    if (want.strategy) {
      html += "<h3>Strategy results</h3><p>" + esc(describe(last.o)) + "</p><div class=\"tiles\">" + $("s-tiles").innerHTML + "</div>" +
        "<div class=\"charts\"><div class=\"chart\"><h3>Running profit and loss (" + unitWord() + ")</h3>" + $("c-equity").innerHTML + "</div><div class=\"chart\"><h3>Losing runs</h3>" + $("c-runs").innerHTML + "</div></div>";
    }
    if (want.games) html += "<h3>Bets (first 200)</h3>" + staticTable(gameCols(), last.r.events.slice(0, 200));
    html += "<h3>Reading this report</h3><p class=\"note\">Rankings across many leagues and teams will always show some that look strong by luck, so a rule should be tested on games it was not chosen from (set a test period start date). Prices are Bet365’s pre-game quotes as stored after the game; in the two-way market Bet365 returns the stake on a tied quarter, which is how the simulation treats it by default. Past results do not set a price edge by themselves: compare the win rate with the break-even rate.</p>";
    $("report").innerHTML = html;
  }

  // ---- today's picks ----------------------------------------------------------------------
  var BLK = {};   // block id -> name, from the board
  function recPrep(r) {
    var o = Object.assign({}, r);
    o.ts = Date.parse(r.start);
    o.team = r.market === "total" ? (r.side === "over" ? "Over " : "Under ") + r.line : (r.side === "home" ? r.home : r.away);
    o.price = +r.price; o.p = +r.p_win; o.ev = +r.ev; o.rank = +r.rank;
    o.stake = (((+$("p-carried").value) || 0) + ((+$("p-base").value) || 1)) / (o.price - 1);
    o.state = r.status === "settled" ? { W: "Won", L: "Lost", T: "Tied (stake returned)" }[r.result] : r.status === "void" ? "Void" : (o.ts < Date.now() ? "Started" : "Open");
    o.pl = r.pl === "" ? null : +r.pl;
    // not recommended although it ranks in the top half: its block already has a recommended pick (blocks), or it overlapped one (older slates)
    o.overlaps = r.recommended !== "yes" && +r.rank <= Math.ceil(+r.slate_size * (((B && B.recs && B.recs.rules) || {}).share || 0.5));
    var rules = recoverRules();
    o.fitWhy = rules ? Stats.recoveryFail({ p: o.p, price: o.price, nTeam: +r.n_team, warn: r.warn, market: r.market, gap: r.gap, standing: r.standing }, rules) : "";
    o.fit = rules ? !o.fitWhy : null;
    return o;
  }
  function todayCols() {
    return [
      { k: "recommended", h: "Pick", l: true, v: function (r) { return r.recommended === "yes" ? 0 : 1; }, f: function (r) { return r.recommended === "yes" ? "<b class=\"pos\">Recommended</b>" : r.overlaps ? 'Slate only<br><span class="note">' + (r.block ? "the block already has its pick" : "starts before a recommended pick\'s result") + "</span>" : "Slate only"; }, t: function (r) { return r.recommended === "yes" ? "Recommended" : r.overlaps ? "Slate only (" + (r.block ? "the block has its pick" : "overlaps a recommended pick") + ")" : "Slate only"; } },
      { k: "rank", h: "Rank by win chance", f: function (r) { return r.rank + " of " + r.slate_size; }, t: function (r) { return r.rank; } },
      { k: "ts", h: "Start", l: true, f: function (r) { return esc(new Date(r.ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })); } },
      { k: "block", h: "Block", l: true, f: function (r) { return esc(BLK[r.block] || ""); }, t: function (r) { return BLK[r.block] || ""; } },
      { k: "game", h: "Game", l: true, v: function (r) { return r.home; }, f: function (r) { return esc(r.home + " v " + r.away) + '<br><span class="note">' + esc(r.league) + "</span>"; }, t: function (r) { return r.home + " v " + r.away; } },
      { k: "sel", h: "Bet", l: true, v: function (r) { return r.market; }, f: function (r) { return esc(MARKET_NAME[r.market] + ": " + r.team); }, t: function (r) { return MARKET_NAME[r.market] + ": " + r.team; } },
      { k: "price", h: "Bet365", f: function (r) { return fmtPrice(r.price); } },
      { k: "p", h: "Win chance", f: function (r) { return pct(r.p); } },
      { k: "ev", h: "Value (EV %)", f: function (r) { return '<span class="' + (r.ev >= 0 ? "pos" : "neg") + '">' + num(r.ev * 100) + "</span>"; }, t: function (r) { return num(r.ev * 100, 2); } },
      { k: "stake", h: "Wager (" + unitWord() + ")", f: function (r) { return money(r.stake, 1); } },
      { k: "fit", h: "Fit to carry a loss", l: true, v: function (r) { return r.fit ? 1 : 0; }, f: function (r) { return r.fit === null ? "–" : r.fit ? "Yes" : '<span class="note" style="white-space:normal;display:inline-block;min-width:150px">No: ' + esc(r.fitWhy) + "</span>"; }, t: function (r) { return r.fit === null ? "" : r.fit ? "Yes" : "No: " + r.fitWhy; } },
      { k: "why", h: "Why", l: true, f: function (r) { return '<span style="white-space:normal;display:inline-block;min-width:280px;max-width:420px">' + esc(r.why) + "</span>"; }, t: function (r) { return r.why; } },
      { k: "state", h: "Status", l: true, f: function (r) { return r.state === "Won" ? '<b class="pos">Won</b>' : r.state === "Lost" ? '<b class="neg">Lost</b>' : esc(r.state); }, t: function (r) { return r.state; } }
    ];
  }
  function recordTable(R, rowsIn) {
    var rows = rowsIn || [["Recommended", R.recommended], ["Rest of the slate", R.not_recommended]];
    return "<table><thead><tr><th class=\"l\">Group</th><th>Picks</th><th>Settled</th><th>W-L-T</th><th>Win rate</th><th>Expected win rate</th><th>P&amp;L (" + unitWord() + ")</th><th>Expected P&amp;L</th><th>ROI</th></tr></thead><tbody>" +
      rows.map(function (x) {
        var t = x[1];
        return "<tr><td class=\"l\">" + x[0] + "</td><td>" + t.picks + "</td><td>" + t.settled + "</td><td>" + t.w + "-" + t.l + "-" + t.t + "</td><td>" + pct(t.win_rate) + "</td><td>" + pct(t.expected_win_rate) + "</td><td class=\"" + (t.pl >= 0 ? "pos" : "neg") + "\">" + money(t.pl * pnlScale("p-base"), 2) + "</td><td>" + money(t.expected_pl * pnlScale("p-base"), 2) + "</td><td>" + pct(t.roi) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function renderToday() {
    if (!B || !B.recs) { $("p-note").textContent = "No recommendations yet."; $("p-table").innerHTML = ""; $("p-tiles").innerHTML = ""; return; }
    var R = B.recs; BLK = {}; (R.blocks || []).forEach(function (b) { BLK[b.id] = b.name; });
    var type = document.querySelector('input[name="ptype"]:checked').value,
        win = document.querySelector('input[name="prank"]:checked').value === "w", T = R.types[type + (win ? "+w" : "")],
        TYPE_NAME = { all: "", q: "quarter", h1: "half", total: "over/under", ml: "full game" };
    var all = T.today.map(recPrep), shown = $("p-rec").checked ? all.filter(function (r) { return r.recommended === "yes"; }) : all;
    var rec = all.filter(function (r) { return r.recommended === "yes"; });
    todayLast = shown;
    var avg = function (a, k) { return a.length ? a.reduce(function (s, r) { return s + r[k]; }, 0) / a.length : null; };
    var open = all.filter(function (r) { return r.state === "Open"; }).length;
    $("p-tiles").innerHTML = [
      [all.length, "games on today's " + (TYPE_NAME[type] ? TYPE_NAME[type] + " " : "") + "slate (" + R.slate + ")"], [rec.length, "recommended"], [open, "still open"],
      [pct(avg(rec, "p")), "average win chance, recommended"], [rec.length ? num(avg(rec, "ev") * 100) + "%" : "–", "average value, recommended"]
    ].map(function (t) { return '<div class="tile"><b>' + esc(t[0]) + "</b><span>" + esc(t[1]) + "</span></div>"; }).join("");
    var per = R.rules.per_block, names = (R.blocks || []).map(function (b) { return b.name; });
    var qualify = " A selection needs value of " + (R.rules.min_ev * 100) + "% or more, a price from " + fmtPrice(R.rules.price_min) + " to " + fmtPrice(R.rules.price_max) + ", and enough history (" + (R.rules.min_league_q != null ? R.rules.min_league_q + " league and " + R.rules.min_team_q + " team games for a quarter or half, " + R.rules.min_league + " and " + R.rules.min_team + " for a full game" : R.rules.min_league + " league and " + R.rules.min_team + " team games") + "). Win chance and value are model estimates; a tied quarter or half returns the stake. The slate is recorded when it is formed and settled from the final score.";
    var rule = per
      ? "Rule: the day runs from " + R.rules.after_et + ":00 AM Eastern to the same time next morning, split into blocks by region and start time (" + names.join(", ") + "; Europe splits at " + R.rules.europe_split + ":00 AM Eastern). Asian games start overnight, so they sit on the evening before's slate. Each open game puts forward " + (win ? "its most likely winner" : "its best-value selection") + " among the selections that qualify; each block keeps its " + per + " best " + (win ? "by win chance" : "by value") + " and recommends one, the most likely winner, so at most one recommended pick is open in a block." + qualify + " Games whose lines or value arrive later are added before they start, up to " + per + " per block; a block that already has its recommended pick adds none. Picks already recorded never change, and a later pick's rank is as of when it was added."
      : (win ? "Rule: each open game puts forward its most likely winner among the selections that qualify; the " + R.rules.slate_max + " most likely form the slate; the best of them by win chance are recommended, at most half" : "Rule: each open game puts forward its best-value selection; the " + R.rules.slate_max + " of greatest value form the slate; the best of them by win chance are recommended, at most half") + (R.rules.stagger_open ? ", keeping no more than " + R.rules.stagger_open + " recommended pick" + (R.rules.stagger_open > 1 ? "s" : "") + " open at once (a pick is open until its result is expected, plus " + R.rules.stagger_gap + " minutes of room)" : "; a strong pick is never dropped because its game overlaps another") + "." + qualify + " Games whose lines or value arrive later in the day are added before they start, up to the " + R.rules.slate_max + " places; picks already recorded never change, and a later pick's rank is as of when it was added.";
    $("p-note").textContent = all.length ? rule
      : (type === "all" ? "No slate for " + R.slate + " yet." : "No " + TYPE_NAME[type] + " selection meets the rules in the games still open.") + " Slates are formed by the first run after " + R.rules.after_et + ":00 AM Eastern from the games still open, and a type with no qualifying game is checked again on each run.";
    var nba = !R.settings || R.settings.nba;
    $("p-pool").innerHTML = "NBA: <b>" + (nba ? "in" : "out of") + " the betting pool</b>. " + (nba ? "NBA games can be picked like any other." : "NBA games are left off the slates; their prices and picks are still logged for study.") + ' To switch it ' + (nba ? "off" : "on") + ', set <code>"nba": ' + (nba ? "false" : "true") + '</code> in <a href="https://github.com/David9930/basketball-odds-results/edit/main/data/settings.json" target="_blank" rel="noopener">data/settings.json</a> (it applies from the next run, which starts when you save).';
    table($("p-table"), todayCols(), shown, sorts.today, renderToday);
    $("p-record").innerHTML = T.days ? recordTable(T) + '<p class="note">' + T.days + " " + (TYPE_NAME[type] ? TYPE_NAME[type] + " " : "") + "slate" + (T.days > 1 ? "s" : "") + " recorded." + (FMT.cur === "units" ? "" : " P&L is for a flat base stake on every pick.") + " If the model has an edge, actual should track expected over a few hundred settled picks; the recommended group should also do better than the rest of the slate.</p>" : '<p class="note">Nothing recorded yet.</p>';
    var V = R.types[type], W = R.types[type + "+w"], cmp = [];
    if (V && V.days) cmp.push(["Value first: recommended", V.recommended], ["Value first: rest of slate", V.not_recommended]);
    if (W && W.days) cmp.push(["Win chance first: recommended", W.recommended], ["Win chance first: rest of slate", W.not_recommended]);
    $("p-compare").innerHTML = cmp.length ? recordTable(null, cmp) + '<p class="note">Each ranking is recorded and settled separately' + (TYPE_NAME[type] ? ", here for " + TYPE_NAME[type] + " slates" : "") + ". Differences mean little until a few hundred picks have settled in each.</p>" : '<p class="note">Nothing recorded yet.</p>';
    var hist = T.recent.map(recPrep);
    table($("p-history"), [
      { k: "slate", h: "Slate", l: true, f: function (r) { return esc(String(r.slate).replace("+w", "")); } }, todayCols()[2], todayCols()[3], todayCols()[4], todayCols()[5], todayCols()[6],
      { k: "recommended", h: "Pick", l: true, f: function (r) { return r.recommended === "yes" ? "Recommended" : "Slate only"; } },
      { k: "state", h: "Result", l: true, f: function (r) { return r.state === "Won" ? '<b class="pos">Won</b>' : r.state === "Lost" ? '<b class="neg">Lost</b>' : esc(r.state); } },
      { k: "pl", h: "P&L (" + unitWord() + ")", f: function (r) { return r.pl == null ? "–" : '<span class="' + (r.pl >= 0 ? "pos" : "neg") + '">' + money(r.pl * pnlScale("p-base"), 2) + "</span>"; } }
    ], hist, sorts.history, renderToday);
  }

  // ---- board ----------------------------------------------------------------------------
  var TRUST_KEYS = ["0.0", "0.25", "0.5", "0.75", "1.0"];      // as board.py writes them
  var MARKET_NAME = { q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4", h1: "1st half", ml: "Moneyline", total: "Total" };
  function fmtStart(r) {
    return isNaN(r.g.ts) ? esc(r.g.date + " " + r.g.time) : esc(new Date(r.g.ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }));
  }
  function boardOpts() {
    var mk = $("b-market").value, set = null;
    if (mk === "quarters") set = { q1: 1, q2: 1, q3: 1, q4: 1 };
    else if (mk !== "all") { set = {}; set[mk] = 1; }
    var mult = [0, 1, 2, 3, 4].map(function (i) { return +$("b-m" + i).value; });
    return { markets: set, date: $("b-date").value || null, league: $("b-league").value || null,
      trust: { q: +$("b-tq").value, h1: +$("b-th").value, ml: +$("b-tm").value }, mult: mult,
      minLeague: +$("b-minl").value, minTeam: +$("b-mint").value, pmin: priceIn("b-pmin"), pmax: priceIn("b-pmax"),
      minEv: +$("b-minev").value / 100, base: +$("b-base").value || 1, carried: +$("b-carried").value || 0, cap: +$("b-cap").value || 0 };
  }
  var BOARD_ORDER = ["rank", "ts", "game", "sel", "price", "p", "ev", "status", "be", "edge", "league", "src", "nt", "stake"];
  function boardCols() {
    var cols = [
      { k: "rank", h: "Rank", f: function (r) { return r.rank || "–"; } },
      { k: "ts", h: "Start", l: true, v: function (r) { return r.g.ts; }, f: fmtStart },
      { k: "league", h: "League", l: true, v: function (r) { return r.g.league; }, f: function (r) { return esc(r.g.league + (r.g.country ? " (" + r.g.country + ")" : "")); } },
      { k: "game", h: "Game", l: true, v: function (r) { return r.g.home; }, f: function (r) { return esc(r.g.home + " v " + r.g.away); } },
      { k: "sel", h: "Selection", l: true, v: function (r) { return r.m; }, f: function (r) { return esc(MARKET_NAME[r.m] + ": " + r.team); } },
      { k: "price", h: "Bet365", f: function (r) { return fmtPrice(r.price); } },
      { k: "p", h: "Win chance", f: function (r) { return pct(r.p); }, t: function (r) { return pct(r.p); } },
      { k: "be", h: "Break-even", f: function (r) { return pct(r.be); } },
      { k: "edge", h: "Edge, pts", f: function (r) { return r.edge == null ? "–" : num(r.edge * 100); } },
      { k: "ev", h: "Value (EV %)", f: function (r) { return r.ev == null ? "–" : '<span class="' + (r.ev >= 0 ? "pos" : "neg") + '">' + num(r.ev * 100) + "</span>"; }, t: function (r) { return r.ev == null ? "" : num(r.ev * 100, 2); } },
      { k: "src", h: "Starts from", l: true, f: function (r) { return esc(r.src); } },
      { k: "nt", h: "Games (league / team)", v: function (r) { return r.nt; }, f: function (r) { return r.nl == null ? "–" : r.nl + " / " + r.nt; }, t: function (r) { return r.nl == null ? "" : r.nl + " / " + r.nt; } },
      { k: "stake", h: "Wager (" + unitWord() + ")", f: function (r) { return money(r.stake, 1); } },
      { k: "status", h: "Status", l: true, v: function (r) { return r.pick ? 0 : r.eligible ? 1 : 2; },
        f: function (r) { return r.pick ? "<b class=\"pos\">Selection</b>" : r.eligible ? "Below minimum value" : esc("Excluded: " + r.why.join(", ")); },
        t: function (r) { return r.pick ? "Selection" : r.eligible ? "Below minimum value" : "Excluded: " + r.why.join(", "); } }
    ];
    return BOARD_ORDER.map(function (k) { return cols.filter(function (c) { return c.k === k; })[0]; });
  }
  function boardRowsNow() {
    var all = S.boardRows(B, boardOpts()), shown = all.filter(function (r) {
      if ($("b-picks").checked) return r.pick;
      return $("b-excl").checked || r.eligible;
    });
    return { all: all, shown: shown };
  }
  function renderBoard() {
    if (!B) { $("b-note").textContent = "No board yet. It is built with each daily run, from the prices captured for today's and tomorrow's games."; $("b-table").innerHTML = ""; $("b-tiles").innerHTML = ""; return; }
    var res = boardRowsNow(), all = res.all, picks = all.filter(function (r) { return r.pick; });
    boardLast = res;
    var best = picks.length ? picks.slice().sort(function (a, b) { return b.ev - a.ev; })[0] : null;
    var games = {}; all.forEach(function (r) { games[r.g.game_id] = 1; });
    $("b-tiles").innerHTML = [
      [Object.keys(games).length, "games priced"], [all.filter(function (r) { return r.eligible; }).length, "eligible selections"],
      [picks.length, "selections at or above " + $("b-minev").value + "% value"], [best ? num(best.ev * 100) + "%" : "–", best ? "best value: " + MARKET_NAME[best.m] + " " + best.team : "best value"]
    ].map(function (t) { return '<div class="tile"><b>' + esc(t[0]) + "</b><span>" + esc(t[1]) + "</span></div>"; }).join("");
    $("b-note").textContent = "Ranked by value: the expected return per unit staked at the Bet365 price. Win chance excludes tied quarters (Bet365 returns the stake). Values are model estimates; the ledger below shows how past selections actually did. Built " + B.generated + "; history " + B.model.history.games.toLocaleString() + " games, " + B.model.history.from + " to " + B.model.history.to + ".";
    table($("b-table"), boardCols(), res.shown, sorts.board, renderBoard, 400);
    renderBoardPanels();
  }
  function renderBoardPanels() {
    var m = B.model, L = B.ledger, kinds = { q: "Quarters", h1: "First half", ml: "Game winner" }, h = "";
    $("b-limit").textContent = "The model may move a price by at most " + m.max_shift + " in log-odds (about " + Math.round(m.max_shift * 25) + " points near 50%).";
    h += "<p class=\"note\">Log loss: lower is better. A gain means the model predicts results better than the league home rate alone, on games after the fit period. Component columns show how much worse the held-out result gets when that component is switched off; near zero means it adds nothing.</p>";
    h += "<table><thead><tr><th class=\"l\">Market</th><th>Fitted on</th><th>Tested on</th><th>League rate only</th><th>Model</th><th>Gain</th>" + m.components.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
    Object.keys(kinds).forEach(function (k) {
      var c = m.check[k]; if (!c) return;
      h += "<tr><td class=\"l\">" + kinds[k] + "</td><td>" + c.train.toLocaleString() + "</td><td>" + c.test.toLocaleString() + " (from " + c.from + ")</td><td>" + c.log_loss_base.toFixed(4) + "</td><td>" + c.log_loss_model.toFixed(4) + "</td><td>" + c.gain.toFixed(4) + "</td>" +
        m.components.map(function (n) { return "<td>" + (c.drop_one[n] == null ? "–" : c.drop_one[n].toFixed(4)) + "</td>"; }).join("") + "</tr>";
    });
    h += "</tbody></table><p class=\"note\">Against Bet365 prices: log loss on finished games that had a price, when the model moves the price by the share of its view shown in the column heading. The lowest value picks the trust used.</p>";
    h += "<table><thead><tr><th class=\"l\">Market</th><th>Priced games</th>" + TRUST_KEYS.map(function (t) { return "<th>Trust " + t + "</th>"; }).join("") + "<th>Trust in use</th></tr></thead><tbody>";
    Object.keys(kinds).forEach(function (k) {
      var v = m.versus_market[k]; if (!v) return;
      var lo = Math.min.apply(null, Object.keys(v.ll).map(function (t) { return v.ll[t]; }));
      h += "<tr><td class=\"l\">" + kinds[k] + "</td><td>" + v.n + "</td>" + TRUST_KEYS.map(function (t) { var x = v.ll[t]; return "<td>" + (x === lo ? "<b>" + x.toFixed(4) + "</b>" : x.toFixed(4)) + "</td>"; }).join("") + "<td>" + m.trust[k] + "</td></tr>";
    });
    h += "</tbody></table>";
    $("b-check").innerHTML = h;
    var r = L.rules, t = "<p class=\"note\">Every run logs the selections that meet fixed rules (value at or above " + (r.min_ev * 100) + "%, price " + fmtPrice(r.price_min) + " to " + fmtPrice(r.price_max) + ", at least " + (r.min_league_q != null ? r.min_league_q + " league and " + r.min_team_q + " team games for a quarter or half and " + r.min_league + " and " + r.min_team + " for a full game" : r.min_league + " league and " + r.min_team + " team games") + "), once per game, before it starts. They settle from the final score. A tied quarter returns the stake; a total on the line is returned. These rules do not change when you change the page controls.</p>" +
      "<div class=\"tiles\"><div class=\"tile\"><b>" + L.picks + "</b><span>logged</span></div><div class=\"tile\"><b>" + L.open + "</b><span>open</span></div><div class=\"tile\"><b>" + L.settled + "</b><span>settled</span></div></div>";
    var ks = Object.keys(L.by_market);
    t += ks.length ? "<table><thead><tr><th class=\"l\">Market</th><th>Settled</th><th>W-L-T</th><th>Expected P&amp;L (model)</th><th>Actual P&amp;L</th><th>ROI</th></tr></thead><tbody>" + ks.map(function (k) {
      var s = L.by_market[k];
      return "<tr><td class=\"l\">" + esc(MARKET_NAME[k]) + "</td><td>" + s.n + "</td><td>" + s.w + "-" + s.l + "-" + s.t + "</td><td>" + money(s.ev * pnlScale("b-base"), 2) + "</td><td class=\"" + (s.pl >= 0 ? "pos" : "neg") + "\">" + money(s.pl * pnlScale("b-base"), 2) + "</td><td>" + pct(s.roi) + "</td></tr>";
    }).join("") + "</tbody></table><p class=\"note\">" + (FMT.cur === "units" ? "P&amp;L is in units per one unit staked on each selection." : "P&amp;L is in " + unitWord() + " for a flat stake of the base stake on each selection.") + " If the model has an edge, actual should track expected over a few hundred settled selections.</p>" : "<p class=\"note\">Nothing has settled yet.</p>";
    $("b-ledger").innerHTML = t;
  }
  function setupBoard() {
    var g = B.games, markets = {}, dates = {}, leagues = {};
    g.forEach(function (x) { x.ts = Date.parse(x.date + "T" + (/^\d\d:\d\d/.test(x.time) ? x.time.slice(0, 5) : "12:00") + ":00Z"); dates[x.date] = 1; leagues[x.league] = 1; Object.keys(x.m).forEach(function (k) { markets[k] = 1; }); });
    var order = ["q1", "q2", "q3", "q4", "h1", "ml", "total"].filter(function (k) { return markets[k]; });
    $("b-market").innerHTML = '<option value="all">All markets</option><option value="quarters">Quarters (Q1 to Q4)</option>' + order.map(function (k) { return '<option value="' + k + '">' + { q1: "First quarter", q2: "Second quarter", q3: "Third quarter", q4: "Fourth quarter", h1: "First half", ml: "Moneyline (game winner)", total: "Over / under (game total)" }[k] + "</option>"; }).join("");
    $("b-date").innerHTML = '<option value="">All upcoming</option>' + Object.keys(dates).sort().map(function (d) { return '<option value="' + d + '">' + d + "</option>"; }).join("");
    $("b-league").innerHTML = '<option value="">All leagues</option>' + Object.keys(leagues).sort().map(function (l) { return "<option>" + esc(l) + "</option>"; }).join("");
    setBoardDefaults();
  }
  function setBoardDefaults() {
    $("b-tq").value = B.model.trust.q; $("b-th").value = B.model.trust.h1; $("b-tm").value = B.model.trust.ml;
    [0, 1, 2, 3, 4].forEach(function (i) { $("b-m" + i).value = 1; });
  }

  // ---- wiring ---------------------------------------------------------------------------
  function setSourceDefaults() {
    var odds = $("g-source").value === "odds";
    document.querySelectorAll("[data-odds]").forEach(function (o) { o.disabled = !odds; });
    if (!odds && ($("s-rule").value === "fav" || $("s-rule").value === "dog")) $("s-rule").value = "home";
    $("s-pricemode").value = odds ? "book" : "fixed";
    var d = cur();
    if (!d) return;
    $("l-min").value = odds ? 5 : 30; $("t-min").value = odds ? 3 : 20;
    fillLeagueSelect($("t-league"), d); fillLeagueSelect($("s-league"), d);
    if (!splitTouched) {
      var g = d.games; $("g-split").value = g.length ? g[Math.floor(g.length * 0.7)].date : "";
    }
  }
  var C = null, chaseLast = null;   // every recommended pick, for the progressive wager view
  function chasePicks() {
    var type = document.querySelector('input[name="ctype"]:checked').value, win = document.querySelector('input[name="crank"]:checked').value === "w";
    return ((C && C.keys[type + (win ? "+w" : "")]) || []).map(function (a) {
      var o = {}; C.cols.forEach(function (c, i) { o[c] = a[i]; });
      o.ts = Date.parse(o.start); o.price = +o.price; o.p = +o.p_win;
      o.team = o.market === "total" ? (o.side === "over" ? "Over " : "Under ") + o.line : (o.side === "home" ? o.home : o.away);
      o.res = o.status === "settled" ? o.result : o.status === "void" ? "void" : "";
      return o;
    });
  }
  // BANK PROTECTION (what-if): the options typed in the ch-bank-box block of index.html, or null when it is off or missing.
  // To remove the feature delete that block (and, if you like, the lines marked BANK here and in stats.js).
  function bankOpts() {
    var on = $("ch-bk");
    if (!on || !on.checked) return null;
    var n = function (id) { return (+$(id).value || 0) / 100; };
    var b = { start: +$("ch-bank").value || 0, basePct: n("ch-bpct"), share: n("ch-rshare"), capPct: n("ch-capp"), writeOff: n("ch-wo"), stopAt: n("ch-stop"), resumeAt: n("ch-resume") };
    if (b.share <= 0 || b.share > 1) b.share = 1;
    if (b.resumeAt < b.stopAt) b.resumeAt = b.stopAt;
    return b.start > 0 && b.basePct > 0 ? b : null;
  }
  function chaseCols() {
    var when = function (t) { return new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
    var cell = function (x) { return x == null ? "–" : money(x, 2); };
    var gain = function (x) { return x == null ? "–" : '<span class="' + (x >= 0 ? "pos" : "neg") + '">' + money(x, 2) + "</span>"; };
    var cols = [
      { k: "ts", h: "Start", l: true, f: function (r) { return esc(when(r.ts)); } },
      { k: "game", h: "Game", l: true, v: function (r) { return r.home; }, f: function (r) { return esc(r.home + " v " + r.away) + '<br><span class="note">' + esc(r.league) + "</span>"; }, t: function (r) { return r.home + " v " + r.away; } },
      { k: "sel", h: "Bet", l: true, v: function (r) { return r.market; }, f: function (r) { return esc(MARKET_NAME[r.market] + ": " + r.team); }, t: function (r) { return MARKET_NAME[r.market] + ": " + r.team; } },
      { k: "price", h: "Bet365", f: function (r) { return fmtPrice(r.price); } },
      { k: "before", h: "Loss carried in (" + unitWord() + ")", f: function (r) { return cell(r.before); }, t: function (r) { return r.before == null ? "" : r.before.toFixed(2); } },
      { k: "wager", h: "Wager (" + unitWord() + ")", f: function (r) { return r.state === "bet" || r.state === "cap" ? money(r.wager, 2) : "–"; }, t: function (r) { return r.state === "bet" ? r.wager.toFixed(2) : ""; } },
      { k: "show", h: "Result", l: true, f: function (r) { return r.show === "Won" ? '<b class="pos">Won</b>' : r.show === "Lost" ? '<b class="neg">Lost</b>' : esc(r.show); }, t: function (r) { return r.show; } },
      { k: "score", h: "Score", l: true, f: function (r) { return r.score ? esc(r.score) + (r.score_note ? '<br><span class="note">' + esc(r.score_note) + "</span>" : "") : "–"; }, t: function (r) { return r.score ? r.score + (r.score_note ? "  " + r.score_note : "") : ""; } },
      { k: "profit", h: "Profit or loss (" + unitWord() + ")", f: function (r) { return gain(r.profit); }, t: function (r) { return r.profit == null ? "" : r.profit.toFixed(2); } },
      { k: "pnl", h: "Running total (" + unitWord() + ")", f: function (r) { return gain(r.pnl); }, t: function (r) { return r.pnl == null ? "" : r.pnl.toFixed(2); } },
      { k: "after", h: "Loss carried out (" + unitWord() + ")", f: function (r) { return cell(r.after); }, t: function (r) { return r.after == null ? "" : r.after.toFixed(2); } },
      { k: "note", h: "Note", l: true, f: function (r) { return esc(r.note); } }
    ];
    if (bankOpts()) cols.splice(cols.map(function (c) { return c.k; }).indexOf("pnl") + 1, 0,                                          // BANK
      { k: "bank", h: "Bank (" + unitWord() + ")", f: function (r) { return r.bank == null ? "–" : money(r.bank, 2); }, t: function (r) { return r.bank == null ? "" : r.bank.toFixed(2); } });
    return cols;
  }
  // The recovery rules typed on the Progressive wager tab, or null when switched off (also used to mark today's picks).
  function recoverRules() {
    if (!$("ch-rec").checked) return null;
    return { pMin: (+$("ch-rp").value || 0) / 100, priceMin: rminDec(), priceMax: priceIn("ch-rmax"), minTeam: +$("ch-rt").value || 0, maxWarn: +$("ch-rw").value || 0, maxWorse: $("ch-rg") ? (+$("ch-rg").value || 0) / 100 : 0 };
  }
  function ymd(t) { var d = new Date(t); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function dayName(t) { return new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
  function renderChase() {
    if (!C) { $("ch-tiles").innerHTML = ""; $("ch-stats").innerHTML = ""; $("ch-note").textContent = "No recommended picks have been recorded yet."; return; }
    var from = $("ch-from").value, picks = chasePicks().filter(function (p) { return !from || ymd(p.ts) >= from; });
    var base = +$("ch-base").value || 1, cap = +$("ch-cap").value || 0, now = Date.now();
    var recover = recoverRules(), bank = bankOpts();
    var sim = Stats.progressive(picks.map(function (p) { return { start: p.ts, price: p.price, result: p.res, market: p.market, p: p.p, nTeam: +p.n_team, warn: p.warn, gap: p.gap, standing: p.standing }; }), { base: base, cap: cap, partial: $("ch-part").checked, recover: recover, bank: bank });
    var why = { cap: "Skipped: wager over the limit", wait: "Waiting for an earlier result", rule: "Skipped: recovery rules" };
    var endOf = function (r) { return r.ts + (Stats.RESULT_MIN[r.market] || 150) * 60000; };
    var rows = picks.map(function (p, i) {
      var r = Object.assign(p, sim.rows[i]);
      r.day = ymd(r.ts); r.label = MARKET_NAME[r.market] + ": " + r.team + ", " + dayName(r.ts);
      var pickRes = { W: " (pick won)", L: " (pick lost)", T: " (pick tied)" }[p.res] || "";
      r.show = r.lost ? "Result missing" : r.state === "bet" ? ({ W: "Won", L: "Lost", T: "Tied (stake returned)", "void": "Void" }[p.res] || (p.ts < now ? "Started" : "Open")) : r.state === "wait" ? "Not placed" : "Skipped" + pickRes;
      var hm = function (t) { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
      var during = r.state === "bet" && r.inPlay.length ? "Placed while " + r.inPlay.map(function (k) { return picks[k].home + " v " + picks[k].away + " (" + MARKET_NAME[picks[k].market] + ")"; }).join(" and ") + " was in play" : "";
      var lim = r.capped ? "At the limit: recovering the whole loss would need " + money(r.full, 2) + ", so only part of it comes back if this wins" : "";
      r.note = r.state === "bet" ? [during, lim, p.res ? "" : "Result expected about " + hm(endOf(r))].filter(Boolean).join(". ") : r.state === "rule" ? "Skipped while a loss is carried: " + r.reason : why[r.state];
      if (bank) {                                                                                                          // BANK
        var ev = r.bkEvent, bn = [];
        if (r.flat) bn.push("Stop-loss active: flat base stake");
        if (ev && ev.type === "writeoff") bn.push("Loss carried passed the write-off line: " + money(ev.amount, 2) + " written off, the next wager starts from the base stake");
        if (ev && ev.type === "stop") bn.push("Stop-loss: bank down to " + money(ev.bank, 2) + ", " + money(ev.amount, 2) + " of carried loss given up, flat base stakes until the bank is back to " + money(bank.resumeAt * bank.start, 2));
        if (ev && ev.type === "resume") bn.push("Bank back to " + money(ev.bank, 2) + ": normal wagering resumes");
        r.note = [r.note].concat(bn).filter(Boolean).join(". ");
      }
      return r;
    });
    var S = sim.sum, st = Stats.progressiveStats(rows), nxt = rows.filter(function (r) { return r.ts > now; })[0];
    var wl = function (x) { return x ? esc(x.label) : ""; };
    var streak = function (n, what) { return st.cur.n && st.cur.type === what ? "current run " + st.cur.n : "current run 0"; };
    $("ch-tiles").innerHTML =
      tile("Running total (" + unitWord() + ")", money(S.pnl, 2), S.pnl >= 0 ? "pos" : "neg", S.w + " won, " + S.l + " lost" + (S.t ? ", " + S.t + " tied" : "")) +
      tile("Loss carried now", money(S.carried, 2), S.carried > 0 ? "neg" : "", "to be added to the next wager" + (S.claimed > 0 ? " (" + money(S.claimed, 2) + " more is riding on open bets)" : "")) +
      tile("Next wager", nxt ? (nxt.state === "bet" ? money(nxt.wager, 2) : "–") : "–", "", nxt ? (nxt.state === "bet" ? esc(MARKET_NAME[nxt.market] + ": " + nxt.team) : esc(why[nxt.state].toLowerCase())) : "no upcoming pick") +
      tile("Open now", money(S.exposure, 2), "", S.open + " bets awaiting results") +
      tile("Games wagered to date", st.placed, "", st.settled + " settled, " + st.open + " open") +
      (bank ? tile("Bank now", money(S.bank, 2), S.bank >= S.startBank ? "pos" : "neg", "started at " + money(S.startBank, 2) + ", lowest " + money(S.lowBank, 2)) +   // BANK
        tile("Stop-loss", S.inFlat ? "Flat stakes" : "Normal", S.inFlat ? "neg" : "", S.stops + " times triggered, " + S.flatBets + " flat bets") +
        tile("Loss given up", money(S.writtenOff, 2), "", S.writeOffs + " write-offs, " + S.stops + " stop-loss resets") : "");
    $("ch-stats").innerHTML =
      tile("Win rate", pct(st.winRate), "", st.expRate == null ? "" : "model expected " + pct(st.expRate)) +
      tile("Longest win streak", st.streakW, "", streak(st.streakW, "W")) +
      tile("Longest loss streak", st.streakL, "", streak(st.streakL, "L")) +
      tile("Largest single wager", st.maxWager ? money(st.maxWager.v, 2) : "–", "", wl(st.maxWager)) +
      tile("Lowest single wager", st.minWager ? money(st.minWager.v, 2) : "–", "", wl(st.minWager)) +
      tile("Average wager", st.avgWager == null ? "–" : money(st.avgWager, 2), "", st.avgPrice == null ? "" : "average price " + fmtPrice(st.avgPrice)) +
      tile("Total staked", money(st.staked, 2), "", "settled bets, ties excluded") +
      tile("Return on staked", st.roi == null ? "–" : pct(st.roi), st.roi == null ? "" : st.roi >= 0 ? "pos" : "neg", "running total ÷ staked") +
      tile("Best bet", st.best && st.best.v > 0 ? money(st.best.v, 2) : "–", st.best && st.best.v > 0 ? "pos" : "", st.best && st.best.v > 0 ? wl(st.best) : "no winning bet yet") +
      tile("Worst bet", st.worst && st.worst.v < 0 ? money(st.worst.v, 2) : "–", st.worst && st.worst.v < 0 ? "neg" : "", st.worst && st.worst.v < 0 ? wl(st.worst) : "no losing bet yet") +
      tile("Peak running total", money(st.peak, 2), "", "highest point so far") +
      tile("Largest drawdown", money(st.maxDD, 2), "", "fall from a peak") +
      tile("Largest loss carried", money(S.maxCarried, 2), "", "most owed at any point") +
      tile("Bets at the limit", S.capped, "", "the wager needed was over the limit, so part of the loss was left carried") +
      tile("Picks not placed", S.skipCap + S.waiting + S.skipRule, "", S.skipCap + " over the limit, " + S.skipRule + " failed the recovery rules, " + S.waiting + " waiting for an earlier result");
    $("ch-note").textContent = "Recommended picks only, oldest first (click Start to reverse), for the game type and ranking chosen. Every bet is meant to earn one base stake. A loss adds the money lost plus the base stake it failed to earn, and the next wager is sized to win it all back: wager = (loss carried + base stake) ÷ (price − 1), rounded up to the cent. Every pick is bet, sized when its game starts from the losses already known by then. A loss carried is staked once: a bet in play holds the loss it was staked to recover, so the next bet to start while it is in play stakes the base only. If that bet loses, the loss goes into the next game that has not started. Result times are estimated (Q1 35 minutes, half 70, Q3 100, Q4 and full game 150). Picks that start together are all placed: the first one listed carries the loss, the others stake the base only, and all their losses are added to the next wager. Ties and voids return the stake and do not break a streak. Results are settled by the daily runs, so recent picks can show as not placed yet until then. Recovery rules (when switched on) apply only while a loss is carried: a pick that fails them (including a price below the minimum) is skipped and the loss stays carried until a pick that passes comes along. When the wager a loss needs is over the largest wager, the largest wager is bet instead (partial recovery: a win pays back only part of the loss, a loss adds the stake and the base to what is carried), or the pick is skipped if that box is unticked. Past picks are replayed with the base stake, limit, recovery rules and start day above.";
    if (bank) $("ch-note").textContent += " Bank protection (what-if) is ON: base stake " + money(bank.start * bank.basePct, 2) + " and largest wager " + (bank.capPct > 0 ? money(bank.start * bank.capPct, 2) : "none") + " come from the bank, each wager stakes " + Math.round(bank.share * 100) + "% of the carried loss plus the base, a carried loss over " + (bank.writeOff > 0 ? money(bank.start * bank.writeOff, 2) : "no limit") + " is written off, and below " + (bank.stopAt > 0 ? money(bank.start * bank.stopAt, 2) : "no floor") + " the stop-loss switches to flat base stakes until the bank is back to " + money(bank.start * bank.resumeAt, 2) + ".";   // BANK
    $("ch-base").disabled = $("ch-cap").disabled = !!bank;                                                                       // BANK
    chaseLast = table($("ch-table"), chaseCols(), rows, sorts.chase, renderChase);
    var dayCols = [
      { k: "ts", h: "Day", l: true, f: function (r) { return esc(dayName(r.ts)); }, t: function (r) { return r.day; } },
      { k: "bets", h: "Bets placed", f: function (r) { return r.bets; } },
      { k: "w", h: "Won" }, { k: "l", h: "Lost" }, { k: "t", h: "Tied" }, { k: "open", h: "Open" },
      { k: "pl", h: "Profit or loss (" + unitWord() + ")", f: function (r) { return r.bets && r.open === r.bets ? "–" : '<span class="' + (r.pl >= 0 ? "pos" : "neg") + '">' + money(r.pl, 2) + "</span>"; }, t: function (r) { return r.pl.toFixed(2); } },
      { k: "total", h: "Running total at day end (" + unitWord() + ")", f: function (r) { return r.total == null ? "–" : money(r.total, 2); }, t: function (r) { return r.total == null ? "" : r.total.toFixed(2); } },
      { k: "carried", h: "Loss carried at day end (" + unitWord() + ")", f: function (r) { return r.carried == null ? "–" : money(r.carried, 2); }, t: function (r) { return r.carried == null ? "" : r.carried.toFixed(2); } }
    ];
    table($("ch-days"), dayCols, st.days, sorts.chaseDays, renderChase);
    var pts = rows.filter(function (r) { return r.pnl != null && !r.lost; }).map(function (r) { var d = new Date(r.ts).toLocaleDateString([], { month: "short", day: "numeric" }); return { x: d, y: +r.pnl.toFixed(3), tip: d + "  " + r.home + " v " + r.away + "  " + MARKET_NAME[r.market] + ": " + r.team + "  running " + money(r.pnl, 2) }; });
    lineChart($("c-chase"), pts);
  }
  var JEFF_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSemN9Ra3hhTMUg2lRG77whuVBE67GIWYKKlJOMZoymbwHVw2g/viewform?embedded=true";   // embed address of the Google Form that collects Jeff's comment
  function renderJeff() {
    var box = $("j-form");
    if (box.dataset.done) return;
    box.dataset.done = "1";
    box.innerHTML = JEFF_FORM
      ? '<iframe src="' + JEFF_FORM + '" title="Comment form" style="width:100%;height:600px;border:1px solid #d0d7de;border-radius:8px">Loading</iframe>'
      : '<p class="note">The comment form is not connected yet.</p>';
  }
  function renderActive() {
    if (tab === "jeff") return renderJeff();
    if (tab === "chase") return renderChase();
    if (tab === "today") return renderToday();
    if (tab === "board") return renderBoard();
    if (!cur()) { $("meta").textContent = "This data set is not available yet."; return; }
    ({ leagues: renderLeagues, teams: renderTeams, strategy: renderStrategy, games: renderGames, report: function () { } })[tab]();
  }
  function show(t) {
    tab = t;
    document.querySelectorAll("#tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === t); });
    ["today", "chase", "board", "leagues", "teams", "strategy", "games", "report", "jeff"].forEach(function (n) { $("tab-" + n).hidden = n !== t; });
    document.querySelector(".global").style.display = t === "board" || t === "today" || t === "jeff" || t === "chase" ? "none" : "";
    renderActive();
  }
  function load(name) {
    return fetch("data/" + name + ".json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { D[name] = prepared(j); }).catch(function () { D[name] = null; });
  }
  fetch("data/chase.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) { C = j; if (tab === "chase") renderChase(); }).catch(function () { C = null; });
  var boardLoad = fetch("data/board.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (j) { B = j; setupBoard(); }).catch(function () { B = null; });
  Promise.all([load("history"), load("odds"), fetch("data/meta.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).catch(function () { return {}; }), boardLoad]).then(function (res) {
    meta = res[2];
    syncFormat();
    if (FMT.odds === "us") showPriceInputs(PRICE_INPUTS.map(function (id) { return +$(id).value || 0; }));
    if (!D.history && !D.odds && !B) { $("meta").textContent = "Data files not found. Open this page from the published site, not from a file on disk."; return; }
    if (!D.history) $("g-source").value = "odds";
    $("meta").textContent = ["history", "odds"].filter(function (k) { return meta[k]; }).map(function (k) {
      return (k === "odds" ? "Bet365 prices: " : "History: ") + meta[k].games.toLocaleString() + " games, " + meta[k].first + " to " + meta[k].last;
    }).join("  |  ") + (meta.generated ? "  |  built " + meta.generated : "");
    if (B) $("meta").textContent = "Board built " + B.generated + "  |  " + $("meta").textContent;
    if (D.history || D.odds) setSourceDefaults();
    show(B ? "today" : "leagues");
  });
  $("g-source").onchange = function () { setSourceDefaults(); renderActive(); };
  ["g-q", "l-min", "t-league", "t-min"].forEach(function (id) { $(id).onchange = renderActive; });
  $("g-split").onchange = function () { splitTouched = true; renderActive(); };
  document.querySelectorAll("#s-controls select, #s-controls input").forEach(function (el) { el.onchange = renderActive; });
  document.querySelectorAll("#tabs button").forEach(function (b) { b.onclick = function () { show(b.dataset.tab); }; });
  var defaults = { leagues: { k: "n", d: -1 }, teams: { k: "n", d: -1 }, games: { k: "date", d: 1 } };
  [["l", "leagues", renderLeagues], ["t", "teams", renderTeams], ["g", "games", renderGames]].forEach(function (x) {
    $(x[0] + "-reset").onclick = function () { sorts[x[1]] = { k: defaults[x[1]].k, d: defaults[x[1]].d }; x[2](); };
  });
  $("l-csv").onclick = function () { var d = cur(); csv(leagueCols(d), leagueRows(d), "leagues.csv"); };
  $("t-csv").onclick = function () { csv(teamCols(), teamRows(cur()), "teams.csv"); };
  $("g-csv").onclick = function () { if (!last) renderGames(); csv(gameCols(), last.r.events, "bets.csv"); };
  $("g-all").onchange = renderGames;
  document.querySelectorAll("#b-controls select, #b-controls input, #b-rules input").forEach(function (el) { el.onchange = renderBoard; });
  ["p-base", "p-carried", "p-rec"].forEach(function (id) { $(id).onchange = renderToday; });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="ptype"]'), function (r) { r.onchange = renderToday; });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="prank"]'), function (r) { r.onchange = renderToday; });
  ["ctype", "crank"].forEach(function (n) { Array.prototype.forEach.call(document.querySelectorAll('input[name="' + n + '"]'), function (r) { r.onchange = renderChase; }); });
  ["ch-base", "ch-cap", "ch-part", "ch-from", "ch-rec", "ch-rp", "ch-rmax", "ch-rt", "ch-rw", "ch-rg"].forEach(function (id) { $(id).onchange = function () { renderChase(); if (tab === "today") renderToday(); }; });
  ["ch-bk", "ch-bank", "ch-bpct", "ch-capp", "ch-rshare", "ch-wo", "ch-stop", "ch-resume"].forEach(function (id) { if ($(id)) $(id).onchange = function () { renderChase(); }; });   // BANK
  $("ch-rmin").oninput = function () { syncRmin(); renderChase(); if (tab === "today") renderToday(); };
  syncRmin();
  $("ch-csv").onclick = function () { if (!chaseLast) renderChase(); if (chaseLast) csv(chaseCols(), chaseLast, "progressive_wager.csv"); };
  $("p-csv").onclick = function () { if (!todayLast) renderToday(); if (todayLast) csv(todayCols(), todayLast, "todays_picks.csv"); };
  Array.prototype.forEach.call(document.querySelectorAll('input[name="fmt-odds"]'), function (r) {
    r.onchange = function () {
      if (r.value === FMT.odds) return;
      var decs = PRICE_INPUTS.map(priceIn);
      FMT.odds = r.value; showPriceInputs(decs); syncFormat(); saveFormat(); renderActive();
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="fmt-cur"]'), function (r) {
    r.onchange = function () { FMT.cur = r.value; syncFormat(); saveFormat(); renderActive(); };
  });
  $("b-reset").onclick = function () { sorts.board = { k: "rank", d: 1 }; renderBoard(); };
  $("b-defaults").onclick = function () { if (B) { setBoardDefaults(); renderBoard(); } };
  $("b-csv").onclick = function () { if (!boardLast) renderBoard(); if (boardLast) csv(boardCols(), boardLast.shown, "board.csv"); };
  $("r-build").onclick = buildReport;
  $("r-print").onclick = function () { buildReport(); window.print(); };
})();
