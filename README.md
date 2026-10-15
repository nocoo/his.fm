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
- Settings: categories, versioned editorial/workflow/narration prompts, brand appearance, bumpers, storage and token management. Revoked token records can be deleted.
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

## Repository layout

- `apps/web`: React website, Cloudflare Worker, migrations and tests (`@his-fm/web`).
- `packages/contracts`: shared scope, prompt and WAV validation; no runtime or model execution.
- Root `package.json` and `package-lock.json`: one release version and one workspace dependency graph.
- `artwork`, `episodes`, `docs` and repository automation stay at root. Secrets, generated audio/video, screenshots and local state stay ignored.
