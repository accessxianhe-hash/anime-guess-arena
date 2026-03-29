# 本地启动注意事项

## 注意事项

- 使用仓库自带 PostgreSQL 时，`data/postgresql/17/pgpass.txt` 不能只写纯密码。
- `pgpass.txt` 必须使用 PostgreSQL 标准格式：`host:port:database:user:password`。
- 当前项目本地联调可用格式为：`localhost:5432:*:postgres:AnimeGuessLocal_2026!`。
- 如果 `pgpass.txt` 格式不对，`psql`、`createdb` 等客户端命令会一直等待交互式密码输入，看起来像“命令卡住不继续”。
- 为了避免再次卡住，本地脚本里调用 PostgreSQL 客户端时应同时满足：
  - 设置 `PGPASSFILE=E:\anime-guess-arena\data\postgresql\17\pgpass.txt`
  - 尽量带上 `-w`，禁止命令退回到交互式密码提示

## 当前本地联调约定

- PostgreSQL 使用仓库内二进制：`tools/postgresql-17.9-binaries/pgsql/bin`
- Node 使用仓库内运行时：`tools/node-v22.19.0-win-x64`
- `TEMP` 和 `TMP` 建议指向仓库内 `tmp/`，避免 `tsx`/`esbuild` 写系统临时目录时触发权限问题
