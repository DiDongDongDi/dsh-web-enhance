# dsh-web-enhance

DeepSeek Harness **Web GUI 增强**插件集合（Cordis 纯插件，零文件补丁，升级不丢）。

当前包含功能：

## 1. 会话页「归档」按钮

在会话页右上角（header 操作区）新增「归档」按钮，点击把**当前会话**移入归档态，
与社区插件 [dsh-session-unarchive](https://github.com/dylan121322/dsh-session-unarchive)
的「已归档 → 恢复」对称：归档后会话从所有视图消失，需要时用 unarchive 插件恢复。

- **Host 半**（`index.js`）：注册 `POST /api/web-enhance/archive`，调用 workspace registry
  的 `archiveSession(sessionId)`（缺失时回退 `enqueueOperation/requireState/setState` 追加
  `archivedSessionIds`，与内置实现同构）；setState 持久化后 workspace 变更流自动广播，
  内置 UI 无需额外刷新。
- **Client 半**（`client.js`）：预构建 CJS bundle（`window.__ModuleLoader__.load`），注册到
  `conversation.session.header.actions`（`replaceRisk: none`），点击直接归档，无二次确认。

## 安装

```bash
cd "$DSH_HOME/profiles/web"          # 例如 ~/.dsh/profiles/web
# 1) package.json dependencies 加：
#      "dsh-web-enhance": "github:DiDongDongDi/dsh-web-enhance"
# 2) dsh.profile.bundles 追加 "dsh-web-enhance"
# 3) pnpm install，重启 dsh（dsh web），刷新浏览器
```

本插件不修改 dsh 安装目录下任何文件，`npm update @deepseek-ai/dsh` 不会覆盖它。

## 兼容性

基于 workspace registry 的运行时内部方法（与 dsh-session-unarchive 同一批 API），
版本无强绑定；若上游重构导致 API 缺失，端点在能力检测失败时返回 500 提示，
不会破坏 dsh 或 workspace 数据。

## 验证

1. 打开任意会话，右上角出现「归档」按钮；
2. 点击后会话从列表消失，进入归档态（可装 dsh-session-unarchive 查看「已归档」面板确认）；
3. 用 unarchive 的「恢复」可还原会话。

## 贡献

后续 web GUI 增强功能（新按钮、新面板）在 `client.js` 追加 seat 注册即可，仓库作增强容器长期演进。
