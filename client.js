// dsh-web-enhance — client half（预构建 CJS bundle，零文件补丁）
//
// 功能 1：在会话页右上角（conversation.session.header.actions）注册「归档」按钮，
// 点击将当前会话移入归档态（调用 host 端 POST /api/web-enhance/archive）。
//
// 功能 2：在对话正文区选中文本后弹出「添加到对话」浮窗，点击把选中内容以
// Markdown 引用块追加进输入框草稿（纯 client，无 host 端参与）：
//   - 挂载位：conversation.input.overlay（list / scope session），锚点是
//     position:absolute;height:0，对布局零影响，且只在有会话时渲染；
//   - 浮窗本体用 react-dom createPortal 挂到 document.body（react-dom 是平台
//     seed 词，插件 bundle 可直接 require）；
//   - 写草稿走框架注入的官方 API inputActions.setDraft(text)（输入框是 Lexical
//     contenteditable，不能用 DOM 注入）。
//
// 数据通路：
//   - 当前会话 id：PropsRuntime scope=session → sessionId
//   - 归档动作：fetch POST /api/web-enhance/archive { sessionId }
//   - 成功后 session 进入 archived，内置视图自动隐藏（dsh workspace 流广播
//     host/archived-sessions-changed，client store 同步），当前会话 header
//     消失（切换到 no-session hero），无需本地状态管理。
//
// 本 bundle 为预构建 CJS 格式（dsh client module 系统约定），只依赖平台
// seed word `react`，不依赖任何其他插件的 client bundle。
window.__ModuleLoader__.load({
	id: "dsh-web-enhance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { createElement: h, useState, useEffect, useRef } = react;
		// react-dom 同为平台 seed 词（packages/client/web/src/platform.ts），
		// 用于把选区浮窗 portal 到 document.body，绕开对话区的滚动裁剪。
		const reactDom = require("react-dom");
		const createPortal = typeof reactDom.createPortal === "function"
			? reactDom.createPortal
			: (reactDom.default && reactDom.default.createPortal);

		// hover / focus 状态样式（dsh client 插件惯例，使用 dsh 设计系统变量）。
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-web-enhance"]') === null) {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", "dsh-web-enhance");
			tag.textContent = [
				".dsh-enhance-archive-btn:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}",
				".dsh-enhance-archive-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
				".dsh-enhance-archive-btn[aria-busy=true]{opacity:0.6;cursor:not-allowed}",
				// 选区浮窗：portal 到 body，z-index 高于 shell.overlay 层（z=20）。
				// 配色照搬 dsh 自己的浮层配方（ui-dockkit 的 .float）：设计令牌定义在
				// body / body[data-ds-dark-theme] 上，portal 到 body 的元素照样继承，
				// 深浅色自动跟随。绝不写颜色兜底值——令牌名写错时白底白字，而不是报错。
				".dsh-enhance-quote-pop{position:fixed;z-index:60;display:inline-flex;align-items:center;gap:6px;"
				+ "height:30px;padding:0 10px;border-radius:8px;white-space:nowrap;cursor:pointer;user-select:none;"
				+ "background:var(--dsw-alias-bg-layer-1);"
				+ "border:0.5px solid var(--dsw-alias-border-l2);"
				+ "box-shadow:0 8px 24px var(--dsw-alias-bg-mask-drop);"
				+ "color:var(--dsw-alias-label-primary);"
				+ "font:inherit;font-size:13px;line-height:1}",
				// 浮窗自身就是不透明面，hover 用 solid 变体；半透明的
				// interactive-bg-hover 会把面盖掉、透出底下的正文。
				".dsh-enhance-quote-pop:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
				".dsh-enhance-quote-pop:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}"
			].join("\n");
			document.head.appendChild(tag);
		}

		/** Locale namespace. */
		const NS = "webEnhance";
		const zh = {
			"archive": "归档",
			"archiving": "归档中…",
			"archive.title": "归档当前会话",
			"archive.error": "归档失败",
			"quote.add": "添加到对话",
			"quote.title": "把选中内容作为引用追加到输入框"
		};
		const en = {
			"archive": "Archive",
			"archiving": "Archiving…",
			"archive.title": "Archive this session",
			"archive.error": "Archive failed",
			"quote.add": "Add to chat",
			"quote.title": "Append the selected text to the composer as a quote"
		};

		/** 归档图标（内联 SVG，避免依赖 primitives bundle）。 */
		function ArchiveIcon({ size }) {
			size = size || 16;
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			}, h("path", { d: "M2.5 5.5h11v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8Z" }),
				h("path", { d: "M1.5 2.5h13v3h-13v-3Z" }),
				h("path", { d: "M5.5 9h5" }));
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
						body: JSON.stringify({ sessionId: String(sessionId) })
					});
					const data = await res.json();
					if (!res.ok || !data.ok) {
						throw new Error(data.error || ("HTTP " + res.status));
					}
					// 归档成功后，session 进入 archived 态，header 组件会被 dsh 框架卸载；
					// 本组件自然从 DOM 消失，无需更多状态管理。
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
					setBusy(false);
				}
			}

			const label = error ? t("archive.error") + ": " + error : t("archive.title");
			return h("button", {
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
					color: error ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)",
					cursor: busy ? "not-allowed" : "pointer",
					font: "inherit",
					fontSize: "13px",
					opacity: busy ? "0.6" : "1"
				},
				title: label,
				"aria-label": label,
				"aria-busy": busy ? "true" : undefined,
				disabled: busy,
				onClick: onClick
			}, error
				? h("span", { style: { fontSize: "12px" } }, "⚠")
				: h(ArchiveIcon, { size: 16 }),
				h("span", null, t(busy ? "archiving" : "archive")));
		}

		// ---- 功能 2：选中文本「添加到对话」 ----

		/** 选区必须落在对话列（含正文与 composer），由 ConversationRoot 打上。 */
		const QUOTE_SCOPE = "[data-conversation-scroll]";
		/** 但要排除 composer 自身：在输入框里选字不该弹浮窗。 */
		const QUOTE_EXCLUDE = "[data-composer-seat]";
		/** 浮窗与选区的间距 & 估算半宽（用于视口边界钳制）。 */
		const POP_GAP = 8;
		const POP_HALF_WIDTH = 70;

		/** 「添加到对话」图标（气泡 + 加号，内联 SVG）。 */
		function QuoteIcon({ size }) {
			size = size || 14;
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			}, h("path", { d: "M14 8.6a4.6 4.6 0 0 1-4.6 4.6H6.6L3.4 15v-2.5A4.6 4.6 0 0 1 1.8 9V8.4A4.6 4.6 0 0 1 6.4 3.8h3.2A4.6 4.6 0 0 1 14 8.4v0.2Z" }),
				h("path", { d: "M7.9 6.8v3.2" }),
				h("path", { d: "M6.3 8.4h3.2" }));
		}

		/**
		 * 读取当前选区，返回浮窗所需的文本与定位信息；不满足条件时返回 null。
		 * 条件：非折叠、去空白后非空、锚点在对话列内且不在 composer 内。
		 */
		function readSelection() {
			if (typeof window === "undefined" || typeof window.getSelection !== "function") return null;
			const selection = window.getSelection();
			if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
			const text = selection.toString();
			if (text.trim() === "") return null;
			const range = selection.getRangeAt(0);
			const node = range.commonAncestorContainer;
			const element = node.nodeType === 1 ? node : node.parentElement;
			if (element === null || typeof element.closest !== "function") return null;
			if (element.closest(QUOTE_SCOPE) === null) return null;
			if (element.closest(QUOTE_EXCLUDE) !== null) return null;
			const rect = range.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) return null;
			return {
				text: text,
				top: rect.top,
				bottom: rect.bottom,
				center: rect.left + rect.width / 2
			};
		}

		/** 两次选区快照是否等价（避免滚动/鼠标事件引起的无谓重渲染）。 */
		function samePlacement(prev, next) {
			return prev !== null
				&& prev.text === next.text
				&& Math.abs(prev.top - next.top) < 0.5
				&& Math.abs(prev.center - next.center) < 0.5;
		}

		/** 选中文本 → Markdown 引用块（逐行加 "> "，掐掉首尾空行与行尾空白）。 */
		function toQuote(text) {
			const lines = text.replace(/\r\n?/g, "\n").split("\n");
			while (lines.length > 0 && lines[0].trim() === "") lines.shift();
			while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
			if (lines.length === 0) return "";
			return lines.map((line) => ("> " + line).replace(/\s+$/, "")).join("\n");
		}

		/**
		 * 选区浮窗：注册在 conversation.input.overlay（零高度锚点），自身不占布局，
		 * 浮窗通过 portal 渲染到 document.body。
		 * @param props.useInput      - 输入框状态选择器 hook（读当前草稿）。
		 * @param props.inputActions  - 输入框官方动作面（setDraft）。
		 * @param props.t             - locale 翻译函数。
		 */
		function SelectionQuoteSurface({ useInput, inputActions, t }) {
			const [placement, setPlacement] = useState(null);
			const popRef = useRef(null);
			const frameRef = useRef(0);
			// 草稿只在点击时读，用 ref 避免把它写进 effect 依赖。
			const draft = useInput((state) => state.draft);
			const draftRef = useRef(draft);
			draftRef.current = draft;

			useEffect(() => {
				let disposed = false;

				function sync() {
					frameRef.current = 0;
					if (disposed) return;
					setPlacement((prev) => {
						const next = readSelection();
						if (next === null) return prev === null ? prev : null;
						return samePlacement(prev, next) ? prev : next;
					});
				}

				// selectionchange / mouseup / scroll 都很密集，统一压到一帧内。
				function schedule() {
					if (frameRef.current !== 0) return;
					frameRef.current = window.requestAnimationFrame(sync);
				}

				function hide() {
					setPlacement((prev) => (prev === null ? prev : null));
				}

				function onKeyDown(event) {
					if (event.key === "Escape") hide();
				}

				// 点击浮窗以外的任何地方先收起；若那次点击是新一轮拖选，mouseup 会重新算。
				function onMouseDown(event) {
					const pop = popRef.current;
					if (pop !== null && pop.contains(event.target)) return;
					hide();
				}

				document.addEventListener("selectionchange", schedule);
				document.addEventListener("mouseup", schedule);
				document.addEventListener("mousedown", onMouseDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				// capture：对话正文的滚动容器不在冒泡路径上。
				window.addEventListener("scroll", schedule, true);
				window.addEventListener("resize", schedule);

				return () => {
					disposed = true;
					if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current);
					document.removeEventListener("selectionchange", schedule);
					document.removeEventListener("mouseup", schedule);
					document.removeEventListener("mousedown", onMouseDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
					window.removeEventListener("scroll", schedule, true);
					window.removeEventListener("resize", schedule);
				};
			}, []);

			function onAdd() {
				if (placement === null) return;
				const quoted = toQuote(placement.text);
				if (quoted === "") return;
				const current = typeof draftRef.current === "string" ? draftRef.current : "";
				// setDraft 是整稿替换：先拼好「已有草稿 + 空行 + 引用块」再写回，
				// 光标由 setDraft 落到末尾，用户可直接接着打字。
				const next = current.trim() === ""
					? quoted + "\n\n"
					: current.replace(/\s+$/, "") + "\n\n" + quoted + "\n\n";
				inputActions.setDraft(next);
				const selection = window.getSelection();
				if (selection !== null) selection.removeAllRanges();
				setPlacement(null);
			}

			if (placement === null || typeof createPortal !== "function" || typeof document === "undefined") {
				return null;
			}

			// 默认贴在选区上方；顶部空间不够时翻到下方。水平居中并钳进视口。
			const above = placement.top > 48;
			const left = Math.min(
				Math.max(placement.center, POP_HALF_WIDTH + POP_GAP),
				window.innerWidth - POP_HALF_WIDTH - POP_GAP
			);
			const label = t("quote.title");

			return createPortal(h("button", {
				ref: popRef,
				type: "button",
				className: "dsh-enhance-quote-pop",
				style: {
					top: (above ? placement.top - POP_GAP : placement.bottom + POP_GAP) + "px",
					left: left + "px",
					transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)"
				},
				title: label,
				"aria-label": label,
				// 阻止默认行为，否则按下瞬间选区就被清掉，onClick 里读不到内容。
				onMouseDown: (event) => { event.preventDefault(); },
				onClick: onAdd
			}, h(QuoteIcon, { size: 14 }), h("span", null, t("quote.add"))), document.body);
		}

		/**
		 * 能力检测外壳：框架若改了 session 标准 props（useInput / inputActions），
		 * 本插件安静退场，而不是在 composer 里抛错拖垮输入框渲染。检测放在
		 * hooks 之前，条件在组件生命周期内恒定，不违反 hooks 规则。
		 */
		function SelectionQuoteButton(props) {
			if (typeof props.useInput !== "function") return null;
			if (props.inputActions === undefined || props.inputActions === null) return null;
			if (typeof props.inputActions.setDraft !== "function") return null;
			if (typeof createPortal !== "function") return null;
			return h(SelectionQuoteSurface, props);
		}

		/** cordis service 依赖：slots（附加位注册）+ locale（i18n 字典）。 */
		const inject = ["slots", "locale"];

		/**
		 * 注册入口：i18n + conversation.session.header.actions（归档按钮）
		 * + conversation.input.overlay（选区「添加到对话」浮窗）。
		 * @param ctx - client root context。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-web-enhance: dictionaries");
			ctx.slots.inject(
				"conversation.session.header.actions",
				() => ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "dsh-web-enhance-archive",
					locale: NS,
					// order 90：放在 header actions 靠右位置（在系统按钮之后）。
					order: 90
				}, ArchiveButton)
			);
			ctx.slots.inject(
				"conversation.input.overlay",
				() => ctx.slots.register({
					name: "conversation.input.overlay",
					id: "dsh-web-enhance-selection-quote",
					locale: NS,
					// 浮窗自身 portal 到 body，order 只决定锚点里的兄弟顺序。
					order: 50
				}, SelectionQuoteButton)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
