/**
 * Offline manual exporter.
 *
 * `buildOfflineManualHtml(input)` is a pure function from plain data to one self-contained `.html`
 * string: inline CSS, inline JS, base64 PNG snapshots and no external URL of any kind. A
 * Content-Security-Policy meta tag (`default-src 'none'`) enforces that in the browser as well.
 *
 * Safety: every string that comes from a part, a file name, a tool, a note or any other user input
 * goes through `escapeHtml` before it enters the document. The step viewer script reads the step
 * markup from the DOM, so no user string is ever placed inside the script. Snapshot URLs must match
 * a strict `data:image/png;base64,` pattern, otherwise the figure shows a text placeholder.
 *
 * `buildManualInput(state, snapshots, generatedAt)` turns `AppState` into that plain data. Both
 * functions are pure: no React, no DOM and no three import.
 */
import { buildStepInstruction, selectStepModels } from "../authoring/stepText";
import { KIT_TITLES } from "../kits";
import type { SolveLabel } from "../protocol";
import { SERVICE_RING } from "../examples/serviceRing";
import { BADGE_INTERLOCKED_TEXT, GUIDE_NOT_VERIFIED_TEXT, legacyRayHitsText, selectClashBadge, selectDeadlockModel } from "../state/selectors";
import type { AppState } from "../state/types";

export interface ManualStepInput {
  /** One-based step number. */
  number: number;
  name: string;
  primitive: string | null;
  instruction: string;
  escapeDistanceText: string;
  tool: string;
  torque: string;
  warning: string;
  note: string;
  subassembly: string;
  markFlexible: boolean;
}

export type ProofTone = "ok" | "warn" | "bad" | "idle";

export interface ManualInput {
  /** Assembly title: the kit title or the uploaded file name. */
  title: string;
  /** Where the assembly came from, for example `Sample kit` or `Uploaded file`. */
  sourceLabel: string;
  /** Display text for the generation time. The caller supplies it, so the function stays pure. */
  generatedAt: string;
  partCount: number;
  planStatus: "solved" | "deadlocked";
  steps: ManualStepInput[];
  /** Display names of parts that no valid sequence reaches (deadlocked plans). */
  lockedParts: string[];
  /**
   * What the manual may say about the whole guide. `Full guide not verified` unless a full check
   * of every step has completed; Guide Forge has no such check yet, so the text is fixed.
   */
  guideVerification: { text: string; tone: ProofTone };
  /** Legacy ray hits over the plan, a diagnostic only. `null` when the plan has no ray report. */
  legacyRayHits: number | null;
  /** Naive Radial Explode comparison in the same words as the Clash_Badge, or `null` when absent. */
  naiveBadge: { text: string } | null;
  snapshots: { assembled: string | null; exploded: string | null };
}

// ---------------------------------------------------------------------------
// Escaping and small helpers
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes the five characters that matter in HTML text and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] as string);
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/** True for a base64 PNG data URL, the only image source the manual accepts. */
export function isPngDataUrl(value: string | null): value is string {
  return value !== null && PNG_DATA_URL.test(value);
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  helical_unscrew: "Unscrew",
  linear_slide: "Slide out",
  two_step_l_slide: "Slide & release",
};

function actionLabel(primitive: string | null): string {
  if (primitive !== null && Object.prototype.hasOwnProperty.call(ACTION_LABELS, primitive)) {
    return ACTION_LABELS[primitive] as string;
  }
  return "Remove";
}

/** File name for the download, safe on every platform. */
export function manualFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\.(glb|gltf)$/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
  return `${slug === "" ? "assembly" : slug}-manual.html`;
}

function labelTitle(label: SolveLabel | null): { title: string; source: string } {
  if (label === null) return { title: "Assembly", source: "Assembly" };
  if (label.kind === "example") return { title: SERVICE_RING.title, source: "Sample assembly" };
  if (label.kind === "file") return { title: label.fileName, source: "Uploaded file" };
  const titles: Readonly<Record<string, string>> = KIT_TITLES;
  return { title: titles[label.kitName] ?? label.kitName, source: "Sample kit" };
}

// ---------------------------------------------------------------------------
// AppState to ManualInput
// ---------------------------------------------------------------------------

/** `true` when a solved or deadlocked result is ready, the condition that enables the export. */
export function canExportManual(state: AppState): boolean {
  const { status, result } = state.solve;
  return status === "ready" && result !== null && result.plan.status !== "error";
}

export function buildManualInput(
  state: AppState,
  snapshots: ManualInput["snapshots"],
  generatedAt: string,
): ManualInput | null {
  const result = state.solve.result;
  if (!canExportManual(state) || result === null) return null;
  const plan = result.plan;
  if (plan.status === "error") return null;

  const { title, source } = labelTitle(state.solve.label);
  const steps = selectStepModels(state).map(
    (model, index): ManualStepInput => ({
      number: model.number,
      name: model.name,
      primitive: model.primitive,
      instruction: buildStepInstruction(model.primitive, model.name),
      escapeDistanceText: plan.steps[index]?.escapeDistance.toFixed(3) ?? "",
      tool: model.tool,
      torque: model.torque,
      warning: model.warning,
      note: model.note,
      subassembly: model.subassembly,
      markFlexible: model.markFlexible,
    }),
  );

  const naive = result.naive === null ? null : { text: selectClashBadge(result, "naive").text };

  const deadlock = selectDeadlockModel(result);
  const lockedParts =
    deadlock === null
      ? []
      : deadlock.lockedPartIds.map((partId) => deadlock.partNameById[partId] ?? `Part ${partId}`);

  return {
    title,
    sourceLabel: source,
    generatedAt,
    partCount: result.parts.length,
    planStatus: plan.status,
    steps,
    lockedParts,
    guideVerification: { text: GUIDE_NOT_VERIFIED_TEXT, tone: "warn" },
    legacyRayHits: result.oracle === null ? null : result.oracle.totalClashes,
    naiveBadge: naive,
    snapshots,
  };
}

// ---------------------------------------------------------------------------
// HTML sections
// ---------------------------------------------------------------------------

const e = escapeHtml;

function tagList(step: ManualStepInput): string {
  const tags: string[] = [];
  if (step.tool !== "") tags.push(`<li class="tag"><b>Tool</b> ${e(step.tool)}</li>`);
  if (step.torque !== "") tags.push(`<li class="tag"><b>Torque</b> ${e(step.torque)}</li>`);
  if (step.warning !== "") tags.push(`<li class="tag tag-warn"><b>Warning</b> ${e(step.warning)}</li>`);
  if (step.markFlexible) tags.push(`<li class="tag tag-warn"><b>Flexible part</b> handle gently</li>`);
  if (step.subassembly !== "") tags.push(`<li class="tag"><b>Subassembly</b> ${e(step.subassembly)}</li>`);
  return tags.length === 0 ? "" : `<ul class="tags">${tags.join("")}</ul>`;
}

function stepArticle(step: ManualStepInput): string {
  const n = step.number;
  return [
    `<article class="step" id="step-${n}" data-step="${n}">`,
    `<header class="step-head"><span class="step-num">${n}</span>`,
    `<h3>${e(step.name)}</h3><span class="action">${e(actionLabel(step.primitive))}</span></header>`,
    `<p class="instruction">${e(step.instruction)}</p>`,
    tagList(step),
    step.note !== "" ? `<p class="note">${e(step.note)}</p>` : "",
    `<label class="done"><input type="checkbox" class="done-box" data-step="${n}"> Step ${n} complete</label>`,
    `</article>`,
  ].join("");
}

function figure(label: string, src: string | null, caption: string): string {
  const body = isPngDataUrl(src)
    ? `<img src="${e(src)}" alt="${e(label)}">`
    : `<div class="no-image">Snapshot not available: the 3D viewport could not be captured.</div>`;
  return `<figure><figcaption class="fig-title">${e(label)}</figcaption>${body}<p class="fig-note">${e(caption)}</p></figure>`;
}

function toolsTable(steps: readonly ManualStepInput[]): string {
  const order: string[] = [];
  const stepsByTool = new Map<string, number[]>();
  for (const step of steps) {
    const tool = step.tool.trim() === "" ? "Unspecified" : step.tool;
    const list = stepsByTool.get(tool);
    if (list === undefined) {
      order.push(tool);
      stepsByTool.set(tool, [step.number]);
    } else {
      list.push(step.number);
    }
  }
  if (order.length === 0) return `<p class="empty">No steps, so no tools are needed.</p>`;
  const rows = order
    .map((tool) => {
      const used = stepsByTool.get(tool) ?? [];
      return `<tr><td>${e(tool)}</td><td class="num">${used.length}</td><td>${e(used.join(", "))}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th scope="col">Tool</th><th scope="col">Steps</th><th scope="col">Used in step</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function bomSummary(input: ManualInput): string {
  let unscrew = 0;
  let slide = 0;
  let other = 0;
  for (const step of input.steps) {
    if (step.primitive === "helical_unscrew") unscrew += 1;
    else if (step.primitive === "linear_slide" || step.primitive === "two_step_l_slide") slide += 1;
    else other += 1;
  }
  const items: [string, number][] = [
    ["Parts", input.partCount],
    ["Steps", input.steps.length],
    ["Unscrew", unscrew],
    ["Slide", slide],
    ["Other", other],
  ];
  return `<ul class="bom-summary">${items
    .map(([label, value]) => `<li><b>${value}</b> ${e(label)}</li>`)
    .join("")}</ul>`;
}

function bomTable(input: ManualInput): string {
  const rows = input.steps
    .map(
      (step) =>
        `<tr><td class="num">${step.number}</td><td>${e(step.name)}</td><td>${e(actionLabel(step.primitive))}</td>` +
        `<td>${e(step.tool === "" ? "Unspecified" : step.tool)}</td><td>${e(step.torque === "" ? "-" : step.torque)}</td>` +
        `<td>${e(step.subassembly === "" ? "-" : step.subassembly)}</td><td>${step.markFlexible ? "Yes" : "-"}</td></tr>`,
    )
    .join("");
  const locked = input.lockedParts
    .map(
      (name) =>
        `<tr class="locked"><td class="num">-</td><td>${e(name)}</td><td colspan="5">Interlocked: no valid removal sequence</td></tr>`,
    )
    .join("");
  return (
    `${bomSummary(input)}<table><thead><tr><th scope="col">Step</th><th scope="col">Part</th><th scope="col">Action</th>` +
    `<th scope="col">Tool</th><th scope="col">Torque</th><th scope="col">Subassembly</th><th scope="col">Flexible</th></tr></thead>` +
    `<tbody>${rows}${locked}</tbody></table>`
  );
}

function proofSection(input: ManualInput): string {
  const diagnostic =
    input.legacyRayHits === null
      ? ""
      : `<span class="badge-note">Legacy ray check (diagnostic only, not proof): ${e(legacyRayHitsText(input.legacyRayHits))}</span>`;
  const interlock = input.planStatus === "deadlocked" ? `<span class="badge-note">${e(BADGE_INTERLOCKED_TEXT)}</span>` : "";
  const proof = `<div class="badge badge-${input.guideVerification.tone}" role="status"><span class="badge-label">Guide verification</span><span class="badge-text">${e(input.guideVerification.text)}</span>${interlock}${diagnostic}</div>`;
  const naive =
    input.naiveBadge === null
      ? ""
      : `<div class="badge badge-bad"><span class="badge-label">Naive Radial Explode</span><span class="badge-text">${e(input.naiveBadge.text)}</span></div>`;
  return `<div class="proof" aria-label="Clash comparison">${proof}${naive}</div>`;
}

function lockedNotice(input: ManualInput): string {
  if (input.planStatus !== "deadlocked") return "";
  return `<p class="callout">This assembly is interlocked: no valid removal sequence exists. The steps below are the parts that could be peeled before the deadlock. ${e(
    String(input.lockedParts.length),
  )} part${input.lockedParts.length === 1 ? " is" : "s are"} locked in.</p>`;
}

// ---------------------------------------------------------------------------
// Style and script (constants, never built from user input)
// ---------------------------------------------------------------------------

const STYLE = `
:root{--canvas:#F6F8FB;--accent:#1E3A5F;--text:#0F172A;--muted:#475569;--panel:#FFFFFF;--rule:#C3CDDA;--ok:#14532D;--ok-bg:#F0FDF4;--warn:#92400E;--warn-bg:#FFFBEB;--bad:#9F1239;--bad-bg:#FFF1F2}
*{box-sizing:border-box}
html{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--text);background:var(--canvas)}
body{margin:0;background-color:var(--canvas);background-image:linear-gradient(rgba(30,58,95,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(30,58,95,.06) 1px,transparent 1px);background-size:16px 16px;line-height:1.5}
.page{max-width:960px;margin:0 auto;padding:24px 16px 48px}
.cover{background:var(--panel);border:1px solid var(--accent);border-top:4px solid var(--accent);padding:24px}
.kicker{margin:0;font:600 12px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{margin:4px 0 8px;font-size:28px;color:var(--accent)}
h2{margin:32px 0 12px;font-size:16px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);border-bottom:2px solid var(--accent);padding-bottom:4px}
h3{margin:0;font-size:18px;color:var(--text)}
.meta{margin:0;color:var(--muted)}
.proof{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}
.badge{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border:1px solid var(--accent);background:var(--panel)}
.badge-label{font:600 11px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.badge-text{font:700 15px ui-monospace,Menlo,Consolas,monospace}
.badge-note{font-size:12px;color:var(--muted)}
.badge-ok{color:var(--ok);background:var(--ok-bg);border-color:var(--ok)}
.badge-warn{color:var(--warn);background:var(--warn-bg);border-color:var(--warn)}
.badge-bad{color:var(--bad);background:var(--bad-bg);border-color:var(--bad)}
.badge-idle{color:var(--muted)}
.callout{margin:16px 0 0;padding:8px 12px;color:var(--warn);background:var(--warn-bg);border:1px solid var(--warn)}
.figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
figure{margin:0;background:var(--panel);border:1px solid var(--rule);padding:8px}
figure img{display:block;width:100%;height:auto;background:var(--canvas)}
.fig-title{font:600 12px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.fig-note{margin:6px 0 0;font-size:13px;color:var(--muted)}
.no-image,.empty{padding:24px;color:var(--muted);border:1px dashed var(--rule)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-size:14px}
th,td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--rule);vertical-align:top}
th{background:#EAF0F7;color:var(--accent);font-size:12px;letter-spacing:.05em;text-transform:uppercase}
td.num{font-variant-numeric:tabular-nums;text-align:right;width:3em}
tr.locked td{color:var(--warn);background:var(--warn-bg)}
.bom-summary{display:flex;flex-wrap:wrap;gap:8px 20px;margin:0 0 12px;padding:0;list-style:none;color:var(--muted)}
.bom-summary b{color:var(--accent);font-size:18px}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:12px}
button{font:inherit;font-weight:600;color:var(--accent);background:var(--panel);border:1px solid var(--accent);padding:6px 14px;cursor:pointer}
button:hover:not(:disabled){background:#EAF0F7}
button:disabled{color:var(--muted);border-style:dashed;cursor:not-allowed}
button:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.counter{font:600 14px ui-monospace,Menlo,Consolas,monospace}
.progress{margin-left:auto;font:14px ui-monospace,Menlo,Consolas,monospace;color:var(--muted)}
.stepnav{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 12px;padding:0;list-style:none}
.stepnav button{min-width:36px;padding:2px 8px}
.stepnav button[aria-current="step"]{color:#FFFFFF;background:var(--accent)}
.stepnav button.is-done{border-color:var(--ok);color:var(--ok)}
.step{background:var(--panel);border:1px solid var(--accent);padding:16px;margin-bottom:12px}
.js .step{display:none}
.js .step.active{display:block}
.step-head{display:flex;align-items:center;gap:12px}
.step-num{display:inline-flex;align-items:center;justify-content:center;min-width:36px;height:36px;font:700 16px ui-monospace,Menlo,Consolas,monospace;color:#FFFFFF;background:var(--accent)}
.action{margin-left:auto;font:600 12px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.instruction{margin:12px 0 8px;font-size:18px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;padding:0;list-style:none}
.tag{padding:2px 10px;font-size:13px;border:1px solid var(--accent);background:#EAF0F7}
.tag-warn{color:var(--warn);background:var(--warn-bg);border-color:var(--warn)}
.note{margin:8px 0;padding:8px 12px;border-left:4px solid var(--accent);background:var(--canvas);white-space:pre-wrap}
.done{display:inline-flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer}
.done-box{width:18px;height:18px}
.step.is-done{border-color:var(--ok)}
.hint{margin:12px 0 0;font-size:13px;color:var(--muted)}
footer{margin-top:32px;font-size:12px;color:var(--muted)}
@media print{
html,body{background:#FFFFFF}
body{background-image:none}
.page{max-width:none;padding:0}
.controls,.stepnav,.hint{display:none!important}
.step,.js .step{display:block!important;break-inside:avoid;page-break-inside:avoid}
figure,table,.cover{break-inside:avoid;page-break-inside:avoid}
h2{break-after:avoid;page-break-after:avoid}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

const SCRIPT = `
(function () {
  var doc = document;
  var steps = Array.prototype.slice.call(doc.querySelectorAll(".step"));
  if (steps.length === 0) { return; }
  doc.documentElement.className += " js";
  var prev = doc.getElementById("prev-step");
  var next = doc.getElementById("next-step");
  var counter = doc.getElementById("step-counter");
  var progress = doc.getElementById("progress");
  var navButtons = Array.prototype.slice.call(doc.querySelectorAll(".stepnav button"));
  var boxes = Array.prototype.slice.call(doc.querySelectorAll(".done-box"));
  var current = 0;
  function show(index) {
    current = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach(function (step, k) { step.classList.toggle("active", k === current); });
    navButtons.forEach(function (button, k) {
      if (k === current) { button.setAttribute("aria-current", "step"); } else { button.removeAttribute("aria-current"); }
    });
    counter.textContent = "Step " + (current + 1) + " of " + steps.length;
    prev.disabled = current === 0;
    next.disabled = current === steps.length - 1;
  }
  function refreshProgress() {
    var done = 0;
    boxes.forEach(function (box, k) {
      var on = box.checked;
      if (on) { done += 1; }
      steps[k].classList.toggle("is-done", on);
      if (navButtons[k]) { navButtons[k].classList.toggle("is-done", on); }
    });
    progress.textContent = done + " of " + steps.length + " steps complete";
  }
  prev.addEventListener("click", function () { show(current - 1); });
  next.addEventListener("click", function () { show(current + 1); });
  navButtons.forEach(function (button, k) { button.addEventListener("click", function () { show(k); }); });
  boxes.forEach(function (box) { box.addEventListener("change", refreshProgress); });
  doc.addEventListener("keydown", function (event) {
    var target = event.target;
    var tag = target && target.tagName ? target.tagName.toUpperCase() : "";
    var typing = tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && target.type !== "checkbox") || (target && target.isContentEditable);
    if (typing || event.ctrlKey || event.metaKey || event.altKey) { return; }
    var key = event.key;
    if (key === "j" || key === "J" || key === "ArrowRight") { event.preventDefault(); show(current + 1); }
    else if (key === "k" || key === "K" || key === "ArrowLeft") { event.preventDefault(); show(current - 1); }
  });
  show(0);
  refreshProgress();
})();
`;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function buildOfflineManualHtml(input: ManualInput): string {
  const stepCount = input.steps.length;
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
  const viewer =
    stepCount === 0
      ? `<p class="empty">This plan has no steps.</p>`
      : [
          `<div class="controls" role="group" aria-label="Step navigation">`,
          `<button type="button" id="prev-step">Prev</button>`,
          `<button type="button" id="next-step">Next</button>`,
          `<span class="counter" id="step-counter" aria-live="polite">Step 1 of ${stepCount}</span>`,
          `<span class="progress" id="progress">0 of ${stepCount} steps complete</span>`,
          `</div>`,
          `<ol class="stepnav" aria-label="Jump to step">${input.steps
            .map((step) => `<li><button type="button" aria-label="Go to step ${step.number}">${step.number}</button></li>`)
            .join("")}</ol>`,
          `<div class="steps">${input.steps.map(stepArticle).join("")}</div>`,
          `<p class="hint">Keyboard: J or Right Arrow for the next step, K or Left Arrow for the previous step. Printing shows every step.</p>`,
        ].join("");

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta http-equiv="Content-Security-Policy" content="${e(csp)}">`,
    `<title>${e(input.title)} - Disassembly manual</title>`,
    `<style>${STYLE}</style>`,
    `</head>`,
    `<body>`,
    `<div class="page">`,
    `<header class="cover">`,
    `<p class="kicker">Disassembly manual</p>`,
    `<h1>${e(input.title)}</h1>`,
    `<p class="meta">${e(input.sourceLabel)} · ${input.partCount} parts · ${stepCount} steps · Generated ${e(input.generatedAt)}</p>`,
    proofSection(input),
    lockedNotice(input),
    `</header>`,
    `<section aria-labelledby="h-views"><h2 id="h-views">Overview</h2><div class="figures">`,
    figure("Assembled", input.snapshots.assembled, "Every part in place."),
    figure("Exploded", input.snapshots.exploded, "Every part at the end of its removal path."),
    `</div></section>`,
    `<section aria-labelledby="h-tools"><h2 id="h-tools">Tools required</h2>${toolsTable(input.steps)}</section>`,
    `<section aria-labelledby="h-bom"><h2 id="h-bom">Bill of materials</h2>${bomTable(input)}</section>`,
    `<section aria-labelledby="h-steps"><h2 id="h-steps">Step-by-step</h2>${viewer}</section>`,
    `<footer>Generated by Guide Forge. This file is self-contained and works offline.</footer>`,
    `</div>`,
    `<script>${SCRIPT}</script>`,
    `</body>`,
    `</html>`,
  ].join("\n");
}
