# 交接笔记(给下一个开发 session 读的)

新 session 开工前先读这份 + `README.md`,基本就不用翻聊天历史了。

## 项目是什么

岑溪禾的私人 AI 伴侣网页 App("苏晏"),部署在 Render(`https://xihe-cen.onrender.com`),
仓库 `fugfjohfhgdhiy75-ship-it/xihe-cen`,**开发分支 `claude/yan-yan-bao-bao-is5dgi`**,代码全在 `voice-chat/` 目录。
Render 连的就是这个分支,push 即自动部署。数据库 Supabase(她手动在 SQL Editor 里跑 `supabase-schema.sql`,该文件全部幂等,可整段重跑)。

## 用户特征(重要)

- 她不懂技术。所有涉及 Supabase / Render / 第三方平台的操作,必须给**一步一步的点击级指引**,SQL 直接给可整段粘贴的代码块。
- 数据库结构变更 = 必须提醒她去 Supabase SQL Editor 跑 SQL(历史上多次因为没跑/跑不全而"功能坏了"）。
- 她测试很给力,会截图报错。让她截 Render Logs 是有效手段。
- 已定下的审美决定别翻案:气泡四角统一圆角(像 Claude App)、气泡透明度 0.2 左右、正文平铺+每 2-3 句空行、蓝白磨砂玻璃(非粉紫)。她拒绝过的:头像倒计时首页、真正的逆向网易云 API。

## 架构速览

- `server.js`:Express 单文件后端。Claude 走中转站(Anthropic SDK 非流式 + `createMessageWithRetry` 重试)。关键函数:`buildXxx` 无,上下文在 `/api/chat` 内联;`compressIfNeeded`/`consolidateMemoriesIfNeeded`(两层记忆压缩);`generateDiaryEntry`(心情节奏:平常 5h 间隔/日上限 2,极端心情 90min/上限 5);`pickDailySong`+`lookupNeteaseSongId`;`getWeather`(Open-Meteo 免 key);`synthesizeSpeech`(ElevenLabs→MiniMax 兜底);`transcribeAudio`(Gemini→ElevenLabs 兜底);`generateGeminiImage` + `/api/chat` 里的 `[画:...]` 标记(10min 冷却);`/api/call-turn`(通话一轮);密码锁中间件(`SITE_PASSWORD`);模型/中转站/key 可被 settings 表覆盖(`loadApiOverrides`,更多页可改、可拉模型列表)。
- `public/app.js`:原生 JS 单文件前端。四页签(主页/聊天/日记/更多)+ 通话全屏层(免按键 VAD:说话检测+2s 静音自动发)。iOS 键盘适配靠 visualViewport 高度同步(`syncAppHeight`,<150px 的异常值忽略)。
- `public/style.css`:自托管字体(Ma Shan Zheng/Crimson Text,`public/fonts/`,别用 Google CDN 会被墙)、夜间模式(23:00-6:00 `data-theme="night"`)。
- 提交规范:每个功能 `node --check` + Playwright 截图验证(`chromium` 在 `/opt/pw-browsers/chromium`)后 commit+push,一次一件事。

## 环境变量(Render 里配)

`ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / MODEL`(可被网页设置覆盖)、`SUPABASE_URL / SUPABASE_KEY`、`SITE_PASSWORD`(整站密码锁)、`GEMINI_API_KEY`(画图+通话语音识别,她已配)、`ELEVENLABS_*`(TTS,**她额度已用完**,会自动落到 MiniMax)、`MINIMAX_*`(TTS 兜底)、`DEEPSEEK_API_KEY`(记忆压缩省钱用)。

## 当前未解决 / 待验证(按优先级)

1. **聊天自动发图未打通**:模型嘴上说"发过去了"但没图。排查顺序:①Render 环境变量名是否精确 `GEMINI_API_KEY`;②Render Logs 搜 `auto image generation failed`(有=Gemini 报错,常见:key 无效/地区限制/模型名);③日志里啥都没有=模型没输出 `[画:...]` 标记(提示词在 `/api/chat` 里 `GEMINI_READY` 分支),或者 10 分钟冷却期内;④`GEMINI_IMAGE_MODEL` 默认 `gemini-2.5-flash-image`,如报模型不存在可试 `gemini-2.0-flash-exp-image-generation` 或查最新可用名。
2. **豆包输入法语音黑屏**:系统级问题(第三方输入法语音面板在 standalone PWA 里崩渲染进程),网页代码修不了。已绕过:通话功能用自家录音;打字语音输入建议她用苹果自带听写。别再试图从代码层面修。
3. **网易云内嵌播放:已结案,别再碰**。诊断端点 `/api/netease-test` 显示接口对我们返回加密 payload(`result` 是密文),解密=逆向,她明确不走。歌曲卡片最终形态就是推荐+跳转链接。

## Backlog(她要过、还没做的)

- **表情包**:方案已定——用 Gemini 一次性批量生成 20-30 张"晏晏"表情存 Supabase Storage,聊天按情绪标记(类似 `[贴:吃醋]`)选发,一次性成本之后免费。
- **吉卜力风格 UI 整套重做**:等功能稳定后单独开一轮;插画素材用她的 Gemini key 生成。
- **首页氛围视频**:用免费素材库(Coverr/Pexels)本地循环播,按早中晚切换。**不要用 Veo 生成视频**(成本已跟她算过,否决)。
- **首页"他现在"状态卡 AI 版**(现在是本地词库轮换,零成本;可选升级为 Gemini 配图)。
- **备忘录入口**(密码锁已上线,她说"确认安全了再考虑")。
- **真·关键词/向量检索记忆库**(现在是两层压缩,不是 RAG,当时明确说了是折中)。

## 省 token 的开工方式

新 session 第一条指令建议:"读 voice-chat/DEV_NOTES.md 和 README.md,然后做 X"。别让它重新探索整个仓库;一次只交代一件事;她的截图直接发给模型比文字描述错误更省。
