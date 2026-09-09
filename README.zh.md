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

## 2. 选中文本「添加到对话」浮窗

在对话正文区选中任意文本，选区上方弹出「添加到对话」浮窗；点击后选中内容以
**Markdown 引用块**（逐行 `> `）追加到输入框草稿末尾，省掉手动复制粘贴。

- **纯 client 实现**，不涉及 host 端接口。挂载位是 `conversation.input.overlay`
  （`list` / `scope: session`），其锚点为 `position:absolute;height:0`，对布局零影响，
  且只在有会话时渲染；浮窗本体用 `react-dom` 的 `createPortal` 挂到 `document.body`，
  绕开对话区的滚动裁剪（`react-dom` 是平台 seed 词，插件 bundle 可直接 `require`）。
- **选区范围校验**：只在 `[data-conversation-scroll]` 内、且不在 `[data-composer-seat]`
  内的选区才弹窗——即在输入框里选字不会打扰。
- **写草稿走官方 API** `inputActions.setDraft(text)`（框架注入给 session 作用域 slot 的
  标准 props）。输入框是 Lexical contenteditable，DOM 注入无效，故不做 DOM hack。
- 浮窗按下时 `preventDefault`，避免选区被清空；滚动/缩放时跟随选区，点击别处、
  按 `Esc` 或选区消失时自动收起。
- 若框架改动导致 `useInput` / `inputActions.setDraft` 缺失，组件做能力检测后静默返回
  `null`，不会拖垮输入框渲染。

**已知限制**：`setDraft` 是整稿替换，且会剥掉引用占位符。因此若草稿里已有 `@文件`
引用 chip，追加引用会把这些 chip 摊平成纯文本。这是官方唯一开放的写草稿 API 的
固有行为（见本体 `packages/client/ui-conversation/src/client/input/facade.ts`）。

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

归档功能基于 workspace registry 的运行时内部方法（与 dsh-session-unarchive 同一批 API），
版本无强绑定；若上游重构导致 API 缺失，端点在能力检测失败时返回 500 提示，
不会破坏 dsh 或 workspace 数据。

「添加到对话」只依赖两处公开约定：session 作用域 slot 的标准 props
（`useInput` / `inputActions.setDraft`）与 DOM 标记 `[data-conversation-scroll]`
/ `[data-composer-seat]`。缺失时组件静默不渲染（已在 dsh 0.1.2-rc.1 核对通过）。

## 验证

归档按钮：

1. 打开任意会话，右上角出现「归档」按钮；
2. 点击后会话从列表消失，进入归档态（可装 dsh-session-unarchive 查看「已归档」面板确认）；
3. 用 unarchive 的「恢复」可还原会话。

「添加到对话」浮窗：

1. 在助手回复或自己的消息里选中一段文字，选区上方出现「添加到对话」浮窗；
2. 点击后输入框出现 `> ...` 引用块（已有草稿则空一行追加），光标落在末尾；
3. 在输入框里选中文本不应弹浮窗；滚动时浮窗跟随选区，按 `Esc` 或点击别处收起。

## 贡献

后续 web GUI 增强功能（新按钮、新面板）在 `client.js` 追加 seat 注册即可，仓库作增强容器长期演进。
