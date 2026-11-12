// dsh-web-enhance — client half（预构建 CJS bundle，零文件补丁）
//
// 功能：
//   1. 会话页右上角「归档」按钮 → POST /api/web-enhance/archive
//   2. 地址栏 #session=<id> 时打开该会话（KLab 对话测试跳转）
//
// 注意：曾用 CSS 隐藏官方右栏 ExpandButton（corner）。在 better-sidebar v0.19+
// 下右列即官方右侧栏（插件 tab 开在里面），藏掉展开钮等于失去手动开右栏入口，
// 已于 0.2.1 撤回。better-sidebar 底部工作台开关在 header.utilities，与 corner 无关。
//
// 本 bundle 为预构建 CJS（只依赖平台 seed `react`）。
window.__ModuleLoader__.load({
    id: "dsh-web-enhance",
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
        const react = require("react");
        const { createElement: h, useState } = react;

        // hover / focus 状态样式（dsh client 插件惯例）。
        if (
            typeof document !== "undefined" &&
            document.querySelector(
                'style[data-plugin-css="dsh-web-enhance"]',
            ) === null
        ) {
            const tag = document.createElement("style");
            tag.setAttribute("data-plugin-css", "dsh-web-enhance");
            tag.textContent = [
                ".dsh-enhance-archive-btn:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}",
                ".dsh-enhance-archive-btn:focus{outline:var(--dsw-alias-focus-ring,2px solid #3b82f6);outline-offset:1px}",
                ".dsh-enhance-archive-btn[aria-busy=true]{opacity:0.6;cursor:not-allowed}",
            ].join("\n");
            document.head.appendChild(tag);
        }

        /** Locale namespace. */
        const NS = "webEnhance";
        const zh = {
            archive: "归档",
            archiving: "归档中…",
            "archive.title": "归档当前会话",
            "archive.error": "归档失败",
        };
        const en = {
            archive: "Archive",
            archiving: "Archiving…",
            "archive.title": "Archive this session",
            "archive.error": "Archive failed",
        };

        /** 归档图标（内联 SVG，避免依赖 primitives bundle）。 */
        function ArchiveIcon({ size }) {
            size = size || 16;
            return h(
                "svg",
                {
                    width: size,
                    height: size,
                    viewBox: "0 0 16 16",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: 1.4,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    "aria-hidden": true,
                },
                h("path", {
                    d: "M2.5 5.5h11v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8Z",
                }),
                h("path", { d: "M1.5 2.5h13v3h-13v-3Z" }),
                h("path", { d: "M5.5 9h5" }),
            );
        }

        /**
         * 会话页右上角「归档」按钮。
         * @param props.sessionId  - 当前会话 id（PropsRuntime scope=session 提供）。
         * @param props.t        - locale 翻译函数。
         */
        function ArchiveButton({ sessionId, t }) {
            const [busy, setBusy] = useState(false);
            const [error, setError] = useState(null);

            async function onClick() {
                if (busy) return;
                setBusy(true);
                setError(null);
                try {
                    const res = await fetch("/api/web-enhance/archive", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ sessionId: String(sessionId) }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.ok) {
                        throw new Error(data.error || "HTTP " + res.status);
                    }
                    // 归档成功后，session 进入 archived 态，header 组件会被 dsh 框架卸载；
                    // 本组件自然从 DOM 消失，无需更多状态管理。
                } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                    setBusy(false);
                }
            }

            const label = error
                ? t("archive.error") + ": " + error
                : t("archive.title");
            return h(
                "button",
                {
                    type: "button",
                    className: "dsh-enhance-archive-btn",
                    style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        height: "28px",
                        padding: "0 8px",
                        border: "none",
                        borderRadius: "6px",
                        background: "transparent",
                        color: error
                            ? "var(--dsw-alias-destructive)"
                            : "var(--dsw-alias-label-secondary)",
                        cursor: busy ? "not-allowed" : "pointer",
                        font: "inherit",
                        fontSize: "13px",
                        opacity: busy ? "0.6" : "1",
                    },
                    title: label,
                    "aria-label": label,
                    "aria-busy": busy ? "true" : undefined,
                    disabled: busy,
                    onClick: onClick,
                },
                error
                    ? h("span", { style: { fontSize: "12px" } }, "⚠")
                    : h(ArchiveIcon, { size: 16 }),
                h("span", null, t(busy ? "archiving" : "archive")),
            );
        }

        const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

        function sessionFromHash() {
            const raw = String(window.location.hash || "").replace(/^#/, "");
            if (!raw) return "";
            const session = new URLSearchParams(raw).get("session") || "";
            return SESSION_ID.test(session) ? session : "";
        }

        /**
         * 打开 hash 里的会话。列表还没包含该 id 时 retain 会抛错，调用方重试。
         * beginNavigation 取消启动时正在恢复的旧会话，避免它稍后盖回来。
         */
        function openHashedSession(ctx) {
            const sessionId = sessionFromHash();
            if (!sessionId) return false;
            const layout = ctx.get("layout");
            const workspace = ctx.get("uiWorkspace");
            if (!workspace || typeof workspace.openSession !== "function") return false;
            if (layout && typeof layout.beginNavigation === "function") {
                layout.beginNavigation();
            }
            workspace.openSession(sessionId);
            return true;
        }

        function watchSessionHash(ctx) {
            let timer = 0;
            const stopTimer = () => {
                if (!timer) return;
                window.clearTimeout(timer);
                timer = 0;
            };
            const run = () => {
                stopTimer();
                let attempts = 0;
                const tick = () => {
                    if (!sessionFromHash()) return;
                    try {
                        if (openHashedSession(ctx)) return;
                    } catch (error) {
                        if (attempts >= 39) {
                            console.warn("[dsh-web-enhance] openSession failed:", error);
                        }
                    }
                    attempts += 1;
                    if (attempts < 40) timer = window.setTimeout(tick, 250);
                };
                tick();
            };
            run();
            window.addEventListener("hashchange", run);
            return () => {
                stopTimer();
                window.removeEventListener("hashchange", run);
            };
        }

        /** slots / locale 给归档按钮；uiWorkspace / layout 给 #session= 跳转。 */
        const inject = ["slots", "locale", "uiWorkspace", "layout"];

        /**
         * 注册入口：i18n + conversation.session.header.actions 附加位。
         * @param ctx - client root context。
         */
        function apply(ctx) {
            ctx.effect(
                () => ctx.locale.register(NS, { zh, en }),
                "dsh-web-enhance: dictionaries",
            );
            ctx.slots.inject("conversation.session.header.actions", () =>
                ctx.slots.register(
                    {
                        name: "conversation.session.header.actions",
                        id: "dsh-web-enhance-archive",
                        locale: NS,
                        // order 90：放在 header actions 靠右位置（在系统按钮之后）。
                        order: 90,
                    },
                    ArchiveButton,
                ),
            );
            ctx.effect(
                () => watchSessionHash(ctx),
                "dsh-web-enhance: session hash",
            );
        }

        exports.apply = apply;
        exports.inject = inject;
        return module.exports;
    },
});
