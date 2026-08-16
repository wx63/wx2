# DEPLOY.md — OpenClaw 部署执行手册（2026-08-16）

> OpenClaw 收到“部署上服务器 / 更新远程 / 上线”时，先读本文件。
> 本手册只做**代码更新**，不覆盖服务器 `data/` 和 `.env`。

## 1. 本次目标

- 服务器：`http://106.55.18.244:3001`
- 更新内容：最新前后端代码，重点修复未登录访问根路径不跳转登录页的问题。
- 更新包：`E:\基于OpenClaw构建跨境电商智能体\基于OpenClaw构建跨境电商智能体\deploy\ecommerce-agent-update-latest.zip`
- 更新包已验证：不含 `data/`，不含 `.env`，包含最新 `public/app.js` 和 `server/index.js`。

## 2. 先确认远程当前状态

```bash
pm2 list
pm2 describe ecommerce-agent | head -n 20
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/login.html
curl -s http://127.0.0.1:3001/app.js | grep -c "redirectToLogin" || true
```

如果 `redirectToLogin` 数量是 `0`，说明远程确实落后，需要执行下面的更新。
如果 `pm2 describe` 显示的目录不是 `~/app`，把后面的 `APP_DIR` 换成实际目录。

## 3. 方式 A：本机 OpenClaw 有 SSH 权限（推荐）

以下命令在 Windows 本机执行，SSH 用户名按服务器实际值替换：

```powershell
$serverUser = "ubuntu"
$serverIp = "106.55.18.244"
$zip = "E:\基于OpenClaw构建跨境电商智能体\基于OpenClaw构建跨境电商智能体\deploy\ecommerce-agent-update-latest.zip"

scp $zip "${serverUser}@${serverIp}:~/ecommerce-agent-update-latest.zip"
ssh "${serverUser}@${serverIp}"
```

进入服务器后执行：

```bash
APP_DIR="$HOME/app"
mkdir -p "$APP_DIR"
unzip -o "$HOME/ecommerce-agent-update-latest.zip" -d "$APP_DIR"
cd "$APP_DIR/server"
npm install
pm2 restart ecommerce-agent --update-env
pm2 save
```

如果服务器目录不是 `~/app`，先执行：

```bash
pm2 describe ecommerce-agent | head -n 20
```

然后把 `APP_DIR` 改成 PM2 显示的目录，再重复上面命令。

## 4. 方式 B：OpenClaw 在服务器上，且项目有 git

如果服务器项目是从本仓库 clone 的，并且已经配置过 `origin/main`，可以直接：

```bash
cd /path/to/ecommerce-agent
git pull origin main
cd server
npm install
pm2 restart ecommerce-agent --update-env
pm2 save
```

注意：`git pull` 方式只能拿到仓库里的代码，拿不到本机 `deploy/` 里的部署包。最新代码提交已经推送到 `origin/main`。

## 5. 验证远程是否更新成功

服务器本地验证：

```bash
curl -s http://127.0.0.1:3001/app.js | grep -c "redirectToLogin" || true
curl -s http://127.0.0.1:3001/login.html | grep -o "欢迎回来" | head -n 1
curl -s http://127.0.0.1:3001/api/auth/register-status
```

公网验证：

```powershell
Invoke-WebRequest -Uri 'http://106.55.18.244:3001/app.js' -UseBasicParsing | Select-Object -ExpandProperty Content | Select-String -Pattern 'redirectToLogin'
```

浏览器验证：

1. 打开 `http://106.55.18.244:3001/`
2. 未登录时应自动跳到 `/login.html`
3. 登录后应进入运营控制台，中文正常，无乱码
4. 输入“你好”，应能完成路由并显示产出

## 6. 不做什么

- 不覆盖服务器 `.env`
- 不覆盖服务器 `data/app.db`
- 不执行数据库迁移（本次 SQLite 结构未变）
- 不打印服务器密钥、管理员密码、DeepSeek API Key
- 不修改远程 `ALLOW_REGISTER`；公网保持 `false`

## 7. 回滚

如果更新后服务异常：

```bash
cd "$APP_DIR"
ls -la
pm2 logs ecommerce-agent --lines 100
pm2 restart ecommerce-agent
```

最稳妥回滚方式：把服务器 `server/` 和 `public/` 先备份，再从旧的完整部署包解压对应文件。`data/` 和 `.env` 一直不要覆盖。

## 8. 完成判定

- [ ] `pm2 list` 中 `ecommerce-agent` 为 `online`
- [ ] `redirectToLogin` 在远程 `app.js` 中出现
- [ ] 未登录访问 `/` 自动跳 `/login.html`
- [ ] 登录页中文正常
- [ ] 登录后可进入控制台
- [ ] `ALLOW_REGISTER=false` 保持
