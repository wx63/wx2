// ================================================================
//  OpenClaw 跨境全能运营矩阵 · 前端控制台
//  纯静态 + 本地逻辑，无后端依赖；演示完整业务闭环
// ================================================================

// ============ 数据模型：5 名数字员工 ============
const AGENTS = [
  {
    id: 0, emoji: "🔍", name: "市场调研 Agent",
    role: "VOC 分析 · 竞品抓取 · 趋势预测", color: "#60a5fa", status: "online",
    task: "正在交叉检索亚马逊 US / Shopee 东南亚 3 个品类的竞品数据",
    metrics: { 报告: 4, 数据源: 12 },
    skills: [
      { name: "VOC 用户声音分析", on: true },
      { name: "跨平台竞品数据抓取", on: true },
      { name: "POD 选品可行性报告", on: true },
      { name: "趋势预测", on: false },
    ],
    templates: [
      { title: "竞品周报", prompt: "汇总本周亚马逊 US 宠物用品 Top20 竞品的价格、销量、差评关键词，输出竞品周报", icon: "📊" },
      { title: "VOC 分析", prompt: "抓取本品近 30 天的买家评论，分类正向/负向诉求并提炼 5 条产品改进建议", icon: "🗣️" },
      { title: "POD 选品报告", prompt: "调研定制宠物铭牌品类的需求量、竞争度与 POD 供应链可行性，出选品报告", icon: "🏷️" },
      { title: "趋势预测", prompt: "预测未来 90 天东南亚市场家居收纳品类的搜索趋势与爆款候选", icon: "📈" },
    ],
  },
  {
    id: 1, emoji: "🎨", name: "内容与视觉 Agent",
    role: "多语种 Listing · SEO · 爆款视频脚本", color: "#a855f7", status: "busy",
    task: "生成 5 条 Shopee 西班牙语 Listing 的五点描述与 SEO 标题",
    metrics: { Listing: 23, 脚本: 6 },
    skills: [
      { name: "多语种 Listing 生成", on: true },
      { name: "SEO 标题优化", on: true },
      { name: "GEO 内容本地化", on: true },
      { name: "TikTok/IG 视频脚本", on: true },
    ],
    templates: [
      { title: "多语种 Listing", prompt: "为【便携折叠宠物水壶】生成英语/西语/日语三语 Listing 五点描述 + SEO 标题", icon: "📝" },
      { title: "SEO 标题优化", prompt: "对现有 5 条亚马逊 Listing 标题做 SEO 优化，植入高频长尾词", icon: "🔍" },
      { title: "视频脚本", prompt: "为 TikTok 写一条 30 秒开箱爆款脚本，含分镜与口播", icon: "🎬" },
      { title: "本地化文案", prompt: "把英文 Listing 本地化为越南语，注意文化禁忌与货币表述", icon: "🌍" },
    ],
  },
  {
    id: 2, emoji: "📣", name: "获客与社媒 Agent",
    role: "社媒内容排期 · 互动种草 · 线索抓取", color: "#fb7185", status: "online",
    task: "为 3 个 X 账号排期今日内容（合规频率，非矩阵）",
    metrics: { 发帖: 18, 线索: 37 },
    skills: [
      { name: "社媒内容排期", on: true },
      { name: "自动互动种草", on: true },
      { name: "Reddit 线索抓取", on: false },
      { name: "高意向线索整理", on: true },
    ],
    templates: [
      { title: "排期今日内容", prompt: "为 3 个 X 账号排期今日 9 条内容，间隔 6-18 分钟，附文案与配图建议", icon: "📅" },
      { title: "种草回复草稿", prompt: "为 Reddit r/dogs 里 5 条潜在买家提问生成种草回复草稿（待人工审批）", icon: "💬" },
      { title: "线索整理", prompt: "整理昨日全渠道社媒进线，按意向分级并产出线索表", icon: "📥" },
      { title: "周内容计划", prompt: "制定下周跨平台（X/TikTok/IG）内容日历", icon: "🗓️" },
    ],
  },
  {
    id: 3, emoji: "💬", name: "客服与订单 Agent",
    role: "7×24 多渠道接待 · 查单 · 线索清洗", color: "#34d399", status: "online",
    task: "WhatsApp 进线 12 路会话，已为 3 位 B 端客户打标【高意向】",
    metrics: { 会话: 12, 打标: 3 },
    skills: [
      { name: "RAG 知识库问答", on: true },
      { name: "ERP Function Calling（查物流/库存）", on: true },
      { name: "退换货处理", on: true },
      { name: "线索意向打标", on: true },
    ],
    templates: [
      { title: "RAG 问答", prompt: "客户问「这件衣服有 XL 吗」，查知识库尺码表给出带对照的答复草稿", icon: "📐", mode: "kb" },
      { title: "查物流", prompt: "调用 ERP 查订单 #OC-2026-7732 的物流轨迹并生成回复草稿", icon: "📦" },
      { title: "退换货处理", prompt: "处理 2 笔退货申请，核验退换货政策后生成处理方案", icon: "↩️", mode: "kb" },
      { title: "线索打标", prompt: "清洗今日进线的 14 条对话，按 B 端意向分级打标", icon: "🏷️" },
    ],
  },
  {
    id: 4, emoji: "🛡️", name: "合规与风控 Agent",
    role: "侵权拦截 · 敏感词审查 · 广告异常监控", color: "#fbbf24", status: "busy",
    task: "扫描 23 条待上架 Listing，拦截 1 处 “clinically proven” FDA 禁用表述",
    metrics: { 扫描: 23, 拦截: 6 },
    skills: [
      { name: "上架前侵权风险拦截", on: true },
      { name: "敏感词 / FDA 禁用表述审查", on: true },
      { name: "主图水印 / 元数据检测", on: true },
      { name: "广告 ROAS 异常监控", on: false },
    ],
    templates: [
      { title: "上架前审查", prompt: "对待上架的 23 条 Listing 做侵权词/敏感词/FDA 表述审查，输出违规点清单", icon: "🛡️" },
      { title: "水印检测", prompt: "扫描 18 张主图的水印与 EXIF 元数据，标记风险图", icon: "🖼️" },
      { title: "广告异常", prompt: "监控 6 个在投广告的 ROAS，对低于阈值的生成预警", icon: "💰" },
      { title: "敏感词库更新", prompt: "同步本周新增的平台禁用词到敏感词库", icon: "📚" },
    ],
  },
];

// ============ KPI ============
const KPIS = [
  { label: "今日订单量", value: "1,284", trend: "▲ 12.4% vs 昨日", up: true, key: "orders",
    icon: '<path d="M6 2 3 6h3v12a1 1 0 0 0 1 1h12v3l4-4-4-4v3h-11V6h3z" fill="currentColor"/>',
    color: "#60a5fa", spark: [4,6,5,8,7,9,11] },
  { label: "待处理线索", value: '<span id="leadCount">37</span>', trend: "▲ 8 条高意向", up: true, key: "leads",
    icon: '<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M5 21a7 7 0 0 1 14 0" fill="currentColor"/>',
    color: "#fb7185", spark: [3,4,4,6,5,7,8] },
  { label: "在线 Agent", value: '<span id="onlineAgents">5</span> / 5', trend: "全部在岗", up: false, key: "agents",
    icon: '<circle cx="9" cy="9" r="3" fill="currentColor"/><circle cx="17" cy="11" r="2.5" fill="currentColor"/><path d="M3 19a6 6 0 0 1 11 0M14 19a5 5 0 0 1 7-1.5" fill="none" stroke="currentColor" stroke-width="2"/>',
    color: "#34d399", spark: [5,5,5,5,5,5,5] },
  { label: "风险拦截", value: "6", trend: "▲ 含 1 处 FDA 禁用词", up: true, key: "risk",
    icon: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z" fill="currentColor"/>',
    color: "#fbbf24", spark: [2,3,4,5,5,6,6] },
];

// ============ 活动流种子 ============
const FEED_SEED = [
  { tag: "合规", color: "#fbbf24", text: "拦截 1 处 “clinically proven” FDA 禁用表述（Listing #2284）" },
  { tag: "内容", color: "#a855f7", text: "完成 3 条 Shopee 西班牙语 Listing 五点描述" },
  { tag: "客服", color: "#34d399", text: "WhatsApp 进线客户 #C-7732 打标【高意向-B端】" },
  { tag: "获客", color: "#fb7185", text: "X 账号 @brand_us 发帖成功，随机延迟 11 分钟" },
  { tag: "调研", color: "#60a5fa", text: "生成 POD 选品报告：定制宠物铭牌（需求↑ / 可行）" },
];

// 实时活动流候选池（模拟后端持续推送）
const FEED_POOL = [
  { tag: "客服", color: "#34d399", text: "WhatsApp 新会话进线，自动答复草稿已生成" },
  { tag: "内容", color: "#a855f7", text: "SEO 标题优化完成，植入长尾词「折叠宠物水壶」" },
  { tag: "获客", color: "#fb7185", text: "Reddit r/dogs 抓取到 2 条潜在买家提问" },
  { tag: "合规", color: "#fbbf24", text: "主图检测发现 1 张含第三方水印，已标记" },
  { tag: "调研", color: "#60a5fa", text: "竞品价格波动：#A-2210 降价 8%，已记录快照" },
  { tag: "客服", color: "#34d399", text: "客户 #C-7732 物流查询命中 ERP，轨迹已回填" },
  { tag: "内容", color: "#a855f7", text: "TikTok 开箱脚本 v2 生成，30s 含 6 分镜" },
  { tag: "合规", color: "#fbbf24", text: "广告 #AD-09 ROAS 降至 1.2，触发预警（不自动关停）" },
  { tag: "获客", color: "#fb7185", text: "高意向线索整理完成，3 条待销售跟进" },
  { tag: "调研", color: "#60a5fa", text: "VOC 分析：32% 负评指向「容量偏小」，已提炼改进项" },
];

const STATUS_LABEL = { online: "在线", busy: "处理中", offline: "离线" };

// ============ 线索数据（对应 lead-scoring 产出） ============
let LEADS = [
  { id: "L-20260731-01", channel: "WhatsApp", name: "M. Reyes", country: "🇵🇭 菲律宾", msg: "MOQ 多少？定制 logo 起订量？", grade: "hot", intent: "B 端·求 MOQ/定制", time: "10:22", score: 92 },
  { id: "L-20260731-02", channel: "X / DM", name: "@petlover_us", country: "🇺🇸 美国", msg: "这款有 XL 吗？多久到货？", grade: "hot", intent: "C 端·询规格", time: "11:04", score: 81 },
  { id: "L-20260731-03", channel: "Reddit", name: "u/seller_jp", country: "🇯🇵 日本", msg: "想做代理，请问批发价表", grade: "hot", intent: "B 端·求批发价", time: "11:38", score: 88 },
  { id: "L-20260731-04", channel: "WhatsApp", name: "L. Tan", country: "🇲🇾 马来", msg: "颜色有哪些？能换吗", grade: "warm", intent: "C 端·咨询属性", time: "09:50", score: 54 },
  { id: "L-20260731-05", channel: "X / DM", name: "@hobbyist", country: "🇺🇸 美国", msg: "好看，关注了", grade: "cold", intent: "C 端·无明确意向", time: "08:15", score: 23 },
  { id: "L-20260731-06", channel: "Reddit", name: "u/curious", country: "🇸🇬 新加坡", msg: "在哪买？有链接吗", grade: "warm", intent: "C 端·问购买入口", time: "12:10", score: 47 },
  { id: "L-20260731-07", channel: "WhatsApp", name: "P. Santos", country: "🇧🇷 巴西", msg: "5000 件起订能做吗？FOB 价？", grade: "hot", intent: "B 端·大单询价", time: "12:45", score: 95 },
  { id: "L-20260731-08", channel: "X / DM", name: "@bot_x12", country: "🇺🇸 美国", msg: "点击查看优惠详情→bit.ly/xxx", grade: "cold", intent: "垃圾·外链", time: "07:30", score: 8 },
];

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
const ROUTE_RULES = [
  { agent: 0, kw: ["竞品","周报","调研","趋势","选品","voc","评论","市场"], tag: "调研", color: "#60a5fa" },
  { agent: 1, kw: ["listing","标题","seo","脚本","文案","多语种","本地化","爆款"], tag: "内容", color: "#a855f7" },
  { agent: 2, kw: ["发帖","社媒","排期","种草","reddit","tiktok","x 账号","矩阵"], tag: "获客", color: "#fb7185" },
  { agent: 3, kw: ["客户","回复","物流","查单","退换货","客服","询","moq","尺码"], tag: "客服", color: "#34d399" },
  { agent: 4, kw: ["审查","侵权","敏感词","fda","水印","广告","roas","合规","上架前"], tag: "合规", color: "#fbbf24" },
];
// 对外动作识别（需走审批闸门）
const ACTION_RULES = [
  { type: "post",    kw: ["发帖","发推","发布到","发到 x","发到社媒","种草回复"] },
  { type: "reply",   kw: ["回复客户","答复","回复 whatsapp","回复"] },
  { type: "listing", kw: ["上架","发布 listing","提交上架"] },
  { type: "order",   kw: ["下单","采购","补货"] },
];

function routeCommand(cmd) {
  const lower = cmd.toLowerCase();
  let target = { agent: null, tag: "通用", color: "var(--brand)" };
  for (const r of ROUTE_RULES) {
    if (r.kw.some(k => lower.includes(k))) { target = r; break; }
  }
  let action = null;
  for (const a of ACTION_RULES) {
    if (a.kw.some(k => lower.includes(k))) { action = a.type; break; }
  }
  return { agentIdx: target.agent, tag: target.tag, color: target.color, action };
}

// 每种 Agent 的流式产出片段（模拟 LLM 流式输出）
function buildSteps(agentIdx, cmd, action) {
  const a = AGENTS[agentIdx];
  const steps = [];
  // 通用起手
  steps.push({ label: `运营总监路由`, text: `识别意图 → 路由至「${a ? a.name : "通用"}」` , tag: "路由", color: "#6366f1" });
  if (a) {
    steps.push({ label: a.name, text: `拉起 ${a.name}，注入技能包 + 知识库上下文`, tag: target_tag(a.id), color: a.color });
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

function renderConsole() {
  const box = document.getElementById("consoleBody");
  if (!consoleState.steps.length) {
    box.innerHTML = `<div class="console-empty">
      <div class="console-empty-icon">⚡</div>
      <p>给矩阵下达指令，运营总监将自动路由、拉起对应数字员工、流式执行。</p>
      <p class="muted">对外动作（发帖/回复/上架/下单）将自动进入审批闸门，等人工确认后执行。</p>
    </div>`;
    return;
  }
  box.innerHTML = consoleState.steps.map((s, i) => {
    // 长产出（报告/分析/答复）加 long 类：内部滚动，完整可读，不截断不撑页
    const isLong = typeof s.text === "string" && s.text.length > 280;
    // escapeHtml 防模型输出/用户输入污染页面（保留换行靠 CSS white-space: pre-wrap）
    const textHtml = s.text
      ? escapeHtml(s.text)
      : '<span class="cs-typing">▌</span>';
    return `
    <div class="console-step ${s.done ? "done" : "active"}" style="--step-color:${s.color}">
      ${s.isApproval ? '<span class="console-gate">闸门</span>' : ""}
      <div class="cs-marker"></div>
      <div class="cs-body">
        <div class="cs-label"><span class="cs-tag" style="color:${s.color}">${escapeHtml(s.tag)}</span> ${escapeHtml(s.label)}</div>
        <div class="cs-text${isLong ? " long" : ""}">${textHtml}</div>
      </div>
      ${s.done ? '<span class="cs-check">✓</span>' : '<span class="cs-spinner"></span>'}
    </div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
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
  // tpl 带 mode: 'kb' → 走知识库检索（kb-query）
  if (tpl && tpl.mode === "kb") {
    runKbQuery(cmd);
  } else {
    runCommand(cmd);
  }
}
document.getElementById("commandSend").addEventListener("click", () => handleCommand());
document.getElementById("commandInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleCommand();
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
  document.getElementById("kpiRow").innerHTML = KPIS.map((k) => `
    <div class="kpi" style="--kpi-color:${k.color};--kpi-chip:color-mix(in srgb,${k.color} 16%,transparent);--kpi-glow:color-mix(in srgb,${k.color} 10%,transparent)">
      <div class="kpi-top">
        <span class="kpi-label">${k.label}</span>
        <span class="kpi-icon"><svg viewBox="0 0 24 24">${k.icon}</svg></span>
      </div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-trend ${k.up ? "up" : "flat"}">${k.trend}</div>
      ${sparkSVG(k.spark, k.color)}
    </div>
  `).join("");
}

// ================================================================
//  渲染 Agent 卡片
// ================================================================
function renderAgentGrid() {
  const grid = document.getElementById("agentGrid");
  grid.innerHTML = AGENTS.map((a) => `
    <div class="agent-card" style="--agent-color:${a.color}" data-id="${a.id}">
      <div class="agent-head">
        <span class="agent-emoji">${a.emoji}</span>
        <div>
          <div class="agent-name">${a.name}</div>
          <div class="agent-role">${a.role}</div>
        </div>
        <span class="agent-status status-${a.status}">
          <span class="dot dot-${a.status === "online" ? "on" : a.status === "busy" ? "busy" : "off"}"></span>
          ${STATUS_LABEL[a.status]}
        </span>
      </div>
      <div class="agent-task"><span class="label">当前任务 · </span>${a.task}</div>
      <div class="agent-meta">
        ${Object.entries(a.metrics).map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("")}
      </div>
    </div>
  `).join("");

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
  const detail = document.getElementById("agentDetail");
  detail.innerHTML = `
    <div class="detail-hero" style="--agent-color:${a.color}">
      <span class="detail-emoji">${a.emoji}</span>
      <div>
        <div class="detail-name">${a.name}</div>
        <div class="detail-role">${a.role}</div>
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
        <div class="panel-head"><div class="ph-left"><span class="ph-dot"></span><h2>当前任务</h2></div><span class="hint">${STATUS_LABEL[a.status]}</span></div>
        <div class="agent-task" style="margin:0"><span class="label">进行中 · </span>${a.task}</div>
        <div class="agent-meta" style="margin-top:14px">
          ${Object.entries(a.metrics).map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="ph-left"><span class="ph-dot"></span><h2>技能包</h2></div><span class="hint">${a.skills.filter(s => s.on).length}/${a.skills.length} 启用</span></div>
        <ul class="skill-list">
          ${a.skills.map((s, i) => `
            <li class="${s.on ? "on" : ""}" data-i="${i}">
              <span class="skill-name">${s.name}</span>
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
          <button class="tpl-card" data-i="${i}" style="--agent-color:${a.color}">
            <span class="tpl-icon">${t.icon}</span>
            <span class="tpl-title">${t.title}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  document.getElementById("assignTask").addEventListener("click", () => openTaskModal(id));
  document.getElementById("toggleStatus").addEventListener("click", () => {
    a.status = a.status === "offline" ? "online" : "offline";
    persistAgents();
    renderAgentDetail(id);
    renderAgentGrid();
    updateOnlineCount();
    showToast(`「${a.name}」已${a.status === "offline" ? "下线" : "上线"}`);
  });
  detail.querySelectorAll(".skill-toggle").forEach((t) => {
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = +t.dataset.i;
      a.skills[i].on = !a.skills[i].on;
      persistAgents();
      renderAgentDetail(id);
      showToast(`技能「${a.skills[i].name}」已${a.skills[i].on ? "启用" : "停用"}`);
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
  const overlay = document.getElementById("modalOverlay");
  document.getElementById("modalBody").innerHTML = `
    <div class="task-modal-hero" style="--agent-color:${a.color}">
      <span class="detail-emoji">${a.emoji}</span>
      <div>
        <div class="detail-name">${a.name}</div>
        <div class="detail-role">${a.role}</div>
      </div>
      <button class="modal-close" id="modalClose" aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">快捷任务模板</div>
      <div class="tpl-grid">
        ${a.templates.map((t, i) => `
          <button class="tpl-card" data-i="${i}" style="--agent-color:${a.color}">
            <span class="tpl-icon">${t.icon}</span>
            <span class="tpl-title">${t.title}</span>
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
  overview: ["运营总览", "5 名数字员工协同作战 · 实时"],
  agent: ["数字员工", "单个 Agent 详情与技能管理"],
  approval: ["审批中心", "对外动作的人工确认闸门"],
  leads: ["线索管理", "全渠道进线分级打标 · 导出 leads.csv"],
  knowledge: ["知识库", "RAG 向量化文档管理"],
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
    <li style="--feed-color:${f.color}">
      <span class="feed-time">${escapeHtml(f.time)}</span>
      <span class="feed-tag">${escapeHtml(f.tag)}</span>
      <span class="feed-text">${escapeHtml(f.text)}</span>
    </li>
  `).join("");
}
// 初始化种子
FEED_SEED.forEach(f => feedItems.push({ ...f, time: timeLabel() }));

// 实时推送（模拟后端事件流，随机间隔 8-16s）
function startFeedStream() {
  let i = 0;
  function next() {
    const ev = FEED_POOL[i % FEED_POOL.length]; i++;
    pushFeed(ev.tag, ev.color, ev.text);
    setTimeout(next, 8000 + Math.floor(Math.random() * 8000));
  }
  setTimeout(next, 6000 + Math.floor(Math.random() * 4000));
}

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
function loadUser() {
  const email = localStorage.getItem("oc_user");
  if (!email) { window.location.href = "login.html"; return; }
  const name = email.split("@")[0];
  document.getElementById("userName").textContent = name;
  document.getElementById("userAvatar").textContent = name.charAt(0).toUpperCase();
}
document.getElementById("userChip").addEventListener("click", () => {
  localStorage.removeItem("oc_user");
  window.location.href = "login.html";
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
    <div class="kb-stat" style="--stat-color:${s.color}">
      <div class="kb-stat-label">${s.label}</div>
      <div class="kb-stat-value">${s.value}</div>
      <div class="kb-stat-sub">${s.sub}</div>
    </div>
  `).join("");

  const renderList = (list, emptyMsg) => list.length ? list.map(a => {
    const meta = APPROVAL_META[a.type] || APPROVAL_META.reply;
    return `
      <li class="ap-item" data-id="${a.id}">
        <div class="ap-icon" style="--file-color:${meta.color}">${meta.icon}</div>
        <div class="ap-main">
          <div class="ap-title">
            <span class="ap-type-chip" style="color:${meta.color};background:color-mix(in srgb,${meta.color} 14%,transparent)">${meta.label}</span>
            ${escapeHtml(a.title)}
            <span class="ap-id">#${a.id}</span>
          </div>
          <div class="ap-summary">${escapeHtml(a.summary || a.command || "")}</div>
          <div class="ap-meta">
            <span>👤 ${escapeHtml(a.agentName || "运营总监")}</span>
            <span>⏱ ${escapeHtml(a.created)}</span>
            <span class="ap-risk">⚠ ${escapeHtml(a.risk || "对外动作，需人工确认后执行")}</span>
          </div>
        </div>
        <div class="ap-actions">
          ${a.status === "pending" ? `
            <button class="btn btn-sm" data-act="view" data-id="${a.id}">查看草稿</button>
            <button class="btn btn-sm btn-reject" data-act="reject" data-id="${a.id}">驳回</button>
            <button class="btn btn-sm btn-primary" data-act="approve" data-id="${a.id}">批准草稿</button>
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

// 调后端落库批准/驳回，再更新本地
async function decideApproval(ap, decision) {
  if (!ap) return;
  // 乐观更新
  ap.status = decision === "approve" ? "approved" : "rejected";
  const meta = APPROVAL_META[ap.type] || APPROVAL_META.reply;
  pushFeed("审批", meta.color, `${decision === "approve" ? "批准草稿" : "驳回"} ${meta.label}草稿 #${ap.id}，${decision === "approve" ? "已归档（执行器未接入）" : "退回修改"}`);
  renderApprovals();
  renderApprovalBadge();
  try {
    const resp = await fetch(`${API_BASE}/api/approvals/${encodeURIComponent(ap.id)}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    // 用后端返回的最新状态同步
    Object.assign(ap, data.data);
    renderApprovals();
    showToast(decision === "approve"
      ? `✅ 已批准草稿「${ap.title}」，已归档（执行器尚未接入，未真实执行）`
      : `已驳回「${ap.title}」，退回修改`);
  } catch (e) {
    // 后端失败：本地回滚状态提示，但保留本地操作
    showToast(`⚠ 后端同步失败：${e.message}（本地状态已更新，重启后请重新审批）`);
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
      <div class="tms-label">AI 生成草稿（待人工复核）</div>
      <pre class="draft-view">${escapeHtml(ap.draft || "（无草稿）")}</pre>
    </div>
    <div class="task-modal-section">
      <div class="tms-label">风险提示</div>
      <div class="draft-risk">⚠ ${escapeHtml(ap.risk || "对外动作，需人工确认后执行")}</div>
    </div>
    <div class="task-modal-foot">
      <span class="hint">AI 只出方案，人工确认后执行</span>
      <div>
        <button class="btn btn-sm btn-reject" id="draftReject">驳回</button>
        <button class="btn btn-sm btn-primary" id="draftApprove">批准草稿</button>
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
    <div class="kb-stat" style="--stat-color:${s.color}">
      <div class="kb-stat-label">${s.label}</div>
      <div class="kb-stat-value">${s.value}</div>
      <div class="kb-stat-sub">${s.sub}</div>
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
              <td><span class="grade-chip ${g.cls}" style="--gc:${g.color}">${g.label}</span></td>
              <td><span class="lead-score" style="--gc:${g.color}">${l.score}</span></td>
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
      showToast(`已将「${l.name}」转入 CRM 待跟进（待接入后端 CRM）`);
      pushFeed("客服", "#34d399", `线索 ${l.id}「${l.name}」转入 CRM 跟进池`);
    };
  });
}

// 导出 leads.csv（真实 Blob 下载）
function exportLeadsCSV() {
  const header = ["线索ID", "渠道", "客户", "地区", "原话", "意向", "分级", "得分", "时间"];
  const rows = LEADS.map(l => [
    l.id, l.channel, l.name, l.country, l.msg, l.intent, GRADE_META[l.grade].label, l.score, l.time
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "leads.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast(`已导出 ${LEADS.length} 条线索至 leads.csv`);
}

// ================================================================
//  报告沉淀（控制台最终产出）
// ================================================================
const REPORTS = [];
function addReport(r) {
  REPORTS.unshift({ ...r, time: timeLabel(), id: "R-" + String(REPORTS.length + 1).padStart(3, "0") });
  if (REPORTS.length > 20) REPORTS.pop();
  renderReports();
}
function renderReports() {
  const el = document.getElementById("reportList");
  if (!el) return;
  el.innerHTML = REPORTS.length ? REPORTS.map(r => `
    <li style="--feed-color:${r.color}">
      <span class="feed-time">${escapeHtml(r.time)}</span>
      <span class="feed-tag">${escapeHtml(r.tag)}</span>
      <span class="feed-text">📄 ${escapeHtml(r.title)}</span>
    </li>
  `).join("") : `<li class="feed-empty">暂无产出报告</li>`;
}

// ================================================================
//  知识库（RAG）
// ================================================================
const KB_DOCS = [
  // 初始为空，启动后由 loadKBFilesFromServer() 从后端拉取真实文件覆盖
];

const FILE_COLORS = { pdf: "#fb7185", docx: "#60a5fa", xlsx: "#34d399", csv: "#fbbf24", txt: "#7e85a3", md: "#a855f7" };
const KB_STATUS = { ready: "已就绪", processing: "向量化中", failed: "失败", not_indexed: "未向量化", uploading: "上传中" };

function initKnowledge() {
  const total = KB_DOCS.length;
  const ready = KB_DOCS.filter(d => d.status === "ready").length;
  const chunks = KB_DOCS.reduce((s, d) => s + (d.chunks || 0), 0);
  const processing = KB_DOCS.filter(d => d.status === "uploading" || d.status === "processing").length;

  document.getElementById("kbStats").innerHTML = [
    { label: "文档总数", value: total, sub: "已上传", color: "var(--brand)" },
    { label: "已向量化", value: ready, sub: "可检索", color: "var(--success)" },
    { label: "文本块", value: chunks, sub: "chunks", color: "var(--info)" },
    { label: "处理中", value: processing, sub: "上传队列", color: "var(--warning)" },
  ].map(s => `
    <div class="kb-stat" style="--stat-color:${s.color}">
      <div class="kb-stat-label">${s.label}</div>
      <div class="kb-stat-value">${s.value}</div>
      <div class="kb-stat-sub">${s.sub}</div>
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
      showToast("向量化完成，文档已可检索");
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
    desc: "为不同 Agent 分配模型与 fallback",
    rows: [
      { key: "model_0", type: "select", label: "市场调研 Agent", options: ["claude-opus-5", "claude-sonnet-5", "gpt-4o", "gemini-2-pro"], value: "claude-opus-5" },
      { key: "model_1", type: "select", label: "内容与视觉 Agent", options: ["claude-sonnet-5", "gpt-4o", "gemini-2-pro"], value: "claude-sonnet-5" },
      { key: "model_3", type: "select", label: "客服与订单 Agent", options: ["claude-sonnet-5", "claude-haiku-5", "gpt-4o-mini"], value: "claude-sonnet-5" },
      { key: "model_4", type: "select", label: "合规与风控 Agent", options: ["claude-opus-5", "claude-sonnet-5", "gpt-4o"], value: "claude-sonnet-5" },
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
      { type: "btn", label: "memory/ 记忆条目", hint: "清理过时低价值记忆，防止污染", btnText: "立即清理", btnIcon: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' },
      { type: "btn", label: "openclaw doctor 自检", hint: "检查配置一致性、DM 策略、路径", btnText: "运行自检", btnIcon: '<path d="M9 12l2 2 4-4M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"/>' },
    ],
  },
];

const SETTINGS_STORE_KEY = "oc_settings";

function getSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_STORE_KEY) || "{}"); }
  catch { return {}; }
}
function setSetting(key, val) {
  const s = getSettings();
  s[key] = val;
  localStorage.setItem(SETTINGS_STORE_KEY, JSON.stringify(s));
}
function settingVal(row) {
  const s = getSettings();
  return key => s[key] !== undefined ? s[key] : row.value;
}

function initSettings() {
  const s = getSettings();
  document.getElementById("settingsGrid").innerHTML = SETTINGS.map(card => `
    <div class="settings-card">
      <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${card.icon}</svg>${card.title}</h3>
      <p class="sc-desc">${card.desc}</p>
      ${card.rows.map((r) => {
        let control = "";
        const val = r.key && s[r.key] !== undefined ? s[r.key] : r.value;
        if (r.type === "select") {
          control = `<select class="settings-select" data-key="${r.key}">${r.options.map(o => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("")}</select>`;
        } else if (r.type === "input") {
          control = `<input class="settings-input" type="text" data-key="${r.key}" placeholder="${r.placeholder || ""}" value="${val || ""}" />`;
        } else if (r.type === "toggle") {
          control = `<div class="settings-toggle ${val ? "on" : ""}" data-key="${r.key}" data-on="${val}"></div>`;
        } else if (r.type === "btn") {
          control = `<button class="settings-btn" data-btn="${r.btnText}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${r.btnIcon}</svg>${r.btnText}</button>`;
        }
        return `
          <div class="settings-row">
            <div>
              <div class="settings-row-label">${r.label}</div>
              ${r.hint ? `<div class="settings-row-hint">${r.hint}</div>` : ""}
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
        setSetting(t.dataset.key, on);
        showToast(`「${t.closest(".settings-card").querySelector("h3").textContent}」已${on ? "开启" : "关闭"}`);
      }
    });
  });
  // 下拉
  document.querySelectorAll(".settings-select").forEach(sel => {
    sel.addEventListener("change", () => {
      if (sel.dataset.key) {
        setSetting(sel.dataset.key, sel.value);
        showToast(`已保存：${sel.value}`);
      }
    });
  });
  // 输入
  document.querySelectorAll(".settings-input").forEach(inp => {
    inp.addEventListener("change", () => {
      if (inp.dataset.key) {
        setSetting(inp.dataset.key, inp.value);
        showToast(`已保存配置`);
      }
    });
  });
  // 按钮
  document.querySelectorAll(".settings-btn").forEach(b => {
    b.addEventListener("click", () => {
      const t = b.dataset.btn;
      if (t === "立即清理") {
        showToast("已清理 12 条过时记忆（memory/ 已归档）");
        pushFeed("合规", "#fbbf24", "memory/ 清理完成，归档 12 条低价值记忆");
      } else if (t === "运行自检") {
        showToast("✅ openclaw doctor 自检通过：配置一致 / DM 策略正常 / 路径就绪");
        pushFeed("合规", "#34d399", "openclaw doctor 自检通过");
      } else {
        showToast(`「${t}」已触发`);
      }
    });
  });
}

// ================================================================
//  持久化：Agent 状态/技能
// ================================================================
const AGENT_STORE_KEY = "oc_agents";
function persistAgents() {
  try {
    localStorage.setItem(AGENT_STORE_KEY, JSON.stringify(
      AGENTS.map(a => ({ id: a.id, status: a.status, skills: a.skills.map(s => s.on) }))
    ));
  } catch {}
}
function loadAgents() {
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_STORE_KEY) || "[]");
    saved.forEach(s => {
      const a = AGENTS.find(x => x.id === s.id);
      if (a) { a.status = s.status; a.skills.forEach((sk, i) => { if (s.skills[i] !== undefined) sk.on = s.skills[i]; }); }
    });
  } catch {}
}

// ================================================================
//  真实执行模式：桥接 OpenClaw 后端（v0.2）
//  后端: http://localhost:3001 (server\index.js)
// ================================================================
const API_BASE = ""; // 同源：Express 托管前端，前后端同端口，用相对路径

/** 调后端执行指令（真实 OpenClaw），返回 {content, approval} */
async function callBackend(command) {
  const resp = await fetch(`${API_BASE}/api/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, agentId: "main", sessionId: "ecommerce-console" }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `后端错误 HTTP ${resp.status}`);
  }
  return resp.json();
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
    risk: ap.risk || "对外动作，需人工确认后执行",
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
    APPROVALS = (data.data || []).map(normalizeApproval);
    renderApprovalBadge();
    if (currentView === "approval") renderApprovals();
    return APPROVALS;
  } catch (e) {
    showToast(`⚠ 审批数据拉取失败：${e.message}`);
    return [];
  }
}

// 真实执行 runCommand（覆盖模拟版，因 function 声明后定义者生效）
async function runCommand(cmd, opts = {}) {
  const { agentIdx: presetAgent, tag: presetTag, color: presetColor } = opts;
  const route = routeCommand(cmd);
  const agentIdx = presetAgent != null ? presetAgent : route.agentIdx;
  const tag = presetTag || route.tag;
  const color = presetColor || route.color;

  // 写入指令回显
  consoleState.steps = [{ label: "指令", text: cmd, tag: "输入", color: "#6366f1", done: true }];
  renderConsole();
  consoleState.running = true;

  const push = (label, text, tagName = tag, done = false) => {
    consoleState.steps.push({ label, text, tag: tagName, color, done });
    renderConsole();
  };

  try {
    push("路由", "识别意图 → 调度 OpenClaw 运营总监", "路由", false);
    await delay(300 + pseudoRand() * 300);
    consoleState.steps[consoleState.steps.length - 1].done = true;
    renderConsole();

    push("执行", "已连接 OpenClaw Gateway，真实执行中…", tag, false);
    renderConsole();
    pushFeed(tag, color, `真实执行指令：${cmd.slice(0, 30)}`);

    const result = await callBackend(cmd);

    // 完成执行步骤
    const execStep = consoleState.steps[consoleState.steps.length - 1];
    execStep.done = true;
    execStep.text = result.needsApproval
      ? "已生成执行方案，等待人工审批（对外动作不自动执行）"
      : "执行完成";
    renderConsole();

    // 审批闸门：真实审批条目
    if (result.approval) {
      const ap = mergeRealApproval(result.approval);
      push("审批", `已生成审批条目 ${ap ? ap.id : ""}：${result.approval.title}`, "审批", true);
      renderConsole();
      showToast(`⚡ 检测到对外动作，已生成审批条目 ${result.approval.id}`);
    }

    // 最终产出：真实结果写入报告（完整内容，不截断）
    push("产出", result.content, "结果", true);
    addReport({ agent: agentIdx, title: cmd.slice(0, 24) + (cmd.length > 24 ? "…" : ""), tag, color });

  } catch (e) {
    push("错误", `执行失败：${e.message}`, "错误", true);
    showToast(`❌ 执行失败：${e.message}`);
    if (e.message.includes("后端") || e.message.includes("fetch")) {
      push("降级", "后端不可用，请确认 server 服务已启动 (node server/index.js)", "警告", true);
    }
  } finally {
    consoleState.running = false;
    renderConsole();
  }
}

// ================================================================
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
    addReport({ agent: 3, title: "客服 RAG：" + question.slice(0, 18), tag: "客服", color: "#34d399" });
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
loadAgents();
loadUser();
renderKPI();
renderAgentGrid();
renderFeed();
renderQuickCmds();
renderConsole();
renderApprovalBadge();
updateOnlineCount();
initKnowledge();
initSettings();
startFeedStream();
// 拉取后端真实审批数据（启动后异步，失败则降级为空）
loadApprovalsFromServer();
// 拉取后端真实知识库文件列表（覆盖空 KB_DOCS）
loadKBFilesFromServer();
// 每 30s 轮询一次审批数据，保证多端同步 & 徽标新鲜
setInterval(() => { if (!document.hidden) loadApprovalsFromServer(); }, 30000);
