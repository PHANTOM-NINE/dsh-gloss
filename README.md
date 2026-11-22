# dsh-gloss

**选中即查、秒级响应**的英文术语解释插件：在 DeepSeek Harness 的会话结果里用鼠标选中任意英文词或短语，立刻弹出一张卡片，给出**音标 + 中文专业解读**——技术义项自动排在最前面。

**零配置、不调模型、不改你的任何配置。** 装上就能用：查询走免费联网词典（约 0.04–0.12 秒），断网或查不到自动回退到内置的 17,397 词离线词库。

## 为什么做这个（开发背景）

在 DeepSeek 里读技术会话，经常遇到看不懂的专业英文（latency、token、throughput、race condition……）。以前的做法是：选中词 → 打开搜索 → 翻几个网页 → 在一堆通用义里找那个技术义。这个流程又慢又打断阅读。

第一版尝试用模型结合语境解释，但实测模型固有延迟 **2–3 秒**，且经常把技术词直译成通用义（`latency` 被译成"潜伏"而非"延迟"）。最终方案改为**联网词典 + 技术义排序**：既秒级响应，又拿到准确的技术义，还彻底甩掉模型延迟。

## 解决的痛点

| 痛点 | dsh-gloss 的做法 |
|---|---|
| 查词要跳出会话、开网页、反复搜索 | 会话内**选中即查**，卡片就地弹出 |
| 模型解释慢（2–3 秒） | 联网词典 **0.04–0.12 秒**，快的不是一点半点 |
| 通用义淹没了技术义（latency→"潜伏"） | 技术义项**自动排最前**（latency→"延迟/时延"） |
| 内联代码色块 `` `latency` `` 里的词查不了 | 读选区文本，不挑 DOM 节点，色块词照查 |
| 悬停触发误触多、卡片关不掉 | 改为**鼠标选中**触发，点外部 / Esc / × 都能关 |
| 怕插件改坏自己已有的配置 | **配置完全隔离**（见下），一个字节都不写你的 profile |

## 效果预览

在会话里选中 `latency`，卡片显示：

```
latency                         🔈  ×
n.  /'leitnsi/

解读  n. （计算机、网络、通信等）延迟，时延，指从发出请求或信号
      到得到响应或完成传输所经过的时间；（医学）潜伏…
```

再比如：

- `token` → **n.（人工智能和大语言模型）词元；（计算机）令牌，记号…**
- `throughput` → **（计算机、网络等）数据吞吐量，吞吐率…**
- `cache` → **n. 把（数据）存入高速缓冲存储器…**

音标来自标准词典数据；解读里的技术义项排在最前，通用义（医学、心理学等）排在后面。

## 使用方式

1. **选中**：用鼠标选中消息里的英文词或短语（内联代码色块里的词也可以）。
2. **看卡片**：音标 + 中文解读就地弹出；同一词再查走缓存，即时显示。
3. **朗读**：点 🔈 用系统英语音色朗读（离线可用，只有点了才念）。
4. **关闭**：点卡片外部 / 按 Esc / 点 ×。
5. 键盘选中（Shift+方向键等）同样触发。触屏长按选中可用。

## 工作原理

- **触发**：监听 `mouseup` / `keyup`，读取 `window.getSelection()`，规范化为查询词（过滤停用词，最长 token 优先）。
- **查询**：host 侧 `/api/gloss/quick?word=` —— 先查进程内 24 小时缓存 → 再查有道免费词典 `jsonapi` → 失败/查不到回退内置 ECDICT 离线词库。
- **技术义排序**：把释义拆成义项，命中技术词（计算机/网络/AI/数据库/并发……）的义项加权排前，通用义（医学/心理学/弗洛伊德……）降权排后。
- **朗读**：`window.speechSynthesis` + 系统英语音色，零依赖、离线可用。
- **缓存**：进程内 24 小时 + 浏览器 localStorage 7 天 LRU，重复词即时显示。

## 配置隔离（重点）

`dsh-gloss` **绝不写入**以下位置：

- `~/.dsh/profiles/*/cordis.patch.yml`
- `~/.dsh/settings-legacy.yaml`、`settings.yaml.imported`
- `~/.dsh/prompt-inject.md`、`dsh-purge/`、`guard/`、`.credentials.yaml`

插件激活完全靠**包内自带的** `cordis.patch.yml`（`dsh.bundle.patch`），由安装在内存里合成，不会落到你的 profile 文件。插件没有声明 Config schema、没有设置页，也不会调用任何会触发 profile 重写的设置 API —— 对你已有的（包括破甲类）配置零改动。

## 与其他插件的区别

[`hover-glossary`](https://www.npmjs.com/package/hover-glossary) 也是显示英文释义，但它靠**悬停 + 纯本地词库**：只有通用本义，没有联网释义、没有技术义排序、断词库就没结果。`dsh-gloss` 用**选中即查 + 联网词典**，给出完整中文专业解读并把技术义排最前，同时保留离线兜底和朗读——而且完全不碰你的配置。

## 安装

```bash
dsh plugin install dsh-gloss
```

本地开发安装：在桌面 profile 目录执行

```bash
pnpm add "dsh-gloss@file:/path/to/dsh-gloss"
```

然后重启 DeepSeek Harness。

## 数据来源

- 联网释义：[有道词典 jsonapi](https://dict.youdao.com/)（免费公共接口，无需 key）。
- 离线词库：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT，8.6k star），筛出牛津核心词、高频前 2 万词、CET-4/6、GK、KY 考试词汇，共 17,397 词（约 406 KB gzip）。详见 `NOTICE`。

## 许可证

MIT。

---
---

# English

**Select-to-look-up, instant** English terminology glosses inside DeepSeek Harness: select any English word or phrase in a conversation and a card pops up with its **phonetic + Chinese technical definition** — technical senses sorted to the top.

**Zero configuration. No model calls. No changes to your config.** Install and go: lookups use a free online dictionary (~0.04–0.12 s), with an automatic fallback to the bundled 17,397-word offline lexicon when offline or on a miss.

## Why it exists

Reading technical conversations in DeepSeek means hitting unfamiliar English terms (latency, token, throughput, race condition…). The old flow — select, open a search engine, scan several pages, hunt for the technical sense among generic ones — is slow and breaks your reading flow.

The first version used a model to explain terms in context, but the model's inherent latency was **2–3 s**, and it often rendered technical terms with generic meanings (`latency` → "latency/dormancy" instead of "delay"). The final design uses **an online dictionary + technical-sense ranking**: instant response and accurate technical meanings, with model latency removed entirely.

## Problems it solves

| Problem | What dsh-gloss does |
|---|---|
| Looking up a word means leaving the chat and searching the web | **Select-to-look-up** inline; the card appears in place |
| Model explanations are slow (2–3 s) | Online dictionary **0.04–0.12 s** |
| Generic senses bury the technical one (latency → "dormancy") | Technical senses **ranked first** (latency → "delay/latency time") |
| Words inside inline-code chips `` `latency` `` can't be looked up | Reads the selection text, not the DOM node — chip words work |
| Hover triggers misfire and cards won't close | **Selection**-based trigger; click-away / Esc / × all close it |
| Worry a plugin will break your existing config | **Full config isolation** (below) — not a byte written to your profile |

## What it shows

Select `latency` in a conversation:

```
latency                         🔈  ×
n.  /'leitnsi/

Definition  n. （计算机、网络、通信等）延迟，时延 …（医学）潜伏…
```

More examples:

- `token` → **n. (AI & LLMs) token; (computing) token/marker…**
- `throughput` → **data throughput, processing rate (computing/networking)…**
- `cache` → **n. store (data) in a high-speed cache…**

Phonetics come from standard dictionary data; technical senses are sorted ahead of generic ones (medicine, psychology, etc.).

## How to use

1. **Select** an English word or phrase in a message (words inside inline-code chips work too).
2. **Read the card**: phonetic + Chinese definition appear in place; repeat lookups are cache-instant.
3. **Speak**: click 🔈 for a system English voice (offline, only speaks when clicked).
4. **Close**: click outside / Esc / ×.
5. Keyboard selection (Shift+arrows) also triggers it; touch long-press selection works.

## How it works

- **Trigger**: listens on `mouseup` / `keyup`, reads `window.getSelection()`, normalizes to a query word (stopwords filtered, longest token first).
- **Lookup**: host `/api/gloss/quick?word=` — 24h in-process cache → free Youdao `jsonapi` → bundled ECDICT offline fallback on failure/miss.
- **Sense ranking**: splits the definition into senses, weights senses hitting technical terms (computing/network/AI/database/concurrency…) up and generic ones (medicine/psychology/Freud…) down.
- **Speech**: `window.speechSynthesis` with a system English voice — zero dependencies, offline.
- **Caching**: 24h in-process + 7-day localStorage LRU; repeat words are instant.

## Config isolation (important)

`dsh-gloss` **never writes** to:

- `~/.dsh/profiles/*/cordis.patch.yml`
- `~/.dsh/settings-legacy.yaml` or `settings.yaml.imported`
- `~/.dsh/prompt-inject.md`, `dsh-purge/`, `guard/`, `.credentials.yaml`

Activation comes entirely from the **bundled** `cordis.patch.yml` (`dsh.bundle.patch`), composed in memory by the installer. The plugin declares no Config schema and no settings page, and never calls any API that rewrites the profile — zero changes to your existing (including jailbreak-style) config.

## Comparison with hover-glossary

[`hover-glossary`](https://www.npmjs.com/package/hover-glossary) also shows English definitions, but via **hover + a local-only lexicon**: generic senses only, no online definitions, no technical-sense ranking, and nothing when the lexicon misses. `dsh-gloss` uses **select-to-look-up + an online dictionary**, gives full Chinese technical definitions with technical senses ranked first, keeps an offline fallback plus pronunciation — and never touches your config.

## Install

```bash
dsh plugin install dsh-gloss
```

For local development, in the desktop profile directory:

```bash
pnpm add "dsh-gloss@file:/path/to/dsh-gloss"
```

Then restart DeepSeek Harness.

## Data sources

- Online definitions: [Youdao Dictionary jsonapi](https://dict.youdao.com/) (free public endpoint, no key).
- Offline lexicon: [ECDICT](https://github.com/skywind3000/ECDICT) (MIT, 8.6k stars), filtered to Oxford core, top-20k frequency, and CET-4/6, GK, KY exam vocabulary — 17,397 entries (~406 KB gzip). See `NOTICE`.

## License

MIT.
