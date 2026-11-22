# dsh-gloss 发布材料

> 一份给 GitHub Release 和插件市场提交用的现成素材。中文为主，附英文版，可直接复制。

---

## 一、一句话定位

**在 DeepSeek Harness 会话里选中英文词，秒出带音标的中文专业解读——技术义排最前，不调模型，不改配置。**

EN: **Select any English term in a DeepSeek Harness conversation and get an instant Chinese technical definition with IPA — technical senses first, no model calls, no config changes.**

---

## 二、开发背景

读 DeepSeek 的技术会话时，专业英文词（latency、token、throughput、race condition……）是最大的阅读障碍。传统流程是「选中 → 开搜索引擎 → 翻网页 → 在通用义里翻找技术义」，又慢又打断思路。

我们做了三轮迭代，最终定型：

1. **第一版（模型方案）**：用模型结合语境解释。实测模型固有延迟 2–3 秒，且常把技术词直译成通用义（latency → "潜伏"）。否决。
2. **第二版（联网 suggest）**：有道 suggest 接口快（0.08s）但释义被服务端截断成 53 字，技术义恰好被砍掉。否决。
3. **最终版（联网 jsonapi + 技术义排序）**：有道 jsonapi 返回完整不截断释义 + 标准音标，把技术义项自动排最前，断网回退内置词库。**0.04–0.12 秒，准确且稳定**。定型。

交互也从「悬停 1 秒」（误触多、卡片关不掉）改成「**鼠标选中即查**」，天然支持内联代码色块里的词。

---

## 三、解决的痛点

| # | 痛点 | 解决方式 |
|---|---|---|
| 1 | 查词要跳出会话、开网页、反复搜索 | 会话内选中即查，卡片就地弹出 |
| 2 | 模型解释慢（2–3 秒） | 联网词典 0.04–0.12 秒，快 30 倍 |
| 3 | 通用义淹没技术义（latency→"潜伏"） | 技术义项自动排最前（latency→"延迟/时延"） |
| 4 | 内联代码色块 `` `latency` `` 里的词查不了 | 读选区文本，不挑 DOM 节点，色块词照查 |
| 5 | 悬停误触多、卡片关不掉 | 选中触发；点外部 / Esc / × 都能关 |
| 6 | 怕插件改坏自己已有配置 | 配置完全隔离，一个字节都不写你的 profile |
| 7 | 断网 / 查不到就没结果 | 内置 17,397 词离线词库兜底，卡片照常出 |

---

## 四、使用效果（实测数据）

| 词 | 响应 | 卡片解读（技术义已排最前） |
|---|---|---|
| latency | 112ms | n.（计算机、网络、通信等）延迟，时延…（医学）潜伏… |
| token | 68ms | n.（人工智能和大语言模型）词元；（计算机）令牌，记号… |
| cache | 38ms | n. 把（数据）存入高速缓冲存储器… |
| throughput | 33ms | （计算机、网络等）数据吞吐量，吞吐率… |
| 生词 | 35ms | 自动回退离线词库 |

- 速度：**0.04–0.12 秒**（模型方案的 1/30）。
- 准确：完整中文释义，技术义项排最前，带标准音标。
- 健壮：断网 / 超时 / 查不到 → 离线兜底；进程内 24h + 浏览器 7 天缓存，重复词即时。
- 朗读：系统英语音色，离线可用，点 🔈 才念。

---

## 五、核心特性

- **选中即查**：鼠标选中或键盘选中（Shift+方向键）均可触发。
- **技术义优先**：命中计算机 / 网络 / AI / 数据库 / 并发等技术词的义项加权排前，医学 / 心理学等通用义降权排后。
- **秒级响应**：联网快查 + 双层缓存 + 本地离线兜底。
- **零配置**：装上即用，无设置页，无需 API key。
- **配置隔离**：绝不写 cordis.patch.yml / settings / prompt-inject.md / dsh-purge / guard / .credentials.yaml；靠包内 patch 在内存合成激活。
- **朗读 + 音标**：系统 TTS，零依赖。

---

## 六、GitHub Release 文案（可直接复制）

```markdown
## dsh-gloss v0.1.0 — 选中即查的英文术语解读插件

在 DeepSeek Harness 会话里选中任意英文词或短语，秒出带音标的中文专业解读，技术义项自动排在最前。

### 亮点
- ⚡ **秒级响应**：联网词典 0.04–0.12 秒，不调模型，告别 2–3 秒等待
- 🎯 **技术义优先**：latency → "延迟/时延" 而不是 "潜伏"；token → "词元/令牌"
- 🔒 **配置零改动**：不写你的 profile，不碰破甲 / guard 配置
- 📴 **离线兜底**：内置 17,397 词 ECDICT 词库，断网照常用
- 🔊 **朗读 + 音标**：系统英语音色，离线可用
- 🖱️ **选中即查**：支持内联代码色块里的词，点外部 / Esc / × 关闭

### 安装
`dsh plugin install dsh-gloss`，重启 DeepSeek Harness。

MIT 许可证。数据来源：有道词典 jsonapi + ECDICT (MIT)。
```

---

## 七、插件市场提交条目（字段模板）

> 数据来源：市场索引 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（format 1）。
> 提交前把 `PHANTOM-NINE/REPO`、`publishTimestamp`、版本号换成真实值。

```json
{
  "name": "dsh-gloss",
  "title": "PHANTOM-NINE/dsh-gloss",
  "description": {
    "en": "Select-to-look-up English terms in DeepSeek Harness: instant IPA and Chinese technical definitions from a free online dictionary, technical senses ranked first, offline fallback, zero config changes.",
    "zh": "在 DeepSeek Harness 会话中选中英文词即查：联网词典秒出音标与中文专业解读，技术义排最前，离线兜底，零配置且不改用户配置。"
  },
  "homepage": "https://awesome-dsh-plugin.com/p/PHANTOM-NINE/dsh-gloss/",
  "repository": { "url": "https://github.com/PHANTOM-NINE/dsh-gloss" },
  "metadata": {
    "category": "ui",
    "keywords": ["dsh", "gloss", "selection", "dictionary", "terminology", "translation", "vocabulary", "english"],
    "labels": [],
    "sortKeys": []
  },
  "versions": [
    {
      "version": "0.1.0",
      "publishTimestamp": 1763820000000,
      "source": { "type": "npm" },
      "engines": { "dsh": ">=0.2.0-rc.1 <0.3.0-0" }
    }
  ]
}
```

**提交前检查清单**：
- [ ] `npm publish` 把 `dsh-gloss@0.1.0` 发到 npm（市场全部插件都是 npm 分发，无 git 分发）。
- [ ] `title` / `homepage` / `repository.url` 里的 `PHANTOM-NINE` 换成真实 GitHub 用户名。
- [ ] `publishTimestamp` 用发布时刻的毫秒时间戳。
- [ ] `description.en` 必填（市场契约硬性要求）。
- [ ] category 用 `ui`。

---

## 八、发布步骤

1. **GitHub**：新建仓库 → 把 `dsh-gloss/` 目录内容推上去 → 用第六节文案建 v0.1.0 Release。
2. **npm**：`cd dsh-gloss && npm publish`（先 `npm whoami` 确认登录；包名 `dsh-gloss` 已确认未占用）。
3. **插件市场**：按第七节 JSON 提交条目（或走市场的提交 PR 流程），category 选 `ui`。
4. **验证**：`dsh plugin install dsh-gloss` 能装上，重启后选中词出卡片。

---

## 九、许可证与数据来源

- 插件代码：MIT。
- 离线词库：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT，skywind3000），17,397 词，详见包内 `NOTICE`。
- 联网释义：[有道词典 jsonapi](https://dict.youdao.com/)（免费公共接口，无需 key）。
