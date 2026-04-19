# Bangumi 作品级用户图片抓取器

这个工具是一个 **Tampermonkey 用户脚本**，用于在你已登录的 Bangumi 页面里，围绕单个作品 `subject` 页面自动抓取用户正文中发出的图片，并导出到本地目录。

## 文件位置

- 脚本：[`scripts/bangumi-subject-image-export.user.js`](/E:/anime-guess-arena/scripts/bangumi-subject-image-export.user.js)

## 这版能做什么

- 从当前作品 `subject` 页面开始抓取
- 自动发现并访问：
  - 章节/单集页
  - 单集讨论页
  - 条目讨论页
  - 评论 / 日志 / 吐槽等可从作品页继续进入的页面
  - 分页页
- 只提取 **用户正文里的图片**
- 自动导出：
  - 图片文件
  - `manifest.csv`
  - `manifest.json`
  - `crawl-log.json`

## 不会抓的内容

- 头像
- 条目封面
- 站点图标 / emoji / UI 装饰图
- 明显过小的图片

## 使用步骤

### 1. 安装脚本

1. 在 Chrome 或 Edge 安装 Tampermonkey
2. 打开 [`scripts/bangumi-subject-image-export.user.js`](/E:/anime-guess-arena/scripts/bangumi-subject-image-export.user.js)
3. 复制脚本内容到 Tampermonkey 新建脚本中并保存

### 2. 登录 Bangumi

1. 用浏览器登录你的 Bangumi 账号
2. 推荐使用专门账号来执行抓图

### 3. 进入作品页

打开任意一个作品的 `subject` 页面，例如：

- [Bangumi subject 示例](https://bgm.tv/subject/12)

### 4. 启动抓取

1. 点击 Tampermonkey 扩展图标
2. 选择菜单项：`开始抓取本作品图片`
3. 如果浏览器支持目录写入，会先让你选择一个本地目录

### 5. 导出结果

默认目录结构：

```text
bangumi-export/
  subject-<id>-<slug>/
    images/
    manifest.csv
    manifest.json
    crawl-log.json
```

如果浏览器不支持目录写入，脚本会在结束时导出 manifest 文件，图片则逐张下载。

## manifest 字段

`manifest.csv` / `manifest.json` 会包含这些字段：

- `subject_id`
- `subject_title`
- `page_type`
- `page_url`
- `post_url`
- `post_author`
- `post_time`
- `image_original_url`
- `image_saved_path`
- `image_ext`
- `image_hash`
- `crawl_time`

## 运行策略

- 单作品
- 单线程页面抓取
- 页面请求间隔随机 `2-5` 秒
- 图片低并发下载
- 连续页面异常会自动暂停

## 暂停与恢复

脚本菜单里提供：

- `暂停/恢复抓取`
- `导出当前抓取日志`

## 当前版本的边界

- 第一版优先保证稳定抓图，不做复杂图形界面
- 第一版不做“哪些图更适合题库”的自动评分
- 第一版不做跨作品批量抓取

## 推荐工作流

1. 先用脚本抓单部作品的所有用户发图
2. 看 `manifest.csv`
3. 按作者、来源页、页面类型快速筛图
4. 再手工挑出适合题库的高辨识度截图

## 注意事项

- 这是浏览器内脚本，不是高速爬虫
- 请控制抓取频率，不要并发跑多个作品
- 如果页面出现验证码、403、429 或明显风控提示，请暂停
- 不建议用主账号长期大批量执行
