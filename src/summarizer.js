import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const SYSTEM_PROMPT = `你是一個 LINE 群組訊息摘要助理。你的任務是從大量群組對話中，精準提取真正重要的資訊。

## 需要保留的內容
- 重要決議、決定
- 活動通知、集合時間地點
- 待辦事項、指派任務
- 重要公告、提醒
- 有價值的資訊分享（連結、文件、數據）

## 需要忽略的內容
- 閒聊、問候、表情符號
- 玩笑話、梗圖描述
- 「好的」「謝謝」「了解」等附和
- 重複確認的訊息
- 無實質內容的對話

## 輸出格式
用繁體中文輸出，結構清晰。如果沒有重要資訊，直接說「今日無重要資訊」。

格式範例：
📌 **重要事項**
- [事項1]
- [事項2]

📅 **活動/通知**
- [日期/時間] [內容]

✅ **待辦/行動項目**
- [誰] 需要 [做什麼]

如果某個類別沒有內容，則省略該類別。`;

function formatMessages(messages) {
  return messages
    .map((m) => {
      const name = m.display_name || m.user_id || '未知用戶';
      return `[${m.timestamp}] ${name}: ${m.message}`;
    })
    .join('\n');
}

export async function summarize(groupId, messages, dateStr) {
  if (messages.length === 0) {
    return '今日無訊息記錄。';
  }

  const chatText = formatMessages(messages);
  const userContent = `以下是 ${dateStr} 的群組對話記錄，共 ${messages.length} 則訊息：\n\n${chatText}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text : '';
}
