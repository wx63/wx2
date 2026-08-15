// ================================================================
//  OpenClaw 跨境全能运营矩阵 · 前端控制台
//  同源后端 API 驱动；认证、权限和业务数据均由 Express + SQLite 负责
// ================================================================

// ============ 数据模型：5 名数字员工 ============
// 真实数据由后端 /api/dashboard 加载；这里仅保留空状态，避免前端静态业务数据成为事实来源。
let AGENTS = [];

// ============ KPI ============
let KPIS = [];

// ============ 活动流 ============
// 活动数据由后端 activity_feed 表返回，生产环境不再在浏览器随机伪造业务事件。
const STATUS_LABEL = { online: "在线", busy: "处理中", offline: "离线" };

// ============ 线索数据（对应 lead-scoring 产出） ============
let LEADS = [];

const GRADE_META = {
  hot:   { label: "高意向", cls: "g-hot",   color: "#fb7185" },
  warm:  { label: "普通",   cls: "g-warm",  color: "#fbbf24" },
  cold:  { label: "垃圾",   cls: "g-cold",  color: "#7e85a3" },
};

// ============ 审批队列（审批闸门） ============
// 真实数据从后端 GET /api/approvals 拉取（见 loadApprovalsFromServer）；
// 进入审批中心视图时自动拉取后端数据，覆盖此空数组。
let APPROVALS = [];

// 后端返回的 action → 前端 type 映射（统一展示）
const ACTION_TO_TYPE = {
  social_post: "post",   // 社媒发帖/回复
  listing_submit: "listing", // 商品上架
  purchase: "order",     // 采购/下单
  refund: "reply",       // 退款（暂归到回复类）
  reply: "reply",
  post: "post",
  listing: "listing",
  order: "order",
};

const APPROVAL_META = {
  post:    { label: "发帖", icon: "📣", color: "#fb7185" },
  listing: { label: "上架", icon: "📤", color: "#a855f7" },
  reply:   { label: "回复", icon: "💬", color: "#34d399" },
  order:   { label: "下单", icon: "🛒", color: "#60a5fa" },
};
const APPROVAL_STATUS = { pending: "待审批", approved: "已批准", rejected: "已驳回" };

// ================================================================
//  指令路由：运营总监意图识别（关键词路由 → Agent）
// ================================================================
const FALLBACK_ROUTE_RULES = [
  { agent: 0, kw: ["竞品","周报","调研","趋势","选品","voc","评论","市场"], tag: "调研", color: "#60a5fa" },
  { agent: 1, kw: ["listing","标题","seo","脚本","文案","多语种","本地化","爆款"], tag: "内容", color: "#a855f7" },
  { agent: 2, kw: ["发帖","社媒","排期","种草","reddit","tiktok","x 账号","矩阵"], tag: "获客", color: "#fb7185" },
  { agent: 3, kw: ["客户","回复","物流","查单","退换货","客服","询","moq","尺码"], tag: "客服", color: "#34d399" },
  { agent: 4, kw: ["审查","侵权","敏感词","fda","水印","广告","roas","合规","上架前"], tag: "合规", color: "#fbbf24" },
];
let ROUTE_RULES = FALLBACK_ROUTE_RULES;

const FALLBACK_ACTION_RULES = [
  { action: "social_post", label: "社媒发帖/回复", kw: ["发帖", "发推", "发布", "发消息", "回复客户", "回复买家", "推广帖", "推文", "发一条", "发个", "发一个", "发新品", "发广告"] },
  { action: "listing_submit", label: "商品上架", kw: ["上架", "上新产品", "提交 listing", "提交listing", "上传产品", "上架产品", "上新", "更新 listing", "更新listing"] },
  { action: "purchase", label: "采购/下单", kw: ["下单", "购买", "采购", "进货", "补货", "采购一批", "买一批"] },
  { action: "refund", label: "退款/赔偿", kw: ["退款", "退钱", "赔偿", "补偿", "退我钱"] },
];
let ACTION_RULES = FALLBACK_ACTION_RULES;

function detectAction(cmd) {
  const lower = String(cmd || "").toLowerCase();
  for (const rule of ACTION_RULES) {
    if ((rule.kw || []).some(k => lower.includes(String(k).toLowerCase()))) return rule.action;
    for (const pattern of rule.patterns || []) {
      if (pattern.test(lower)) return rule.action;
    }
  }
  return null;
}

async function loadRulesFromServer() {
  try {
    const data = await apiJson("/api/rules");
    const rules = data.data || {};
    if (Array.isArray(rules.routeRules) && rules.routeRules.length) ROUTE_RULES = rules.routeRules;
    if (Array.isArray(rules.actionRules) && rules.actionRules.length) {
      ACTION_RULES = rules.actionRules.map(r => ({ ...r, patterns: (r.patterns || []).map(src => new RegExp(src, "i")) }));
    }
  } catch (e) {
    console.warn("[rules] 规则接口拉取失败，使用本地兜底副本：", e.message);
  }
}

function routeCommand(cmd) {
  const lower = cmd.toLowerCase();
  let target = { agent: null, tag: "通用", color: "var(--brand)" };
  for (const r of ROUTE_RULES) {
    if (r.kw.some(k => lower.includes(k))) { target = r; break; }
  }
  return { agentIdx: target.agent, tag: target.tag, color: target.color };
}

// 每种 Agent 的流式产出片段（模拟 LLM 流式输出）
function buildSteps(agentIdx, cmd, action) {
  const a = AGENTS[agentIdx];
  const steps = [];
  // 通用起手
  steps.push({ label: `运营总监路由`, text: `识别意图 → 路由至「${a ? a.name : "通用"}」` , tag: "路由", color: "#6366f1" });
  if (a) {
    steps.push({ label: a.name, text: `拉起 ${escapeHtml(a.name)}，注入技能包 + 知识库上下文`, tag: target_tag(a.id), color: a.color });
    // 按技能产出
    a.skills.filter(s => s.on).slice(0, 2).forEach(s => {
      steps.push({ label: s.name, text: `执行「${s.name}」…`, tag: target_tag(a.id), color: a.color });
    });
  }
  // 对外动作 → 审批闸门
  if (action) {
    const meta = APPROVAL_META[action];
    steps.push({ label: "审批闸门", text: `检测到对外动作「${meta.label}」，已生成草稿并提交审批（待人工确认）`, tag: "审批", color: "#fbbf24", isApproval: true });
  } else {
    steps.push({ label: "产出", text: `汇总结果，生成报告 / 草稿`, tag: target_tag(agentIdx), color: a ? a.color : "#6366f1", isFinal: true });
  }
  return steps;
}
function target_tag(id) { return ["调研","内容","获客","客服","合规"][id] || "通用"; }

// ================================================================
//  控制台渲染
// ================================================================
let consoleState = { running: false, steps: [], abort: null };
let commandDrawerState = { open: false, collapsed: false };

function getConsoleTargets() {
  return [
    document.getElementById("consoleBody"),
    document.getElementById("commandDrawerBody"),
  ].filter(Boolean);
}

function looksLikeMarkdown(text) {
  return /(?:^|\n)(?:\s*#{1,4}\s|>\s?|[-*+]\s|\d+[.)]\s|\|.*\||---+$)/m.test(text) || /(\*\*|`)/.test(text);
}

function inlineFormat(escapedText) {
  return String(escapedText || "")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");
}

function renderTable(rows) {
  const cells = (line) => String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => inlineFormat(cell.trim()));
  const delimiterIndex = rows.findIndex((row) => {
    const cells = row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
  });
  const hasDelimiter = delimiterIndex >= 0;
  const headerCells = cells(rows[0]);
  const bodyRows = hasDelimiter ? rows.slice(delimiterIndex + 1) : rows.slice(1);
  const head = `<tr>${headerCells.map((cell) => `<th>${cell}</th>`).join("")}</tr>`;
  const body = bodyRows.filter(Boolean).map((row) => `<tr>${cells(row).map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return `<div class="cs-table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderRichText(text) {
  if (!text) return "";
  const rawLines = String(text == null ? "" : text).split(/\r?\n/);
  const lines = rawLines.map(escapeHtml);
  const blocks = [];
  let i = 0;
  let guard = 0;

  while (i < lines.length) {
    if (++guard > 5000) break;
    const line = lines[i];
    const trim = line.trim();

    if (!trim) { i += 1; continue; }
    if (/^(?:---+|\*\*\*+)$/.test(trim)) { blocks.push('<hr class="cs-hr">'); i += 1; continue; }

    const heading = trim.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const cls = level <= 2 ? "cs-h2" : level === 3 ? "cs-h3" : "cs-h4";
      blocks.push(`<h4 class="${cls}">${inlineFormat(heading[2])}</h4>`);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(rawLines[i].trim())) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(rawLines[i].trim())) {
        quote.push(inlineFormat(escapeHtml(rawLines[i].trim().replace(/^>\s?/, ""))));
        i += 1;
      }
      blocks.push(`<blockquote class="cs-quote">${quote.join("<br>")}</blockquote>`);
      continue;
    }

    if (/^\s*(?:[-*+])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*(?:[-*+])\s+/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\s*(?:[-*+])\s+/, ""))}</li>`);
        i += 1;
      }
      blocks.push(`<ul class="cs-list">${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
        i += 1;
      }
      blocks.push(`<ol class="cs-list">${items.join("")}</ol>`);
      continue;
    }

    if (trim.startsWith("|") && trim.endsWith("|")) {
      const rows = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        if (!current.startsWith("|") || !current.endsWith("|")) break;
        rows.push(current);
        i += 1;
      }
      if (rows.length) blocks.push(renderTable(rows));
      continue;
    }

    const paragraph = [];
    while (i < lines.length) {
      const current = lines[i].trim();
      if (!current) break;
      if (/^(?:---+|\*\*\*+)$/.test(current)) break;
      if (/^#{1,4}\s/.test(current)) break;
      if (/^>\s?/.test(rawLines[i].trim())) break;
      if (/^\s*(?:[-*+])\s+/.test(lines[i])) break;
      if (/^\s*\d+[.)]\s+/.test(lines[i])) break;
      if (current.startsWith("|") && current.endsWith("|")) break;
      paragraph.push(inlineFormat(current));
      i += 1;
    }
    blocks.push(`<p>${paragraph.join("<br>")}</p>`);
  }

  return blocks.join("");
}

function buildConsoleStepsHtml() {
  return consoleState.steps.map((s, i) => {
    const isOutput = s.label === "\u4EA7\u51FA" || s.tag === "\u7ED3\u679C" || s.isFinal;
    const preview = isOutput
      ? (s.done ? "\u5DF2\u5B8C\u6210" : "\u6D41\u5F0F\u751F\u6210\u4E2D\u2026")
      : String(s.text || "").split(/\r?\n/)[0] || (s.done ? "\u5DF2\u5B8C\u6210" : "\u6267\u884C\u4E2D\u2026");
    return `
      <div class="console-step ${s.done ? "done" : "active"}${isOutput ? " step-output" : ""}" style="--step-color:${safeCssColor(s.color)}">
        ${s.isApproval ? '<span class="console-gate">闸门</span>' : ""}
        <div class="cs-marker"></div>
        <div class="cs-body">
          <div class="cs-label"><span class="cs-tag" style="color:${safeCssColor(s.color)}">${escapeHtml(s.tag)}</span> ${escapeHtml(s.label)}</div>
          <div class="cs-text cs-step-preview">${escapeHtml(preview)}</div>
        </div>
        ${s.done ? '<span class="cs-check">✓</span>' : '<span class="cs-spinner"></span>'}
      </div>`;
  }).join("");
}

function buildConsoleOutputHtml() {
  const output = [...consoleState.steps].reverse().find(s => s.label === "\u4EA7\u51FA" || s.tag === "\u7ED3\u679C" || s.isFinal);
  if (!output || !String(output.text || "").trim()) {
    return `<div class="console-output-empty">
      <span class="console-output-cursor">▌</span>
      <p>${consoleState.running ? "正在流式生成最终产出\u2026" : "暂无产出，执行完成后会显示在这里"}</p>
    </div>`;
  }
  const isMarkdown = looksLikeMarkdown(output.text);
  const content = isMarkdown ? renderRichText(output.text) : escapeHtml(output.text);
  return `<div class="console-output-content cs-text${isMarkdown ? " rich" : ""}">${content}</div>`;
}

function buildConsoleHtml() {
  if (!consoleState.steps.length) {
    return `<div class="console-empty">
      <div class="console-empty-icon">⚡</div>
      <p>给矩阵下达指令，运营总监将自动路由、拉起对应数字员工、流式执行。</p>
      <p class="muted">对外动作（发帖/回复/上架/下单）将自动进入审批闸门，等人工确认后归档。</p>
    </div>`;
  }

  const output = [...consoleState.steps].reverse().find(s => s.label === "\u4EA7\u51FA" || s.tag === "\u7ED3\u679C" || s.isFinal);
  const outputState = output
    ? (output.done ? "\u5DF2\u5B8C\u6210" : "\u6D41\u5F0F\u751F\u6210\u4E2D")
    : (consoleState.running ? "\u7B49\u5F85\u9996\u6BB5\u8F93\u51FA" : "\u6682\u65E0\u4EA7\u51FA");

  return `
    <div class="console-layout">
      <aside class="console-steps-pane">
        <div class="console-pane-title"><span>执行轨迹</span><em>${consoleState.steps.length} 步</em></div>
        <div class="console-steps-list">${buildConsoleStepsHtml()}</div>
      </aside>
      <section class="console-output-pane">
        <div class="console-pane-title"><span>最终产出</span><em class="${outputState === "\u5DF2\u5B8C\u6210" ? "done" : outputState.includes("流式") ? "streaming" : "idle"}">${escapeHtml(outputState)}</em></div>
        <div class="console-output-body">${buildConsoleOutputHtml()}</div>
      </section>
    </div>`;
}

function getConsoleOutputTargets() {
  return [
    document.querySelector("#consoleBody .console-output-body"),
    document.querySelector("#commandDrawerBody .console-output-body"),
  ].filter(Boolean);
}

function renderConsoleOutput() {
  const html = buildConsoleOutputHtml();
  getConsoleOutputTargets().forEach((body) => {
    body.innerHTML = html;
    const scrollPane = body.closest(".console-output-pane");
    if (scrollPane) scrollPane.scrollTop = scrollPane.scrollHeight;
  });
}
function renderCommandDrawerState() {
  const drawer = document.getElementById("commandDrawer");
  const status = document.getElementById("commandDrawerStatus");
  const toggle = document.getElementById("commandDrawerToggle");
  const send = document.getElementById("commandSend");
  if (drawer) {
    drawer.classList.toggle("show", commandDrawerState.open);
    drawer.classList.toggle("collapsed", commandDrawerState.collapsed);
    drawer.classList.toggle("running", consoleState.running);
  }
  if (status) {
    status.className = consoleState.running ? "status running" : consoleState.steps.length ? "status done" : "status idle";
    status.textContent = consoleState.running
      ? "执行中"
      : consoleState.steps.length
        ? "已完成"
        : "等待指令";
  }
  if (toggle) toggle.textContent = commandDrawerState.collapsed ? "展开" : "收起";
  if (send) {
    send.disabled = consoleState.running;
    send.textContent = consoleState.running ? "执行中" : "执行";
  }
}

function openCommandDrawer() {
  commandDrawerState.open = true;
  commandDrawerState.collapsed = false;
  renderCommandDrawerState();
}

function toggleCommandDrawer() {
  commandDrawerState.collapsed = !commandDrawerState.collapsed;
  renderCommandDrawerState();
}

function renderConsole() {
  const html = buildConsoleHtml();
  getConsoleTargets().forEach((box) => {
    box.innerHTML = html;
    const pane = box.querySelector(".console-output-pane");
    if (pane) pane.scrollTop = pane.scrollHeight;
  });
  renderCommandDrawerState();
}


// 伪随机（不用 Math.random 以保证可读节奏）—— 但演示用随机可接受
function pseudoRand() { return Math.random(); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ================================================================
//  控制台指令输入
// ================================================================
function handleCommand(tpl = null) {
  const input = document.getElementById("commandInput");
  const cmd = input.value.trim();
  if (!cmd) return;
  if (consoleState.running) { showToast("上条指令仍在执行，请稍候…"); return; }
  input.value = "";
  openCommandDrawer();
  if (currentView !== "overview") showToast("指令已开始执行，结果会显示在右下角抽屉");
  // tpl 带 mode: 'kb' → 走知识库检索（kb-query）
  runCommand(cmd);
}
document.getElementById("commandSend").addEventListener("click", () => handleCommand());
document.getElementById("commandInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleCommand();
});
document.getElementById("commandDrawerToggle").addEventListener("click", toggleCommandDrawer);
document.getElementById("commandDrawerOverview").addEventListener("click", () => {
  switchView("overview");
  if (!consoleState.running) commandDrawerState.collapsed = true;
  renderCommandDrawerState();
});

// 控制台快捷指令
const QUICK_CMDS = [
  { label: "竞品周报", cmd: "生成本周亚马逊 US 宠物用品竞品周报", color: "#60a5fa" },
  { label: "多语种 Listing", cmd: "为便携折叠宠物水壶生成英语/西语/日语三语 Listing", color: "#a855f7" },
  { label: "排期今日发帖", cmd: "为 3 个 X 账号排期今日发帖内容（6-18 分钟间隔）", color: "#fb7185" },
  { label: "客服查物流", cmd: "客户询订单物流，调用 ERP 查单并回复客户", color: "#34d399" },
  { label: "上架前审查", cmd: "对 23 条待上架 Listing 做敏感词与 FDA 审查", color: "#fbbf24" },
];
function renderQuickCmds() {
  const wrap = document.getElementById("quickCmds");
  wrap.innerHTML = QUICK_CMDS.map(q => `
    <button class="quick-cmd" style="--qc:${q.color}">${q.label}</button>
  `).join("");
  wrap.querySelectorAll(".quick-cmd").forEach((b, i) => {
    b.addEventListener("click", () => {
      document.getElementById("commandInput").value = QUICK_CMDS[i].cmd;
      handleCommand();
    });
  });
}

// ================================================================
//  迷你 sparkline
// ================================================================
function sparkSVG(data, color) {
  const w = 70, h = 28, max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${h} ${pts.join(" ")} ${w},${h}`;
  return `<svg class="kpi-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polygon points="${area}" fill="${color}" opacity="0.12"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ================================================================
//  渲染 KPI
// ================================================================
function renderKPI() {
  document.getElementById("kpiRow").innerHTML = KPIS.map((k) => {
    const color = safeCssColor(k.color, "#6366f1");
    const icon = typeof k.icon === "string" && !/script|on\w+=|<\/?svg|foreignObject|javascript:/i.test(k.icon) ? k.icon : "";
    const value = k.key === "leads" ? `<span id="leadCount">${escapeHtml(LEADS.length)}</span>`
      : k.key === "agents" ? `<span id="onlineAgents">${AGENTS.filter(a => a.status !== "offline").length}</span> / ${AGENTS.length}`
      : escapeHtml(k.value);
    return `
    <div class="kpi" style="--kpi-color:${color};--kpi-chip:color-mix(in srgb,${color} 16%,transparent);--kpi-glow:color-mix(in srgb,${color} 10%,transparent)">
      <div class="kpi-top">
        <span class="kpi-label">${escapeHtml(k.label)}</span>
        <span class="kpi-icon"><svg viewBox="0 0 24 24">${icon}</svg></span>
      </div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-trend ${k.up ? "up" : "flat"}">${escapeHtml(k.trend)}</div>
      ${sparkSVG(k.spark || [], color)}
    </div>`;
  }).join("");
}

// ================================================================
//  渲染 Agent 卡片
// ================================================================
function renderAgentGrid() {
  const grid = document.getElementById("agentGrid");
  grid.innerHTML = AGENTS.map((a) => {
    const color = safeCssColor(a.color);
    const status = safeClassToken(a.status, ["online", "busy", "offline"], "offline");
    return `
    <div class="agent-card" style="--agent-color:${color}" data-id="${escapeAttr(a.id)}">
      <div class="agent-head">
        <span class="agent-emoji">${escapeHtml(a.emoji)}</span>
        <div>
          <div class="agent-name">${escapeHtml(a.name)}</div>
          <div class="agent-role">${escapeHtml(a.role)}</div>
        </div>
        <span class="agent-status status-${status}">
          <span class="dot dot-${status === "online" ? "on" : status === "busy" ? "busy" : "off"}"></span>
          ${escapeHtml(STATUS_LABEL[status])}
        </span>
      </div>
      <div class="agent-task"><span class="label">当前任务 · </span>${escapeHtml(a.task)}</div>
      <div class="agent-meta">
        ${Object.entries(a.metrics || {}).map(([k, v]) => `<span>${escapeHtml(k)} <b>${escapeHtml(v)}</b></span>`).join("")}
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll(".agent-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = +card.dataset.id;
      document.querySelector(`.nav-item[data-agent="${id}"]`).click();
    });
  });
}

// ================================================================
//  渲染 Agent 详情
// ================================================================
function renderAgentDetail(id) {
  const a = AGENTS[id];
  const color = safeCssColor(a.color);
  const status = safeClassToken(a.status, ["online", "busy", "offline"], "offline");
  const detail = document.getElementById("agentDetail");
  detail.innerHTML = `
    <div class="detail-hero" style="--agent-color:${color}">
      <span class="detail-emoji">${escapeHtml(a.emoji)}</span>
      <div>
        <div class="detail-name">${escapeHtml(a.name)}</div>
        <div class="detail-role">${escapeHtml(a.role)}</div>
      </div>
      <div class="detail-actions">
        <button class="btn" id="toggleStatus">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.4 5.6a9 9 0 1 0 2.1 6.4M12 3v4M7 7l-4-4M17 7l4-4"/></svg>
          ${a.status === "offline" ? "上线" : "下线"}
        </button>
        <button class="btn btn-primary" id="assignTask">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          下达任务
        </button>
      </div>
    </div>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-head"><div class="ph-left"><span class="ph-dot"></span><h2>当前任务</h2></div><span class="hint">${escapeHtml(STATUS_LABEL[status])}</span></div>
        <div class="agent-task" style="margin:0"><span class="label">进行中 · </span>${escapeHtml(a.task)}</div>
        <div class="agent-meta" style="margin-top:14px">
          ${Object.entries(a.metrics || {}).map(([k, v]) => `<span>${escapeHtml(k)} <b>${escapeHtml(v)}</b></span>`).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="ph-left"><span class="ph-dot"></span><h2>技能包</h2></div><span class="hint">${a.skills.filter(s => s.on).length}/${a.skills.length} 启用</span></div>
        <ul class="skill-list">
          ${a.skills.map((s, i) => `
            <li class="${s.on ? "on" : ""}" data-i="${i}">
              <span class="skill-name">${escapeHtml(s.name)}</span>
              <span class="skill-toggle ${s.on ? "on" : ""}" data-i="${i}"></span>
            </li>
          `).join("")}
        </ul>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><div class="ph-left"><span class="ph-dot"></span><h2>快捷任务模板</h2></div><span class="hint">点击即派发至控制台执行</span></div>
      <div class="tpl-grid">
        ${a.templates.map((t, i) => `
          <button class="tpl-card" data-i="${i}" style="--agent-color:${color}">
            <span class="tpl-icon">${escapeHtml(t.icon)}</span>
            <span class="tpl-title">${escapeHtml(t.title)}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  document.getElementById("assignTask").addEventListener("click", () => openTaskModal(id));
  document.getElementById("toggleStatus").addEventListener("click", () => {
    const prev = a.status;
    a.status = a.status === "offline" ? "online" : "offline";
    renderAgentDetail(id);
    renderAgentGrid();
    updateOnlineCount();
    saveAgentStatus(a)
      .then(() => showToast(`「${escapeHtml(a.name)}」已${a.status === "offline" ? "下线" : "上线"}`))
      .catch(e => { a.status = prev; renderAgentDetail(id); renderAgentGrid(); updateOnlineCount(); showToast(`状态保存失败：${e.message}`); });
  });
  detail.querySelectorAll(".skill-toggle").forEach((t) => {
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = +t.dataset.i;
      a.skills[i].on = !a.skills[i].on;
      renderAgentDetail(id);
      saveAgentSkill(a, i)
        .then(() => showToast(`技能「${a.skills[i].name}」已${a.skills[i].on ? "启用" : "停用"}`))
        .catch(e => { a.skills[i].on = !a.skills[i].on; renderAgentDetail(id); showToast(`技能保存失败：${e.message}`); });
    });
  });
  detail.querySelectorAll(".tpl-card").forEach((c) => {
    c.addEventListener("click", () => {
      const i = +c.dataset.i;
      const tpl = a.templates[i];
      // 滚到顶栏指令栏并执行
      document.getElementById("commandInput").value = tpl.prompt;
      document.getElementById("commandInput").focus();
      handleCommand(tpl);
    });
  });
}

// ================================================================
//  任务下达弹窗
// ================================================================
function openTaskModal(agentId) {
  const a = AGENTS[agentId];
  const color = safeCssColor(a.color);
  const overlay = document.getElementById("modalOverlay");
  document.getElementById("modalBody").innerHTML = `
    <div class="task-modal-hero" style="--agent-color:${color}">
      <span class="detail-emoji">${escapeHtml(a.emoji)}</span>
      <div>
        <div class="detail-name">${escapeHtml(a.name)}</div>
        <div class="detail-role">${escapeHtml(a.role)}</div>
      </div>
      <button class="modal-close" id="modalClose" aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">快捷任务模板</div>
      <div class="tpl-grid">
        ${a.templates.map((t, i) => `
          <button class="tpl-card" data-i="${i}" style="--agent-color:${color}">
            <span class="tpl-icon">${escapeHtml(t.icon)}</span>
            <span class="tpl-title">${escapeHtml(t.title)}</span>
          </button>
        `).join("")}
      </div>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">自由指令</div>
      <textarea id="taskFreeInput" class="task-free-input" rows="3" placeholder="例如：调研东南亚宠物用品 Top 卖家本周价格变动…"></textarea>
    </div>
    <div class="task-modal-foot">
      <span class="hint">对外动作将自动进入审批闸门</span>
      <button class="btn btn-primary" id="taskDispatch">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        派发至控制台
      </button>
    </div>
  `;
  overlay.classList.add("show");

  document.getElementById("modalClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); }, { once: true });
  document.getElementById("taskDispatch").addEventListener("click", () => {
    const ta = document.getElementById("taskFreeInput");
    const val = ta.value.trim();
    if (!val) { showToast("请输入指令或选择一个模板"); return; }
    closeModal();
    document.getElementById("commandInput").value = val;
    handleCommand();
  });
  document.querySelectorAll("#modalBody .tpl-card").forEach((c) => {
    c.addEventListener("click", () => {
      const i = +c.dataset.i;
      closeModal();
      const tpl = a.templates[i];
      document.getElementById("commandInput").value = tpl.prompt;
      handleCommand(tpl);
    });
  });
}
function closeModal() {
  document.getElementById("modalOverlay").classList.remove("show");
}

// ================================================================
//  视图切换
// ================================================================
let currentView = "overview";
const PAGE_META = {
  overview: ["运营总览", "5 名数字员工协同作战 · 最近快照"],
  agent: ["数字员工", "单个 Agent 详情与技能管理"],
  approval: ["审批中心", "对外动作的人工确认闸门"],
  leads: ["线索管理", "全渠道进线分级打标 · 导出 leads.csv"],
  orders: ["订单管理", "本地订单录入/查询/状态管理"],
  knowledge: ["知识库", "RAG 索引文档管理"],
  settings: ["设置", "渠道 · 模型 · 沙箱 · 安全"],
};

function switchView(view, agentId) {
  currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("view-active"));
  document.getElementById(`view-${view}`).classList.add("view-active");

  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  const navTarget = agentId != null
    ? document.querySelector(`.nav-item[data-agent="${agentId}"]`)
    : document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navTarget) navTarget.classList.add("active");

  const [title, sub] = PAGE_META[view] || ["", ""];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSub").textContent = sub;

  if (view === "agent" && agentId != null) renderAgentDetail(agentId);
  if (view === "approval") { renderApprovals(); loadApprovalsFromServer(); }
  if (view === "leads") renderLeads();
  if (view === "orders") { renderOrders(); loadOrdersFromServer(); }
  if (view === "knowledge") loadKBFilesFromServer();
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const view = item.dataset.view;
    const agentId = item.dataset.agent != null ? +item.dataset.agent : null;
    switchView(view, agentId);
  });
});

// ================================================================
//  Toast
// ================================================================
let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

// ================================================================
//  时钟
// ================================================================
function tickClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  document.getElementById("clock").textContent =
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

// ================================================================
//  活动流
// ================================================================
const feedItems = [];
function timeLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pushFeed(tag, color, text) {
  feedItems.unshift({ tag, color, text, time: timeLabel() });
  if (feedItems.length > 30) feedItems.pop();
  renderFeed();
}
function renderFeed() {
  const feed = document.getElementById("activityFeed");
  feed.innerHTML = feedItems.map((f) => `
    <li style="--feed-color:${safeCssColor(f.color)}">
      <span class="feed-time">${escapeHtml(f.time)}</span>
      <span class="feed-tag">${escapeHtml(f.tag)}</span>
      <span class="feed-text">${escapeHtml(f.text)}</span>
    </li>
  `).join("");
}
// 活动流初始内容由 loadDashboardData() 从后端加载。

// ================================================================
//  在线计数
// ================================================================
function updateOnlineCount() {
  const n = AGENTS.filter((a) => a.status !== "offline").length;
  const el = document.getElementById("onlineAgents");
  if (el) el.textContent = n;
}

// ================================================================
//  用户信息与登出
// ================================================================
let currentUser = null;
async function loadUser() {
  try {
    const data = await apiJson("/api/auth/me");
    currentUser = data.user;
    const name = currentUser.name || currentUser.email.split("@")[0];
    document.getElementById("userName").textContent = name;
    document.getElementById("userAvatar").textContent = name.charAt(0).toUpperCase();
    return currentUser;
  } catch (e) {
    if (e.message === "请先登录" || String(e.message).includes("401")) {
      window.location.href = "/login.html";
      return null;
    }
    showToast("获取用户信息失败：" + e.message);
    return null;
  }
}
document.getElementById("userChip").addEventListener("click", async () => {
  try { await apiJson("/api/auth/logout", { method: "POST" }); } catch {}
  window.location.href = "/login.html";
});

// 通知铃铛 → 跳审批中心
document.querySelector(".icon-btn").addEventListener("click", () => {
  switchView("approval");
});

// ================================================================
//  审批中心
// ================================================================
function renderApprovalBadge() {
  const n = APPROVALS.filter(a => a.status === "pending").length;
  document.querySelectorAll(".nav-badge").forEach(b => {
    b.textContent = n;
    b.style.display = n > 0 ? "inline-flex" : "none";
  });
  const bell = document.querySelector(".icon-btn");
  bell.classList.toggle("has-badge", n > 0);
}

function renderApprovals() {
  const pending = APPROVALS.filter(a => a.status === "pending");
  const history = APPROVALS.filter(a => a.status !== "pending");
  const stats = [
    { label: "待审批", value: pending.length, sub: "需人工确认", color: "var(--warning)" },
    { label: "今日已批", value: APPROVALS.filter(a => a.status === "approved").length, sub: "草稿已归档", color: "var(--success)" },
    { label: "今日已驳", value: APPROVALS.filter(a => a.status === "rejected").length, sub: "已退回修改", color: "var(--danger)" },
    { label: "累计审批", value: APPROVALS.length, sub: "全部记录", color: "var(--brand)" },
  ];
  document.getElementById("approvalStats").innerHTML = stats.map(s => `
    <div class="kb-stat" style="--stat-color:${safeCssColor(s.color)}">
      <div class="kb-stat-label">${escapeHtml(s.label)}</div>
      <div class="kb-stat-value">${escapeHtml(s.value)}</div>
      <div class="kb-stat-sub">${escapeHtml(s.sub)}</div>
    </div>
  `).join("");

  const renderList = (list, emptyMsg) => list.length ? list.map(a => {
    const meta = APPROVAL_META[a.type] || APPROVAL_META.reply;
    return `
      <li class="ap-item" data-id="${escapeAttr(a.id)}">
        <div class="ap-icon" style="--file-color:${safeCssColor(meta.color)}">${escapeHtml(meta.icon)}</div>
        <div class="ap-main">
          <div class="ap-title">
            <span class="ap-type-chip" style="color:${safeCssColor(meta.color)};background:color-mix(in srgb,${safeCssColor(meta.color)} 14%,transparent)">${escapeHtml(meta.label)}</span>
            ${escapeHtml(a.title)}
            <span class="ap-id">#${a.id}</span>
          </div>
          <div class="ap-summary">${escapeHtml(a.summary || a.command || "")}</div>
          <div class="ap-meta">
            <span>👤 ${escapeHtml(a.agentName || "运营总监")}</span>
            <span>⏱ ${escapeHtml(a.created)}</span>
            <span class="ap-risk">⚠ ${escapeHtml(a.risk || "对外动作，需人工确认后归档")}</span>
          </div>
        </div>
        <div class="ap-actions">
          ${a.status === "pending" ? `
            <button class="btn btn-sm" data-act="view" data-id="${a.id}" ${a._deciding ? "disabled" : ""}>查看草稿</button>
            <button class="btn btn-sm btn-reject" data-act="reject" data-id="${a.id}" ${a._deciding ? "disabled" : ""}>驳回</button>
            <button class="btn btn-sm btn-primary" data-act="approve" data-id="${a.id}" ${a._deciding ? "disabled" : ""}>${a._deciding ? "同步中…" : "批准并归档"}</button>
          ` : `<span class="ap-status ap-${a.status}">${APPROVAL_STATUS[a.status]}</span>`}
        </div>
      </li>
    `;
  }).join("") : `<div class="ap-empty">${emptyMsg}</div>`;

  document.getElementById("approvalPending").innerHTML = renderList(pending, "✅ 无待审批项，所有对外动作已处理");
  document.getElementById("approvalHistory").innerHTML = renderList(history, "暂无历史记录");

  // 绑定按钮
  document.querySelectorAll("#approvalPending [data-act]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const ap = APPROVALS.find(x => x.id === id);
      if (act === "view") { openApprovalDraft(ap); return; }
      decideApproval(ap, act === "approve" ? "approve" : "reject");
    });
  });
  renderApprovalBadge();
}

// HTML 转义（防止草稿内容里的 < > 破坏 DOM）
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function safeCssColor(value, fallback = "#6366f1") {
  const v = String(value || "").trim();
  if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(v)) return v;
  return fallback;
}
function safeClassToken(value, allowed, fallback = "") {
  const v = String(value || "");
  return allowed.includes(v) ? v : fallback;
}
function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 调后端落库批准/驳回，再以后端状态为准刷新本地
async function decideApproval(ap, decision) {
  if (!ap || ap._deciding) return;
  const idx = APPROVALS.findIndex(x => x.id === ap.id);
  const snapshot = { ...ap };
  const meta = APPROVAL_META[ap.type] || APPROVAL_META.reply;

  ap._deciding = true;
  renderApprovals();
  try {
    const data = await apiJson(`/api/approvals/${encodeURIComponent(ap.id)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const updated = normalizeApproval(data.data);
    if (updated) {
      const currentIdx = APPROVALS.findIndex(x => x.id === ap.id);
      if (currentIdx >= 0) APPROVALS[currentIdx] = updated;
      else APPROVALS.unshift(updated);
    }
    pushFeed("审批", meta.color, `${decision === "approve" ? "批准并归档" : "驳回"} ${meta.label}草稿 #${ap.id}，${decision === "approve" ? "已归档（执行器未接入）" : "退回修改"}`);
    renderApprovals();
    showToast(decision === "approve"
      ? `✅ 已批准并归档「${updated ? updated.title : ap.title}」，已归档（执行器尚未接入，未真实执行）`
      : `已驳回「${updated ? updated.title : ap.title}」，退回修改`);
  } catch (e) {
    const currentIdx = APPROVALS.findIndex(x => x.id === ap.id);
    if (currentIdx >= 0) APPROVALS[currentIdx] = snapshot;
    renderApprovals();
    await loadApprovalsFromServer();
    showToast(`⚠ 审批同步失败：${e.message}，已恢复服务器状态`);
  }
}

function openApprovalDraft(ap) {
  if (!ap) return;
  const meta = APPROVAL_META[ap.type] || APPROVAL_META.reply;
  const overlay = document.getElementById("modalOverlay");
  document.getElementById("modalBody").innerHTML = `
    <div class="task-modal-hero" style="--agent-color:${meta.color}">
      <span class="detail-emoji">${meta.icon}</span>
      <div>
        <div class="detail-name">${escapeHtml(ap.title)}</div>
        <div class="detail-role">${meta.label}草稿 · #${ap.id}</div>
      </div>
      <button class="modal-close" id="modalClose" aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">来源 Agent 运行${ap.runId ? ` · Run #${ap.runId}` : ""}</div>
      <div class="agent-step-meta">${ap.runId ? `该草稿由 Agent Run #${ap.runId} 生成` : "历史审批未关联 Agent 运行"}</div>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">AI 生成草稿（待人工复核）</div>
      <pre class="draft-view">${escapeHtml(ap.draft || "（无草稿）")}</pre>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">风险提示</div>
      <div class="draft-risk">⚠ ${escapeHtml(ap.risk || "对外动作，需人工确认后归档")}</div>
    </div>
    <div class="task-modal-foot">
      <span class="hint">AI 只出方案，人工确认后归档</span>
      <div>
        <button class="btn btn-sm btn-reject" id="draftReject">驳回</button>
        <button class="btn btn-sm btn-primary" id="draftApprove">批准并归档</button>
      </div>
    </div>
  `;
  overlay.classList.add("show");
  document.getElementById("modalClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); }, { once: true });
  document.getElementById("draftReject").addEventListener("click", () => {
    closeModal(); decideApproval(ap, "reject");
  });
  document.getElementById("draftApprove").addEventListener("click", () => {
    closeModal(); decideApproval(ap, "approve");
  });
}

// ================================================================
//  线索管理
// ================================================================
let leadFilter = "all";
function renderLeads() {
  const stats = [
    { label: "线索总数", value: LEADS.length, sub: "今日进线", color: "var(--brand)" },
    { label: "高意向", value: LEADS.filter(l => l.grade === "hot").length, sub: "B 端/C 端求购", color: "var(--danger)" },
    { label: "普通", value: LEADS.filter(l => l.grade === "warm").length, sub: "咨询属性", color: "var(--warning)" },
    { label: "垃圾", value: LEADS.filter(l => l.grade === "cold").length, sub: "外链/无效", color: "var(--text-3)" },
  ];
  document.getElementById("leadStats").innerHTML = stats.map(s => `
    <div class="kb-stat" style="--stat-color:${safeCssColor(s.color)}">
      <div class="kb-stat-label">${escapeHtml(s.label)}</div>
      <div class="kb-stat-value">${escapeHtml(s.value)}</div>
      <div class="kb-stat-sub">${escapeHtml(s.sub)}</div>
    </div>
  `).join("");

  const filtered = LEADS.filter(l => leadFilter === "all" || l.grade === leadFilter);
  document.getElementById("leadCount").textContent = LEADS.length;

  const table = document.getElementById("leadTable");
  table.innerHTML = filtered.length ? `
    <table class="lead-table">
      <thead>
        <tr>
          <th>线索 ID</th><th>渠道</th><th>客户</th><th>地区</th>
          <th>原话</th><th>意向</th><th>分级</th><th>得分</th><th>时间</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(l => {
          const g = GRADE_META[l.grade];
          return `
            <tr>
              <td class="lead-id">${escapeHtml(l.id)}</td>
              <td>${escapeHtml(l.channel)}</td>
              <td>${escapeHtml(l.name)}</td>
              <td>${escapeHtml(l.country)}</td>
              <td class="lead-msg">${escapeHtml(l.msg)}</td>
              <td class="lead-intent">${escapeHtml(l.intent)}</td>
              <td><span class="grade-chip ${safeClassToken(g.cls, ["g-hot", "g-warm", "g-cold"], "g-cold")}" style="--gc:${safeCssColor(g.color)}">${escapeHtml(g.label)}</span></td>
              <td><span class="lead-score" style="--gc:${safeCssColor(g.color)}">${escapeHtml(safeNumber(l.score))}</span></td>
              <td class="lead-time">${escapeHtml(l.time)}</td>
              <td>
                <button class="btn btn-sm" data-promote="${escapeHtml(l.id)}">转客户</button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  ` : `<div class="ap-empty">该筛选下无线索</div>`;

  // 筛选按钮
  document.querySelectorAll(".lead-filter").forEach(b => {
    b.classList.toggle("active", b.dataset.grade === leadFilter);
    b.onclick = () => { leadFilter = b.dataset.grade; renderLeads(); };
  });
  // 转客户
  table.querySelectorAll("[data-promote]").forEach(btn => {
    btn.onclick = () => {
      const l = LEADS.find(x => x.id === btn.dataset.promote);
      apiJson(`/api/leads/${encodeURIComponent(l.id)}/promote`, { method: "POST" })
        .then(async () => { showToast(`已将「${l.name}」转入 CRM 待跟进`); pushFeed("客服", "#34d399", `线索 ${l.id}「${l.name}」转入 CRM 跟进池`); await refreshLeadsFromServer(); })
        .catch(e => showToast(`转客户失败：${e.message}`));
    };
  });
}

async function refreshLeadsFromServer() {
  try {
    await loadDashboardData();
    renderLeads();
  } catch (e) {
    showToast("刷新线索失败：" + e.message);
    throw e;
  }
}

// 导出 leads.csv（以后端 SQLite 为准）
function exportLeadsCSV() {
  window.location.href = "/api/leads/export.csv";
}

function bindExportLeads() {
  const btn = document.getElementById("exportLeads");
  if (btn) btn.addEventListener("click", exportLeadsCSV);
}

// ================================================================
//  报告沉淀（控制台最终产出）
// ================================================================
let REPORTS = [];
let RUNS = { items: [], total: 0 };
function addReport(r) {
  const report = { ...r, time: timeLabel(), id: "R-" + String(REPORTS.length + 1).padStart(3, "0") };
  REPORTS.unshift(report);
  if (REPORTS.length > 20) REPORTS.pop();
  renderReports();
  fetch(`${API_BASE}/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: r.agent, title: r.title, tag: r.tag, color: r.color, content: r.content || "" }),
  }).catch(e => showToast("报告保存失败：" + e.message));
}
function renderReports() {
  const el = document.getElementById("reportList");
  if (!el) return;
  el.innerHTML = REPORTS.length ? REPORTS.map(r => `
    <li style="--feed-color:${safeCssColor(r.color)}" data-report="${escapeAttr(r.id)}">
      <span class="feed-time">${escapeHtml(r.time)}</span>
      <span class="feed-tag">${escapeHtml(r.tag)}</span>
      <span class="feed-text">📄 ${escapeHtml(r.title)}</span>
    </li>
  `).join("") : `<li class="feed-empty">暂无产出报告</li>`;
  el.querySelectorAll("[data-report]").forEach(item => {
    item.addEventListener("click", () => openReportDetail(REPORTS.find(r => r.id === item.dataset.report)));
  });
}

function openReportDetail(report) {
  if (!report) return;
  const overlay = document.getElementById("modalOverlay");
  document.getElementById("modalBody").innerHTML = `
    <div class="task-modal-hero" style="--agent-color:${safeCssColor(report.color)}">
      <span class="detail-emoji">📄</span>
      <div>
        <div class="detail-name">${escapeHtml(report.title)}</div>
        <div class="detail-role">${escapeHtml(report.tag || "报告")} · ${escapeHtml(report.time || report.createdAt || "")}</div>
      </div>
      <button class="modal-close" id="modalClose" aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">报告正文</div>
      <pre class="draft-view">${escapeHtml(report.content || "（无正文）")}</pre>
    </div>`;
  overlay.classList.add("show");
  document.getElementById("modalClose").onclick = closeModal;
}

// ================================================================
let RUN_FILTER = { status: "all", search: "", offset: 0, limit: 20 };
let runSearchTimer = null;
function debounceRunSearch(fn, ms = 300) { clearTimeout(runSearchTimer); runSearchTimer = setTimeout(fn, ms); }
function renderAgentRuns() {
  const el = document.getElementById("agentRunList");
  if (!el) return;
  const colorFor = (r) => r.status === "ok" ? "#34d399" : r.status === "running" ? "#fbbf24" : r.status === "cancelled" ? "#7e85a3" : "#fb7185";
  const steps = (r) => (r.steps && r.steps.length) || 0;
  const when = (r) => String(r.finishedAt || r.createdAt || "").slice(11, 16);
  const items = RUNS && RUNS.items ? RUNS.items : (RUNS || []);
  const total = RUNS && RUNS.total ? RUNS.total : items.length;
  const listHtml = items.length ? items.map(r => {
    const line = [String(r.id), r.agentId || "main", r.summary || String(r.command || "").slice(0, 28), String(steps(r)) + " steps"];
    const actions = '<button class="btn btn-sm" data-run-action="view" data-id="' + escapeAttr(r.id) + '">查看</button>' +
      (r.status === "running" || r.status === "queued" ? '<button class="btn btn-sm" data-run-action="cancel" data-id="' + escapeAttr(r.id) + '">取消</button>' : "") +
      (r.status === "error" || r.status === "cancelled" ? '<button class="btn btn-sm" data-run-action="rerun" data-id="' + escapeAttr(r.id) + '">重跑</button>' : "");
    return '<li style="--feed-color:' + safeCssColor(colorFor(r)) + '" data-run="' + escapeAttr(r.id) + '">' +
      '<span class="feed-time">' + escapeHtml(when(r)) + '</span>' +
      '<span class="feed-tag">' + escapeHtml(r.status || "unknown") + '</span>' +
      '<span class="feed-text">' + escapeHtml(line.join(" · ")) + '</span>' +
      '<span class="feed-actions">' + actions + '</span></li>';
  }).join("") : '<li class="feed-empty">暂无 Agent 运行记录</li>';
  el.innerHTML = listHtml + '<li class="feed-empty" style="justify-content:space-between"><span>共 ' + escapeHtml(String(total)) + ' 条</span><span><button class="btn btn-sm" id="runPrev">上一页</button> <button class="btn btn-sm" id="runNext">下一页</button></span></li>';
  const prev = document.getElementById("runPrev");
  const next = document.getElementById("runNext");
  if (prev) prev.onclick = () => { RUN_FILTER.offset = Math.max(0, RUN_FILTER.offset - RUN_FILTER.limit); loadAgentRuns(); };
  if (next) next.onclick = () => { RUN_FILTER.offset += RUN_FILTER.limit; loadAgentRuns(); };
  const search = document.getElementById("runSearch");
  const status = document.getElementById("runStatus");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    search.addEventListener("input", () => { RUN_FILTER.search = search.value.trim(); RUN_FILTER.offset = 0; debounceRunSearch(() => loadAgentRuns()); });
  }
  if (status && !status.dataset.bound) {
    status.dataset.bound = "1";
    status.addEventListener("change", () => { RUN_FILTER.status = status.value; RUN_FILTER.offset = 0; loadAgentRuns(); });
  }
  el.querySelectorAll("[data-run-action]").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); const id = Number(btn.dataset.id); const act = btn.dataset.runAction; handleRunAction(id, act); });
  });
  el.querySelectorAll("[data-run]").forEach(item => {
    item.addEventListener("click", (e) => { if (e.target.closest("[data-run-action]")) return; openAgentRunDetail(items.find(r => String(r.id) === item.dataset.run)); });
  });
}
async function loadAgentRuns() {
  const params = new URLSearchParams({ limit: String(RUN_FILTER.limit), offset: String(RUN_FILTER.offset) });
  if (RUN_FILTER.status !== "all") params.set("status", RUN_FILTER.status);
  if (RUN_FILTER.search) params.set("search", RUN_FILTER.search);
  try {
    const data = await apiJson("/api/agent-runs?" + params.toString());
    RUNS = data.data || { items: [], total: 0 };
    renderAgentRuns();
  } catch (e) { showToast("运行记录加载失败：" + e.message); }
}
async function handleRunAction(id, action) {
  if (action === "view") { const item = RUNS && RUNS.items ? RUNS.items.find(r => r.id === id) : RUNS.find(r => r.id === id); if (item) openAgentRunDetail(item); return; }
  try {
    if (action === "cancel") await apiJson("/api/agent-runs/" + id + "/cancel", { method: "POST" });
    if (action === "rerun") { const data = await apiJson("/api/agent-runs/" + id + "/rerun", { method: "POST" }); showToast("已重新提交命令 #" + data.commandId); return; }
    showToast("操作成功");
    await loadAgentRuns();
  } catch (e) { showToast("操作失败：" + e.message); }
}

function openAgentRunDetail(run) {
  if (!run) return;
  const overlay = document.getElementById("modalOverlay");
  const stepHtml = (run.steps || []).map((s, i) => {
    const metaLine = s.meta ? '<div class="agent-step-meta">' + escapeHtml(JSON.stringify(s.meta)) + '</div>' : '';
    return '<div class="agent-step-detail">' +
      '<div class="agent-step-head"><span>' + String(i + 1) + '. ' + escapeHtml(s.label || s.kind || '步骤') + '</span><span>' + escapeHtml(s.tool || s.kind || 'agent') + ' · ' + escapeHtml(s.status || '') + '</span></div>' +
      metaLine +
      '<pre class="draft-view">' + escapeHtml(s.output || s.input || '（无输出）') + '</pre></div>';
  }).join('');
  const stats = run.stats || {};
  const context = run.context || {};
  const statsHtml = Object.keys(stats).length ? '<div class="task-modal-section"><div class="tms-label">运行统计</div><div class="agent-step-meta">' + Object.entries(stats).map(([k, v]) => escapeHtml(k + ': ' + String(v))).join(' · ') + '</div></div>' : '';
  const contextHtml = Object.keys(context).length ? '<div class="task-modal-section"><div class="tms-label">执行上下文</div><div class="agent-step-meta">' + escapeHtml(JSON.stringify(context)) + '</div></div>' : '';
  document.getElementById("modalBody").innerHTML =
    '<div class="task-modal-hero" style="--agent-color:#6366f1">' +
      '<span class="detail-emoji">⚙</span>' +
      '<div><div class="detail-name">Agent Run #' + escapeHtml(run.id) + '</div><div class="detail-role">' + escapeHtml(run.status || 'unknown') + ' · ' + escapeHtml(run.agentId || 'main') + ' · ' + escapeHtml(run.path || '') + '</div></div>' +
      '<button class="modal-close" id="modalClose" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '</div>' +
    (run.summary ? '<div class="task-modal-section"><div class="tms-label">摘要</div><div class="agent-step-meta">' + escapeHtml(run.summary) + '</div></div>' : '') +
    statsHtml +
    contextHtml +
    '<div class="task-modal-section"><div class="tms-label">指令</div><pre class="draft-view">' + escapeHtml(run.command || '') + '</pre></div>' +
    '<div class="task-modal-section"><div class="tms-label">执行步骤</div>' + (stepHtml || '<div class="ap-empty">暂无步骤</div>') + '</div>' +
    (run.result ? '<div class="task-modal-section"><div class="tms-label">最终产出</div><pre class="draft-view">' + escapeHtml(run.result) + '</pre></div>' : '');
  overlay.classList.add("show");
  document.getElementById("modalClose").onclick = closeModal;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); }, { once: true });
}

const ORDER_STATUS_LABEL = {
  pending: '待处理',
  paid: '已付款',
  shipped: '已发货',
  delivered: '已送达',
  completed: '已完成',
  cancelled: '已取消',
};

let ORDERS = { items: [], total: 0 };
let ORDER_FILTER = { status: "all", search: "", offset: 0, limit: 50 };
async function loadOrdersFromServer() {
  const params = new URLSearchParams({ limit: String(ORDER_FILTER.limit), offset: String(ORDER_FILTER.offset) });
  if (ORDER_FILTER.status !== "all") params.set("status", ORDER_FILTER.status);
  if (ORDER_FILTER.search) params.set("search", ORDER_FILTER.search);
  try {
    const data = await apiJson("/api/orders?" + params.toString());
    ORDERS = data.data || { items: [], total: 0 };
    renderOrders();
  } catch (e) { showToast("订单加载失败：" + e.message); }
}
function renderOrders() {
  const statsEl = document.getElementById("orderStats");
  const tableEl = document.getElementById("orderTable");
  if (!statsEl || !tableEl) return;
  apiJson("/api/orders/stats").then(d => {
    const s = d.data || {};
    const stats = [{ label: "订单总数", value: s.total || 0, color: "var(--brand)" }, { label: "今日订单", value: s.today || 0, color: "var(--success)" }, { label: "待处理", value: s.pending || 0, color: "var(--warning)" }, { label: "已发货", value: s.shipped || 0, color: "var(--info)" }];
    statsEl.innerHTML = stats.map(x => `<div class="kb-stat" style="--stat-color:${safeCssColor(x.color)}"><div class="kb-stat-label">${escapeHtml(x.label)}</div><div class="kb-stat-value">${escapeHtml(x.value)}</div></div>`).join("");
  }).catch(() => {});
  const items = ORDERS.items || [];
  tableEl.innerHTML = items.length ? `<table class="lead-table"><thead><tr><th>订单号</th><th>客户</th><th>商品</th><th>数量</th><th>金额</th><th>渠道</th><th>状态</th><th>物流</th><th></th></tr></thead><tbody>` + items.map(o => {
    const orderStatus = o.status || "pending";
    return `<tr><td>${escapeHtml(o.orderNo)}</td><td>${escapeHtml(o.customerName || "")}</td><td>${escapeHtml(o.product || "")}</td><td>${escapeHtml(o.qty)}</td><td>${escapeHtml(o.currency || "USD")} ${escapeHtml(o.amount)}</td><td>${escapeHtml(o.channel || "")}</td><td><span class="order-status status-${escapeAttr(orderStatus)}">${escapeHtml(ORDER_STATUS_LABEL[orderStatus] || orderStatus)}</span></td><td>${escapeHtml(o.trackingNo || "")}</td><td><div class="order-actions"><button class="order-action-btn" data-order-edit="${escapeAttr(o.id)}" title="编辑订单" aria-label="编辑订单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span>编辑</span></button><button class="order-action-btn danger" data-order-delete="${escapeAttr(o.id)}" title="删除订单" aria-label="删除订单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg><span>删除</span></button></div></td></tr>`;
  }).join("") + "</tbody></table>" : `<div class="ap-empty">暂无订单</div>`;
  tableEl.querySelectorAll("[data-order-edit]").forEach(b => b.onclick = () => openOrderModal(items.find(o => o.id === b.dataset.orderEdit)));
  tableEl.querySelectorAll("[data-order-delete]").forEach(b => b.onclick = async () => { if (!confirm("确认删除该订单？")) return; try { await apiJson("/api/orders/" + b.dataset.orderDelete, { method: "DELETE" }); showToast("订单已删除"); await loadOrdersFromServer(); } catch (e) { showToast("删除失败：" + e.message); } });
}
function openOrderModal(order) {
  const overlay = document.getElementById("modalOverlay");
  const o = order || {};
  document.getElementById("modalBody").innerHTML = `<div class="task-modal-hero" style="--agent-color:#60a5fa"><span class="detail-emoji">📦</span><div><div class="detail-name">${escapeHtml(order ? "编辑订单" : "新增订单")}</div><div class="detail-role">本地订单</div></div><button class="modal-close" id="modalClose">✕</button></div><div class="task-modal-section"><input id="orderFormOrderNo" placeholder="订单号" value="${escapeAttr(o.orderNo || "")}" /><input id="orderFormCustomer" placeholder="客户名称" value="${escapeAttr(o.customerName || "")}" /><input id="orderFormProduct" placeholder="商品" value="${escapeAttr(o.product || "")}" /><input id="orderFormQty" type="number" min="1" placeholder="数量" value="${escapeHtml(o.qty || 1)}" /><input id="orderFormAmount" type="number" step="0.01" placeholder="金额" value="${escapeHtml(o.amount || 0)}" /><input id="orderFormChannel" placeholder="渠道" value="${escapeAttr(o.channel || "")}" /><select id="orderFormStatus">${["pending","shipped","completed","cancelled"].map(s => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}</select><input id="orderFormTracking" placeholder="物流单号" value="${escapeAttr(o.trackingNo || "")}" /></div><div class="task-modal-foot"><button class="btn" id="orderCancel">取消</button><button class="btn btn-primary" id="orderSave">保存</button></div>`;
  overlay.classList.add("show");
  document.getElementById("modalClose").onclick = closeModal;
  const cancelBtn = document.getElementById("orderCancel");
  if (cancelBtn) cancelBtn.onclick = closeModal;
  document.getElementById("orderSave").onclick = async () => {
    const payload = { orderNo: document.getElementById("orderFormOrderNo").value.trim(), customerName: document.getElementById("orderFormCustomer").value.trim(), product: document.getElementById("orderFormProduct").value.trim(), qty: Number(document.getElementById("orderFormQty").value), amount: Number(document.getElementById("orderFormAmount").value), channel: document.getElementById("orderFormChannel").value.trim(), status: document.getElementById("orderFormStatus").value, trackingNo: document.getElementById("orderFormTracking").value.trim() };
    if (!payload.orderNo) { showToast("订单号不能为空"); return; }
    try { if (order) { await apiJson("/api/orders/" + order.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } else { await apiJson("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); } closeModal(); showToast("订单已保存"); await loadOrdersFromServer(); } catch (e) { showToast("保存失败：" + e.message); }
  };
}
function bindOrderControls() {
  const search = document.getElementById("orderSearch");
  const status = document.getElementById("orderStatus");
  const add = document.getElementById("addOrderBtn");
  if (search) search.addEventListener("input", () => { ORDER_FILTER.search = search.value.trim(); ORDER_FILTER.offset = 0; loadOrdersFromServer(); });
  if (status) status.addEventListener("change", () => { ORDER_FILTER.status = status.value; ORDER_FILTER.offset = 0; loadOrdersFromServer(); });
  if (add) add.addEventListener("click", () => openOrderModal(null));
}
//  知识库（RAG）
// ================================================================
const KB_DOCS = [
  // 初始为空，启动后由 loadKBFilesFromServer() 从后端拉取真实文件覆盖
];

const FILE_COLORS = { pdf: "#fb7185", docx: "#60a5fa", xlsx: "#34d399", csv: "#fbbf24", txt: "#7e85a3", md: "#a855f7" };
const KB_STATUS = { ready: "已就绪", processing: "索引中", failed: "失败", not_indexed: "未索引", uploading: "上传中" };

function initKnowledge() {
  const total = KB_DOCS.length;
  const ready = KB_DOCS.filter(d => d.status === "ready").length;
  const chunks = KB_DOCS.reduce((s, d) => s + (d.chunks || 0), 0);
  const processing = KB_DOCS.filter(d => d.status === "uploading" || d.status === "processing").length;

  document.getElementById("kbStats").innerHTML = [
    { label: "文档总数", value: total, sub: "已上传", color: "var(--brand)" },
    { label: "已索引", value: ready, sub: "可检索", color: "var(--success)" },
    { label: "文本块", value: chunks, sub: "chunks", color: "var(--info)" },
    { label: "处理中", value: processing, sub: "上传队列", color: "var(--warning)" },
  ].map(s => `
    <div class="kb-stat" style="--stat-color:${safeCssColor(s.color)}">
      <div class="kb-stat-label">${escapeHtml(s.label)}</div>
      <div class="kb-stat-value">${escapeHtml(s.value)}</div>
      <div class="kb-stat-sub">${escapeHtml(s.sub)}</div>
    </div>
  `).join("");

  renderKBList();

  // 上传按钮 → 隐藏 file input（真实读取文件名/大小）
  const fileInput = document.getElementById("kbFileInput");
  document.getElementById("kbUploadBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = [...fileInput.files];
    if (files.length) addKBFiles(files);
    fileInput.value = "";
  });

  // 拖拽区
  const dz = document.getElementById("kbDropzone");
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const files = [...e.dataTransfer.files];
    if (files.length) addKBFiles(files);
  });
}

function addKBFiles(files) {
  // 先把每个文件以「上传中」状态塞进列表，给用户即时反馈
  const pending = files.map(f => {
    const ext = f.name.split(".").pop().toLowerCase();
    return {
      name: f.name,
      type: ext,
      size: f.size > 1048576 ? (f.size / 1048576).toFixed(1) + " MB" : (f.size / 1024).toFixed(0) + " KB",
      status: "uploading",
      progress: 0,
      chunks: 0,
      color: FILE_COLORS[ext] || "var(--brand)",
      _file: f, // 暂存 File 对象，上传用
    };
  });
  KB_DOCS.unshift(...pending);
  renderKBList();
  initKnowledge();
  showToast(`正在上传 ${files.length} 个文档…`);
  uploadKBFiles(pending);
}

/** 真实上传：FormData POST /api/kb/upload，成功后用后端真相覆盖列表 */
async function uploadKBFiles(pending) {
  const fd = new FormData();
  pending.forEach(d => fd.append("files", d._file));
  try {
    const resp = await fetch(`${API_BASE}/api/kb/upload`, { method: "POST", body: fd });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    showToast(`✅ 已上传 ${data.files.length} 个文档，md/txt 已进索引`);
    await loadKBFilesFromServer();
  } catch (e) {
    // 失败：把这几条标为失败
    pending.forEach(d => { d.status = "failed"; });
    renderKBList();
    initKnowledge();
    showToast(`❌ 上传失败：${e.message}`);
  }
}

function renderKBList() {
  const list = document.getElementById("kbList");
  list.innerHTML = KB_DOCS.map((d, i) => {
    const color = FILE_COLORS[d.type] || d.color || "var(--brand)";
    const ext = d.type.toUpperCase().slice(0, 4);
    let right = "";
    if (d.status === "uploading" || d.status === "processing") {
      right = `
        <span class="kb-status-chip kb-status-processing">${KB_STATUS.uploading || KB_STATUS.processing}</span>
      `;
    } else if (d.status === "not_indexed") {
      right = `<span class="kb-status-chip kb-status-failed">${KB_STATUS.not_indexed}</span>`;
    } else if (d.status === "ready") {
      right = `<span class="kb-status-chip kb-status-ready">${KB_STATUS.ready}</span>`;
    } else {
      right = `<span class="kb-status-chip kb-status-failed">${KB_STATUS.failed}</span>`;
    }
    const meta = d.status === "uploading" ? `${d.size} · 上传中…`
      : d.chunks ? `${d.size} · ${d.chunks} 块 · ${d.type.toUpperCase()}`
      : `${d.size} · ${d.type.toUpperCase()}`;
    return `
      <li class="kb-item" data-i="${i}">
        <span class="kb-file-icon" style="--file-color:${color}">${escapeHtml(ext)}</span>
        <div class="kb-file-info">
          <div class="kb-file-name">${escapeHtml(d.name)}</div>
          <div class="kb-file-meta">${escapeHtml(meta)}</div>
        </div>
        ${right}
        <button class="kb-item-del" data-i="${i}" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </li>
    `;
  }).join("");

  list.querySelectorAll(".kb-item-del").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const i = +btn.dataset.i;
      const name = KB_DOCS[i].name;
      // 立即从本地移除给出反馈，失败再恢复
      const removed = KB_DOCS.splice(i, 1)[0];
      renderKBList();
      initKnowledge();
      try {
        const resp = await fetch(`${API_BASE}/api/kb/files/${encodeURIComponent(name)}`, { method: "DELETE" });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        showToast(`已删除「${name}」`);
        await loadKBFilesFromServer();
      } catch (e) {
        KB_DOCS.splice(i, 0, removed); // 恢复
        renderKBList();
        initKnowledge();
        showToast(`❌ 删除失败：${e.message}`);
      }
    });
  });
}

function simulateVectorize() {
  // 保留函数体（历史调用方可能引用），但真实上传走 uploadKBFiles，不再用此模拟
  const tick = setInterval(() => {
    let active = false;
    KB_DOCS.forEach(d => {
      if (d.status === "processing") {
        active = true;
        d.progress = (d.progress || 0) + Math.random() * 18;
        if (d.progress >= 100) {
          d.progress = 100;
          d.status = "ready";
          d.chunks = Math.floor(Math.random() * 20) + 5;
        }
      }
    });
    renderKBList();
    if (!active) {
      clearInterval(tick);
      initKnowledge();
      showToast("索引完成，文档已可检索");
    }
  }, 600);
}

/** 从后端拉取真实知识库文件列表，覆盖本地 KB_DOCS */
async function loadKBFilesFromServer() {
  try {
    const resp = await fetch(`${API_BASE}/api/kb/files`);
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    KB_DOCS.length = 0;
    KB_DOCS.push(...(data.files || []).map(f => ({
      name: f.name,
      type: f.name.split(".").pop().toLowerCase(),
      size: f.size > 1048576 ? (f.size / 1048576).toFixed(1) + " MB" : (f.size / 1024).toFixed(0) + " KB",
      status: f.indexed ? "ready" : "not_indexed",
      chunks: f.chunks || 0,
      color: FILE_COLORS[f.name.split(".").pop().toLowerCase()] || "var(--brand)",
    })));
    renderKBList();
    initKnowledge();
    return KB_DOCS;
  } catch (e) {
    showToast(`⚠ 知识库文件列表拉取失败：${e.message}`);
    return [];
  }
}

// ================================================================
//  设置页
// ================================================================
const SETTINGS = [
  {
    title: "模型路由", icon: '<path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
    desc: "由后端环境变量 OPENCLAW_DIRECT_MODEL 与 provider 配置决定",
    rows: [
      { type: "readonly", label: "当前后端模型", value: () => healthState.model || "未配置模型" },
      { type: "readonly", label: "直连 Provider", value: () => healthState.providerBaseUrl || "未配置直连 Provider" },
      { type: "readonly", label: "Gateway 兜底", value: () => healthState.gatewayUrl || "未配置 Gateway" },
      { type: "readonly", label: "配置状态", value: () => healthState.directConfigured ? "直连已配置" : "直连未配置，将依赖 Gateway/兜底" },
    ],
  },
  {
    title: "渠道接入", icon: '<path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z"/>',
    desc: "飞书 / n8n / Webhook 联动",
    rows: [
      { key: "feishu_webhook", type: "input", label: "飞书 Webhook URL", placeholder: "https://open.feishu.cn/...", value: "" },
      { key: "n8n_callback", type: "input", label: "n8n Callback URL", placeholder: "https://n8n.example.com/webhook", value: "" },
      { key: "feishu_cmd", type: "toggle", label: "开启飞书群指令入口", value: true },
      { key: "roas_alert", type: "toggle", label: "ROAS 低于阈值自动预警", value: true },
    ],
  },
  {
    title: "沙箱与安全", icon: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z"/>',
    desc: "系统级操作隔离与防护",
    rows: [
      { key: "browser_sandbox", type: "toggle", label: "Browser Automation 沙箱模式", value: true },
      { key: "env_iso", type: "toggle", label: "社媒账号环境隔离", value: true },
      { key: "dm_guard", type: "toggle", label: "DM 陌生消息 pairing 防护", value: true },
      { key: "sandbox_backend", type: "select", label: "沙箱后端", options: ["Docker（默认）", "SSH", "OpenShell"], value: "Docker（默认）" },
    ],
  },
  {
    title: "数据与记忆", icon: '<path d="M4 4v16a2 2 0 0 0 2 2h14M4 4h12a2 2 0 0 1 2 2v14M4 4a2 2 0 0 1 2-2h10M8 8h6M8 12h6M8 16h4"/>',
    desc: "知识沉淀与记忆清理",
    rows: [
      { key: "auto_agents_md", type: "toggle", label: "飞书群讨论自动写入 AGENTS.md", value: true },
      { key: "weekly_digest", type: "toggle", label: "每周五自动生成知识沉淀周报", value: true },
      { type: "btn", label: "memory/ 记忆条目", hint: "自动清理策略尚未接入；memory/ 为人工维护的长期记录", btnText: "待接入", disabled: true, btnIcon: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' },
      { type: "btn", label: "openclaw doctor 自检", hint: "检查配置一致性、DM 策略、路径", btnText: "运行自检", btnIcon: '<path d="M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"/>' },
    ],
  },
];

let settingsState = {};
let healthState = {};

function resolveRowValue(row, fallback = "") {
  return typeof row.value === "function" ? row.value() : (row.value ?? fallback);
}

function getSettings() { return settingsState || {}; }
async function setSetting(key, val) {
  settingsState[key] = val;
  const data = await apiJson("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value: val }),
  });
  settingsState = data.data || settingsState;
}
function settingVal(row) {
  const s = getSettings();
  return key => s[key] !== undefined ? s[key] : row.value;
}

function initSettings() {
  const s = getSettings();
  document.getElementById("settingsGrid").innerHTML = SETTINGS.map(card => `
    <div class="settings-card">
      <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${card.icon}</svg>${escapeHtml(card.title)}</h3>
      <p class="sc-desc">${escapeHtml(card.desc)}</p>
      ${card.rows.map((r) => {
        let control = "";
        const val = r.key && s[r.key] !== undefined ? s[r.key] : resolveRowValue(r);
        const key = escapeAttr(r.key || "");
        if (r.type === "readonly") {
          control = `<span class="settings-readonly">${escapeHtml(resolveRowValue(r, "—"))}</span>`;
        } else if (r.type === "select") {
          control = `<select class="settings-select" data-key="${key}">${(r.options || []).map(o => `<option ${o === val ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
        } else if (r.type === "input") {
          control = `<input class="settings-input" type="text" data-key="${key}" placeholder="${escapeAttr(r.placeholder || "")}" value="${escapeAttr(val || "")}" />`;
        } else if (r.type === "toggle") {
          control = `<div class="settings-toggle ${val ? "on" : ""}" data-key="${key}" data-on="${val ? "true" : "false"}"></div>`;
        } else if (r.type === "btn") {
          control = `<button class="settings-btn" data-btn="${escapeAttr(r.btnText)}" ${r.disabled ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${r.btnIcon}</svg>${escapeHtml(r.btnText)}</button>`;
        }
        return `
          <div class="settings-row">
            <div>
              <div class="settings-row-label">${escapeHtml(r.label)}</div>
              ${r.hint ? `<div class="settings-row-hint">${escapeHtml(r.hint)}</div>` : ""}
            </div>
            ${control}
          </div>
        `;
      }).join("")}
    </div>
  `).join("");

  // 开关
  document.querySelectorAll(".settings-toggle").forEach(t => {
    t.addEventListener("click", () => {
      t.classList.toggle("on");
      const on = t.classList.contains("on");
      if (t.dataset.key) {
        setSetting(t.dataset.key, on)
          .then(() => showToast(`「${t.closest(".settings-card").querySelector("h3").textContent}」已${on ? "开启" : "关闭"}`))
          .catch(e => showToast(`保存失败：${e.message}`));
      }
    });
  });
  // 下拉
  document.querySelectorAll(".settings-select").forEach(sel => {
    sel.addEventListener("change", () => {
      if (sel.dataset.key) {
        setSetting(sel.dataset.key, sel.value)
          .then(() => showToast(`已保存：${sel.value}`))
          .catch(e => showToast(`保存失败：${e.message}`));
      }
    });
  });
  // 输入
  document.querySelectorAll(".settings-input").forEach(inp => {
    inp.addEventListener("change", () => {
      if (inp.dataset.key) {
        setSetting(inp.dataset.key, inp.value)
          .then(() => showToast(`已保存配置`))
          .catch(e => showToast(`保存失败：${e.message}`));
      }
    });
  });
  // 按钮
  document.querySelectorAll(".settings-btn").forEach(b => {
    b.addEventListener("click", () => {
      const t = b.dataset.btn;
      if (b.disabled || t === "待接入") {
        showToast("memory/ 自动清理待接入：当前不会修改长期记忆记录");
      } else if (t === "运行自检") {
        loadHealthStatus(true);
      } else {
        showToast(`「${t}」已触发`);
      }
    });
  });
}

// ================================================================
//  Agent 状态/技能持久化：由后端 SQLite 负责
// ================================================================
async function saveAgentStatus(agent) {
  return apiJson(`/api/agents/${encodeURIComponent(agent.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: agent.status }),
  });
}
async function saveAgentSkill(agent, skillIndex) {
  return apiJson(`/api/agents/${encodeURIComponent(agent.id)}/skills/${encodeURIComponent(skillIndex)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: !!agent.skills[skillIndex].on }),
  });
}

// ================================================================
//  真实执行模式：桥接 OpenClaw 后端（v0.2）
//  后端: http://localhost:3001 (server\index.js)
// ================================================================
const API_BASE = ""; // 同源：Express 托管前端，前后端同端口，用相对路径

async function apiJson(url, options = {}) {
  const resp = await fetch(`${API_BASE}${url}`, { credentials: "same-origin", ...options });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401 && !url.startsWith("/api/auth/")) {
    window.location.href = "/login.html";
    throw new Error("请先登录");
  }
  if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

async function loadHealthStatus(showResult = false) {
  const el = document.getElementById("healthStatusText");
  const chip = document.getElementById("modelChip");
  try {
    const data = await apiJson("/api/health");
    healthState = data || {};
    if (el) el.textContent = data.ok ? "后端已连接" : "后端状态异常";
    if (chip) {
      chip.textContent = data.model || "未配置模型";
      chip.title = [
        `当前后端模型：${data.model || "未配置"}`,
        `Provider：${data.providerBaseUrl || "未配置"}`,
        `Gateway：${data.gatewayUrl || "未配置"}`,
        `直连状态：${data.directConfigured ? "已配置" : "未配置"}`,
      ].join("\n");
    }
    if (document.getElementById("settingsGrid")) initSettings();
    if (showResult) {
      showToast(data.ok ? "✅ 后端 API 可达" : "⚠ 后端状态异常");
      pushFeed("合规", data.ok ? "#34d399" : "#fbbf24", data.ok ? "真实自检：后端 API 可达" : "真实自检：后端状态异常");
    }
  } catch (e) {
    healthState = {};
    if (el) el.textContent = "后端不可用";
    if (chip) {
      chip.textContent = "模型未知";
      chip.title = `后端自检失败：${e.message}`;
    }
    if (document.getElementById("settingsGrid")) initSettings();
    if (showResult) showToast(`❌ 后端自检失败：${e.message}`);
  }
}

async function loadDashboardData() {
  const data = await apiJson("/api/dashboard");
  const d = data.data || {};
  AGENTS = d.agents || [];
  KPIS = d.kpis || [];
  LEADS = d.leads || [];
  REPORTS = d.reports || [];
  RUNS = { items: d.runs || [], total: (d.runs || []).length };
  settingsState = d.settings || {};
  feedItems.length = 0;
  feedItems.push(...(d.activity || []));
}

async function readCommandStream(resp, onDelta, onStatus) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let currentEvent = "";
    let commandId = null;
    let content = "";
    let approval = null;
    let needsApproval = false;

    const handleEvent = (event, payload) => {
      if (event === "accepted") {
        commandId = payload.commandId;
        if (typeof onStatus === "function") onStatus({ status: "queued", commandId });
      } else if (event === "delta") {
        const delta = payload.content || "";
        content += delta;
        if (typeof onDelta === "function") onDelta(delta);
      } else if (event === "complete") {
        if (payload.status === "error") {
          reject(new Error(payload.error || "执行失败"));
          return;
        }
        content = payload.content || content;
        approval = payload.approval || null;
        needsApproval = !!payload.approvalId || !!payload.needsApproval;
      } else if (event === "done") {
        resolve({ content, approval, needsApproval });
      }
    };

    const decoder = new TextDecoder("utf-8");
    const reader = resp.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (!data) continue;
            try { handleEvent(currentEvent, JSON.parse(data)); }
            catch (_) {}
          }
        }
      }
      if (content) resolve({ content, approval, needsApproval });
      else reject(new Error("指令流连接已中断"));
    };
    pump().catch(reject);
  });
}

/** 调后端提交异步指令并解析流式结果，返回兼容旧调用的 {content, approval, needsApproval} */
async function callBackend(command, onStatus, onDelta) {
  const resp = await fetch(`${API_BASE}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, agentId: "main", sessionId: "ecommerce-console", stream: true }),
  });
  const contentType = String(resp.headers.get("content-type") || "");
  if (resp.ok && contentType.includes("text/event-stream")) {
    return readCommandStream(resp, onDelta, onStatus);
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
  const submitted = data;
  const commandId = submitted.commandId;
  if (!commandId) throw new Error("后端未返回 commandId");

  const startedAt = Date.now();
  const timeoutMs = 120000;
  while (Date.now() - startedAt < timeoutMs) {
    await delay(1500);
    const polled = await apiJson(`/api/commands/${encodeURIComponent(commandId)}`);
    const job = polled.data || {};
    if (typeof onStatus === "function") onStatus(job);
    if (job.status === "ok") {
      return { content: job.content || "", approval: job.approval || null, needsApproval: !!job.needsApproval };
    }
    if (job.status === "error") throw new Error(job.error || "执行失败");
  }
  throw new Error(`后台仍在处理中，请稍后查看命令 #${commandId}`);
}

/** 把后端审批条目规范化为前端展示对象 */
function normalizeApproval(ap) {
  if (!ap) return null;
  const type = ACTION_TO_TYPE[ap.action] || ap.type || "reply";
  const meta = APPROVAL_META[type] || APPROVAL_META.reply;
  return {
    id: ap.id,                       // 保留后端原 ID（如 "AP-003"）
    type,
    agent: null,
    agentName: ap.agentName || "运营总监",
    title: ap.title || ap.command || "未命名动作",
    summary: ap.summary || (ap.command ? `指令：${ap.command}` : "OpenClaw 生成的草稿，待人工审批后执行"),
    risk: ap.risk || "对外动作，需人工确认后归档",
    created: ap.created || (ap.createdAt
      ? new Date(ap.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "--:--"),
    status: ap.status || "pending",
    draft: ap.draft || "（无草稿）",
    command: ap.command || "",
    _meta: meta,
  };
}

/** 把单条真实审批条目并入前端 APPROVALS（去重） */
function mergeRealApproval(ap) {
  if (!ap) return null;
  const newAp = normalizeApproval(ap);
  // 去重：同 ID 不重复插入
  if (!APPROVALS.find(x => x.id === newAp.id)) {
    APPROVALS.unshift(newAp);
  }
  renderApprovalBadge();
  if (currentView === "approval") renderApprovals();
  return newAp;
}

/** 从后端拉取全部审批条目，覆盖本地 */
async function loadApprovalsFromServer() {
  try {
    const resp = await fetch(`${API_BASE}/api/approvals`);
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    const incoming = (data.data || []).map(normalizeApproval);
    APPROVALS = incoming.map(n => {
      const existing = APPROVALS.find(x => x.id === n.id);
      return existing && existing._deciding ? { ...n, _deciding: true } : n;
    });
    renderApprovalBadge();
    if (currentView === "approval") renderApprovals();
    return APPROVALS;
  } catch (e) {
    showToast(`⚠ 审批数据拉取失败：${e.message}`);
    return [];
  }
}

// \u771F\u5B9E\u6267\u884C runCommand\uFF1A\u5C55\u793A\u540E\u7AEF Agent \u7F16\u6392\u6B65\u9AA4\uFF0C\u4E0D\u518D\u4F7F\u7528\u524D\u7AEF\u6A21\u62DF\u6B65\u9AA4
async function runCommand(cmd, opts = {}) {
  const { agentIdx: presetAgent, tag: presetTag, color: presetColor } = opts;
  const detectedAction = detectAction(cmd);
  const route = routeCommand(cmd);
  const agentIdx = presetAgent != null ? presetAgent : route.agentIdx;
  const tag = presetTag || route.tag;
  const color = presetColor || route.color;

  consoleState.steps = [{ label: '\u6307\u4EE4', text: cmd, tag: '\u8F93\u5165', color: '#6366f1', done: true }];
  renderConsole();
  consoleState.running = true;

  const push = (label, text, tagName = tag, done = false) => {
    consoleState.steps.push({ label, text, tag: tagName, color, done });
    renderConsole();
  };

  try {
    push('\u8DEF\u7531', detectedAction ? '\u8BC6\u522B\u5230\u5BF9\u5916\u52A8\u4F5C\uFF0C\u5DF2\u8FDB\u5165\u5BA1\u6279\u95F8\u95E8\uFF0C\u7B49\u5F85\u540E\u7AEF\u751F\u6210\u5BA1\u6279\u8349\u7A3F\u3002' : '\u5DF2\u63D0\u4EA4\u7ED9\u8FD0\u8425\u603B\u76D1\uFF0C\u540E\u7AEF Agent \u6B63\u5728\u62C6\u89E3\u4EFB\u52A1\u3002', '\u8DEF\u7531', true);
    push('\u6267\u884C', '\u6307\u4EE4\u5DF2\u5165\u961F\uFF0C\u7B49\u5F85 Agent \u7F16\u6392\u5668\u8FD4\u56DE\u771F\u5B9E\u6B65\u9AA4\u3002', tag, false);
    pushFeed(tag, color, `\u63D0\u4EA4\u5F02\u6B65\u6307\u4EE4\uFF1A${cmd.slice(0, 30)}`);

    const result = await callBackend(cmd, (job) => {
      if (job.run && Array.isArray(job.run.steps)) {
        const base = [{ label: '\u6307\u4EE4', text: cmd, tag: '\u8F93\u5165', color: '#6366f1', done: true }];
        for (const s of job.run.steps) {
          base.push({
            label: s.label || s.kind || '\u6B65\u9AA4',
            text: s.output || s.input || '\u6267\u884C\u4E2D\u2026',
            tag: s.tool || s.kind || 'agent',
            color: '#6366f1',
            done: s.status === 'done' || s.status === 'error',
          });
        }
        consoleState.steps = base;
        renderConsole();
      }
    }, (delta) => {
      const finalStep = consoleState.steps[consoleState.steps.length - 1];
      if (finalStep && finalStep.label === '\u4EA7\u51FA') {
        finalStep.text = (finalStep.text || '') + delta;
        renderConsoleOutput();
      } else {
        consoleState.steps.push({ label: '\u4EA7\u51FA', text: delta, tag: '\u7ED3\u679C', color, done: false });
        renderConsole();
      }
    });

    if (!consoleState.steps.some(s => s.kind === 'tool' || s.tool)) {
      const execStep = consoleState.steps[consoleState.steps.length - 1];
      execStep.done = true;
      execStep.text = result.needsApproval
        ? '\u5DF2\u751F\u6210\u6267\u884C\u65B9\u6848\uFF0C\u7B49\u5F85\u4EBA\u5DE5\u5BA1\u6279\uFF08\u5BF9\u5916\u52A8\u4F5C\u4E0D\u81EA\u52A8\u6267\u884C\uFF09'
        : 'Agent \u7F16\u6392\u6267\u884C\u5B8C\u6210';
    }
    renderConsole();

    if (result.approval) {
      const ap = mergeRealApproval(result.approval);
      push('\u5BA1\u6279', `\u5DF2\u751F\u6210\u5BA1\u6279\u6761\u76EE ${ap ? ap.id : ''}\uFF1A${result.approval.title}`, '\u5BA1\u6279', true);
      renderConsole();
      showToast(`\u68C0\u6D4B\u5230\u5BF9\u5916\u52A8\u4F5C\uFF0C\u5DF2\u751F\u6210\u5BA1\u6279\u6761\u76EE ${result.approval.id}`);
    }

    const existingOutput = consoleState.steps.find(s => s.label === '\u4EA7\u51FA');
    if (existingOutput) {
      existingOutput.done = true;
      existingOutput.text = result.content;
      renderConsole();
    } else {
      push('\u4EA7\u51FA', result.content, '\u7ED3\u679C', true);
    }
    addReport({ agent: agentIdx, title: cmd.slice(0, 24) + (cmd.length > 24 ? '\u2026' : ''), tag, color, content: result.content });
    try { await loadDashboardData(); renderAgentRuns(); } catch (e) { showToast("刷新数据失败：" + e.message); }
  } catch (e) {
    push('\u9519\u8BEF', `\u6267\u884C\u5931\u8D25\uFF1A${e.message}`, '\u9519\u8BEF', true);
    showToast(`\u6267\u884C\u5931\u8D25\uFF1A${e.message}`);
    if (e.message.includes('\u540E\u7AEF') || e.message.includes('fetch')) {
      push('\u964D\u7EA7', '\u540E\u7AEF\u4E0D\u53EF\u7528\uFF0C\u8BF7\u786E\u8BA4 server \u670D\u52A1\u5DF2\u542F\u52A8 (node server/index.js)', '\u8B66\u544A', true);
    }
  } finally {
    consoleState.running = false;
    renderConsole();
  }
}
//  知识库检索（kb-query）：客服 RAG 问答
// ================================================================
async function runKbQuery(question) {
  // 写入指令回显
  consoleState.steps = [{ label: "指令", text: question, tag: "客服", color: "#34d399", done: true }];
  renderConsole();
  consoleState.running = true;

  const push = (label, text, tagName = "客服", done = false) => {
    consoleState.steps.push({ label, text, tag: tagName, color: "#34d399", done });
    renderConsole();
  };

  try {
    push("路由", "识别为客服 RAG 问答 → 调用 kb-query 技能", "路由", false);
    await delay(300 + pseudoRand() * 200);
    consoleState.steps[consoleState.steps.length - 1].done = true;
    renderConsole();

    push("检索", "知识库分块检索中…", "客服", false);
    renderConsole();
    pushFeed("客服", "#34d399", `RAG 检索：${question.slice(0, 24)}`);

    const resp = await fetch(`${API_BASE}/api/kb-query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    const step = consoleState.steps[consoleState.steps.length - 1];
    step.done = true;
    const srcList = (data.sources || []).map(s => `${s.file}·${s.heading}`).join("；") || "无命中";
    step.text = `命中 ${data.sources ? data.sources.length : 0} 个片段：${srcList}`;
    renderConsole();

    // 来源引用展示
    if (data.sources && data.sources.length) {
      push("来源", data.sources.map(s => `📄 ${s.file}·${s.heading}（score ${s.score}）`).join("\n"), "引用", true);
      renderConsole();
    }

    // 最终答复
    push("答复", data.answer, "结果", true);
    addReport({ agent: 3, title: "客服 RAG：" + question.slice(0, 18), tag: "客服", color: "#34d399", content: data.answer });
    showToast("✅ 知识库检索完成，已生成带来源引用的答复草稿");
  } catch (e) {
    push("错误", `检索失败：${e.message}`, "错误", true);
    showToast(`❌ kb-query 失败：${e.message}`);
  } finally {
    consoleState.running = false;
    renderConsole();
  }
}

// ================================================================
//  初始化
// ================================================================
async function bootstrap() {
  const user = await loadUser();
  if (!user) return;
  await loadRulesFromServer();
  await loadHealthStatus();
  try { await loadDashboardData(); }
  catch (e) { showToast(`⚠ 仪表盘数据加载失败：${e.message}`); }
  renderKPI();
  renderAgentGrid();
  renderFeed();

  renderReports();
  await loadAgentRuns();
  renderQuickCmds();
  renderConsole();
  renderApprovalBadge();
  updateOnlineCount();
  initKnowledge();
  initSettings();
  bindExportLeads();
  bindOrderControls();
  loadOrdersFromServer();
  await loadApprovalsFromServer();
  await loadKBFilesFromServer();
}
bootstrap();
// 每 30s 轮询一次审批数据，保证多端同步 & 徽标新鲜
setInterval(() => { if (!document.hidden) loadApprovalsFromServer(); }, 30000);
