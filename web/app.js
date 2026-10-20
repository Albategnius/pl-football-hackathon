const S = {
  meta: null, stats: null, status: null, templates: {}, feeds: {},
  suggestions: new Map(), overlays: [], audit: [], packages: [], events: [],
  feed: "main", editing: new Set(), screenTimer: null,
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const team = (id) => S.meta.teams.find((t) => t.id === id);
const clock = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("request failed"), { data, status: res.status });
  return data;
}

// --- header ---------------------------------------------------------------------

function renderScorebug() {
  if (!S.meta || !S.stats) return;
  const h = team(S.meta.home), a = team(S.meta.away), sc = S.stats.score;
  $("scorebug").innerHTML = `
    <span class="team"><span class="swatch" style="background:${h.color}"></span>${esc(h.short)}</span>
    <span class="score">${sc[h.id]} - ${sc[a.id]}</span>
    <span class="team">${esc(a.short)}<span class="swatch" style="background:${a.color}"></span></span>
    <span class="clock">${S.stats.finished ? "FT" : clock(S.stats.t)}</span>`;
  $("screen-bug").innerHTML = `${esc(h.id)} ${sc[h.id]}-${sc[a.id]} ${esc(a.id)} &nbsp; ${S.stats.finished ? "FT" : clock(S.stats.t)}`;
}

function renderStatus() {
  const st = S.status;
  if (!st) return;
  $("speed").value = String(st.speed);
  $("faults").checked = st.inject_faults;
  $("club").value = st.club;
  $("mode").textContent = `model: ${st.mode}`;
  $("mode").className = "badge" + (st.mode.startsWith("live") ? " live" : "");
  $("btn-start").textContent = st.finished ? "Finished" : (st.running ? "Running" : "Start");
}

// --- live feed ------------------------------------------------------------------

function pitchLines() {
  return `<g fill="none" stroke="rgba(255,255,255,.45)" stroke-width=".4">
    <rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/>
    <circle cx="52.5" cy="34" r="9.15"/><rect x="0" y="13.84" width="16.5" height="40.32"/>
    <rect x="88.5" y="13.84" width="16.5" height="40.32"/><rect x="0" y="24.84" width="5.5" height="18.32"/>
    <rect x="99.5" y="24.84" width="5.5" height="18.32"/></g>`;
}

function renderPitch() {
  const pts = S.events.filter((e) => e.x !== undefined).slice(-10);
  let marks = "";
  pts.forEach((e, i) => {
    const c = team(e.team)?.color || "#fff", o = 0.25 + 0.75 * (i / pts.length);
    if (e.type === "pass" || e.type === "carry") {
      marks += `<line x1="${e.x}" y1="${e.y}" x2="${e.end_x}" y2="${e.end_y}" stroke="${c}" stroke-width=".6" opacity="${o}" ${e.outcome === "incomplete" ? 'stroke-dasharray="1.5 1"' : ""}/>`;
    }
    marks += `<circle cx="${e.x}" cy="${e.y}" r="${e.type === "shot" ? 1.6 : 0.9}" fill="${c}" opacity="${o}"/>`;
  });
  const last = pts[pts.length - 1];
  if (last) {
    const bx = last.end_x !== undefined && last.outcome !== "incomplete" ? last.end_x : last.x;
    const by = last.end_y !== undefined && last.outcome !== "incomplete" ? last.end_y : last.y;
    marks += `<circle cx="${bx}" cy="${by}" r="1.3" fill="#fff" stroke="#000" stroke-width=".3"/>`;
  }
  $("pitch").innerHTML = pitchLines() + marks;
}

function renderStats() {
  if (!S.stats) return;
  const h = team(S.meta.home), a = team(S.meta.away);
  const m = S.stats.momentum;
  $("momentum").innerHTML = `
    <div class="bar"><div class="fill" style="${m >= 0 ? `right:50%;width:${m / 2}%;background:${h.color}` : `left:50%;width:${-m / 2}%;background:${a.color}`}"></div></div>
    <div class="labels"><span>${esc(h.short)}</span><span>momentum ${Math.abs(m)} | chaos ${S.stats.chaos}/min</span><span>${esc(a.short)}</span></div>`;
  const th = S.stats.totals[h.id], ta = S.stats.totals[a.id];
  const rows = [["Possession %", "possession_pct"], ["Passes", "passes"], ["Pass accuracy %", "pass_accuracy_pct"],
    ["Shots", "shots"], ["On target", "shots_on_target"], ["xG", "xg"], ["Tackles", "tackles"]];
  $("statbars").innerHTML = rows.map(([name, k]) => {
    const x = th[k], y = ta[k], tot = (x + y) || 1;
    return `<div class="row"><div class="name">${name}</div><span class="v">${x}</span>
      <div class="split"><div style="width:${100 * x / tot}%;background:${h.color}"></div><div style="width:${100 * y / tot}%;background:${a.color}"></div></div>
      <span class="v r">${y}</span></div>`;
  }).join("");
}

function tickerLine(e) {
  const who = e.player ? esc(e.player) : "";
  const tm = e.team ? esc(team(e.team).short) : "";
  switch (e.type) {
    case "goal": return ["goal", `GOAL ${tm} - ${who}`];
    case "shot": return ["shot", `Shot (${e.outcome.replace("_", " ")}) ${who}, xG ${e.xg}, ${e.speed_kmh} km/h`];
    case "tackle": return ["", `Tackle won by ${who} (${tm})`];
    case "foul": return ["", `Foul by ${who} (${tm})`];
    case "kickoff": return ["", `Kick-off ${tm}`];
    case "half_start": return ["goal", `Period ${e.period} starts`];
    case "half_end": return ["goal", "Half-time"];
    case "full_time": return ["goal", "Full-time"];
    case "possession_change": return e.reason === "interception" ? ["", `Interception ${tm} - ${who}`] : null;
    case "carry": return e.speed_kmh >= 32 ? ["", `Sprint ${who} ${e.speed_kmh} km/h`] : null;
    case "pass": return e.difficulty >= 75 && e.outcome === "complete" ? ["", `Difficult pass ${who} (${e.difficulty}/100)`] : null;
    default: return null;
  }
}

function addTicker(e) {
  const line = tickerLine(e);
  if (!line) return;
  const li = document.createElement("li");
  li.className = line[0];
  li.innerHTML = `<span class="m">${e.minute}'</span><span>${line[1]}</span>`;
  $("ticker").prepend(li);
  while ($("ticker").children.length > 80) $("ticker").lastChild.remove();
}

// --- graphics -------------------------------------------------------------------

function gfxHTML(tpl, slots, data) {
  const s = Object.fromEntries(Object.entries(slots || {}).map(([k, v]) => [k, esc(v)]));
  const color = data?.team ? team(data.team)?.color : "#d7263d";
  const style = `style="--teamc:${color}"`;
  const h = team(S.meta.home), a = team(S.meta.away);
  switch (tpl) {
    case "lower_third":
      return `<div class="gfx lower_third" ${style}><div class="hl">${s.headline}</div><div class="bd">${s.body}</div></div>`;
    case "player_tag":
      return `<div class="gfx player_tag" ${style}><div class="hl">${s.player}</div>
        <div class="bd"><div class="kv"><span>${s.stat_label}</span><span class="big">${s.stat_value}</span></div>${s.context}</div></div>`;
    case "pass_card":
      return `<div class="gfx pass_card" ${style}><div class="hl">${s.player}</div>
        <div class="bd"><div class="kv"><span>Distance <b class="big">${s.distance}</b></span><span>Difficulty <b class="big">${s.difficulty}</b></span></div>${s.caption}</div></div>`;
    case "momentum_bar": {
      const m = data?.momentum ?? 0, left = 50 + m / 2;
      return `<div class="gfx momentum_bar" ${style}><div class="hl">${s.headline}</div><div class="bd">
        <div class="kv"><span>${esc(h.short)}</span><span>${esc(a.short)}</span></div>
        <div class="mbar"><div style="width:${left}%;background:${h.color}"></div><div style="width:${100 - left}%;background:${a.color}"></div></div>${s.caption}</div></div>`;
    }
    case "comparison":
      return `<div class="gfx comparison" ${style}><div class="hl">${s.metric}</div><div class="bd">
        <div class="cmp"><span class="big">${s.home_value}</span><span>${esc(h.short)} v ${esc(a.short)}</span><span class="big">${s.away_value}</span></div>${s.caption}</div></div>`;
    default:
      return `<div class="gfx"><div class="bd">${esc(JSON.stringify(slots))}</div></div>`;
  }
}

function showOnAir(ov) {
  $("screen-gfx").innerHTML = gfxHTML(ov.template, ov.slots, ov.data);
  $("cue-json").textContent = JSON.stringify(ov, null, 2);
  clearTimeout(S.screenTimer);
  S.screenTimer = setTimeout(() => { $("screen-gfx").innerHTML = ""; }, ov.duration_s * 1000);
}

function renderFeedTabs() {
  $("feed-tabs").innerHTML = Object.keys(S.feeds).map((f) =>
    `<button class="btn small ${f === S.feed ? "active" : ""}" data-feed="${f}" title="${esc(S.feeds[f])}">${f}</button>`).join("");
}

// --- suggestion queue -------------------------------------------------------------

const ORDER = { pending: 0, adapting: 1, drafting: 2, queued: 3, approved: 4, rejected: 5, dropped: 6 };

function traceHTML(trace) {
  return `<ol class="trace">${trace.map((t) => {
    const mark = t.ok === true ? '<span class="ok">PASS</span> ' : t.ok === false ? '<span class="no">FAIL</span> ' : "";
    const src = t.source ? ` <span class="src">[${esc(t.source)}]</span>` : "";
    return `<li><span class="agent">${esc(t.agent)}</span> ${mark}${esc(t.detail)}${src}</li>`;
  }).join("")}</ol>`;
}

function cardHTML(sug) {
  const c = sug.candidate, st = sug.status;
  if (st === "dropped") {
    return `<div class="card-head"><span class="chip">${esc(c.kind)}</span><span>${c.minute}' ${esc(c.title)}</span>
      <span class="status">dropped by MomentScout: ${esc(sug.dropped_reason)}</span></div>`;
  }
  let html = `<div class="card-head"><span class="chip">${esc(c.kind.replace("_", " "))}</span>
    <span class="title">${c.minute}' ${esc(c.title)}</span><span class="status ${st}">${st}</span></div>`;
  if (sug.analysis) html += `<div class="why"><b>Why now:</b> ${esc(sug.analysis.why_now)}</div>`;
  if (sug.graphic && st !== "queued") html += gfxHTML(sug.graphic.template, sug.graphic.slots, { team: c.team, momentum: c.facts.momentum_now * (c.team === S.meta.home ? 1 : -1) });
  if (sug.trace?.length) html += `<details ${st === "drafting" ? "open" : ""}><summary class="muted">Agent trace (${sug.trace.length} steps${sug.attempts > 1 ? `, ${sug.attempts} drafts` : ""})</summary>${traceHTML(sug.trace)}</details>`;
  html += `<div class="sources">Source events: ${c.source_event_ids.slice(0, 8).map((i) => `<code>${esc(i)}</code>`).join("")}${c.source_event_ids.length > 8 ? ` +${c.source_event_ids.length - 8}` : ""}</div>`;
  if (st === "pending") {
    if (S.editing.has(sug.id)) {
      const limits = S.templates[sug.graphic.template].slots;
      html += `<form class="edit-form" data-id="${sug.id}">${Object.entries(limits).map(([k, lim]) =>
        `<label>${k} (max ${lim})<input type="text" name="${k}" value="${esc(sug.graphic.slots[k] || "")}"></label>`).join("")}
        <div class="edit-issues"></div>
        <div class="actions"><button class="btn good" type="submit">Fact-check and approve</button>
        <button class="btn" type="button" data-act="cancel" data-id="${sug.id}">Cancel</button></div></form>`;
    } else {
      html += `<div class="actions"><button class="btn good" data-act="approve" data-id="${sug.id}">Approve to air</button>
        <button class="btn" data-act="edit" data-id="${sug.id}">Edit</button>
        <button class="btn bad" data-act="reject" data-id="${sug.id}">Reject</button></div>`;
    }
  }
  if (sug.feeds) {
    html += `<div class="feeds">${Object.entries(sug.feeds).map(([f, v]) =>
      `<div class="f"><b>${esc(f)}</b>${Object.values(v.slots).map(esc).join(" / ")}</div>`).join("")}</div>`;
  }
  return html;
}

function upsertCard(sug) {
  S.suggestions.set(sug.id, sug);
  let el = document.querySelector(`.card[data-id="${sug.id}"]`);
  if (!el) {
    el = document.createElement("div");
    el.dataset.id = sug.id;
    $("queue").prepend(el);
  }
  el.className = `card ${sug.status}`;
  el.style.order = String(ORDER[sug.status] * 10000 - Math.round(sug.candidate.t));
  if (S.editing.has(sug.id) && el.querySelector("form")) return;
  el.innerHTML = cardHTML(sug);
}

// --- right column -------------------------------------------------------------------

function addAudit(entry) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="who ${entry.actor}">${esc(entry.actor)}</span> ${esc(entry.action)}
    ${entry.suggestion_id ? `<code>${esc(entry.suggestion_id)}</code>` : ""} <span class="muted">min ${entry.match_minute} | ${esc(entry.at.slice(11, 19))} UTC</span>
    <div class="muted">${esc(entry.details)}</div>`;
  $("audit").prepend(li);
}

function renderPackage(pkg) {
  const items = (pkg.rundown || []).map((r) => {
    const sug = S.suggestions.get(r.id);
    return `<li><b>${sug ? `${sug.candidate.minute}' ${esc(sug.candidate.title)}` : esc(r.id)}</b> - ${esc(r.why)}</li>`;
  }).join("");
  $("package").classList.remove("muted");
  $("package").innerHTML = `<div class="headline">${esc(pkg.headline)}</div>
    <div class="muted">${esc(pkg.phase.replace("_", " "))} | source: ${esc(pkg.source)}</div>
    <ol>${items || "<li class='muted'>No approved graphics yet.</li>"}</ol>
    <div class="script">${esc(pkg.script)}</div>`;
}

// --- boot ---------------------------------------------------------------------------

function loadFull(state) {
  Object.assign(S, { meta: state.meta, stats: state.stats, status: state.status, templates: state.templates,
    feeds: state.feeds, overlays: state.overlays, audit: state.audit, packages: state.packages, events: state.recent_events });
  S.suggestions = new Map();
  S.editing.clear();
  $("queue").innerHTML = ""; $("ticker").innerHTML = ""; $("audit").innerHTML = ""; $("screen-gfx").innerHTML = "";
  $("club").innerHTML = state.meta.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  state.suggestions.forEach(upsertCard);
  state.audit.forEach(addAudit);
  state.recent_events.forEach(addTicker);
  if (state.packages.length) renderPackage(state.packages[state.packages.length - 1]);
  else { $("package").className = "package muted"; $("package").textContent = "Built automatically at half-time and full-time."; }
  renderFeedTabs(); renderScorebug(); renderStats(); renderPitch(); renderStatus();
}

function connect() {
  const es = new EventSource("/api/stream");
  const on = (name, fn) => es.addEventListener(name, (m) => fn(JSON.parse(m.data)));
  on("match_event", (e) => { S.events.push(e); if (S.events.length > 60) S.events.shift(); addTicker(e); renderPitch(); });
  on("stats", (st) => { S.stats = st; renderScorebug(); renderStats(); });
  on("suggestion", upsertCard);
  on("trace", (t) => { const s = S.suggestions.get(t.id); if (s) { s.trace = [...(s.trace || []), t]; upsertCard(s); } });
  on("overlays", (ovs) => { S.overlays.push(...ovs); const mine = ovs.find((o) => o.feed === S.feed); if (mine) showOnAir(mine); });
  on("audit", addAudit);
  on("package", renderPackage);
  on("status", (st) => { S.status = st; renderStatus(); });
  on("reset", loadFull);
  es.onerror = () => { es.close(); setTimeout(async () => { loadFull(await api("/api/state")); connect(); }, 1500); };
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.id === "btn-start") return api("/api/control", { action: "start" });
  if (b.id === "btn-pause") return api("/api/control", { action: "pause" });
  if (b.id === "btn-reset") return api("/api/control", { action: "reset" });
  if (b.id === "btn-package") return api("/api/package", { phase: "on_demand" });
  if (b.dataset.feed) {
    S.feed = b.dataset.feed; renderFeedTabs();
    const last = [...S.overlays].reverse().find((o) => o.feed === S.feed);
    if (last) showOnAir(last);
    return;
  }
  const id = b.dataset.id, act = b.dataset.act;
  if (!act) return;
  if (act === "approve") { b.disabled = true; await api(`/api/suggestions/${id}/approve`, {}).catch(() => {}); }
  if (act === "reject") await api(`/api/suggestions/${id}/reject`, { reason: "producer rejected" }).catch(() => {});
  if (act === "edit") { S.editing.add(id); const s = S.suggestions.get(id); document.querySelector(`.card[data-id="${id}"]`).innerHTML = cardHTML(s); }
  if (act === "cancel") { S.editing.delete(id); upsertCard(S.suggestions.get(id)); }
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target, id = form.dataset.id;
  const slots = Object.fromEntries(new FormData(form).entries());
  try {
    S.editing.delete(id);
    await api(`/api/suggestions/${id}/approve`, { slots });
  } catch (err) {
    S.editing.add(id);
    const issues = err.data?.detail?.issues || ["approval failed"];
    form.querySelector(".edit-issues").innerHTML = "Fact Checker blocked this edit:<br>" + issues.map(esc).join("<br>");
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.target.tagName === "INPUT") return;
  const top = [...S.suggestions.values()].filter((s) => s.status === "pending").sort((x, y) => y.candidate.priority - x.candidate.priority || y.candidate.t - x.candidate.t)[0];
  if (!top) return;
  if (ev.key === "a") api(`/api/suggestions/${top.id}/approve`, {}).catch(() => {});
  if (ev.key === "r") api(`/api/suggestions/${top.id}/reject`, { reason: "producer rejected (hotkey)" }).catch(() => {});
});

$("speed").addEventListener("change", (e) => api("/api/control", { speed: Number(e.target.value) }));
$("faults").addEventListener("change", (e) => api("/api/control", { inject_faults: e.target.checked }));
$("club").addEventListener("change", (e) => api("/api/control", { club: e.target.value }));

api("/api/state").then((st) => { loadFull(st); connect(); });
