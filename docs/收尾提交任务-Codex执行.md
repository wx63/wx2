# 体验优化 · 收尾提交任务（Codex 执行版）

> 背景：`docs/体验优化任务清单-Codex执行.md` 的 U1-U16 已全部完成并验证（含订单数据源 tooltip，位于 public/index.html:239 + public/styles.css:1240-1242，无需再补）。
> 本任务只做 **git 收尾**：把体验优化相关的未提交文件按项目习惯分组提交并推送。完成后工作区应干净。

---

## 1. 当前未提交状态（已核实，2026-08-16）

```
 M server/package.json                                          # test:frontend 脚本已扩展（3 个前端测试文件）
 ?? server/test/coverage.test.js                                # 后端覆盖率/API 测试（新增，从未入库）
 ?? server/test/frontend.auth.test.js                           # 登录/注册/重置页测试（新增，从未入库）
 ?? server/test/frontend.buttons.test.js                        # 主工作台按钮测试（新增，从未入库）
 ?? server/test/frontend.helpers.js                             # 前端测试公共 helper（新增，从未入库）
 ?? 测试报告-2026-08-16.md                                       # 140/145 项测试报告（根目录，建议移入 docs/）
 ?? deploy/                                                     # 部署包（ecommerce-agent-*.zip 等，建议不入库）
```

## 2. 执行步骤

### 2.1 移动测试报告到 docs/（可选但建议）
```powershell
git mv 测试报告-2026-08-16.md docs/测试报告-2026-08-16.md
# 或普通移动后 git add docs/测试报告-2026-08-16.md
```
> 若保留根目录也可接受，但项目惯例是文档进 `docs/`（参考 架构设计.md、两份优化清单）。

### 2.2 deploy/ 加入 .gitignore
`deploy/` 里是编译产物/部署包（含历史 zip，体积大、会过期），按惯例不入库。在根目录 `.gitignore` 追加：

```
# ===== 部署包（可重新生成，不入库）=====
deploy/
```

> 若希望保留部署包版本历史，可跳过本步；但至少不要提交过期 zip。

### 2.3 分组提交
参照 memory/2026-08-15.md 的分组习惯（docs / server / frontend 分开提交），建议：

```powershell
# 1) server 组：测试脚本 + 新增测试文件
git add server/package.json server/test/coverage.test.js server/test/frontend.auth.test.js server/test/frontend.buttons.test.js server/test/frontend.helpers.js
git commit -m "test: add frontend button/auth tests and coverage, extend test:frontend"

# 2) docs 组：测试报告
git add docs/测试报告-2026-08-16.md
git commit -m "docs: add full test report (145 passed)"

# 3) 根目录杂项：.gitignore
git add .gitignore
git commit -m "chore: ignore deploy artifacts"
```

### 2.4 推送
```powershell
git push origin master:main
```

## 3. 验证与收尾

1. `git status --short` → 工作区干净（除 .env / data/ 等已忽略项）
2. `cd server && npm test` → 145/145 全绿（提交前如未跑过，跑一遍确认）
3. `npm run test:frontend` → 42/42 全绿
4. `git log --oneline -5` 确认新提交在列
5. 在 `memory/2026-08-16.md` 末尾追加一行：体验优化收尾提交完成（含文件清单）

## 4. 注意事项（不要做）

- ❌ 不提交 `.env`、`data/app.db`、`data/backup/`、任何密钥（已 gitignore，注意不要 `git add -A` 误加）
- ❌ 不修改业务代码——本任务纯 git 收尾
- ❌ 不升级依赖、不动 node_modules
- ⚠️ 安全提示（仅提醒用户，不代改）：服务器 `.env` 当前 `ALLOW_REGISTER=true` + `DEFAULT_REGISTER_ROLE=operator`，公网任意注册者均可执行运营指令生成审批草稿；正式运营前建议改邀请制或 viewer（记录进 memory 即可）
