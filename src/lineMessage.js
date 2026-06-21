// Maps a LINE message event into storable text + a messageType tag. Used so
// non-text messages (stickers, images, files, locations...) still leave a
// trace in the day's conversation instead of being silently dropped, without
// doing real media analysis (no OCR/vision call).
export function describeMessage(message) {
  switch (message.type) {
    case 'text':
      return { text: message.text, messageType: 'text' };
    case 'sticker':
      return { text: '[貼圖]', messageType: 'sticker' };
    case 'image':
      return { text: '[圖片]', messageType: 'image' };
    case 'video':
      return { text: '[影片]', messageType: 'video' };
    case 'audio':
      return { text: '[語音]', messageType: 'audio' };
    case 'file':
      return { text: `[檔案: ${message.fileName}]`, messageType: 'file' };
    case 'location':
      return { text: `[位置: ${message.title || message.address || '未命名地點'}]`, messageType: 'location' };
    default:
      return null;
  }
}

const SUMMARY_SETTING_COMMAND = '/設定摘要';

// Parses the "/設定摘要 <說明文字>" command. Returns the trimmed instruction
// text, or null if the message isn't this command (or carries no
// instruction text, e.g. "/設定摘要" alone).
export function parseSummarySettingCommand(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(SUMMARY_SETTING_COMMAND)) return null;

  const suffix = trimmed.slice(SUMMARY_SETTING_COMMAND.length).trim();
  return suffix || null;
}
