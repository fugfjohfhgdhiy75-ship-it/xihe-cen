# 小屋

一个只属于自己的聊天小屋：只有**聊天**和**记忆**两个页面，界面参考 Claude iOS App。
用 Cloudflare Pages（免费）托管，记忆存在 Cloudflare D1 数据库（免费），不需要 VPS。
唯一要花钱的是 Anthropic API，按用量计费。

## 部署步骤（全程在网页上点，大约 15 分钟）

1. **注册 Cloudflare**：打开 dash.cloudflare.com 注册一个免费账号。
2. **建数据库**：左边菜单 *Storage & databases → D1* → *Create database*，名字填 `xiaowu`。
   不用建表，第一次打开小屋时会自动建好。
3. **建网站**：*Workers & Pages → Create → Pages → Import an existing Git repository*，
   连上 GitHub，选 `xihe-cen` 这个仓库，然后填：
   - Production branch：`main`
   - Framework preset：`None`
   - Build command：`npm run build`
   - Build output directory：`public`

   点 *Save and Deploy*。第一次部署完先别打开，还要做下面两步。
4. **绑定数据库**：进这个 Pages 项目 → *Settings → Bindings → Add → D1 database*，
   Variable name 填 **`DB`**（大写），数据库选 `xiaowu`。
5. **填密钥**：*Settings → Variables and Secrets → Add*，类型选 **Secret**，加两个：
   - `ANTHROPIC_API_KEY`：你的 Anthropic API key
   - `APP_PASSWORD`：自己设一个进门密码（别人知道网址也进不来）
6. **重新部署**：*Deployments* → 最新那条右边的 `...` → *Retry deployment*。
7. 打开 `https://你的项目名.pages.dev`，输入密码就能进门。
   iPhone 上用 Safari 打开 → 分享 → **添加到主屏幕**，以后就像一个 App 一样。

## 怎么做到聊再久也不会越来越贵

- 每次只把**最近 20～40 条**聊天原文发给 Claude。
- 没整理的超过 40 条时，会自动把较早的部分整理成“更早的经过”（一段摘要），
  同时把值得长期记住的事自动加进“记得的事”。只留最近 20 条原文。
- 人设、记忆、摘要这些不常变的部分开了**提示缓存**，重复发送只收大约一折的钱。
- 所以每条消息的成本基本是固定的，不会因为聊了几个月就变贵。
- 记忆页最上面能看到本月花费、上一条花费和累计花费（估算值）。

## 记忆页能做什么

- **关于我们**：人设，相当于“我是谁、你是谁、我们怎么相处”，每次聊天都会带上。
- **记得的事**：一条一条的长期记忆，可以手动加、改、删。
  在聊天里**长按任意一句话**（电脑上右键）也能直接“记进记忆”。
- **更早的经过**：自动整理出来的摘要，也可以自己改。点“现在整理”可以马上整理一次。
- **模型**：Opus 5.5 / Sonnet 5.5 / Haiku 5.5，思考深度：低 / 中 / 高。

## 注意

- 小屋需要能连上 Anthropic。如果提示“所在地区不支持”，开着梯子再用。
- `pages.dev` 的网址在国内有时打不开，开梯子就好；也可以以后绑定自己的域名。
- 建议在 Anthropic 后台（console.anthropic.com → Billing / Limits）设一个每月花费上限，放心一点。
- Opus 5.5 和 Sonnet 5.5 开了“被拒绝时自动换模型重答”（server-side fallback），一般感觉不到。

## 本地开发（可选）

```bash
npm install
printf 'ANTHROPIC_API_KEY=sk-...\nAPP_PASSWORD=test\n' > .dev.vars
npx wrangler pages dev public --d1 DB
```

## 文件结构

```
public/            前端页面（聊天、记忆、登录）
functions/api/     后端接口（Cloudflare Pages Functions）
lib/               调用 Claude、整理记忆、数据库、计费
```
