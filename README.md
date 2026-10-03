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

频道定位的日常维护入口为后台 `/admin/channel`。初始内容来自以上原则，保存后以当前环境数据库中的定位为创作依据；README 保留创办时的编辑约定，不会覆盖后台修改。创作优先级固定为：**频道定位 → 本期中心思想 → 素材资料**。素材服务于问题，事实核查不因表达意图而让步。

## 单集材料

每期材料保存在独立的 `episodes/<episode-slug>/` 文件夹。逐字稿和发表摘要采用中文，来源记录保留项目版本、原始出处、事实核查结果及引申边界。十分钟节目的时长先按口播字数与语速估算，音频生成后再记录实测时长。

| 期数 | 题目 | 材料 |
| --- | --- | --- |
| 001 | 下班后，还要追多少个 AI？ | [逐字稿](episodes/001-how-to-live-better/transcript.md) · [发表摘要](episodes/001-how-to-live-better/summary.md) · [研究与核查](episodes/001-how-to-live-better/research.md) |

## Website

The website is a Cloudflare Worker application built with Vite 8, TypeScript 7.0.2, React 19 and Biome. The public listening room uses original Sunburst artwork, grass greens and restrained violet accents. The editor uses Basalt 2.2.0 and Cloudflare Access.

- Public pages: homepage, searchable episode catalogue, episode summaries/transcripts and channel introduction.
- Studio: source collection, editorial intent, human brief/script/final reviews, AI production, manual WeChat/Xiaoyuzhou publication, voice comparisons and expiring Native Agent API tokens.
- Local preview: **https://hisfm.dev.hexly.ai**. Run `npm run dev` (the project-pinned `cf` CLI); six preview episodes and the real first-episode draft load into local D1 once, preserving later edits and deletions. The top-right segment switches local admin data between the local Worker and the production Worker, using the editor's Cloudflare Access identity.
- Production: **https://his.fm**. D1 and R2 are named `his-fm`; media uses **https://f.no.mt**. Published GitHub Releases deploy through pinned `nocoo/base-ci` workflows after exact-revision CI verification.
- The first episode currently has a complete manuscript. The site explicitly distinguishes written episodes from playable recordings.

```sh
npm ci --registry https://packagefeedproxy.microsoft.io/npm/
npm run dev
npm run test:coverage
npm run lint
npm run typecheck
npm run test:e2e
npm run build
```

For the configured local coordinator, use `npm run dev:all` to run the website and agent together, `npm run agent:debug` for read-only runtime diagnostics, and `npm run agent:inspect` for the loopback Node inspector. See [local agent setup and debugging](docs/native-agent.md#local-development-and-debugging) before starting a second runtime.

Husky runs coverage, strict lint and typecheck against the staged Git snapshot. All four unit coverage floors are 95%. Pure React views are verified through browser interaction checks. Audit results live in nmem; L1 does not imply full 6DQ certification.

See [production workflow](docs/production.md), [Native Agent API](docs/agent-api.md), [CI/CD](docs/ci-cd.md), [architecture](docs/architecture.md), [operations](docs/operations.md) and [artwork provenance](artwork/README.md). Secrets, generated audio/video and local databases remain ignored.

Design review: start with the [Archify agent architecture map](docs/agent-architecture/index.html) ([source and verification](docs/agent-architecture/README.md)), then [native Pi Durable agent workflow](docs/01-agent-workflow.md), [page-context and API redesign](docs/02-page-context-api.md), [interactive Chinese workspace and architecture review](docs/01-agent-workflow/index.html), and [documentation index](docs/README.md). The walkthrough remains a static design simulation; see [implementation status and local operation](docs/agent-implementation.md) for the working runtime and its remaining boundaries.

## Repository layout

- `apps/web`: React website, Cloudflare Worker, migrations and tests (`@his-fm/web`).
- `packages/agent`: resident Pi Durable coordinator, local model/Jev clients, conversations and durable transport.
- `packages/contracts`: shared validated browser/agent/server protocol.
- Root `package.json` and `package-lock.json`: one release version and one npm workspace dependency graph. Root commands delegate to the web workspace.
- `artwork`, `episodes`, `docs` and repository-level `scripts` stay at root. Local Worker secrets live in `apps/web/.dev.vars`; persistent state lives in `apps/web/.cloudflare/state`.

## Voice comparison

The initial voice comparison is a single-speaker Mandarin launch announcement. It predates the editorial direction above and is retained as an audio test, not as the current channel description.

Listen to all six original samples at `/admin/voices`. Their measured lengths are 16.76–19.72 seconds; immutable WAVs live in R2 under `reference/voices/`. Choosing a voice updates studio settings while preserving the speaking direction.

Uses `gemini-3.8-flash-tts` through the Gemini Interactions REST API. Google announced Gemini 3.8 Flash TTS and Flash-Lite TTS on September 23, 2026.

## Generate

Requires Python 3. No third-party packages.

Set `GEMINI_API_KEY` in the environment or in the ignored local `.env` file, then run:

```sh
python3 scripts/voice-comparison/generate.py Kore Zephyr Puck Charon Aoede Orus
```

Every voice reads the same `scripts/voice-comparison/script.txt` with the same delivery direction, targeting approximately 20 seconds. Duration varies naturally by voice; output is not truncated or time-stretched. WAV files and request metadata are written to the ignored `output/` directory. Existing files for the selected voices are overwritten.

The curated voice descriptions are Kore (firm), Zephyr (bright), Puck (upbeat), Charon (informative), Aoede (breezy), and Orus (firm). These describe the voices, not separate performance prompts.

## Sources

- [Google announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/)
- [Speech generation documentation](https://ai.google.dev/gemini-api/docs/speech-generation)

The API key and generated audio are excluded from Git. Never put credentials in source files or request metadata.
