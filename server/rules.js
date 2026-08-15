// rules.js — 路由与审批规则的单一事实来源。
// server/index.js、server/bridge.js、public/app.js 均以这里为准；
// 前端通过 GET /api/rules 拉取，失败时才使用本地兜底副本。

'use strict';

const ROUTE_RULES = [
  { agent: 0, name: '市场调研 Agent', tag: '调研', kw: ['竞品', '周报', '调研', '趋势', '选品', 'voc', '评论', '市场'], color: '#60a5fa' },
  { agent: 1, name: '内容与视觉 Agent', tag: '内容', kw: ['listing', '标题', 'seo', '脚本', '文案', '多语种', '本地化', '爆款'], color: '#a855f7' },
  { agent: 2, name: '获客与社媒 Agent', tag: '获客', kw: ['发帖', '社媒', '排期', '种草', 'reddit', 'tiktok', 'x 账号', '矩阵'], color: '#fb7185' },
  { agent: 3, name: '客服与订单 Agent', tag: '客服', kw: ['客户', '回复', '物流', '查单', '退换货', '客服', '询', 'moq', '尺码'], color: '#34d399' },
  { agent: 4, name: '合规与风控 Agent', tag: '合规', kw: ['审查', '侵权', '敏感词', 'fda', '水印', '广告', 'roas', '合规', '上架前'], color: '#fbbf24' },
];

const ACTION_RULES = [
  {
    action: 'social_post',
    label: '社媒发帖/回复',
    weakKw: ['动态', '帖', '推文', 'ins', 'ig', 'tiktok', 'story'],
    patterns: [
      /发(?:帖|推|布|消息|广告|新品|一条|一个|个)/,
      /回复(?:客户|买家|用户|消息)/,
      /推广帖|种草回复/,
      /(?:^|[^a-z])(?:po|publish|post|update|share)(?![a-z])(?:个|一条|一|条)?\s*(?:动态|帖|文|图|story)?/i,
      /(?:^|[^a-z])(?:ins|ig)(?![a-z])(?:$|[^a-z])/i,
      /tiktok|story|instagram/i,
      /(?:^|[^a-z])动态(?![a-z])|(?<![\u4e00-\u9fff])帖(?!子|文)/,
    ],
    kw: ['发帖', '发推', '发布', '发消息', '回复客户', '回复买家', '推广帖', '推文', '发一条', '发个', '发一个', '发新品', '发广告', '种草回复'],
  },
  {
    action: 'listing_submit',
    label: '商品上架',
    weakKw: ['listing'],
    patterns: [
      /上架|上新产品|上传产品|上架产品/,
      /发布\s*listing|提交\s*listing|提交listing|更新(?:一下)?\s*listing|优化\s*listing/,
      /上新(?:到|产品|商品)?/,
    ],
    kw: ['上架', '上新产品', '提交 listing', '提交listing', '上传产品', '上架产品', '上新', '更新 listing', '更新listing'],
  },
  {
    action: 'purchase',
    label: '采购/下单',
    weakKw: ['补货'],
    patterns: [
      /下单|购买|采购|进货|补货|买(?:一批|一百|50|100)/,
    ],
    kw: ['下单', '购买', '采购', '进货', '补货', '采购一批', '买一批'],
  },
  {
    action: 'refund',
    label: '退款/赔偿',
    weakKw: [],
    patterns: [
      /退款|退钱|退我钱|赔偿|补偿|退还/,
    ],
    kw: ['退款', '退钱', '赔偿', '补偿', '退我钱'],
  },
];

function isWeakOnly(text, weakKw) {
  const value = String(text || '').trim().toLowerCase();
  return weakKw.some(w => value === w.toLowerCase());
}

/**
 * 判断指令是否属于对外动作。
 * 返回 null 或 { action, label, confidence, matched, needsReview }。
 * 所有命中都必须进入审批闸门，低置信条目额外标记需人工复核。
 */
function detectAction(cmd) {
  const lower = String(cmd || '').toLowerCase();
  for (const rule of ACTION_RULES) {
    const strongKw = rule.kw.find(k => !rule.weakKw.includes(k) && lower.includes(k.toLowerCase()));
    if (strongKw) {
      return {
        action: rule.action,
        label: rule.label,
        confidence: 'high',
        matched: strongKw,
        needsReview: false,
      };
    }
    let patternHit = null;
    for (const pattern of rule.patterns) {
      const matched = lower.match(pattern);
      if (matched && (!patternHit || matched[0].length > patternHit[0].length)) patternHit = matched;
    }
    if (!patternHit) continue;
    const low = isWeakOnly(patternHit[0], rule.weakKw);
    if (!low) {
      return {
        action: rule.action,
        label: rule.label,
        confidence: 'medium',
        matched: patternHit[0],
        needsReview: false,
      };
    }
    const weakKw = rule.weakKw.find(k => lower.includes(k.toLowerCase()));
    if (weakKw) {
      return {
        action: rule.action,
        label: rule.label,
        confidence: 'low',
        matched: weakKw,
        needsReview: true,
      };
    }
    return {
      action: rule.action,
      label: rule.label,
      confidence: 'low',
      matched: patternHit[0],
      needsReview: true,
    };
  }
  return null;
}

function getPublicRules() {
  return {
    routeRules: ROUTE_RULES.map(r => ({ ...r })),
    actionRules: ACTION_RULES.map(r => ({
      action: r.action,
      label: r.label,
      weakKw: [...r.weakKw],
      patterns: r.patterns.map(p => p.source),
      kw: [...r.kw],
    })),
  };
}

module.exports = { ROUTE_RULES, ACTION_RULES, detectAction, getPublicRules };
