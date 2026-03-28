# 猜动漫网站 MVP

一个基于 Next.js App Router、Prisma、PostgreSQL 和 Auth.js 的动漫截图竞猜网站。

## 功能范围

- 游客直接开始答题
- 60 秒整局倒计时
- 截图猜动漫作品名
- 即时判题与积分结算
- 今日榜 / 总榜
- 单管理员后台
- 手动录题和 ZIP + CSV 批量导入

## 本地启动

1. 安装 Node.js 20+ 和 npm。
2. 复制 `.env.example` 为 `.env` 并填入数据库和后台账号配置。
3. 安装依赖：`npm install`
4. 生成 Prisma Client：`npm run prisma:generate`
5. 执行数据库迁移：`npm run prisma:migrate`
6. 初始化管理员和演示题目：`npm run seed:dev`
7. 启动开发环境：`npm run dev`

## Vercel 生产部署

项目已经按 Vercel + PostgreSQL 的生产模式整理好，推荐部署路径如下：

1. 在 Vercel 中创建项目并连接代码仓库。
2. 为 `Production` 和 `Preview` 分别接入独立的 Prisma Postgres 数据库。
3. 在 Vercel 环境变量中配置：
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
   - `AUTH_TRUST_HOST=true`
   - `ADMIN_SEED_EMAIL`
   - `ADMIN_SEED_NAME`
   - `ADMIN_SEED_PASSWORD`
   - `STORAGE_PROVIDER=s3`
   - `S3_REGION`
   - `S3_ENDPOINT`
   - `S3_BUCKET`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`
   - `S3_PUBLIC_BASE_URL`
   - `S3_KEY_PREFIX`
4. 生产环境建议 `S3_KEY_PREFIX=prod/`，预览环境建议 `S3_KEY_PREFIX=preview/`。
5. Vercel 构建时会自动执行 `npm run vercel-build`，其中包含：
   - `prisma generate`
   - `prisma migrate deploy`
   - `next build`
6. 首次正式上线后，手动执行 `npm run seed:prod-admin` 初始化管理员账号。
7. 使用管理员登录后台，验证录题、导入、排行榜和图片上传是否正常。

完整步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 数据导入格式

批量导入文件应为一个 ZIP 包，包含：

- `questions.csv`
- 图片文件

默认 CSV 字段：

- `image_filename`
- `canonical_title`
- `aliases`
- `difficulty`
- `tags`
- `active`

说明：

- `aliases` 使用 `|` 分隔多个别名
- `tags` 使用 `|` 分隔多个标签
- `difficulty` 取值为 `easy`、`medium`、`hard`
- `active` 取值为 `true` 或 `false`

## 对象存储

项目默认使用本地 `public/uploads` 作为开发存储。

如果需要切换到 S3 兼容对象存储，配置以下环境变量：

- `STORAGE_PROVIDER=s3`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_PUBLIC_BASE_URL`
- `S3_KEY_PREFIX`

说明：

- `STORAGE_PROVIDER=local` 仅适用于本地开发
- 在 Vercel 的 `Preview` 和 `Production` 环境中，系统会拒绝继续使用本地磁盘存储
- 推荐为不同环境分配不同的 `S3_KEY_PREFIX`，避免预览环境覆盖正式素材

## 数据初始化脚本

- `npm run seed:dev`
  初始化本地开发管理员，并写入演示题目。
- `npm run seed:prod-admin`
  仅初始化生产管理员，不写入演示题目。
- `npm run seed`
  等同于 `npm run seed:dev`。

## 注意事项

- 演示题目使用的是占位图，用于验证站点流程。
- 正式上线前请确认截图素材来源和授权范围。
- 当前后台只有单管理员模式，适合 MVP 阶段使用。
- Prisma migration 已提交到仓库，Vercel 会在部署时执行 `prisma migrate deploy`。
