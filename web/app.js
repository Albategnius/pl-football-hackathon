"use strict";

const S = {
  meta: null, stats: null, status: null, templates: {}, feeds: {},
  suggestions: new Map(), overlays: [], events: [],
  feed: "main", editing: new Set(), expanded: new Set(), screenTimer: null, started: false,
  hoverLock: false, dirty: false,
  agentState: {},
};

const AGENTS = [
  { id: "MomentScout", role: "Spots moments worth a graphic, skips stale or repeated ones", kind: "Rules" },
  { id: "StatsAnalyst", role: "Explains why the moment matters right now", kind: "AI model" },
  { id: "GraphicsProducer", role: "Picks a template and writes the graphic", kind: "AI model" },
  { id: "FactChecker", role: "Checks every number and length; sends failures back", kind: "Code" },
  { id: "FeedAdapter", role: "Rewrites the approved graphic for 3 feeds", kind: "AI model" },
];
const FEED_LABEL = { main: "Main", casual: "Casual", club: "Club" };

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const team = (id) => S.meta.teams.find((t) => t.id === id);
const clock = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };

// One console per browser tab, kept across reloads of that tab.
const SID = (() => {
  const make = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36));
  try {
    const old = sessionStorage.getItem("pc_sid");
    if (old) return old;
    const id = make();
    sessionStorage.setItem("pc_sid", id);
    return id;
  } catch (_) { return make(); }
})();
const withSid = (path) => `${path}${path.includes("?") ? "&" : "?"}sid=${SID}`;

async function api(path, body) {
  const res = await fetch(withSid(path), body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("request failed"), { data, status: res.status });
  return data;
}

function toast(text, warn = false) {
  const el = document.createElement("div");
  el.className = "toast" + (warn ? " warn" : "");
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// --- header -----------------------------------------------------------------------

function renderScorebug() {
  if (!S.meta || !S.stats) return;
  const h = team(S.meta.home), a = team(S.meta.away), sc = S.stats.score;
  const clk = S.stats.finished ? "FT" : S.started || S.stats.t > 0 ? clock(S.stats.t) : "KO";
  $("scorebug").innerHTML = `
    <span class="sw" style="background:${h.color}"></span><span class="t">${esc(h.short)}</span>
    <span class="sc">${sc[h.id]}–${sc[a.id]}</span>
    <span class="t">${esc(a.short)}</span><span class="sw" style="background:${a.color}"></span>
    <span class="clk">${clk}</span>`;
  $("screen-bug").textContent = `${h.id} ${sc[h.id]}-${sc[a.id]} ${a.id}  ${clk}`;
  $("timeline-fill").style.width = `${Math.min(100, (S.stats.t / (94 * 60)) * 100)}%`;
}

function renderStatus() {
  const st = S.status;
  if (!st) return;
  document.querySelectorAll("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === st.speed)));
  $("faults").checked = st.inject_faults;
  $("club").value = st.club;
  const live = st.mode.startsWith("live");
  $("model-badge").textContent = live
    ? `AI model: ${st.mode.replace(/^live \(|\)$/g, "")}. Every reply is still fact-checked.`
    : "AI model not connected: agents use cached replies and verified templates, so the desk keeps working.";
  const label = st.finished ? "Full time" : st.running ? "Pause" : (S.started ? "Resume" : "Start match");
  $("play-label").textContent = label;
  $("play-ico").setAttribute("d", st.running ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z");
  $("btn-play").disabled = st.finished;
  document.querySelector(".tally-dot").classList.toggle("live", st.running);
}

// --- pitch + stats --------------------------------------------------------------

function pitchLines() {
  return `<g fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".45">
    <rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/>
    <circle cx="52.5" cy="34" r="9.15"/><rect x="0" y="13.84" width="16.5" height="40.32"/>
    <rect x="88.5" y="13.84" width="16.5" height="40.32"/><rect x="0" y="24.84" width="5.5" height="18.32"/>
    <rect x="99.5" y="24.84" width="5.5" height="18.32"/></g>`;
}

function renderPitch() {
  const pts = S.events.filter((e) => e.x !== undefined).slice(-10);
  let marks = "";
  pts.forEach((e, i) => {
    const c = team(e.team)?.color || "#fff", o = 0.3 + 0.7 * (i / Math.max(1, pts.length - 1));
    if (e.type === "pass" || e.type === "carry") {
      marks += `<line x1="${e.x}" y1="${e.y}" x2="${e.end_x}" y2="${e.end_y}" stroke="${c}" stroke-width=".7" opacity="${o}" stroke-linecap="round" ${e.outcome === "incomplete" ? 'stroke-dasharray="1.5 1"' : ""}/>`;
    }
    marks += `<circle cx="${e.x}" cy="${e.y}" r="${e.type === "shot" ? 1.7 : 1}" fill="${c}" stroke="#0b1020" stroke-width=".3" opacity="${o}"/>`;
  });
  const last = pts[pts.length - 1];
  if (last) {
    const ok = last.end_x !== undefined && last.outcome !== "incomplete";
    marks += `<circle cx="${ok ? last.end_x : last.x}" cy="${ok ? last.end_y : last.y}" r="1.4" fill="#fff" stroke="#0b1020" stroke-width=".4"/>`;
  }
  $("pitch").innerHTML = pitchLines() + marks;
}

function renderStats() {
  if (!S.stats) return;
  const h = team(S.meta.home), a = team(S.meta.away), m = S.stats.momentum;
  $("momentum").innerHTML = `
    <div class="bar"><div class="fill" style="${m >= 0 ? `right:50%;width:${m / 2}%;background:${h.color}` : `left:50%;width:${-m / 2}%;background:${a.color}`}"></div></div>
    <div class="labels"><span>${esc(h.short)}</span><span>${m === 0 ? "Even" : `${esc((m > 0 ? h : a).short)} on top`} · momentum ${Math.abs(m)}</span><span>${esc(a.short)}</span></div>`;
  const th = S.stats.totals[h.id], ta = S.stats.totals[a.id];
  const rows = [["Possession %", "possession_pct"], ["Shots", "shots"], ["On target", "shots_on_target"], ["xG (simulated)", "xg"],
    ["Passes", "passes"], ["Pass accuracy %", "pass_accuracy_pct"], ["Tackles", "tackles"]];
  $("statbars").innerHTML = rows.map(([name, k]) => {
    const x = th[k], y = ta[k], tot = (x + y) || 1;
    return `<div class="row"><span class="v">${x}</span><div class="mid"><div class="name">${name}</div>
      <div class="split"><div style="width:${100 * x / tot}%;background:${h.color}"></div><div style="width:${100 * y / tot}%;background:${a.color}"></div></div></div>
      <span class="v r">${y}</span></div>`;
  }).join("");
}

function tickerLine(e) {
  const who = e.player ? esc(e.player) : "";
  const tm = e.team ? esc(team(e.team).short) : "";
  switch (e.type) {
    case "goal": return ["goal", `Goal ${tm} — ${who}`];
    case "shot": return ["", `Shot (${e.outcome.replace("_", " ")}) by ${who}, xG ${e.xg}`];
    case "tackle": return ["", `Tackle won by ${who} (${tm})`];
    case "foul": return ["", `Foul by ${who} (${tm})`];
    case "kickoff": return ["", `Kick-off ${tm}`];
    case "half_start": return ["goal", `Period ${e.period} starts`];
    case "half_end": return ["goal", "Half-time"];
    case "full_time": return ["goal", "Full-time"];
    case "possession_change": return e.reason === "interception" ? ["", `Interception by ${who} (${tm})`] : null;
    case "pass": return e.difficulty >= 75 && e.outcome === "complete" ? ["", `Difficult pass by ${who} (${e.difficulty}/100)`] : null;
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
  while ($("ticker").children.length > 120) $("ticker").lastChild.remove();
}

// --- graphics ---------------------------------------------------------------------

function gfxHTML(tpl, slots, data) {
  const s = Object.fromEntries(Object.entries(slots || {}).map(([k, v]) => [k, esc(v)]));
  const color = data?.team ? team(data.team)?.color : "#4a5675";
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
      return `<div class="gfx"><div class="bd">${esc(Object.values(slots || {}).join(" · "))}</div></div>`;
  }
}

function showOnAir(ov) {
  $("screen-gfx").innerHTML = gfxHTML(ov.template, ov.slots, ov.data);
  $("onair").hidden = false;
  clearTimeout(S.screenTimer);
  S.screenTimer = setTimeout(() => { $("screen-gfx").innerHTML = ""; $("onair").hidden = true; }, ov.duration_s * 1000);
}

function renderFeedTabs() {
  $("feed-tabs").innerHTML = Object.keys(S.feeds).map((f) =>
    `<button type="button" role="tab" aria-selected="${f === S.feed}" data-feed="${f}">${FEED_LABEL[f] || f}</button>`).join("");
  $("feed-desc").textContent = S.feeds[S.feed] || "";
}

// --- agent pipeline ---------------------------------------------------------------

function renderPipeline() {
  $("pipeline").innerHTML = AGENTS.map((a) => {
    const st = S.agentState[a.id];
    const cls = st ? st.cls : "";
    const label = st ? st.label : "Idle";
    return `<li class="${cls}"><span class="kind">${a.kind}</span><span class="name">${a.id}</span>
      <span class="role">${a.role}</span><span class="state">${esc(label)}</span></li>`;
  }).join("");
}

function setAgent(id, cls, label) {
  S.agentState[id] = { cls, label };
  renderPipeline();
}

function onTrace(t) {
  const failed = t.ok === false;
  for (const a of AGENTS) if (S.agentState[a.id]?.cls === "active") S.agentState[a.id] = { cls: "", label: "Done" };
  setAgent(t.agent, failed ? "fail" : t.ok === true ? "pass" : "active",
    failed ? "Rejected a draft" : t.ok === true ? "Passed" : "Working");
  const sug = S.suggestions.get(t.id);
  $("agents-status").textContent = sug ? `On ${sug.candidate.minute}' ${sug.candidate.title}` : "";
}

// --- decision queue ---------------------------------------------------------------

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="currentColor"/></svg>';

function verifyHTML(sug) {
  const fails = (sug.trace || []).filter((t) => t.agent === "FactChecker" && t.ok === false).length;
  if (!sug.trace?.some((t) => t.agent === "FactChecker")) return "";
  return fails
    ? `<div class="verify repaired">${CHECK}Fact Checker rejected ${fails} draft${fails > 1 ? "s" : ""}; the repaired version passed every check.</div>`
    : `<div class="verify">${CHECK}Every number checked against the match data.</div>`;
}

function traceHTML(trace) {
  return `<ol class="trace">${trace.map((t) => {
    const mark = t.ok === true ? '<span class="ok">Pass</span> ' : t.ok === false ? '<span class="no">Fail</span> ' : "";
    const src = t.source ? ` <span class="src">(${esc(t.source)})</span>` : "";
    return `<li><span class="agent">${esc(t.agent)}</span><span>${mark}${esc(t.detail)}${src}</span></li>`;
  }).join("")}</ol>`;
}

function topPendingId() {
  const p = [...S.suggestions.values()].filter((s) => s.status === "pending")
    .sort((x, y) => y.candidate.priority - x.candidate.priority || y.candidate.t - x.candidate.t);
  return p[0]?.id;
}

function fullCard(sug, isTop) {
  const c = sug.candidate;
  let html = `<div class="card-head"><span class="min">${c.minute}'</span><span class="title">${esc(c.title)}</span>
    <span class="chip">${esc(c.kind.replace(/_/g, " "))}</span></div>`;
  if (sug.analysis) html += `<p class="why"><b>Why now:</b> ${esc(sug.analysis.why_now)}</p>`;
  if (sug.graphic) html += gfxHTML(sug.graphic.template, sug.graphic.slots, { team: c.team, momentum: (c.facts.momentum_now || 0) * (c.team === S.meta.home ? 1 : -1) });
  html += verifyHTML(sug);
  if (S.editing.has(sug.id)) {
    const limits = S.templates[sug.graphic.template].slots;
    html += `<form class="edit-form" data-id="${sug.id}">${Object.entries(limits).map(([k, lim]) =>
      `<label>${esc(k.replace(/_/g, " "))} <span class="muted">(max ${lim} characters)</span><input type="text" name="${k}" maxlength="${lim + 20}" value="${esc(sug.graphic.slots[k] || "")}"></label>`).join("")}
      <div class="edit-issues" aria-live="polite"></div>
      <div class="actions"><button class="btn approve" type="submit">Check and put on air</button>
      <button class="btn ghost" type="button" data-act="cancel" data-id="${sug.id}">Cancel</button></div></form>`;
  } else {
    html += `<div class="actions"><button class="btn approve" type="button" data-act="approve" data-id="${sug.id}">Put on air${isTop ? " <kbd>A</kbd>" : ""}</button>
      <button class="btn" type="button" data-act="edit" data-id="${sug.id}">Edit</button>
      <button class="btn danger" type="button" data-act="reject" data-id="${sug.id}">Reject${isTop ? " <kbd>R</kbd>" : ""}</button></div>`;
  }
  if (sug.trace?.length) html += `<details><summary>How the agents got here (${sug.trace.length} steps${sug.attempts > 1 ? `, ${sug.attempts} drafts` : ""})</summary>${traceHTML(sug.trace)}</details>`;
  html += `<div class="sources">Source events ${c.source_event_ids.slice(0, 6).map((i) => `<code>${esc(i)}</code>`).join("")}${c.source_event_ids.length > 6 ? ` +${c.source_event_ids.length - 6}` : ""}</div>`;
  return html;
}

function compactCard(sug) {
  const c = sug.candidate;
  return `<div class="card-head"><span class="min">${c.minute}'</span><span class="title">${esc(c.title)}</span>
    <span class="chip status-pending">Waiting</span></div>`;
}

function workingCard(sug) {
  const c = sug.candidate;
  const last = sug.trace?.[sug.trace.length - 1];
  const label = sug.status === "adapting" ? "FeedAdapter writing 3 feeds" : sug.status === "queued" ? "Queued for the agents" : `${last?.agent || "Agents"} working`;
  return `<div class="card-head"><span class="spinner" aria-hidden="true"></span><span class="min">${c.minute}'</span>
    <span class="title">${esc(c.title)}</span><span class="chip status-${sug.status}">${esc(label)}</span></div>`;
}

function renderQueue(force = false) {
  const all = [...S.suggestions.values()];
  const pending = all.filter((s) => s.status === "pending")
    .sort((x, y) => y.candidate.priority - x.candidate.priority || y.candidate.t - x.candidate.t);
  const working = all.filter((s) => ["queued", "drafting", "adapting"].includes(s.status)).sort((x, y) => y.candidate.t - x.candidate.t);
  const done = all.filter((s) => ["approved", "rejected", "dropped"].includes(s.status)).sort((x, y) => y.candidate.t - x.candidate.t);
  const top = pending[0]?.id;

  const typing = S.editing.size && document.querySelector(".edit-form") && !force;
  if (typing || (S.hoverLock && !force)) {
    // Never move cards under the producer's pointer or while they type: rebuild on mouse-leave.
    S.dirty = true;
  } else {
    S.dirty = false;
    const parts = pending.map((s) => {
      const open = s.id === top || S.expanded.has(s.id) || S.editing.has(s.id);
      return `<article class="card pending${s.id === top ? " top" : ""}${open ? "" : " compact"}" data-id="${s.id}" ${open ? "" : `data-expand="${s.id}" tabindex="0" role="button" aria-label="Open ${esc(s.candidate.title)}"`}>
        ${open ? fullCard(s, s.id === top) : compactCard(s)}</article>`;
    });
    parts.push(...working.slice(0, 4).map((s) => `<article class="card ${s.status}" data-id="${s.id}">${workingCard(s)}</article>`));
    $("queue").innerHTML = parts.join("");
  }
  const n = pending.length;
  $("pending-count").textContent = n;
  $("pending-count").classList.toggle("hot", n > 0);
  $("welcome").hidden = S.started || all.length > 0;

  $("history-count").textContent = done.length;
  $("history").innerHTML = done.map((s) => {
    const label = s.status === "approved" ? "Aired" : s.status === "rejected" ? "Rejected" : "Skipped";
    const detail = s.status === "dropped" ? `MomentScout: ${s.dropped_reason || ""}` : (s.feeds ? `${Object.keys(s.feeds).length} feeds` : (s.reject_reason || ""));
    return `<div class="history-row"><span class="muted">${s.candidate.minute}'</span><span>${esc(s.candidate.title)} <span class="muted small">${esc(detail)}</span></span>
      <span class="chip status-${s.status}">${label}</span></div>`;
  }).join("");
}

function upsert(sug) {
  const prev = S.suggestions.get(sug.id);
  S.suggestions.set(sug.id, sug);
  if (prev && prev.status !== "approved" && sug.status === "approved") {
    toast(`On air: “${sug.candidate.title}” in ${Object.keys(sug.feeds || {}).length || 3} feeds`);
    setAgent("FeedAdapter", "pass", "Wrote 3 feeds");
  }
  if (sug.status === "adapting") setAgent("FeedAdapter", "active", "Working");
  renderQueue();
}

// --- right column extras ------------------------------------------------------------

function addAudit(entry) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="who ${esc(entry.actor)}">${esc(entry.actor === "producer" ? "You" : "Agents")}</span> ${esc(entry.action.replace(/_/g, " "))}
    ${entry.suggestion_id ? `<code>${esc(entry.suggestion_id)}</code>` : ""} <span class="muted">· ${entry.match_minute}' · ${esc(entry.at.slice(11, 19))} UTC</span>
    <div class="muted">${esc(entry.details)}</div>`;
  $("audit").prepend(li);
}

function renderPackage(pkg) {
  const items = (pkg.rundown || []).map((r) => {
    const sug = S.suggestions.get(r.id);
    return `<li><b>${sug ? `${sug.candidate.minute}' ${esc(sug.candidate.title)}` : esc(r.id)}</b> — ${esc(r.why)}</li>`;
  }).join("");
  $("package").innerHTML = `<div class="headline">${esc(pkg.headline)}</div>
    <div class="muted small">${esc(pkg.phase.replace(/_/g, " "))} · written by ${esc(pkg.source)}</div>
    <ol>${items || "<li class='muted'>No approved graphics yet.</li>"}</ol>
    <div class="script">${esc(pkg.script)}</div>`;
}

// --- boot ---------------------------------------------------------------------------

function loadFull(state) {
  Object.assign(S, { meta: state.meta, stats: state.stats, status: state.status, templates: state.templates,
    feeds: state.feeds, overlays: state.overlays, events: state.recent_events });
  S.started = state.status.running || state.status.progress > 0;
  S.suggestions = new Map(state.suggestions.map((s) => [s.id, s]));
  S.editing.clear(); S.expanded.clear(); S.agentState = {};
  $("ticker").innerHTML = ""; $("audit").innerHTML = ""; $("screen-gfx").innerHTML = ""; $("onair").hidden = true;
  $("club").innerHTML = state.meta.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  state.audit.forEach(addAudit);
  state.recent_events.forEach(addTicker);
  if (state.packages.length) renderPackage(state.packages[state.packages.length - 1]);
  renderFeedTabs(); renderScorebug(); renderStats(); renderPitch(); renderStatus(); renderPipeline(); renderQueue();
}

function connect() {
  const es = new EventSource(withSid("/api/stream"));
  const on = (name, fn) => es.addEventListener(name, (m) => fn(JSON.parse(m.data)));
  on("match_event", (e) => {
    S.events.push(e); if (S.events.length > 60) S.events.shift();
    addTicker(e); renderPitch();
    if (e.type === "goal") toast(`Goal! ${team(e.team).short} — ${e.player}`);
  });
  on("stats", (st) => { S.stats = st; renderScorebug(); renderStats(); });
  on("suggestion", upsert);
  on("trace", (t) => { const s = S.suggestions.get(t.id); if (s) { s.trace = [...(s.trace || []), t]; } onTrace(t); renderQueue(); });
  on("overlays", (ovs) => { S.overlays.push(...ovs); const mine = ovs.find((o) => o.feed === S.feed); if (mine) showOnAir(mine); });
  on("audit", addAudit);
  on("package", (p) => { renderPackage(p); toast(`Studio rundown ready (${p.phase.replace(/_/g, " ")})`); });
  on("status", (st) => { S.status = st; renderStatus(); });
  on("reset", loadFull);
  es.onerror = () => { es.close(); setTimeout(async () => { loadFull(await api("/api/state")); connect(); }, 1500); };
}

async function startOrPause() {
  if (S.status?.running) return api("/api/control", { action: "pause" });
  S.started = true;
  renderQueue();
  return api("/api/control", { action: "start" });
}

document.addEventListener("click", async (ev) => {
  const expand = ev.target.closest("[data-expand]");
  if (expand && !ev.target.closest("button")) { S.expanded.add(expand.dataset.expand); return renderQueue(true); }
  const b = ev.target.closest("button");
  if (!b) {
    if (!ev.target.closest(".popover") && !ev.target.closest("#btn-settings")) closeSettings();
    return;
  }
  if (b.id === "btn-play" || b.hasAttribute("data-start")) return startOrPause();
  if (b.id === "btn-reset") { closeSettings(); return api("/api/control", { action: "reset" }); }
  if (b.id === "btn-package") return api("/api/package", { phase: "on_demand" });
  if (b.id === "btn-settings") {
    const open = $("settings").hidden;
    $("settings").hidden = !open; b.setAttribute("aria-expanded", String(open));
    return;
  }
  if (b.dataset.speed) return api("/api/control", { speed: Number(b.dataset.speed) });
  if (b.dataset.tab) {
    document.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === b)));
    document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    return;
  }
  if (b.dataset.feed) {
    S.feed = b.dataset.feed; renderFeedTabs();
    const last = [...S.overlays].reverse().find((o) => o.feed === S.feed);
    if (last) showOnAir(last);
    return;
  }
  const id = b.dataset.id, act = b.dataset.act;
  if (!act) return;
  if (act === "approve" || act === "reject") {
    b.disabled = true;
    const card = b.closest(".card");
    if (card) card.style.opacity = ".5";
    S.hoverLock = false;
    if (act === "approve") await api(`/api/suggestions/${id}/approve`, {}).catch(() => toast("Could not put it on air — it may already be decided.", true));
    else await api(`/api/suggestions/${id}/reject`, { reason: "producer rejected" }).catch(() => {});
    renderQueue(true);
    return;
  }
  if (act === "edit") { S.editing.add(id); S.expanded.add(id); renderQueue(true); document.querySelector(`.edit-form[data-id="${id}"] input`)?.focus(); }
  if (act === "cancel") { S.editing.delete(id); renderQueue(true); }
});

function closeSettings() { $("settings").hidden = true; $("btn-settings").setAttribute("aria-expanded", "false"); }

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target, id = form.dataset.id;
  const slots = Object.fromEntries(new FormData(form).entries());
  try {
    await api(`/api/suggestions/${id}/approve`, { slots });
    S.editing.delete(id);
    renderQueue(true);
  } catch (err) {
    const issues = err.data?.detail?.issues || ["Approval failed."];
    form.querySelector(".edit-issues").innerHTML = "<b>The Fact Checker blocked this edit:</b><br>" + issues.map(esc).join("<br>");
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeSettings();
  if (["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName)) return;
  if (ev.key === "Enter" && ev.target.dataset?.expand) { S.expanded.add(ev.target.dataset.expand); return renderQueue(true); }
  const top = topPendingId();
  if (!top) return;
  if (ev.key === "a") api(`/api/suggestions/${top}/approve`, {}).catch(() => {});
  if (ev.key === "r") api(`/api/suggestions/${top}/reject`, { reason: "producer rejected (hotkey)" }).catch(() => {});
});

$("queue").addEventListener("mouseenter", () => { S.hoverLock = true; });
$("queue").addEventListener("mouseleave", () => { S.hoverLock = false; if (S.dirty) renderQueue(); });

$("faults").addEventListener("change", (e) => {
  api("/api/control", { inject_faults: e.target.checked });
  toast(e.target.checked ? "Fault test on: first drafts will contain a wrong number." : "Fault test off.", e.target.checked);
});
$("club").addEventListener("change", (e) => api("/api/control", { club: e.target.value }));

api("/api/state").then((st) => { loadFull(st); connect(); }).catch(() => toast("Could not reach the server. Refresh to try again.", true));
