# 交接笔记(给下一个开发 session 读的)

新 session 开工前先读这份 + `README.md`,基本就不用翻聊天历史了。

## 项目是什么

岑溪禾的私人 AI 伴侣网页 App("苏晏"),部署在 Render(`https://xihe-cen.onrender.com`),
仓库 `fugfjohfhgdhiy75-ship-it/xihe-cen`,代码全在 `voice-chat/` 目录。
**Render 目前实际连的分支是 `claude/yan-yan-bao-bao-is5dgi`(在 Render 后台 Settings 页她截图确认过),
不是 `main`**——push 到这条分支才会自动部署,push 到 `main` 或别的分支都不会上线,只是存起来而已。
数据库 Supabase(她手动在 SQL Editor 里跑 `supabase-schema.sql`,该文件全部幂等,可整段重跑)。

**每个 session 结束前,必须同时把改动 push 到 `main` 和 `claude/yan-yan-bao-bao-is5dgi` 这两个分支
(两者应该保持完全同步,永远是 `git push origin main:claude/yan-yan-bao-bao-is5dgi` 这种快进关系,
不要在这条分支上单独搞出跟 main 不一样的历史)。**
之前的教训:笔记曾经写死这个分支名,后来一次修复只合去了 `main`、没同步到这条 Render 实际连的分支,
上线的还是旧代码,得靠她截图 Render 后台才发现分支不对。
**建议她找时间去 Render 后台 Settings 页把部署分支直接改成 `main`**(改完这条注意事项就能删掉,以后
只要无脑 push `main` 就行,不用再惦记这个奇怪的分支名);在她改之前,别漏了上面两个分支都要 push。
这样不管她后面开几个新 session、每个 session 用的临时
分支叫什么,只要从 `main` 出发都能看到完整、最新的状态,不用她自己去追踪分支。

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

`ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / MODEL`(可被网页设置覆盖)、`SUPABASE_URL / SUPABASE_KEY`、`SITE_PASSWORD`(整站密码锁)、`GEMINI_API_KEY`(**现在只用于通话语音识别**,画图已不用它,她已配)、`ELEVENLABS_*`(TTS,**她额度已用完**,会自动落到 MiniMax)、`MINIMAX_*`(TTS 兜底 + **自动画图**,`MINIMAX_API_KEY`/`MINIMAX_GROUP_ID`两个功能共用)、`DEEPSEEK_API_KEY`(记忆压缩省钱用)。

## 当前未解决 / 待验证(按优先级)

1. **豆包输入法语音黑屏**:系统级问题(第三方输入法语音面板在 standalone PWA 里崩渲染进程),网页代码修不了。已绕过:通话功能用自家录音;打字语音输入建议她用苹果自带听写。别再试图从代码层面修。
2. **网易云内嵌播放:已结案,别再碰**。诊断端点 `/api/netease-test` 显示接口对我们返回加密 payload(`result` 是密文),解密=逆向,她明确不走。歌曲卡片最终形态就是推荐+跳转链接。

## 已解决:聊天自动发图(2026-07-18,别再重新排查这条)

之前"模型嘴上说'发过去了'但没图"排查了很久,分两层原因,**都已修完,画图现在走 MiniMax,不再用 Gemini**:
1. 调 Gemini 图片接口时请求体漏了 `generationConfig.responseModalities: ['TEXT','IMAGE']`,导致它默默只回文字、不报图片、也不报错——这层已经不重要了,因为整个 Gemini 画图链路都拆掉了,见下一条。
2. 修完①之后测试发现 Gemini 画图报 `Quota exceeded ... limit: 0`——换了新 Google Cloud 项目、换了新 key 结果一样,说明 `gemini-2.5-flash-image` 这个模型**免费额度目前就是 0**,必须开 Google Cloud 计费(要绑国际信用卡)才能用。她没有国际卡,不想开计费。
   **于是把自动画图整条链路从 Gemini 换成了 MiniMax**(`generateMinimaxImage`,复用她已经在用、已经充值的 `MINIMAX_API_KEY`/`MINIMAX_GROUP_ID`,不需要新账号、不需要国际卡)。`GEMINI_API_KEY` 现在只用于通话语音识别(`transcribeWithGemini`),跟画图无关了。
   **如果以后又出现"发图变文字"**:别再往 Gemini 方向排查,先查 Render Logs 搜 `auto image generation failed`,看 MiniMax 那边报的 `base_resp` 错误(常见:余额不足、`MINIMAX_API_KEY`/`MINIMAX_GROUP_ID` 没配对、内容审核拦截)。

## Backlog(她要过、还没做的)

- **表情包**:方案已定——一次性批量生成 20-30 张"晏晏"表情存 Supabase Storage,聊天按情绪标记(类似 `[贴:吃醋]`)选发,一次性成本之后免费。**画图用 MiniMax,不是 Gemini**(见上面"已解决"那条,Gemini 画图免费额度已经是 0)。
- **吉卜力风格 UI 整套重做**:等功能稳定后单独开一轮;插画素材用 MiniMax 生成,不用 Gemini。
- **首页氛围视频**:用免费素材库(Coverr/Pexels)本地循环播,按早中晚切换。**不要用 Veo 生成视频**(成本已跟她算过,否决)。
- **首页"他现在"状态卡 AI 版**(现在是本地词库轮换,零成本;可选升级为 MiniMax 配图)。
- **备忘录入口**(密码锁已上线,她说"确认安全了再考虑")。
- **真·关键词/向量检索记忆库**(现在是两层压缩,不是 RAG,当时明确说了是折中)。2026-07-18 又聊过一次:
  结论是她现在的用法(单窗口长聊,重感情连续性)不需要 RAG,先不做;真正的痛点"重要的事必须永远记住+跨窗口"
  已经用**纪念册**(milestones 表)解决了——模型在聊天里用 `[记:...]` 标记提议,她在聊天里点"记下来"确认,
  confirmed 条目拼进所有窗口每一轮的提示词,永不压缩;主页有卡片可以看/删/手动加。别再重复提议做 RAG,除非她
  主动抱怨"他忘了很久以前的具体细节"。

## 省 token 的开工方式

新 session 第一条指令建议:"读 voice-chat/DEV_NOTES.md 和 README.md,然后做 X"。别让它重新探索整个仓库;一次只交代一件事;她的截图直接发给模型比文字描述错误更省。
