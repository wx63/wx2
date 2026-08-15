'use strict';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MANMANBU_SEARCH_URL = 'https://s.manmanbuy.com/pc/search/result?c=discount&keyword=';
const MANMANBU_PRICE_SEARCH_URL = 'https://s.manmanbuy.com/pc/search/result?c=price&keyword=';
const WEB_SEARCH_URL = 'https://www.so.com/s?q=';
const APPLE_CHINA_URL = 'https://www.apple.com.cn/shop/buy-iphone/iphone-17';
const AUTOHOME_BRAND_URL = 'https://www.autohome.com.cn/grade/carhtml/';
const AUTOHOME_BRAND_LETTERS = {
  '\u65e5\u4ea7':'R', '\u5c3c\u6851':'R', '\u4e1c\u98ce\u65e5\u4ea7':'R', '\u672c\u7530':'B', '\u4e30\u7530':'F',
  '\u5927\u4f17':'D', '\u5965\u8fea':'A', '\u5b9d\u9a6c':'B', '\u5954\u9a70':'B', '\u522b\u514b':'B',
  '\u6bd4\u4e9a\u8fea':'B', '\u5409\u5229':'J', '\u957f\u5b89':'C', '\u54c8\u5f17':'H', '\u5947\u745e':'Q',
  '\u73b0\u4ee3':'X', '\u8d77\u4e9a':'Q', '\u4e94\u83f1':'W', '\u7406\u60f3':'L', '\u851a\u6765':'W',
  '\u5c0f\u9e4f':'X', '\u5c0f\u7c73':'X', '\u95ee\u754c':'W', '\u54ea\u5412':'N', '\u96f6\u8dd1':'L',
  '\u6781\u6c2a':'J', '\u9886\u514b':'L', '\u963f\u7ef4\u5854':'A', '\u51ef\u8fea\u62c9\u514b':'K',
  '\u798f\u7279':'F', '\u96ea\u4f5b\u5170':'X', '\u65af\u67ef\u8fbe':'S', '\u9a6c\u81ea\u8fbe':'M',
  '\u6c83\u5c14\u6c83':'W', '\u8def\u864e':'L', '\u4fdd\u65f6\u6377':'B', '\u6377\u8c79':'J',
  '\u82f1\u975e\u5c3c\u8fea':'Y', '\u8c03\u6b4c':'A', '\u6797\u80af':'L', '\u7279\u65af\u62c9':'T',
  '\u7ea2\u65d7':'H', '\u6377\u9014':'J', '\u661f\u9014':'X', '\u4f20\u797a':'C', '\u542f\u660e':'Q',
  '\u6b27\u62c9':'O', '\u5c9a\u56fe':'L', '\u817e\u52bf':'T', '\u65b9\u7a0b\u8c79':'F', '\u4ef0\u671b':'Y',
  '\u6df1\u84dd':'S', '\u667a\u5df1':'Z', '\u98de\u51e1':'F', '\u94f6\u6cb3':'Y', '\u6781\u72d0':'J',
  '\u84dd\u7535':'L', '\u4e1c\u98ce':'D', '\u5954\u9a70':'B'
};
const AUTOMOTIVE_TERM_RE = /\u6c7d\u8f66|\u8f66\u578b|\u843d\u5730\u4ef7|\u6307\u5bfc\u4ef7|\u5b98\u65b9\u552e\u4ef7|\u88f8\u8f66\u4ef7|SUV|MPV|\u8f66\u4ef7/i;
const AUTOMOTIVE_ACCESSORY_QUERY_RE = /\u673a\u6cb9|\u6ee4\u82af|\u5239\u8f66\u7247|\u8f6e\u80ce|\u811a\u57ab|\u5750\u57ab|\u65b9\u5411\u76d8\u5957|\u8f66\u819c|\u8d34\u819c|\u96e8\u522e|\u914d\u4ef6|\u4fdd\u517b|\u7ef4\u4fee|\u5145\u7535\u68a8|\u653e\u5f62\u5c0f/i;
const ACCESSORY_RE = /适用|兼容|数据线|充电器|保护壳|手机壳|钢化膜|支架|耳机套|转接线|贴膜|保护套|收纳|充电宝|电池|梳子|板梳|气囊|挂绳|配\s*[A-Za-z0-9]|配件/i;
const ACCESSORY_QUERY_RE = /数据线|充电器|保护壳|手机壳|钢化膜|支架|耳机套|转接线|贴膜|保护套|收纳|充电宝|电池|梳子|板梳|气囊|挂绳|配件/i;
const LOOKALIKE_RE = /华强北|德乐|森系|高仿|原版|山寨|1\s*:\s*1|A货/i;
const LOOKALIKE_QUERY_RE = /华强北|德乐|森系|高仿|原版|山寨|A货/i;
const SECONDHAND_RE = /二手|资源机|准新机|官翻|翻新/i;
const SECONDHAND_QUERY_RE = /二手|资源机|准新机|官翻|翻新/i;
const PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
const priceCache = new Map();

function fetchText(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: ctrl.signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .finally(() => clearTimeout(timer));
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function normalizeSearchQuery(query) {
  const q = String(query || '').trim();
  if (/iphone\s*17\s*(\d+\s*gb)?/i.test(q)) return 'iphone 17' + (q.match(/256|512/)?.[0] ? ` ${q.match(/256|512/)[0]}GB` : '');
  return q
    .replace(/\u6700\u4f4e\u4ef7|\u4ef7\u683c|\u591a\u5c11\u94b1|\u62a5\u4ef7|\u73b0\u4ef7|\u552e\u4ef7|\u54ea\u91cc\u4e70|\u6e20\u9053|\u56fd\u5185|\u56fd\u884c|\u5927\u9646|\u8bf7\u67e5\u4e00\u4e0b|\u67e5\u4e00\u4e0b|\u67e5\u67e5|\u5e2e\u6211|\u8d26\u53f7/gi, '')
    .trim() || q;
}

function normalizeTitle(title) {
  return decodeEntities(title).replace(/\s+/g, ' ');
}

function parseNumericPrice(priceText) {
  const match = String(priceText || '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isStandardIphone17(title, query) {
  const lower = String(title || '').toLowerCase();
  const q = String(query || '').toLowerCase();
  if (/iphone\s*17\s*pro|17\s*pro/.test(q)) return /iphone\s*17\s*pro|17\s*pro/.test(lower);
  if (/17\s*pro\s*max/.test(q)) return /17\s*pro\s*max/.test(lower);
  if (/17\s*air|iphone\s*air/.test(q)) return /17\s*air|iphone\s*air/.test(lower);
  if (/17\s*e/.test(q)) return /17\s*e/.test(lower);
  if (!/iphone\s*17/.test(lower)) return false;
  return !/17\s*pro|17\s*air|17\s*e|pro\s*max|iphone\s*air/i.test(lower);
}

function isAppleIphone17Query(query) {
  return /iphone\s*17|iphone17|\u82f9\u679c\s*17/i.test(String(query || ''));
}

function extractSearchTerms(query) {
  const cleaned = String(query || '')
    .replace(/\u6700\u4f4e\u4ef7|\u4ef7\u683c|\u591a\u5c11\u94b1|\u62a5\u4ef7|\u73b0\u4ef7|\u552e\u4ef7|\u54ea\u91cc\u4e70|\u6e20\u9053|\u56fd\u5185|\u56fd\u884c|\u5927\u9646|\u8bf7\u67e5\u4e00\u4e0b|\u67e5\u4e00\u4e0b|\u67e5\u67e5|\u5e2e\u6211|\u8d26\u53f7/gi, ' ')
    .replace(/[，。！？、,?!;；]/g, ' ')
    .toLowerCase()
    .trim();
  const alnum = Array.from(cleaned.matchAll(/[a-z0-9]+(?:[-\s][a-z0-9]+)*/g), (m) => m[0].trim()).filter((s) => s.length >= 2);
  const chinese = Array.from(cleaned.matchAll(/[\u4e00-\u9fa5]{2,}/g), (m) => m[0]).filter((s) => s.length >= 2);
  const ignored = new Set(['cheap', 'lowest', 'price', '价格', '最低价', '多少钱', '报价', '现价', '售价', '商品', '产品']);
  return Array.from(new Set([...alnum, ...chinese])).filter((s) => !ignored.has(s)).slice(0, 8);
}

function termMatchesTitle(term, title) {
  const lowerTerm = String(term || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  if (lowerTitle.includes(lowerTerm)) return true;
  if (!/[\u4e00-\u9fa5]/.test(lowerTerm)) return false;
  for (let i = 0; i + 2 <= lowerTerm.length; i += 1) {
    if (lowerTitle.includes(lowerTerm.slice(i, i + 2))) return true;
  }
  return false;
}

function isRelevantItem(title, query) {
  if (isAppleIphone17Query(query)) return isStandardIphone17(title, query);
  if (/华为\s*mate\s*70|mate\s*70/i.test(String(query || ''))) {
    const lowerTitle = String(title || '').toLowerCase();
    const q = String(query || '').toLowerCase();
    if (/pro\s*\+|pro\+/.test(q)) return /mate\s*70\s*pro\s*\+|mate70\s*pro\s*\+/.test(lowerTitle);
    if (/\bpro\b/.test(q)) return /mate\s*70\s*pro|mate70\s*pro/.test(lowerTitle);
    if (/\bair\b/.test(q)) return /mate\s*70\s*air|mate70\s*air/.test(lowerTitle);
    if (!/mate\s*70|mate70/.test(lowerTitle)) return false;
    return !/mate\s*70\s*(air|pro|pro\+)|mate70\s*(air|pro|pro\+)/.test(lowerTitle);
  }
  const terms = extractSearchTerms(query);
  if (!terms.length) return true;
  return isGenericRelevantItem(title, query);
}

function isGenericRelevantItem(title, query) {
  const terms = extractSearchTerms(query);
  if (!terms.length) return true;
  const chineseLongTerms = terms.filter((term) => /[\u4e00-\u9fa5]/.test(term) && term.length >= 4);
  if (chineseLongTerms.length && !chineseLongTerms.some((term) => String(title || '').includes(term.slice(0, 2)))) return false;
  return terms.some((term) => termMatchesTitle(term, title));
}

function shouldSkipLookalike(title, query) {
  if (LOOKALIKE_QUERY_RE.test(String(query || ''))) return false;
  return LOOKALIKE_RE.test(String(title || ''));
}

function shouldSkipAccessory(title, query) {
  if (ACCESSORY_QUERY_RE.test(String(query || ''))) return false;
  return ACCESSORY_RE.test(String(title || ''));
}

function isAutomotiveQuery(query) {
  const text = String(query || '');
  if (AUTOMOTIVE_TERM_RE.test(text)) return true;
  const compact = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  if (AUTOMOTIVE_ACCESSORY_QUERY_RE.test(text)) return false;
  return Object.keys(AUTOHOME_BRAND_LETTERS).some((brand) => compact.includes(brand) && (/[a-z0-9]/.test(compact) || !ACCESSORY_RE.test(text)));
}

function autohomeLetterForQuery(query) {
  const text = String(query || '');
  for (const [brand, letter] of Object.entries(AUTOHOME_BRAND_LETTERS)) {
    if (text.includes(brand)) return letter;
  }
  return '';
}

function extractAutohomeCards(html) {
  const cards = [];
  const zh = '\u6307\u5bfc\u4ef7\uff1a';
  const re = new RegExp(`<li id="s\\d+">\\s*<h4><a[^>]*href='([^']*)'[^>]*>(.*?)<\\/a><\\/h4>\\s*<div>${zh}<a class='red'[^>]*>(.*?)<\\/a>`, 'g');
  let match;
  while ((match = re.exec(html))) {
    const name = decodeEntities(match[2]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const price = decodeEntities(match[3]).replace(/<[^>]+>/g, '').trim();
    const href = match[1].startsWith('//') ? 'https:' + match[1] : match[1];
    if (name && price) cards.push({ name, price, href });
  }
  return cards;
}

function isAutohomeCardRelevant(card, query) {
  const terms = extractSearchTerms(query);
  if (!terms.length) return true;
  const modelTerms = terms.filter((term) => /[a-z0-9]/i.test(term));
  if (modelTerms.length && !modelTerms.some((term) => termMatchesTitle(term, card.name))) return false;
  return terms.some((term) => {
    const lowerTerm = String(term).toLowerCase();
    const lowerName = String(card.name || '').toLowerCase();
    if (lowerName.includes(lowerTerm)) return true;
    if (/[\u4e00-\u9fa5]/.test(lowerTerm) && lowerTerm.length >= 4) {
      return lowerName.includes(lowerTerm.slice(-2));
    }
    return termMatchesTitle(term, card.name);
  });
}

function formatAutohomeResult(query, card) {
  return [
    `\u5b9e\u65f6\u4ef7\u683c\u67e5\u8be2\uff1a${query}`,
    `\u6570\u636e\u6e90\uff1a\u6c7d\u8f66\u4e4b\u5bb6\u8f66\u578b\u6307\u5bfc\u4ef7`,
    '',
    `\u8f66\u578b\uff1a${card.name}`,
    `\u6307\u5bfc\u4ef7\uff1a${card.price}`,
    `\u8f66\u578b\u9875\uff1a${card.href || ''}`,
    '',
    '\u63d0\u793a\uff1a\u6307\u5bfc\u4ef7\u4e0d\u7b49\u4e8e\u6700\u7ec8\u843d\u5730\u4ef7\uff0c\u5b9e\u9645\u4f18\u60e0/\u843d\u5730\u4ef7\u8bf7\u4ee5\u6b63\u89c4\u7ecf\u9500\u5546\u62a5\u4ef7\u4e3a\u51c6\u3002',
  ].join('\n');
}

async function lookupAutohomeGuidePrice(query) {
  const letter = autohomeLetterForQuery(query);
  if (!letter) return null;
  const html = await fetchText(`${AUTOHOME_BRAND_URL}${letter}.html`, 15000);
  const cards = extractAutohomeCards(html).filter((c) => isAutohomeCardRelevant(c, query));
  return cards[0] || null;
}

function parseWebSearchResults(html) {
  const results = [];
  const marker = '<li class="res-list">';
  let from = 0;
  while (from < html.length) {
    const start = html.indexOf(marker, from);
    if (start < 0) break;
    const next = html.indexOf(marker, start + marker.length);
    const chunkEnd = next < 0 ? Math.min(html.length, start + 6000) : next;
    const chunk = html.slice(start, chunkEnd);

    const titleMatch = chunk.match(/<h3[^>]*class="res-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>/);
    const hrefMatch = chunk.match(/data-mdurl="([^"]+)"/);
    const displayHrefMatch = chunk.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/);
    const descMatch = chunk.match(/<p class="res-desc">([\s\S]*?)<\/p>/);
    if (!titleMatch) {
      from = start + marker.length;
      continue;
    }
    const title = decodeEntities(titleMatch[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const snippet = descMatch
      ? decodeEntities(descMatch[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    const href = hrefMatch ? decodeEntities(hrefMatch[1]) : (displayHrefMatch ? decodeEntities(displayHrefMatch[1]) : '');
    if (title) results.push({ title, snippet, href });
    from = start + marker.length;
  }
  return results.slice(0, 8);
}

function hasPriceHint(text) {
  return /(?:人民币|¥|￥|\$|RMB|CNY)?\s*\d+(?:\.\d+)?\s*(?:万|元|美元|港币)/i.test(String(text || ''))
    || /\d+(?:\.\d+)?\s*(?:万|元|美元|港币)/i.test(String(text || ''));
}

async function searchWebPrice(query) {
  const rawQuery = String(query || '').trim();
  const cleanedQuery = rawQuery
    .replace(/\u4ef7\u683c|\u6700\u4f4e\u4ef7|\u591a\u5c11\u94b1|\u62a5\u4ef7|\u73b0\u4ef7|\u552e\u4ef7|\u8f66\u4ef7|\u843d\u5730\u4ef7/g, '')
    .trim();
  const searchQuery = `${cleanedQuery || rawQuery} \u4ef7\u683c`;
  const html = await fetchText(WEB_SEARCH_URL + encodeURIComponent(searchQuery), 20000);
  const results = parseWebSearchResults(html);
  const searchUrl = WEB_SEARCH_URL + encodeURIComponent(searchQuery);
  if (!results.length) {
    return {
      results: [{
        title: `\u6253\u5f00\u5b9e\u65f6\u641c\u7d22\u7ed3\u679c\uff1a${query} \u4ef7\u683c`,
        snippet: `\u5f53\u524d\u672a\u4ece\u7535\u5546\u5e93/\u6c7d\u8f66\u4ef7\u683c\u5e93\u5339\u914d\u5230\uff0c\u53ef\u4ee5\u901a\u8fc7\u4ee5\u4e0b\u7f51\u7edc\u641c\u7d22\u9875\u9762\u8fdb\u4e00\u6b65\u6821\u9a8c\u3002`,
        href: searchUrl,
      }],
      priced: [],
      searchUrl,
    };
  }
  return {
    results: results.slice(0, 6),
    priced: results.filter((r) => hasPriceHint(`${r.title} ${r.snippet}`)).slice(0, 6),
    searchUrl,
  };
}

function formatWebSearchResult(query, search) {
  const lines = [];
  lines.push(`\u5b9e\u65f6\u4ef7\u683c\u67e5\u8be2\uff1a${query}`);
  lines.push('\u6570\u636e\u6e90\uff1a360\u641c\u7d22\u516c\u5f00\u7ed3\u679c\uff08\u672a\u5339\u914d\u5230\u7535\u5546\u5e93/\u6c7d\u8f66\u4ef7\u683c\u5e93\u65f6\u81ea\u52a8\u4f7f\u7528\uff09');
  const picked = (search.priced.length ? search.priced : search.results).slice(0, 6);
  if (picked.length) {
    lines.push('');
    lines.push('\u53ef\u6821\u9a8c\u7f51\u7edc\u4ef7\u683c\u7ebf\u7d22\uff1a');
    for (const item of picked) {
      const detail = [item.title, item.snippet].filter(Boolean).join(' | ');
      lines.push(`- ${detail.slice(0, 240)}${item.href ? `\n  ${item.href}` : ''}`);
    }
  } else {
    lines.push('');
    lines.push('\u5f53\u524d\u672a\u4ece\u516c\u5f00\u641c\u7d22\u7ed3\u679c\u63d0\u53d6\u5230\u660e\u786e\u4ef7\u683c\uff0c\u4ee5\u4e0b\u662f\u76f8\u5173\u9875\u9762\u4f9b\u6821\u9a8c\u3002');
    for (const item of search.results) {
      lines.push(`- ${item.title}${item.snippet ? ` | ${item.snippet.slice(0, 180)}` : ''}${item.href ? `\n  ${item.href}` : ''}`);
    }
  }
  lines.push('');
  lines.push('\u63d0\u793a\uff1a\u7f51\u7edc\u641c\u7d22\u7ed3\u679c\u53ef\u80fd\u6765\u81ea\u62a5\u4ef7\u9875\u3001\u65b0\u95fb\u6216\u8bba\u575b\uff0c\u6700\u7ec8\u4ef7\u683c\u4ee5\u5b98\u65b9\u6e20\u9053\u6216\u4e0b\u5355\u9875\u4e3a\u51c6\u3002');
  return lines.join('\n');
}

function relevanceScore(title, query) {
  if (isAppleIphone17Query(query)) {
    return isStandardIphone17(title, query) ? 100 : 0;
  }
  const lowerTitle = String(title || '').toLowerCase();
  const terms = extractSearchTerms(query);
  let score = 0;
  for (const term of terms) {
    const lowerTerm = String(term).toLowerCase();
    if (lowerTitle.includes(lowerTerm)) {
      score += 2;
    } else if (/[\u4e00-\u9fa5]/.test(lowerTerm)) {
      for (let i = 0; i + 2 <= lowerTerm.length; i += 1) {
        if (lowerTitle.includes(lowerTerm.slice(i, i + 2))) {
          score += 1;
        }
      }
    }
  }
  if (/\u624b\u673a|\u6258|\u7535\u8111|\u8033\u673a|\u5439\u98ce\u673a/.test(lowerTitle)) score += 1;
  if (/官方标配|自营|旗舰店|官方/.test(lowerTitle)) score += 1;
  if (shouldSkipAccessory(title, query)) score -= 4;
  if (shouldSkipLookalike(title, query)) score -= 4;
  if (SECONDHAND_RE.test(lowerTitle) && !SECONDHAND_QUERY_RE.test(String(query || ''))) score -= 2;
  return score;
}

function compareCards(a, b) {
  const aTier = a.relevance >= 4 ? 0 : 1;
  const bTier = b.relevance >= 4 ? 0 : 1;
  return aTier - bTier || a.numericPrice - b.numericPrice;
}

function shouldSkipInternational(title, query) {
  const q = String(query || '').toLowerCase();
  if (!/\u56fd\u5185|\u56fd\u884c|\u5927\u9646/.test(q)) return false;
  return /\u56fd\u9645\u7248|\u6e2f\u7248|\u6c34\u8d27/.test(String(title || '').toLowerCase());
}

function extractManmanbuyCards(html) {
  const cards = [];
  const marker = 'class="flex DiscountItemPC_discountItem__btTF1';
  let from = 0;
  while (from < html.length) {
    const start = html.indexOf(marker, from);
    if (start < 0) break;
    const next = html.indexOf(marker, start + marker.length);
    const chunkEnd = next < 0 ? html.length : next;
    const chunk = html.slice(start, chunkEnd);

    const hrefMatch = chunk.match(/href="([^"]*discuxiao_[^"]+)"/);
    const titleMatch = chunk.match(/<a[^>]+title="([^"]*)"/);
    const priceMatch = chunk.match(/DiscountItemPC_itemSubTitle__rWgWK[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
    if (!titleMatch || !priceMatch) {
      from = start + marker.length;
      continue;
    }

    const title = normalizeTitle(titleMatch[1]);
    const price = decodeEntities(priceMatch[1]);
    const numericPrice = parseNumericPrice(price);
    const tags = Array.from(chunk.matchAll(/DiscountItemPC_itemTag__vQuZm">([^<]+)</g), (m) => m[1]);
    const timeMatch = chunk.match(/DiscountItemPC_itemTime__F_Ku_">([^<]+)</);
    const mallMatch = chunk.match(/DiscountItemPC_itemMall__R8PlE">([^<]+)</);
    const mall = mallMatch ? decodeEntities(mallMatch[1]) : '';
    const href = hrefMatch ? hrefMatch[1] : '';

    if (title && price && numericPrice != null) {
      cards.push({
        title,
        price,
        numericPrice,
        tags,
        time: timeMatch ? decodeEntities(timeMatch[1]) : '',
        mall,
        href,
      });
    }
    from = start + marker.length;
  }
  return cards;
}

function parseAppleOfficial(html) {
  const items = [];
  const re = /"price":\{"fullPrice":(\d+(?:\.\d+)?)\},"category":"iphone","name":"iPhone 17 (\d+)GB ([A-Za-z ]+)"/g;
  let match;
  while ((match = re.exec(html))) {
    items.push({
      capacity: Number(match[2]),
      color: decodeEntities(match[3]),
      price: Number(match[1]),
    });
  }
  const seen = new Set();
  const deduped = [];
  for (const item of items.sort((a, b) => a.capacity - b.capacity || a.price - b.price)) {
    const key = `${item.capacity}:${item.color.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

function formatLookupResult(query, cards, official, fetchedAt) {
  const lines = [];
  lines.push(`\u5b9e\u65f6\u4ef7\u683c\u67e5\u8be2\uff1a${query}`);
  lines.push(`\u6570\u636e\u6e90\uff1a\u6162\u6162\u4e70\u516c\u5f00\u6bd4\u4ef7\u641c\u7d22\uff08\u542b\u6298\u6263\u4e0e\u5546\u54c1\u62a5\u4ef7\uff09\uff0c\u67e5\u8be2\u65f6\u95f4 ${fetchedAt}`);
  if (cards.length) {
    lines.push('');
    lines.push(`\u76ee\u524d\u53ef\u89c1\u6700\u4f4e\uff1a${cards[0].price} | ${cards[0].title} | ${cards[0].mall || '\u672a\u6807\u6ce8\u6e20\u9053'} | ${cards[0].time || ''}`);
    lines.push('');
    lines.push('\u5176\u4ed6\u53ef\u9009\u62a5\u4ef7\uff1a');
    for (const item of cards.slice(1, 8)) {
      lines.push(`- ${item.price} | ${item.title} | ${item.mall || '\u672a\u6807\u6ce8\u6e20\u9053'} | ${item.time || ''}`);
    }
  } else {
    lines.push('\u6682\u672a\u68c0\u5230\u76f8\u5173\u5546\u54c1\u62a5\u4ef7\u3002');
  }
  if (official.length) {
    lines.push('');
    lines.push('\u82f9\u679c\u4e2d\u56fd\u5b98\u7f51\u53c2\u8003\u4ef7\uff1a');
    for (const item of official) {
      lines.push(`- iPhone 17 ${item.capacity}GB ${item.color} RMB ${item.price}`);
    }
  }
  lines.push('');
  lines.push('\u63d0\u793a\uff1a\u4e0b\u5355\u524d\u8bf7\u786e\u8ba4\u6e20\u9053\u662f\u5426\u56fd\u884c\u3001\u5168\u56fd\u8054\u4fdd\u3001\u56fd\u8865\u8d44\u683c\u3001\u6d3b\u52a8\u6761\u4ef6\u53ca\u5b9e\u9645\u5230\u624b\u4ef7\u3002');
  return lines.join('\n');
}

async function lookupPrice(query) {
  const key = String(query || '').trim().toLowerCase();
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.fetchedAtMs < PRICE_CACHE_TTL_MS) {
    return { ...cached, data: { ...cached.data, cached: true } };
  }
  const result = await lookupPriceUncached(query);
  if (result.ok) {
    priceCache.set(key, { ...result, fetchedAtMs: Date.now() });
  }
  return result;
}

async function lookupPriceUncached(query) {
  if (isAutomotiveQuery(query)) {
    try {
      const auto = await lookupAutohomeGuidePrice(query);
      if (auto) {
        return {
          ok: true,
          output: formatAutohomeResult(query, auto),
          data: { query, source: 'autohome', automotive: auto, fetchedAt: new Date().toISOString() },
        };
      }
    } catch (_) {
      // Fall through to the e-commerce feed only for non-automotive results.
    }
    try {
      const search = await searchWebPrice(query);
      if (search) {
        return {
          ok: true,
          output: formatWebSearchResult(query, search),
          data: { query, source: 'web_fallback', web: search, fetchedAt: new Date().toISOString() },
        };
      }
    } catch (_) {
      // Keep the final error when no public source is available.
    }
    return {
      ok: false,
      error: '\u672a\u4ece\u6c7d\u8f66\u4e4b\u5bb6\u5339\u914d\u5230\u8be5\u8f66\u578b\u7684\u6307\u5bfc\u4ef7\uff0c\u8bf7\u6362\u7528\u54c1\u724c+\u8f66\u578b\u5173\u952e\u8bcd\uff0c\u6216\u4ee5\u5f53\u5730\u6388\u6743\u7ecf\u9500\u5546\u62a5\u4ef7\u4e3a\u51c6\u3002',
    };
  }

  const keyword = normalizeSearchQuery(query);
  const fetchedAt = new Date().toISOString();
  let cards = [];
  try {
    const html = await fetchText(MANMANBU_SEARCH_URL + encodeURIComponent(keyword));
    const allCards = extractManmanbuyCards(html);
    cards = allCards
      .filter((c) => isRelevantItem(c.title, query))
      .map((c) => ({ ...c, relevance: relevanceScore(c.title, query) }))
      .filter((c) => c.relevance >= 3)
      .filter((c) => !shouldSkipLookalike(c.title, query))
      .filter((c) => !shouldSkipInternational(c.title, query))
      .sort(compareCards);
    if (!cards.length) {
      cards = allCards
        .filter((c) => isGenericRelevantItem(c.title, query))
        .map((c) => ({ ...c, relevance: relevanceScore(c.title, query) }))
        .filter((c) => c.relevance >= 3)
        .filter((c) => !shouldSkipLookalike(c.title, query))
        .filter((c) => !shouldSkipInternational(c.title, query))
        .sort(compareCards);
    }
  } catch (e) {
    console.warn('[price-lookup] manmanbuy source failed:', e.message);
  }
  if (!cards.length) {
    try {
      const priceHtml = await fetchText(MANMANBU_PRICE_SEARCH_URL + encodeURIComponent(keyword), 25000);
      const priceCards = extractManmanbuyCards(priceHtml);
      cards = priceCards
        .filter((c) => isRelevantItem(c.title, query))
        .map((c) => ({ ...c, relevance: relevanceScore(c.title, query) }))
        .filter((c) => c.relevance >= 3)
        .filter((c) => !shouldSkipLookalike(c.title, query))
        .filter((c) => !shouldSkipInternational(c.title, query))
        .sort(compareCards);
      if (!cards.length) {
        cards = priceCards
          .filter((c) => isGenericRelevantItem(c.title, query))
          .map((c) => ({ ...c, relevance: relevanceScore(c.title, query) }))
          .filter((c) => c.relevance >= 3)
          .filter((c) => !shouldSkipLookalike(c.title, query))
          .filter((c) => !shouldSkipInternational(c.title, query))
          .sort(compareCards);
      }
    } catch (_) {
      // Fall through to the web search fallback when the full product feed is unavailable.
    }
  }

  let official = [];
  if (isAppleIphone17Query(query) && !/pro|air|17\s*e/i.test(query)) {
    try {
      official = parseAppleOfficial(await fetchText(APPLE_CHINA_URL, 15000));
    } catch (_) {
      // Apple official price is optional; the discount feed is the primary source.
    }
  }

  if (!cards.length && !official.length) {
    try {
      const search = await searchWebPrice(query);
      if (search) {
        return {
          ok: true,
          output: formatWebSearchResult(query, search),
          data: { query, keyword, source: 'web_fallback', web: search, fetchedAt },
        };
      }
    } catch (_) {
      // Keep the final error when no public source is available.
    }
    return { ok: false, error: '\u672a\u67e5\u5230\u5b9e\u65f6\u4ef7\u683c\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u6216\u6362\u5546\u54c1\u5173\u952e\u8bcd\u3002' };
  }

  return {
    ok: true,
    output: formatLookupResult(query, cards.slice(0, 8), official, fetchedAt),
    data: { query, keyword, cards: cards.slice(0, 8), official, fetchedAt },
  };
}

module.exports = { lookupPrice, normalizeSearchQuery, searchWebPrice, parseWebSearchResults, extractManmanbuyCards };
