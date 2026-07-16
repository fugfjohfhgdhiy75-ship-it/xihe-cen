require('dotenv').config();
const fs = require('fs');
const path = require('path');

const HOST = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';
const API_KEY = process.env.MINIMAX_API_KEY;
const GROUP_ID = process.env.MINIMAX_GROUP_ID;

async function main() {
  const [, , filePath, voiceId] = process.argv;
  if (!filePath || !voiceId) {
    console.error('用法: node scripts/clone-voice.js <音频文件路径> <自定义voice_id,比如 suyan-voice-01>');
    console.error('音频要求: mp3/m4a/wav,10秒~5分钟,不超过20MB');
    process.exit(1);
  }
  if (!API_KEY || !GROUP_ID) {
    console.error('先在 .env 里配置 MINIMAX_API_KEY 和 MINIMAX_GROUP_ID');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('文件不存在:', filePath);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const uploadForm = new FormData();
  uploadForm.append('purpose', 'voice_clone');
  uploadForm.append('file', new Blob([fileBuffer]), path.basename(filePath));

  console.log('上传音频...');
  const uploadRes = await fetch(`${HOST}/v1/files/upload?GroupId=${GROUP_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: uploadForm,
  });
  const uploadJson = await uploadRes.json();
  const fileId = uploadJson.file && uploadJson.file.file_id;
  if (!fileId) {
    console.error('上传失败:', JSON.stringify(uploadJson, null, 2));
    process.exit(1);
  }
  console.log('上传成功, file_id =', fileId);

  console.log('发起克隆...');
  const cloneRes = await fetch(`${HOST}/v1/voice_clone?GroupId=${GROUP_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_id: fileId, voice_id: voiceId }),
  });
  const cloneJson = await cloneRes.json();
  console.log(JSON.stringify(cloneJson, null, 2));

  if (cloneJson.base_resp && cloneJson.base_resp.status_code === 0) {
    console.log(`\n克隆成功。把这行加到 .env:\nMINIMAX_VOICE_ID=${voiceId}`);
    console.log('注意: 新克隆的音色 7 天内没有被真正用于一次 TTS 合成会被自动清理, 克隆完记得赶紧在 app 里说句话用一下。');
  } else {
    console.error('\n克隆失败,看上面的返回信息。');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
