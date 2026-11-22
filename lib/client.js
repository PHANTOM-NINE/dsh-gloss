window.__ModuleLoader__.load({
	id: "dsh-gloss",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		//#region gloss-card CSS
		const CSS = `
.gloss-card{position:fixed;z-index:2147483647;max-width:380px;min-width:220px;
  padding:11px 13px 13px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;line-height:20px;
  box-shadow:0 6px 24px rgba(0,0,0,.18);border:.5px solid var(--dsw-alias-border-l4,#e5e7eb)}
.gloss-word{font-weight:600;font-size:15px;line-height:22px;margin-bottom:4px}
.gloss-ipa{color:var(--dsw-alias-label-caption,#656d76);font-size:12px;margin-bottom:8px}
.gloss-row{display:flex;gap:6px;margin-top:4px}
.gloss-label{flex:0 0 44px;color:var(--dsw-alias-label-caption,#656d76)}
.gloss-value{flex:1 1 auto;word-break:break-word}
.gloss-hint{margin-top:8px;padding-top:7px;border-top:.5px solid var(--dsw-alias-border-l4,#e5e7eb);
  color:var(--dsw-alias-label-caption,#656d76);font-size:11px;line-height:16px}
.gloss-speak{float:right;cursor:pointer;border:0;background:transparent;color:inherit;font-size:14px;line-height:16px}
.gloss-close{float:right;cursor:pointer;border:0;background:transparent;color:var(--dsw-alias-label-caption,#656d76);font-size:14px;line-height:16px}
`;
		const CSS_TAG = "dsh-gloss-card";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + CSS_TAG + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-gloss";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		// v3: selection-triggered, offline dictionary only. No model call — the
		// card opens in milliseconds. Bumping the cache prefix drops v2 entries.
		const STORE_KEY = "dsh-gloss:v3:";
		const STORE_LIMIT = 500;
		const STORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
		const STOPWORDS = new Set(("the a an of and or to in on at by for with is are was were be been it its this that these those as from but not no nor into over under again more most some such only own same so than too very can will just don should now via per etc").split(/\s+/));

		function readCache(word) {
			try {
				if (typeof localStorage === "undefined") return null;
				const raw = localStorage.getItem(STORE_KEY + word);
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				if (Date.now() - (parsed.at ?? 0) > STORE_TTL_MS) return null;
				return parsed.result;
			} catch { return null; }
		}

		function writeCache(word, result) {
			try {
				if (typeof localStorage === "undefined") return;
				localStorage.setItem(STORE_KEY + word, JSON.stringify({ at: Date.now(), result }));
				const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORE_KEY));
				while (keys.length > STORE_LIMIT) {
					const oldest = keys.shift();
					if (oldest) localStorage.removeItem(oldest);
				}
			} catch { /* storage full or blocked — degrade silently */ }
		}

		/**
		 * Turn a raw text selection into one lookup term. Supports a single word
		 * (the common case) or a short phrase — for a phrase we look up its
		 * longest non-stopword token. Inline-code selections work naturally here
		 * because we read the selection text, not the DOM node type.
		 */
		function normalizeSelection(raw) {
			if (!raw) return null;
			const text = raw.replace(/\s+/g, " ").trim();
			if (text.length < 2 || text.length > 80) return null;
			if (!/^[\p{L}\p{M}]+([\s'’\-][\p{L}\p{M}]+)*$/u.test(text)) return null;
			const parts = text.split(/[\s'’\-]+/).filter(Boolean);
			if (!parts.length || parts.length > 6) return null;
			const content = parts.filter((p) => !STOPWORDS.has(p.toLowerCase()));
			if (!content.length) return null;
			content.sort((a, b) => b.length - a.length);
			const term = content[0];
			if (term.length < 2 || term.length > 40 || /^\d+$/.test(term)) return null;
			return term;
		}

		function inExcluded(node) {
			const el = node && (node.nodeType === 1 ? node : node.parentElement);
			if (!el || !el.closest) return false;
			// Inline <code> is intentionally NOT excluded — technical terms live there.
			return Boolean(el.closest("pre,input,textarea,[contenteditable='true']"));
		}

		function rectOfSelection() {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			if (!rect || (rect.width === 0 && rect.height === 0)) return null;
			return { x: rect.left + rect.width / 2, y: rect.bottom };
		}

		function pickVoice() {
			try {
				if (typeof speechSynthesis === "undefined" || !speechSynthesis.getVoices) return null;
				const voices = speechSynthesis.getVoices();
				const preferred = ["Samantha", "Daniel", "Google US English"];
				for (const name of preferred) {
					const hit = voices.find((v) => (v.name ?? "").includes(name));
					if (hit) return hit;
				}
				return voices.find((v) => (v.lang ?? "").toLowerCase().startsWith("en")) ?? null;
			} catch { return null; }
		}

		function GlossOverlay() {
			const cardRef = react.useRef(null);
			const [result, setResult] = react.useState(null);
			const [error, setError] = react.useState(null);
			const tokenRef = react.useRef(0);
			const controllerRef = react.useRef(null);
			const voiceRef = react.useRef(null);
			const posRef = react.useRef({ x: 0, y: 0 });

			const hide = () => {
				tokenRef.current += 1;
				controllerRef.current?.abort();
				setResult(null);
				setError(null);
			};

			react.useEffect(() => {
				const onSelect = () => {
					const sel = window.getSelection();
					if (!sel || sel.isCollapsed) return;
					const term = normalizeSelection(sel.toString());
					if (!term) return;
					if (inExcluded(sel.anchorNode)) return;
					const rect = rectOfSelection();
					if (!rect) return;
					posRef.current = rect;

					const key = term.toLowerCase();
					const cached = readCache(key);
					if (cached) {
						tokenRef.current += 1;
						setResult(cached);
						setError(null);
						return;
					}

					controllerRef.current?.abort();
					const controller = new AbortController();
					controllerRef.current = controller;
					const token = ++tokenRef.current;
					setResult(null);
					setError(null);

					// Host-side dictionary lookup over localhost: no model, <10ms.
					fetch("/api/gloss/quick?word=" + encodeURIComponent(key), { signal: controller.signal })
						.then((res) => res.ok ? res.json() : null)
						.then((data) => {
							if (token !== tokenRef.current) return;
							if (data && (data.origin || data.ipa)) {
								const full = { ...data, word: term };
								setResult(full);
								writeCache(key, full);
							} else {
								setError("词库暂未收录此词");
							}
						})
						.catch((e) => {
							if (token !== tokenRef.current) return;
							setError("查询失败：" + String(e?.message ?? e));
						});
				};

				const onPointerDown = (event) => {
					const card = cardRef.current;
					if (card && !card.contains(event.target)) {
						setResult(null);
						setError(null);
					}
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") hide();
				};

				window.addEventListener("mouseup", onSelect);
				window.addEventListener("keyup", onSelect);
				window.addEventListener("pointerdown", onPointerDown, true);
				window.addEventListener("keydown", onKeyDown);
				return () => {
					controllerRef.current?.abort();
					window.removeEventListener("mouseup", onSelect);
					window.removeEventListener("keyup", onSelect);
					window.removeEventListener("pointerdown", onPointerDown, true);
					window.removeEventListener("keydown", onKeyDown);
				};
			}, []);

			react.useLayoutEffect(() => {
				const el = cardRef.current;
				if (!el) return;
				const { x, y } = posRef.current;
				const w = el.offsetWidth || 240;
				const h = el.offsetHeight || 100;
				el.style.left = `${Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8))}px`;
				el.style.top = `${Math.max(8, Math.min(y + 8, window.innerHeight - h - 8))}px`;
			}, [result, error]);

			const speak = () => {
				if (typeof speechSynthesis === "undefined") return;
				const voice = voiceRef.current ?? pickVoice();
				voiceRef.current = voice;
				const utter = new SpeechSynthesisUtterance(result?.word ?? "");
				if (voice) utter.voice = voice;
				utter.lang = "en-US";
				utter.rate = 0.9;
				speechSynthesis.speak(utter);
			};

			if (!result && !error) return null;

			return (0, react_jsx_runtime.jsx)("div", {
				ref: cardRef,
				className: "gloss-card",
				style: { left: "-9999px", top: "-9999px" },
				children: [
					result?.word
						? (0, react_jsx_runtime.jsxs)("div", {
							className: "gloss-word",
							children: [
								(0, react_jsx_runtime.jsx)("span", { children: result.word }),
								typeof speechSynthesis !== "undefined"
									? (0, react_jsx_runtime.jsx)("button", { className: "gloss-speak", title: "朗读", onClick: speak, children: "🔈" })
									: null,
								(0, react_jsx_runtime.jsx)("button", { className: "gloss-close", title: "关闭", onClick: hide, children: "×" })
							]
						})
						: null,
					result?.ipa
						? (0, react_jsx_runtime.jsxs)("div", {
							className: "gloss-ipa",
							children: [result.pos ? result.pos + "  " : "", result.ipa]
						})
						: null,
					result?.origin
						? (0, react_jsx_runtime.jsxs)("div", {
							className: "gloss-row",
							children: [
								(0, react_jsx_runtime.jsx)("div", { className: "gloss-label", children: "解读" }),
								(0, react_jsx_runtime.jsx)("div", { className: "gloss-value", children: result.origin })
							]
						})
						: null,
					error && !result
						? (0, react_jsx_runtime.jsx)("div", { className: "gloss-hint", children: error })
						: null
				]
			});
		}

		function apply(ctx) {
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "gloss",
					order: 90,
					locale: "gloss",
					inject: () => ({})
				}, GlossOverlay));
			} catch (error) {
				console.warn("dsh-gloss: overlay slot skipped:", error?.message ?? error);
			}
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
