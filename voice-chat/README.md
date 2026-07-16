# 聊天前端(Claude API + 语音)

打字或者按麦克风说一句话,发送,Claude 用文字回复,同时用 TTS 把回复念出来。是聊天窗口模式(发一句、回一句),不是持续监听的"电话"模式——每次说话都要你自己点一下麦克风,这样更贴合正常聊天的节奏,也比连续通话稳定得多(不用担心播放和录音抢麦克风)。

TTS 默认用浏览器自带的 `speechSynthesis`;配好 MiniMax speech-02 的环境变量后会自动切换成克隆音色朗读,不用改代码。每条 AI 回复气泡旁边有个 ▶ 按钮,可以重新播放。

## 本地运行

```bash
cd voice-chat
npm install
cp .env.example .env   # 填入你的 ANTHROPIC_API_KEY
npm start
```

打开 http://localhost:3000。

走中转站(而不是官方 Anthropic 账号)的话,把中转站给的接口地址填进 `.env` 的 `ANTHROPIC_BASE_URL`(形如 `https://xxx.xxx/v1`,注意不要带 `/v1`,SDK 自己会加,详见"已知限制"里的坑),`MODEL` 按中转站文档里给的模型名填(有些中转站的 model 名字带方括号前缀,是真正字符串的一部分,不是装饰,要原样复制)。

## 使用说明

- 打字 + 回车/点"发送",或者点麦克风说一句话(说完自动停止识别并发送)。
- AI 回复默认只显示文字,**不会自动念出来**——想听语音自己点气泡旁边的 ▶ 按钮,点了才会去合成语音(懒加载),不会一打开对话就疯狂跑 TTS 账单。
- 左上角 ☰ 是对话列表,可以新建/切换/改名/删除多个独立对话,每个对话的记录都存在 Supabase 里,换设备登录也能接着聊。
- 右上角齿轮可以改 System Prompt(存在服务器,全设备共用)、识别语言、浏览器朗读音色(仅浏览器 TTS 模式下生效)。改完记得点"保存"。
- 没配置 Supabase 时,顶部会有提示,输入框也会被禁用——聊天记录持久化是必须有数据库的,见下面"接入 Supabase"。
- 输入框左边的 🖼️ 可以发图片,选好会先出个小预览,确认没问题再发送;模型要支持多模态(能看图)才认得,`MODEL` 换成不支持的会报错。图片存在 Supabase Storage 里,历史记录里也能看到;为了控制成本,只有"当下这一轮"会把图片真的发给模型,之后的对话不会每次重发。

## 接入 Supabase(聊天记录持久化 + 多会话 + 记忆压缩)

1. 去 [supabase.com](https://supabase.com) 用 GitHub 账号注册,新建一个项目(免费额度够用)。
2. 项目建好后,进 **SQL Editor**,把仓库里 `supabase-schema.sql` 的内容整段粘贴进去执行一次,会建好 `sessions` / `messages` / `memories` / `settings` 四张表。
3. 项目设置里的 **Settings → API** 页面,拿到 **Project URL** 和 **`service_role` 或 `anon` key**(个人项目用哪个都行,填进 `.env` 的 `SUPABASE_URL` / `SUPABASE_KEY`)。
4. 重启服务,顶部的"未配置 Supabase"提示应该消失,输入框可以用了。

**记忆压缩**是怎么回事:每次对话后,后端会检查当前会话"可见消息"的总字数,超过 `COMPRESS_CHAR_THRESHOLD`(默认 6000 字)就会把最早的一批消息(保留最近 `COMPRESS_KEEP_MESSAGES` 条不动)丢给模型压缩成一段摘要存进 `memories` 表,原始消息标记为不可见(数据还在,只是不再拼进上下文)。这样对话越聊越长也不会无限增加 token 成本。默认用主模型自己做压缩;配置 `DEEPSEEK_API_KEY` 之后会改用更便宜的 DeepSeek 做这件事,不影响主对话质量。

**发图片**需要额外建一个 Storage 桶:服务器启动时会自动尝试创建一个叫 `chat-images` 的公开桶,一般不用手动管;如果启动日志报 `createBucket error`,就去 Supabase 的 **Storage** 页面手动建一个名字为 `chat-images` 的 **Public** 桶。另外 `messages` 表需要多一个 `image_url` 字段,老项目在 SQL Editor 里跑一下这一行就行(新项目跑完整个 `supabase-schema.sql` 已经包含):
```sql
alter table messages add column if not exists image_url text;
```

## 接入 MiniMax speech-02 克隆音色

1. 去 [platform.minimax.io](https://platform.minimax.io)(国际版)或 [platform.minimaxi.com](https://platform.minimaxi.com)(国内版)注册,拿到 `API Key` 和 `Group ID`,填进 `.env` 的 `MINIMAX_API_KEY` / `MINIMAX_GROUP_ID`。国内版记得把 `MINIMAX_API_HOST` 改成 `https://api.minimaxi.com`。
2. 准备一段 10 秒~5 分钟、mp3/m4a/wav、不超过 20MB 的干净音源(没有背景噪音,不然大概率克隆失败或跑出杂音,得重新花钱录)。
3. 克隆有两种方式:
   - **有本地开发环境**:跑脚本一行命令搞定
     ```bash
     node scripts/clone-voice.js ./你的音频.mp3 suyan-voice-01
     ```
   - **只有手机/没装 Node**:部署上线后,打开 `https://你的域名/clone.html`,上传音频、填音色 ID,点按钮,网页会调用部署好的服务器完成上传+克隆(服务器有完整外网权限,不受本地网络限制)。这个页面会消耗 MiniMax 余额,建议配一个 `CLONE_PASSCODE` 环境变量做访问口令,不然任何知道网址的人都能用你的余额瞎克隆。
   
   成功都会提示把 `MINIMAX_VOICE_ID=suyan-voice-01` 加到环境变量。
4. **新克隆的音色 7 天内没有被真正合成过一次会被自动清理**,克隆完记得马上开一次通话说句话用一下。
5. 重启 `npm start`,前端会自动检测到配置,把朗读换成 MiniMax。想切回浏览器朗读,把 `.env` 里的 `MINIMAX_*` 清空即可。

`MINIMAX_MODEL` 默认 `speech-02-turbo`(低延迟,适合实时通话);想要更好的音质、能接受更慢一点可以改成 `speech-02-hd`。

## 已知限制

- 语音识别用的是浏览器原生 `SpeechRecognition`,Chrome / Edge(桌面端)支持最好;iOS Safari 能用但依赖苹果自己的识别服务,偶尔会慢或者失败,这是平台限制不是 bug。
- 没配 MiniMax 时用的是浏览器原生 `speechSynthesis`,音色取决于操作系统自带的语音包,不是高保真人声;配好 MiniMax 之后走克隆音色,见下面"接入 MiniMax speech-02 克隆音色"。
- iOS Safari 对"没有直接用户点击就自动播放音频"管得很严,已经做了播放解锁处理,但如果换了浏览器/系统还是遇到听不到声音,先看是不是需要手动点 ▶ 按钮。
- `SpeechRecognition` 要求安全上下文(HTTPS),部署到线上时必须用 HTTPS 域名,`localhost` 本地开发不受此限制。
- 中转站接口地址(`ANTHROPIC_BASE_URL`)不要带 `/v1` 后缀,SDK 会自动拼接,带了会变成 `/v1/v1/messages` 导致 404。

## 部署

这是个普通的 Node/Express 应用,`ANTHROPIC_API_KEY` 只存在服务端,不会下发到前端。选一个支持长连接/流式响应、外加 HTTPS 的平台即可,比如:

- **Render / Railway / Fly.io**:直接连 GitHub repo,设置根目录为 `voice-chat`,构建命令 `npm install`,启动命令 `npm start`,配置环境变量 `ANTHROPIC_API_KEY`。
- **自己的服务器**:`npm install && npm start`(建议用 pm2 常驻),前面挂 nginx 做 HTTPS 反代。
- Vercel 的 Serverless Functions 对长时间 SSE 流支持有限,不太推荐;真要用 Vercel 建议改成 Edge Function 或直接用上面几个平台。

部署完把域名换成你的服务地址访问即可,不需要改代码。
