# API Token 机器认证（n8n 集成前置）— 执行方案（Codex）

> 目标：让 n8n / 外部程序用固定 Token 直接调用系统 API（无需模拟登录），为后续 n8n 自动化集成铺路。
> 产出：请求头带 `Authorization: Bearer <API_TOKEN>` 即可获得 admin 级机器身份。

## 现状（代码位置）

- `server/index.js:198` `attachUser`：从会话解析用户挂 `req.user`
- `server/index.js:209` `requireAuth`：无 `req.user` → 401
- `server/index.js:222` `sameOriginWriteGuard`：跨源写请求 403（**API Token 请求必须放行此处**，否则 n8n 写操作会被拦）
- `server/index.js:310-313` 中间件挂载顺序：`attachUser` → logger → `sameOriginWriteGuard` → `createApiRouter`
- 路由统一在 `server/routes/index.js` 组装

## 改动

### 1. `server/index.js` — 新增 `apiTokenAuth` 中间件

在 `attachUser` 定义之后新增（放在 `app.use(attachUser)` 之后、`sameOriginWriteGuard` 之前挂载）：

```js
// 机器身份认证：Authorization: Bearer <API_TOKEN> 或 X-API-Token 头
function apiTokenAuth(req, res, next) {
  try {
    const expected = process.env.API_TOKEN;
    if (!expected) return next(); // 未配置则跳过（保持现状）
    const header = req.headers['authorization'] || '';
    const alt = req.headers['x-api-token'] || '';
    let token = '';
    if (header.startsWith('Bearer ')) token = header.slice(7).trim();
    else if (alt) token = String(alt).trim();
    if (!token) return next();
    // 常量时间比较，防时序攻击
    const a = Buffer.from(String(expected));
    const b = Buffer.from(token);
    if (a.length === b.length && require('crypto').timingSafeEqual(a, b)) {
      req.user = { id: null, role: 'admin', name: 'api_token', source: 'api_token' };
      req.apiToken = true;
    }
    next();
  } catch (e) {
    next();
  }
}
```

挂载顺序改为：

```js
app.use(attachUser);
app.use(apiTokenAuth);          // 新增：机器身份
app.use(createRequestLogger({ logAudit }));
app.use(sameOriginWriteGuard);  // 需对 req.apiToken 放行（见下）
app.use(createApiRouter({ allowPublicRegister, defaultRegisterRole, enqueueCommand }));
```

### 2. `sameOriginWriteGuard` 放行机器请求

在该守卫函数开头加：

```js
if (req.apiToken) return next(); // 机器身份跳过跨源校验
```

### 3. `.env` / `.env.example` 新增

```ini
# ===== 机器身份 API Token（n8n 等外部程序调用）=====
# 生成：openssl rand -hex 32
API_TOKEN=
```

### 4. 测试

- `server/test/` 新增 1 个用例（放 api.test.js 或单独文件）：
  - 设置 `process.env.API_TOKEN` 后，`Authorization: Bearer <token>` 请求受保护端点（如 `GET /api/health` 或指令相关只读端点）返回 200，且不带会话 Cookie
  - 错误 token → 401
  - 未配置 API_TOKEN 时行为不变（回归）

## 安全规则

1. `API_TOKEN` 用强随机值（≥32 字节，`openssl rand -hex 32`）
2. **不进 git、不打包、不上云部署包**——只在服务器 `.env` 手工配置
3. 机器身份为 admin 全权限（与登录 admin 等同）；如需收紧，后续可在 `apiTokenAuth` 里加端点白名单（本期不做）
4. 轮换方式：改 `.env` → `pm2 restart ecommerce-agent --update-env`
5. 审计：现有 `logAudit` 会自动记录机器请求（userId 为 null，可加 metadata.source='api_token' 便于检索）

## 验收标准

- [ ] `curl -H "Authorization: Bearer $API_TOKEN" http://127.0.0.1:3001/api/health` 返回 200/401 判定为"已认证"（health 需要认证，带 token 应通过）
- [ ] 不带 token → 401；错误 token → 401
- [ ] 带 token 发起写请求（如提交指令）不被 `sameOriginWriteGuard` 拦截
- [ ] 未配置 API_TOKEN 时系统行为完全不变
- [ ] `npm test` 全量通过（140 + 新增）

## 工作量

- Codex：约 3~5 小时（半天）
- 部署 + 验证：小吴负责（.env 配置 + pm2 重启 + curl 验证）

## 不做什么

- 不改前端、不改现有登录体系、不动数据
- 不做端点白名单/限流（如需后续加）
