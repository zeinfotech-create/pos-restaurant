import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MediaService } from './MediaService';

describe('MediaService', () => {
  it('should convert File/Blob to Base64', async () => {
    const blob = new Blob(['hello world'], { type: 'text/plain' });
    const file = new File([blob], 'hello.txt', { type: 'text/plain' });
    
    const base64 = await MediaService.fileToBase64(file);
    expect(base64).toContain('data:text/plain;base64,');
  });

  it('should throw an error if non-image is uploaded', async () => {
    const mockEvent = {
      target: {
        files: [
          new File([new Blob(['abc'], { type: 'text/plain' })], 'test.txt', { type: 'text/plain' })
        ]
      }
    };

    await expect(MediaService.handleImageUpload(mockEvent)).rejects.toThrow('Please upload an image file');
  });
});
