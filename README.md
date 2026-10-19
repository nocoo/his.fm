# his.fm

his.fm 是一档面向年轻程序员的中文播客，关注 AI 带来的企业转型、团队与岗位变化，以及工作生活加速之下的人。我们面向正在经历技术变化、职业不确定性和持续学习压力的开发者。技术和项目是理解生活的入口，人的处境与身心状态是关注的中心。

## 频道定位与编辑原则

有温度，有柔情，不谄媚。认真对待人在快速转型和压力之下的 well-being，包括睡眠、情绪、成年人的关系相处和可自主安排的生活。承认变化带来的机会，也承认人的时间、精力与选择受到现实条件约束。

这些原则用于内部选题、调研、取舍、叙事和审稿，**绝不在节目逐字稿或发表摘要中直接宣讲、复述或包装成频道口号**。让具体的人、可核实的事实和讲述方式体现它们。

- 先从目标听众的具体处境寻找切入点，再解释项目为何与他有关。避免照读 README、罗列功能或堆砌术语。
- 选题与讲述避开政治、国际关系、金融、法律、犯罪、暴力、未成年人等敏感话题。这一边界同样适用于案例、类比、背景介绍、引述、标题、发表摘要、标签和选引的具体资料。
- 先判断材料是否适合讲，再核实它是否可靠。优先选择成年人的日常工作、学习、睡眠、休息和相处经验；原项目涉及上述话题时主动跳过。需要替换的内容，改用独立成立的新材料，不通过隐去名称、背景或换用委婉说法继续带入。
- 内容要言之有物。优先采用项目引出的真实研究、公开案例和可以追溯的细节；逐条核对关键数字、适用人群及例外。
- 明确区分已发生的案例、研究结果、主持人的判断和假设场景。不编造采访、亲历、人物经历或项目使用效果。
- 项目的表述也需要核查。证据等级、作者的价值排序和对听众的具体建议分别判断，不把相关性写成因果，不把局部结果外推为保证。
- 不把职业与组织压力全归咎于个人心态，不用自律清单增加负担，也不许诺一个工具就能解决现实困境。
- 用自然的中文口语写单人播讲。少说套话，避免空泛安慰、说教和反复总结；建议必须交代现实成本和可选择的余地。

频道定位的日常维护入口为后台 `/admin/channel`。初始内容来自以上原则，保存后以当前环境数据库中的定位为创作依据；README 保留创办时的编辑约定，不会覆盖后台修改。创作优先级固定为：**频道定位 → 栏目提示词 → 本期中心思想 → 素材资料**。素材服务于问题，事实核查不因表达意图而让步。

## 单集材料

每期材料保存在独立的 `episodes/<episode-slug>/` 文件夹。逐字稿和发表摘要采用中文，来源记录保留项目版本、原始出处、事实核查结果及引申边界。十分钟节目的时长先按口播字数与语速估算，音频生成后再记录实测时长。

| 期数 | 题目 | 材料 |
| --- | --- | --- |
| 001 | 下班后，还要追多少个 AI？ | [逐字稿](episodes/001-how-to-live-better/transcript.md) · [发表摘要](episodes/001-how-to-live-better/summary.md) · [研究与核查](episodes/001-how-to-live-better/research.md) |

## Website

his.fm is a podcast content-management site built with React 19, Vite 8, TypeScript 7.0.2 and one Cloudflare Worker. The public listening room keeps the Open Interval identity; the private studio uses Basalt 3.1.0 and Cloudflare Access.

- Public pages: searchable episodes, summaries, transcripts and a custom accessible audio player. A written episode without a recording is never presented as playable.
- Studio: one cover-first library at `/admin`, grid/list views, metadata and source editing, manuscripts, uploaded artwork/recordings, explicit reviews and publication records. Existing standalone episodes remain editable.
- Content creation happens outside the website. External agents use explicit scoped REST tokens to read prompts, edit content, upload assets, approve/reopen and record publication when authorized. There is no embedded agent, generation queue or provider configuration.
- Settings: categories, versioned channel/category prompt slots, brand appearance, bumpers, storage and token management. Revoked token records can be deleted. Prompt migration is an explicit preview/apply operation, never a deployment side effect.
- Local preview: **https://hisfm.dev.hexly.ai**. `npm run dev` applies local migrations and seeds preview data once, preserving later edits. The Local/Production segment selects the data environment; Production performs real operations using the editor's Access identity.
- Production: **https://his.fm**, with D1 and R2 named `his-fm` and media at **https://f.no.mt**. Published GitHub Releases deploy only after exact-revision CI verification.

```sh
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run dev
npm run test:coverage
npm run lint
npm run typecheck
npm run test:e2e
npm run build
```

Husky checks the staged Git snapshot with coverage, strict lint and typecheck. All four unit coverage floors are 95%; browser tests verify rendered interactions. L1 evidence does not imply full 6DQ certification.

See [production workflow](docs/production.md), [external API](docs/agent-api.md), [audio uploads](docs/audio.md), [architecture](docs/architecture.md), [operations](docs/operations.md), [CI/CD](docs/ci-cd.md) and [artwork provenance](artwork/README.md).

### Brand identity

The canonical ID is `his.fm ()`: the wordmark comes first, followed by a pair of open parentheses. The symbol alludes to a programmer's function call, `func()`, connecting the podcast to its developer audience. Keep the accepted outlined shapes in `apps/web/src/brand/identity.svg`; neither the wordmark nor the parentheses may be replaced with typed text or a theme-specific font.

Public and studio top-left headers, the appearance specimen and all eight theme cards share the same lockup proportions: an equally tall square symbol and an 8px gap per 116px of wordmark width, vertically centered. Public headers and the appearance specimen retain the 116px wordmark; the studio rail uses 92px, and theme cards use 140px, shrinking proportionally only when the card is narrow. The parentheses have the same typographic scale as the wordmark, like `func()`, not a small accompanying icon. Wordmark and symbol always share one color: the theme's dark primary (`ink`) on light backgrounds, or white on dark backgrounds. Theme-card slogans share one responsive size; card titles share one size across directions.

Each theme has a standard favicon: its dark primary background and the canonical white parentheses, centered with identical proportions and padding. Public previews use the preview theme; normal browsing and the studio use the saved theme. Selecting a card alone does not change the saved identity. Archived design studies, decorative hero marks, cover frames, sharing artwork and installed-app icons are outside this normalization.

The studio theme catalogue pairs each study's hero, named palette and original design rationale with a live cover preview from one selected, saved production. All eight compositions use the existing versioned PNG endpoint and the selected Local/Prod environment, never mock artwork. Selecting a theme or refreshing previews does not save or publish anything. See [appearance](docs/appearance.md#theme-catalogue).

### API prompt slots

Prompt slots use GET/PUT/POST /channel/prompt-slots and /categories/{id}/prompt-slots, plus PATCH/DELETE /{slotId}. Reads require prompts:read; all writes require prompts:write, independently of category metadata grants. Mutations use the collection version; write-only responses contain only version. Category append adds after the same channel ID; override replaces it. Disabled category slots do not mask channel. Enabled results sort by order then ID. GET /migration/dry-run below either table is read-only; POST /migration/apply with version and legacyVersion explicitly initializes slots with an atomic original-value backup. Nothing auto-applies on deploy; reapply is a no-op. Old channel.content, channel.prompts.* and category.prompt are read-only: stored values until apply, then enabled local slots concatenated as Markdown. New clients must use slots; compatibility removal requires a separately announced, verified consumer cutover.

Paths are relative to `/api/agent`. Read [onboarding](docs/api-onboarding.md#prompt-slot-transition) and [prompt slots](docs/prompts.md) before migration. The studio keeps local drafts and saves a level's complete slot table atomically; `skills` accepts names only. The founding Chinese editorial policy above remains unchanged.

### API cover artwork

Uploading a clean cover with `PUT /api/agent/productions/{id}/assets/cover?version=N` pregenerates square podcast art and landscape share images as immutable generated R2 objects before publication; publishing or republishing warms the linked episode's artwork keys. Use a **1400 x 1400 square original** (smaller originals are accepted), without text, logos, borders or overlays. Keep essential subjects near **x = 50%, y = 40%** for the share crop; on square originals its safe-area band spans **y = 13.75-66.25%**.

Public published-only `/episodes/{id}/art.jpg` and `/episodes/{id}/share.jpg` resolve to versioned URLs (`art.jpg?v=<hash>`, optionally with `&size=N`, and `share.jpg?v=<hash>`). Square art follows the website theme, defaults to 1400 square and accepts sizes from 1400 through 3000; the 1200 x 630 landscape image is theme-independent. Only generated outputs are cached, never replacements for originals; storage cleanup protects current generated versions. See [API onboarding](docs/api-onboarding.md#cached-podcast-and-share-artwork) and [appearance](docs/appearance.md#public-rss-and-share-artwork).

Successful versioned artwork responses and 304s include x-hisfm-art: edge-hit | r2-hit | rendered. After successful cover upload/publication warming, the first default 1400-square art or share GET should report r2-hit (pregenerated), not rendered (lazy fallback); an already warm edge may report edge-hit. Repeat GETs to the same full versioned URL at the same edge should become edge-hit after asynchronous cache fill, not globally guaranteed. Other sizes may render. HEAD reads cached GET metadata without a body and cannot warm the edge; cold HEAD/304 may use only R2 metadata without populating it. Conditional 304s honor the same ETag and Last-Modified validators.

## Repository layout

- `apps/web`: React website, Cloudflare Worker, migrations and tests (`@his-fm/web`).
- `packages/contracts`: shared scope, prompt and WAV validation; no runtime or model execution.
- Root `package.json` and `package-lock.json`: one release version and one workspace dependency graph.
- `artwork`, `episodes`, `docs` and repository automation stay at root. Secrets, generated audio/video, screenshots and local state stay ignored.
