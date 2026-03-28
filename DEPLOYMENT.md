# Vercel 部署清单

这份清单对应当前项目的生产化配置，目标是让 `Preview` 和 `Production` 都能稳定运行，同时避免测试环境污染正式数据。

## 1. 准备数据库

- 在 Vercel Marketplace 中接入 Prisma Postgres，或使用等价方式创建两套数据库。
- 为 `Production` 单独准备一套库。
- 为 `Preview` 单独准备一套库。
- 把两套库分别绑定到对应的 Vercel 环境。

## 2. 准备对象存储

- 使用 S3 兼容对象存储。
- 最少做到“同一存储服务，不同前缀”：
  - 生产：`S3_KEY_PREFIX=prod/`
  - 预览：`S3_KEY_PREFIX=preview/`
- 如果条件允许，也可以让生产和预览使用不同 bucket。
- 需要提供稳定的公开访问地址 `S3_PUBLIC_BASE_URL`。

## 3. Vercel 环境变量

所有环境都需要：

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `AUTH_TRUST_HOST=true`
- `ADMIN_SEED_EMAIL`
- `ADMIN_SEED_NAME`
- `ADMIN_SEED_PASSWORD`
- `STORAGE_PROVIDER=s3`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_PUBLIC_BASE_URL`
- `S3_KEY_PREFIX`

额外说明：

- `Production` 环境建议显式设置 `NEXTAUTH_URL=https://你的正式域名`
- `Preview` 环境可以显式设置 `NEXTAUTH_URL`，也可以依赖 Vercel 提供的 `VERCEL_URL`
- 如果你使用自定义 S3 兼容服务，需要配置 `S3_ENDPOINT`

## 4. 构建与迁移

项目已经配置 `vercel.json` 和 `npm run vercel-build`。

部署时会自动执行：

1. `prisma generate`
2. `prisma migrate deploy`
3. `next build`

这意味着：

- Preview 部署只会改 Preview 数据库
- Production 部署只会改 Production 数据库
- migration 文件必须提交到仓库

## 5. 首次上线后的初始化

首次正式部署完成后，手动执行：

```bash
npm run seed:prod-admin
```

这个脚本只会创建或更新管理员账号，不会导入演示题目。

本地开发时使用：

```bash
npm run seed:dev
```

## 6. 上线后验证

至少验证以下项目：

- 管理员可以成功登录后台
- 手动录题可以上传图片并保存
- ZIP 批量导入可以成功写入对象存储
- 前台游客可以正常开始答题
- 结算后可以提交排行榜
- 重新部署后，旧图片仍然可访问

## 7. 常见问题

### 后台上传时报错“不能使用本地存储”

说明当前运行环境被识别为 Preview 或 Production，但 `STORAGE_PROVIDER` 仍是 `local`。把它改为 `s3` 并补齐对象存储变量。

### 登录或后台页面直接报配置错误

通常是以下变量缺失之一：

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` 或 Vercel 自动提供的 `VERCEL_URL`

### Preview 上传覆盖了正式图片

说明 `Preview` 和 `Production` 共用了同一个对象存储前缀。请把 `S3_KEY_PREFIX` 分开。
