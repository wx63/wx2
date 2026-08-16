# 云服务器部署指南（跨境电商智能体）

> 目标：把本系统部署到免费/低成本云服务器，脱离本地电脑运行。
> 系统对云无特殊依赖：DeepSeek 直连 + 飞书长连接均为出站请求，无需公网回调地址。

## 0. 服务器选择（免费优先）

| 方案 | 配置 | 费用 | 说明 |
|------|------|------|------|
| **Oracle Cloud Always Free** | ARM 4核24G / AMD 1核1G×2，200G 硬盘 | 永久免费 | 配置最强，需外币信用卡验证，注册审核较严；闲置实例可能被回收 |
| **阿里云/腾讯云/华为云 新人试用** | 轻量 2核2G 常见 | 3~6 个月免费 | 国内实名即可，免绑卡，速度快；到期要续费或迁移 |
| 廉价 VPS（CloudIPLC/RackNerd 等） | 1核1G | ~$10/年 | 便宜但非免费，适合当长期主力 |

**推荐路线**：先领国内云试用（当天搞定），同时试着注册 Oracle 免费 ARM（抢到后迁移）。

本系统很轻（Express + SQLite + 少量静态文件），**1核1G 就够跑**，512MB 也能跑但建议 1G 起。

## 1. 准备部署包

在 Windows 开发机上执行：

```powershell
cd E:\基于OpenClaw构建跨境电商智能体\基于OpenClaw构建跨境电商智能体
powershell -ExecutionPolicy Bypass -File deploy\make-package.ps1
```

产出 `deploy\ecommerce-agent-deploy-<日期>.zip`，包含：
- `server/`（已排除 node_modules）、`public/`、`知识库/`、`skills/`、`docs/`、`memory/`
- `data/`（含 app.db 数据库、approvals.json 审批记录）
- 根目录 README.md / AGENTS.md / .env.example / .gitignore / .smoke.js

**不包含**：`.env`（敏感配置）、`.git`、`node_modules`、`logs/`。

## 2. 服务器初始化（Ubuntu 22.04/24.04 或 Debian 12）

### 2.1 安装 Node.js ≥ 22.5（关键！用了 node:sqlite 原生模块）

系统自带 apt 的 node 太老（Ubuntu 24.04 只有 18.x），**必须用 nvm 或 nodesource**：

```bash
# nvm 方式（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 22
node -v   # 确认 >= 22.5

# 或 nodesource 方式
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2.2 安装 pm2（进程守护 + 开机自启）

```bash
sudo npm i -g pm2
```

### 2.3 上传部署包

```bash
# 本地（Windows PowerShell）：
scp deploy\ecommerce-agent-deploy-<日期>.zip ubuntu@<服务器IP>:~/

# 服务器：
sudo apt install -y unzip
mkdir -p ~/app && cd ~/app && unzip ~/ecommerce-agent-deploy-<日期>.zip
cd server && npm install          # 装依赖（含 pm2）
```

## 3. 配置 .env

```bash
cd ~/app
cp .env.example .env
nano .env
```

必须填写/修改的项：

```ini
NODE_ENV=production
PORT=3001
SESSION_SECRET=<新生成的强随机值>        # 用命令生成：openssl rand -hex 32
SESSION_COOKIE_SECURE=auto              # HTTP 部署必须 auto/false；HTTPS 反代可 auto 或 true
ALLOW_REGISTER=false                    # 公网必须 false
ADMIN_EMAIL=<你的管理员邮箱>
ADMIN_PASSWORD=<强密码>                 # 仅首次启动创建 admin 用

# 直连 DeepSeek（快路径）——云上必须显式配置，因为读不到本机 models.json
OPENCLAW_DIRECT_MODEL=deepseek/deepseek-chat
OPENCLAW_PROVIDER_BASE_URL=https://api.deepseek.com
OPENCLAW_PROVIDER_API_KEY=<你的 DeepSeek API Key>

# Gateway 兜底：云上没有 OpenClaw，指向不可达地址即可（直连失败才走它）
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789

# 飞书（如启用）
FEISHU_APP_ID=<飞书自建应用 App ID>
FEISHU_APP_SECRET=<飞书 App Secret>
```

> 注：飞书为**长连接**模式（WebSocket 出站），不需要公网回调地址，云上可直接用。

## 4. 启动 + 开机自启

```bash
cd ~/app/server
pm2 start index.js --name ecommerce-agent --cwd . --log ../logs/out.log --error ../logs/err.log --merge-logs --time
pm2 save
pm2 startup   # 按提示执行它输出的那行 sudo 命令
pm2 logs ecommerce-agent   # 看启动日志
curl http://127.0.0.1:3001/api/health   # 内部自检（需要登录态，401 也算服务活着）
```

## 5. 开放端口 / 安全组（按服务商）

- **阿里云/腾讯云/华为云**：控制台 → 实例 → 安全组 → 入方向放行 **TCP 3001**（及 80/443 如果配 HTTPS）
- **Oracle Cloud**：除控制台安全列表外，**Ubuntu 镜像自带 iptables 会拦 3001**，必须额外放行：

```bash
sudo iptables -I INPUT -p tcp --dport 3001 -j ACCEPT
sudo netfilter-persistent save    # 持久化（如提示无此命令则 apt install iptables-persistent）
```

## 6. （推荐）HTTPS 反代：Caddy 一行搞定

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
yourdomain.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
sudo systemctl reload caddy   # 自动申请/续期 HTTPS 证书
```

没有域名就先用 `http://<IP>:3001` 顶着（配合强密码），或用免费域名服务（如 DuckDNS）。

## 7. 上线安全检查单

- [ ] `ALLOW_REGISTER=false`（启动日志无安全警告）
- [ ] `SESSION_SECRET` 为强随机值（非 replace-me）
- [ ] `SESSION_COOKIE_SECURE=auto`（HTTP 直连部署可保持登录；HTTPS 反代同样可用）
- [ ] 管理员密码为强密码；首次登录后改掉
- [ ] SSH 用密钥登录，关掉密码登录（`PasswordAuthentication no`）
- [ ] 数据库每日自动备份：`DAILY_BACKUP_MINUTE` 已启用，`data/backup-*` 定期用 cron 拉到本地
- [ ] 定期 `pm2 monit` 看内存/CPU（1G 内存跑这系统绰绰有余）

## 8. 常见问题

**Q: 启动报错 `ERR_MODULE_NOT_FOUND` 或 sqlite 相关错误？**
A: node 版本低于 22.5。`node -v` 检查，用 nvm 装 22 重试。

**Q: 浏览器访问不了 3001 端口？**
A: 三步排查：① 服务器本地 `curl 127.0.0.1:3001` 通不通；② 安全组/防火墙（云控制台 + iptables）；③ 云服务器是否绑定了公网 IP。

**Q: 指令报错「直连：...；Gateway：...」？**
A: 直连失败且 Gateway 不可达时的双失败提示。确认 `OPENCLAW_PROVIDER_API_KEY` 有效、`OPENCLAW_PROVIDER_BASE_URL=https://api.deepseek.com`。云上直连 deepseek 延迟一般 2-5s，比本机还快。

**Q: 数据想迁移回本地 / 换服务器？**
A: 直接打包 `data/` 目录（app.db + approvals.json）复制即可，SQLite 单文件，无需导出。

**Q: 免费服务器会被回收吗？**
A: Oracle Always Free 闲置 7 天会回收实例（CPU 使用率低触发）；国内试用到期不续费即释放。**关键数据只有 data/ 一个目录，定期备份就是全部保险**。
