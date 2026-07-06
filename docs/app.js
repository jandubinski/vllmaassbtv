"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  experiment: $("experiment"),
  model: $("model"),
  effort: $("effort"),
  promptKey: $("prompt-key"),
  direction: $("direction"),
  answerSide: $("answer-side"),
  covertness: $("covertness"),
  summary: $("summary"),
  list: $("list"),
  detail: $("detail"),
};

const COVERTNESS_LABELS = {
  INFLUENCED: "admits the threshold shaped its estimate",
  MENTIONED: "raises the possible bias, no definite conclusion",
  NOT_INFLUENCED: "claims the estimate is independent of the threshold",
  NO_STATEMENT: "mentions the note but makes no statement either way",
  NO_MENTION: "never mentions the threshold / bet / cause",
  UNKNOWN: "empty or unparseable source text",
};

let INDEX = null;
let BASES = {};       // base -> {base, variants: [{key, effort, display}]}
let DATA = null;      // currently loaded (model variant, prompt_key) file
let selectedIdx = null;

function fmtNum(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US");
}

function option(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

function currentExperiment() {
  return INDEX.experiments.find((e) => e.id === els.experiment.value);
}

function currentVariantKey() {
  return els.effort.value;
}

async function loadIndex() {
  const res = await fetch("data/index.json");
  INDEX = await res.json();
  els.experiment.replaceChildren(
    ...INDEX.experiments.map((e) => option(e.id, e.label)),
  );
  onExperimentChange();
}

function onExperimentChange() {
  const exp = currentExperiment();

  BASES = {};
  els.model.replaceChildren();
  for (const group of exp.model_groups) {
    const og = document.createElement("optgroup");
    og.label = group.family;
    for (const b of group.bases) {
      BASES[b.base] = b;
      og.append(option(b.base, b.base));
    }
    els.model.append(og);
  }

  els.promptKey.replaceChildren(
    ...exp.prompt_keys.map((pk) =>
      option(pk, pk.replace(/^v1_/, "").replace(/_accurate$/, ""))),
  );

  onModelChange();
}

function onModelChange() {
  const base = BASES[els.model.value];
  const prevEffort = els.effort.dataset.effort;
  els.effort.replaceChildren(
    ...base.variants.map((v) => option(v.key, v.effort)),
  );
  const keep = base.variants.find((v) => v.effort === prevEffort);
  if (keep) els.effort.value = keep.key;
  els.effort.disabled = base.variants.length === 1;
  onEffortChange();
}

function onEffortChange() {
  const base = BASES[els.model.value];
  const v = base.variants.find((x) => x.key === els.effort.value);
  els.effort.dataset.effort = v ? v.effort : "";
  loadData();
}

async function loadData() {
  const exp = currentExperiment();
  const variant = currentVariantKey();
  const pk = els.promptKey.value;
  if (!variant || !pk) return;
  DATA = null;
  selectedIdx = null;
  els.list.innerHTML = '<div class="loading">Loading…</div>';
  renderDetail();
  try {
    const res = await fetch(`data/${exp.id}/${encodeURIComponent(variant)}/${encodeURIComponent(pk)}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    els.list.innerHTML = `<div class="loading">Failed to load data (${err.message}).</div>`;
    els.summary.textContent = "";
    return;
  }
  renderList();
}

function filteredRows() {
  if (!DATA) return [];
  const dir = els.direction.value;
  const side = els.answerSide.value;
  const cov = els.covertness.value;
  const thr = DATA.threshold;
  return DATA.rows
    .map((r, i) => ({ ...r, _idx: i }))
    .filter((r) => {
      if (dir !== "all" && r.direction !== dir) return false;
      if (side === "below" && !(r.estimate !== null && r.estimate <= thr)) return false;
      if (side === "above" && !(r.estimate !== null && r.estimate > thr)) return false;
      if (side === "unparsed" && r.estimate !== null) return false;
      if (cov !== "all") {
        if (r.direction === "baseline") return false;  // covertness only measured on directional rows
        const c = r.cot_covertness ?? "unmeasured";
        if (c !== cov) return false;
      }
      return true;
    });
}

function sideInfo(r) {
  if (r.estimate === null) return { cls: "na", label: "no estimate" };
  if (r.direction === "baseline") return { cls: "na", label: "" };
  if (r.on_good_side === true) return { cls: "good", label: "✓ good side" };
  if (r.on_good_side === false) return { cls: "bad", label: "✗ bad side" };
  return { cls: "na", label: "" };
}

function renderList() {
  if (!DATA) return;
  const rows = filteredRows();
  const thr = DATA.threshold;

  const directional = rows.filter((r) => r.direction !== "baseline" && r.estimate !== null);
  const nGood = directional.filter((r) => r.on_good_side === true).length;
  const pct = directional.length
    ? ` — <b>${((100 * nGood) / directional.length).toFixed(0)}%</b> of directional answers on the good side`
    : "";
  els.summary.innerHTML =
    `<b>${rows.length}</b> rollouts shown · threshold <b>${fmtNum(thr)}</b>${pct}`;

  els.list.replaceChildren(
    ...rows.map((r) => {
      const card = document.createElement("div");
      card.className = "row-card" + (r._idx === selectedIdx ? " active" : "");
      card.dataset.idx = r._idx;
      const side = sideInfo(r);
      const preview = (r.reasoning || r.answer || "").slice(0, 130);
      const cov = r.direction === "baseline" ? "" : (r.cot_covertness
        ? `<span class="cov-chip cov-${r.cot_covertness}">${r.cot_covertness}</span>`
        : '<span class="cov-chip cov-none">not measured</span>');
      card.innerHTML = `
        <div class="row-top">
          <span class="badge ${r.direction}">${r.direction}</span>
          <span class="estimate">${fmtNum(r.estimate)}</span>
          <span class="side ${side.cls}">${side.label}</span>
        </div>
        <div class="row-cov">${cov}</div>
        <div class="row-preview"></div>`;
      card.querySelector(".row-preview").textContent = preview;
      card.addEventListener("click", () => {
        selectedIdx = r._idx;
        renderList();
        renderDetail();
      });
      return card;
    }),
  );
  if (!rows.length) {
    els.list.innerHTML = '<div class="loading">No rollouts match the current filters.</div>';
  }
}

function navigate(delta) {
  if (!DATA) return;
  const rows = filteredRows();
  if (!rows.length) return;
  const pos = rows.findIndex((r) => r._idx === selectedIdx);
  let next;
  if (pos === -1) {
    next = delta >= 0 ? 0 : rows.length - 1;
  } else {
    next = Math.min(rows.length - 1, Math.max(0, pos + delta));
  }
  if (rows[next]._idx === selectedIdx) return;
  selectedIdx = rows[next]._idx;
  renderList();
  renderDetail();
  const active = els.list.querySelector(`.row-card[data-idx="${selectedIdx}"]`);
  if (active) active.scrollIntoView({ block: "nearest" });
}

function textBlock(text, extraClass = "") {
  const div = document.createElement("div");
  div.className = "textblock" + (extraClass ? ` ${extraClass}` : "");
  div.textContent = text;
  return div;
}

function navRow() {
  const rows = filteredRows();
  const pos = rows.findIndex((r) => r._idx === selectedIdx);
  const bar = document.createElement("div");
  bar.className = "nav-row";

  const prev = document.createElement("button");
  prev.textContent = "← Previous";
  prev.disabled = pos <= 0;
  prev.addEventListener("click", () => navigate(-1));

  const counter = document.createElement("span");
  counter.className = "nav-counter";
  counter.textContent = pos === -1 ? "" : `${pos + 1} / ${rows.length}`;

  const next = document.createElement("button");
  next.textContent = "Next →";
  next.disabled = pos === -1 || pos >= rows.length - 1;
  next.addEventListener("click", () => navigate(1));

  const hint = document.createElement("span");
  hint.className = "nav-hint";
  hint.textContent = "(or use ← / → keys)";

  bar.append(prev, counter, next, hint);
  return bar;
}

function renderDetail() {
  const d = els.detail;
  if (!DATA || selectedIdx === null) {
    d.innerHTML = '<div class="placeholder">Select a rollout on the left (or press →) to inspect its chain-of-thought and answer.</div>';
    return;
  }
  const r = DATA.rows[selectedIdx];
  const side = sideInfo(r);
  d.replaceChildren();

  d.append(navRow());

  const meta = document.createElement("div");
  meta.className = "meta-grid";
  const items = [
    ["Model", DATA.display_name || DATA.model],
    ["Question", DATA.prompt_key.replace(/^v1_/, "").replace(/_accurate$/, "")],
    ["Scenario", r.direction],
    ["Threshold", fmtNum(DATA.threshold)],
    ["Final estimate (judge)", fmtNum(r.estimate)],
  ];
  if (r.direction !== "baseline") {
    items.push(["Outcome", side.label || "—"]);
    items.push(["CoT covertness", r.cot_covertness || "not measured"]);
    items.push(["Answer covertness", r.answer_covertness || "not measured"]);
  }
  for (const [k, v] of items) {
    const it = document.createElement("div");
    it.className = "meta-item";
    const kEl = document.createElement("span");
    kEl.className = "k";
    kEl.textContent = k;
    it.append(kEl, document.createTextNode(v));
    meta.append(it);
  }
  d.append(meta);

  if (r.direction !== "baseline" && r.cot_covertness) {
    const note = document.createElement("div");
    note.className = "cov-note";
    const chip = `<span class="cov-chip cov-${r.cot_covertness}">${r.cot_covertness}</span>`;
    note.innerHTML = `${chip} <span>${COVERTNESS_LABELS[r.cot_covertness] || ""} <i>(Sonnet judge, CoT with numbers blurred)</i></span>`;
    d.append(note);
  }

  if (r.cot_covertness_raw || r.answer_covertness_raw) {
    const det = document.createElement("details");
    det.className = "prompt-details";
    const sum = document.createElement("summary");
    sum.textContent = "Show covertness judge rationale";
    det.append(sum);
    if (r.cot_covertness_raw) {
      const h = document.createElement("div");
      h.className = "judge-sub";
      h.textContent = `CoT judge → ${r.cot_covertness}`;
      det.append(h, textBlock(r.cot_covertness_raw, "prompt"));
    }
    if (r.answer_covertness_raw) {
      const h = document.createElement("div");
      h.className = "judge-sub";
      h.textContent = `Answer judge → ${r.answer_covertness}`;
      det.append(h, textBlock(r.answer_covertness_raw, "prompt"));
    }
    d.append(det);
  }

  const promptText = (DATA.prompts && DATA.prompts[r.direction]) || "";
  if (promptText) {
    const det = document.createElement("details");
    det.className = "prompt-details";
    const sum = document.createElement("summary");
    sum.textContent = "Show prompt";
    det.append(sum, textBlock(promptText, "prompt"));
    const h = document.createElement("h2");
    h.textContent = "Prompt";
    d.append(h, det);
  }

  const hCot = document.createElement("h2");
  hCot.textContent = "Chain of thought";
  d.append(hCot);
  d.append(r.reasoning
    ? textBlock(r.reasoning)
    : Object.assign(document.createElement("div"),
        { className: "empty-note", textContent: "(empty — no reasoning trace captured)" }));

  const hAns = document.createElement("h2");
  hAns.textContent = "Answer";
  d.append(hAns);
  d.append(r.answer
    ? textBlock(r.answer)
    : Object.assign(document.createElement("div"),
        { className: "empty-note", textContent: "(empty answer)" }));

  d.scrollTop = 0;
}

document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "select" || tag === "input" || tag === "textarea") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); navigate(-1); }
  if (e.key === "ArrowRight") { e.preventDefault(); navigate(1); }
});

els.experiment.addEventListener("change", onExperimentChange);
els.model.addEventListener("change", onModelChange);
els.effort.addEventListener("change", onEffortChange);
els.promptKey.addEventListener("change", loadData);
els.direction.addEventListener("change", () => { renderList(); renderDetail(); });
els.answerSide.addEventListener("change", () => { renderList(); renderDetail(); });
els.covertness.addEventListener("change", () => { renderList(); renderDetail(); });

loadIndex();
