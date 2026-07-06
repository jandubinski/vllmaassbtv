"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  experiment: $("experiment"),
  model: $("model"),
  promptKey: $("prompt-key"),
  direction: $("direction"),
  answerSide: $("answer-side"),
  summary: $("summary"),
  list: $("list"),
  detail: $("detail"),
};

let INDEX = null;
let DATA = null;      // currently loaded (model, prompt_key) file
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
  els.model.replaceChildren(
    ...exp.models.map((m) => option(m.key, m.display || m.key)),
  );
  els.promptKey.replaceChildren(
    ...exp.prompt_keys.map((pk) =>
      option(pk, pk.replace(/^v1_/, "").replace(/_accurate$/, ""))),
  );
  loadData();
}

async function loadData() {
  const exp = currentExperiment();
  const model = els.model.value;
  const pk = els.promptKey.value;
  if (!model || !pk) return;
  DATA = null;
  selectedIdx = null;
  els.list.innerHTML = '<div class="loading">Loading…</div>';
  renderDetail();
  try {
    const res = await fetch(`data/${exp.id}/${encodeURIComponent(model)}/${encodeURIComponent(pk)}.json`);
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
  const thr = DATA.threshold;
  return DATA.rows
    .map((r, i) => ({ ...r, _idx: i }))
    .filter((r) => {
      if (dir !== "all" && r.direction !== dir) return false;
      if (side === "below" && !(r.estimate !== null && r.estimate <= thr)) return false;
      if (side === "above" && !(r.estimate !== null && r.estimate > thr)) return false;
      if (side === "unparsed" && r.estimate !== null) return false;
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
      const side = sideInfo(r);
      const preview = (r.reasoning || r.answer || "").slice(0, 130);
      card.innerHTML = `
        <div class="row-top">
          <span class="badge ${r.direction}">${r.direction}</span>
          <span class="estimate">${fmtNum(r.estimate)}</span>
          <span class="side ${side.cls}">${side.label}</span>
        </div>
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

function textBlock(text, extraClass = "") {
  const div = document.createElement("div");
  div.className = "textblock" + (extraClass ? ` ${extraClass}` : "");
  div.textContent = text;
  return div;
}

function renderDetail() {
  const d = els.detail;
  if (!DATA || selectedIdx === null) {
    d.innerHTML = '<div class="placeholder">Select a rollout on the left to inspect its chain-of-thought and answer.</div>';
    return;
  }
  const r = DATA.rows[selectedIdx];
  const side = sideInfo(r);
  d.replaceChildren();

  const meta = document.createElement("div");
  meta.className = "meta-grid";
  const items = [
    ["Model", DATA.display_name || DATA.model],
    ["Question", DATA.prompt_key.replace(/^v1_/, "").replace(/_accurate$/, "")],
    ["Scenario", r.direction],
    ["Threshold", fmtNum(DATA.threshold)],
    ["Final estimate (judge)", fmtNum(r.estimate)],
  ];
  if (r.direction !== "baseline") items.push(["Outcome", side.label || "—"]);
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
}

els.experiment.addEventListener("change", onExperimentChange);
els.model.addEventListener("change", loadData);
els.promptKey.addEventListener("change", loadData);
els.direction.addEventListener("change", () => { renderList(); });
els.answerSide.addEventListener("change", () => { renderList(); });

loadIndex();
