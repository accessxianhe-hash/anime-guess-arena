# 备案审核期间的临时预览方案

当你的腾讯云域名还在备案审核、暂时不能访问时，可以用这个流程快速查看页面改动。

## 你会得到什么

- 一个临时公网 HTTPS 链接（Cloudflare Quick Tunnel）
- 不改动生产域名和 Caddy
- 本地改完代码即可立即预览

## Windows 一键启动

双击：

`scripts\preview\start-temp-preview.cmd`

脚本会自动执行：

1. 需要时自动启动本地项目（`scripts/start-local.ps1`）
2. 首次自动下载 `cloudflared`
3. 将 `http://127.0.0.1:3000` 暴露为临时 HTTPS 外网地址

## PowerShell 启动方式

如果本地项目已经在跑：

```powershell
.\scripts\preview\start-temp-preview.ps1
```

如果本地项目还没启动：

```powershell
.\scripts\preview\start-temp-preview.ps1 -StartLocal
```

如果你用的是其他端口：

```powershell
.\scripts\preview\start-temp-preview.ps1 -Port 3100 -StartLocal
```

## 日常使用流程

1. 保持隧道窗口不要关闭
2. 复制终端里生成的 `https://*.trycloudflare.com` 链接
3. 浏览器打开这个链接查看当前改动效果
4. 用 `Ctrl + C` 停止临时预览

## 说明

- 这个链接是临时的，每次重启可能变化。
- 该方案用于审核期间“看改动”，不替代腾讯云生产环境。
- 如果你想要固定不变的预览域名，下一步可以升级为绑定你子域名的 Cloudflare Tunnel。
