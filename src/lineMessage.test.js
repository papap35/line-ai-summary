import { describe, it, expect } from 'vitest';
import { describeMessage } from './lineMessage.js';

describe('describeMessage', () => {
  it('passes text messages through unchanged', () => {
    expect(describeMessage({ type: 'text', text: 'hello' })).toEqual({ text: 'hello', messageType: 'text' });
  });

  it('returns a placeholder for stickers', () => {
    expect(describeMessage({ type: 'sticker', packageId: '1', stickerId: '2' })).toEqual({
      text: '[貼圖]',
      messageType: 'sticker',
    });
  });

  it('returns a placeholder for images', () => {
    expect(describeMessage({ type: 'image' })).toEqual({ text: '[圖片]', messageType: 'image' });
  });

  it('returns a placeholder for video', () => {
    expect(describeMessage({ type: 'video' })).toEqual({ text: '[影片]', messageType: 'video' });
  });

  it('returns a placeholder for audio', () => {
    expect(describeMessage({ type: 'audio' })).toEqual({ text: '[語音]', messageType: 'audio' });
  });

  it('includes the file name for file messages', () => {
    expect(describeMessage({ type: 'file', fileName: 'report.pdf', fileSize: 1234 })).toEqual({
      text: '[檔案: report.pdf]',
      messageType: 'file',
    });
  });

  it('includes the title for location messages', () => {
    expect(
      describeMessage({ type: 'location', title: '台北車站', address: '台北市中正區', latitude: 25, longitude: 121 })
    ).toEqual({ text: '[位置: 台北車站]', messageType: 'location' });
  });

  it('falls back to the address when a location has no title', () => {
    expect(describeMessage({ type: 'location', address: '台北市中正區' })).toEqual({
      text: '[位置: 台北市中正區]',
      messageType: 'location',
    });
  });

  it('returns null for unsupported message types', () => {
    expect(describeMessage({ type: 'imagemap' })).toBeNull();
  });
});
