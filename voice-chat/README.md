# 语音通话前端(Claude API)

浏览器语音识别(STT)→ Claude API(流式)→ 浏览器语音合成(TTS)拼起来的"实时通话"体验。不是原生语音模型,是拼接链路,但打断、连续对话都支持,体验接近打电话。

## 本地运行

```bash
cd voice-chat
npm install
cp .env.example .env   # 填入你的 ANTHROPIC_API_KEY
npm start
```

打开 http://localhost:3000,点击麦克风按钮开始通话。

## 使用说明

- 点击圆形按钮开始通话,浏览器会请求麦克风权限。
- 说完一句话后停顿一下,识别会自动结束并发给 Claude,回复会边生成边朗读。
- 想打断 Claude 说话,点"打断"按钮,或者直接开始说话(打断按钮会停止朗读并重新开始监听)。
- 右上角齿轮可以改 System Prompt、识别语言、朗读音色。
- 再次点击圆形按钮结束通话。

## 已知限制

- 语音识别用的是浏览器原生 `SpeechRecognition`,目前只有 Chrome / Edge(桌面端)支持得比较好,Safari/Firefox 基本不可用。
- 朗读用的是浏览器原生 `speechSynthesis`,音色取决于操作系统自带的语音包,不是高保真人声。想要更自然的声音可以换成 ElevenLabs / OpenAI TTS 之类的服务,把 `speakSentence` 换成调用对应 API 再播放音频。
- 没有做真正的"全双工"打断(AI 说话时麦克风不会一直监听打断),而是"AI 说完自动重新监听 + 手动打断按钮"的半双工模式,避免设备自己的声音被识别成用户在说话导致的回音问题。
- `SpeechRecognition` 要求安全上下文(HTTPS),部署到线上时必须用 HTTPS 域名,`localhost` 本地开发不受此限制。

## 部署

这是个普通的 Node/Express 应用,`ANTHROPIC_API_KEY` 只存在服务端,不会下发到前端。选一个支持长连接/流式响应、外加 HTTPS 的平台即可,比如:

- **Render / Railway / Fly.io**:直接连 GitHub repo,设置根目录为 `voice-chat`,构建命令 `npm install`,启动命令 `npm start`,配置环境变量 `ANTHROPIC_API_KEY`。
- **自己的服务器**:`npm install && npm start`(建议用 pm2 常驻),前面挂 nginx 做 HTTPS 反代。
- Vercel 的 Serverless Functions 对长时间 SSE 流支持有限,不太推荐;真要用 Vercel 建议改成 Edge Function 或直接用上面几个平台。

部署完把域名换成你的服务地址访问即可,不需要改代码。
