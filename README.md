# 个人 AI 辅助任务决策系统 MVP

这是一个面向学生干部、医学生和高频处理通知材料的人群的单用户任务决策助手。它不是普通待办清单，而是把通知、聊天记录、截图、PDF 解析成结构化任务，再用明确可解释的规则告诉你现在最该做什么。

## 主要功能

- 导入文本、图片、PDF，并为每条导入内容建立 `Source`
- 自动抽取任务字段：截止时间、提交对象、提交方式、纸质/电子版、签字/盖章、证据片段、下一步建议
- 链式通知会拆成多个任务，并建立简化依赖关系
- Dashboard 聚焦“现在最该做”“今天必须推进”“等待中”，不是只堆任务列表
- 明确的 deterministic priority scoring，综合逾期、临期、线下风险、阻塞价值、外部依赖和可快速推进性
- 任务详情页支持快速状态流转与核心字段编辑
- 所有任务都能回溯到来源和原文证据片段
- 内置 5 条中文 demo 来源，可手动导入，支持无 AI Key 演示

## 技术栈

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma + SQLite
- Zod
- dayjs
- Vitest

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

默认的 `DATABASE_URL` 使用 `file:./dev.db`，它会稳定落到 [prisma/dev.db](/mnt/d/DESKTOP/Projects/test/prisma/dev.db)。

3. 初始化数据库

```bash
npm run setup
```

`npm run setup` 只会初始化数据库和 Prisma Client，不会自动写入 demo 数据。

如果你要手动导入 demo，有两种方式：

```bash
npm run seed
```

或者启动后进入 `/import` 页面，点击“导入 demo 数据”。

4. 启动开发环境

```bash
npm run dev
```

默认访问 `http://localhost:3000`。

说明：
`npm run dev` 不再自动执行 Prisma 同步，以加快日常启动速度。  
当你修改了 `prisma/schema.prisma` 后，再手动执行：

```bash
npm run db:sync
```

`npm run setup`、`npm run db:sync` 和 `npm run build` 会先执行一个轻量的 Prisma 引擎准备脚本，处理当前环境里偶发的 `schema-engine` 下载失败问题。

## AI Provider 配置

这个项目现在支持 OpenAI-compatible 服务端接口，不只限于 OpenAI。

### OpenAI

```env
AI_API_KEY="sk-..."
AI_MODEL="gpt-4.1-mini"
AI_VISION_MODEL="gpt-4.1-mini"
AI_SUPPORTS_VISION="true"
```

### DeepSeek 示例

```env
AI_API_KEY="sk-..."
AI_BASE_URL="https://api.deepseek.com"
AI_MODEL="deepseek-chat"
AI_VISION_MODEL="deepseek-chat"
AI_SUPPORTS_VISION="false"
```

说明：

- 文本抽取走 `AI_MODEL`
- 图片抽取走 `AI_VISION_MODEL`
- 如果当前模型或供应商不支持视觉，把 `AI_SUPPORTS_VISION` 设为 `false`，图片会自动退回 fallback mode
- 仍兼容旧的 `OPENAI_API_KEY` / `OPENAI_MODEL` 配置

## 钉钉群机器人 Webhook（最快接入）

1. 在钉钉群里添加“自定义机器人”，复制 Webhook 地址。
2. 如果安全设置选了“加签”，同时复制 `secret`。
3. 在 `.env` 填入：

```env
DINGTALK_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=..."
DINGTALK_SECRET="SEC..."
```

4. 启动项目后，调用接口发送消息：

```bash
curl -X POST http://localhost:3000/api/notify/dingtalk \
  -H "Content-Type: application/json" \
  -d '{"text":"TaskFlow-AI 测试消息：今天 18:00 前提交材料","atAll":false}'
```

返回 `{"ok":true,...}` 代表发送成功。

## 自动提醒（每日摘要 + 截止前 + 等待回看）

你现在可以通过一个定时接口，自动推送三类提醒到钉钉：

- 每日摘要（默认每天 `08:30` 后仅发一次）
- 截止前提醒（按 `24h / 3h / 1h` 分层提醒）
- 等待任务到 `nextCheckAt` 的回看提醒

可选环境变量：

```env
REMINDER_DAILY_TIME="08:30"
REMINDER_RUN_TOKEN="your-secret-token"
```

触发接口（建议给定时任务调用）：

```bash
curl -X POST http://localhost:3000/api/reminders/run \
  -H "Content-Type: application/json" \
  -H "x-reminder-token: your-secret-token" \
  -d '{"dryRun":false}'
```

只预览不发送（dry run）：

```bash
curl "http://localhost:3000/api/reminders/run?dryRun=1" \
  -H "x-reminder-token: your-secret-token"
```

## 两种运行模式

### 1. 有 `AI_API_KEY` 或 `OPENAI_API_KEY`

- 服务端调用 OpenAI-compatible 接口做结构化任务抽取
- 文本和图片会优先走你配置的模型
- 输出经 Zod 校验后写入数据库

### 2. 没有配置 AI Key

- 文本和可提取文本的 PDF 走本地 fallback parser
- 图片会保存文件，但不会做智能识别，会明确提示当前处于 fallback mode
- 你仍可手动导入 demo 数据来演示完整流程

## 关键页面

- `/`
  Dashboard。展示当前建议、最该做的 1 条任务、今天必须推进、等待中、按状态分组的任务，以及最近导入来源。
- `/import`
  导入页面。支持粘贴文本、上传图片、上传 PDF，并在提交后立即显示解析结果摘要。
- `/tasks/[id]`
  任务详情页。展示截止时间、提交要求、签字盖章、优先级解释、证据片段、依赖、状态流转、编辑表单。
- `/sources/[id]`
  来源详情页。展示原始文本/图片、解析摘要和关联任务。
- `/logs`
  工作日志页。按日期生成可复制的“某日日志”，支持简版/详版与手动微调。

## 主要文件结构

```text
app/
  api/
  import/
  sources/[id]/
  tasks/[id]/
  layout.tsx
  page.tsx
components/
  import-form.tsx
  quick-status-actions.tsx
  status-badge.tsx
  task-card.tsx
  task-edit-form.tsx
lib/
  constants.ts
  data/demo-sources.ts
  parser/
  scoring/priority.ts
  server/
prisma/
  schema.prisma
  seed.ts
tests/
```

## AI 抽取与 fallback 分工

### 使用 AI Provider 的地方

- `lib/parser/openai.ts`
  服务端文本/图片任务抽取，支持 OpenAI、DeepSeek 和其他兼容 OpenAI SDK 的接口

### 使用 fallback 的地方

- `lib/parser/fallback.ts`
  基于规则、关键词、时间表达和启发式拆任务
- `app/api/import/route.ts`
  当图片无 AI Key 或 PDF 提取不到文本时做清晰降级
- `lib/server/seed.ts`
  提供手动导入 demo 数据的能力

## 当前已知限制

- 图片 OCR 仅在配置支持视觉的 AI Provider 时可用，未内置本地 OCR
- PDF 文本提取依赖 `pdf-parse`，扫描版 PDF 可能无法拿到文本
- fallback parser 已覆盖核心场景，但对特别复杂或极度模糊的通知仍会进入 `needs_review`
- 当前是单用户本地 MVP，没有身份系统和协作能力

## 测试

```bash
npm run test
```

当前包含：

- priority scoring 的基础测试
- fallback parser 的链式任务拆分测试

## 后续最值得做的扩展点

1. 增加本地 OCR 或接入更稳定的图片/PDF OCR 管线，降低图片 fallback 的能力缺口
2. 做批量确认与批量改状态，把导入后的人工修正成本进一步压低
3. 引入“今日执行面板”和提醒机制，把决策结果继续转成实际执行节奏
