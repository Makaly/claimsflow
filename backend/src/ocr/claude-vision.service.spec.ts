import { Test } from '@nestjs/testing';
import { ClaudeVisionService } from './claude-vision.service';

describe('ClaudeVisionService', () => {
  let service: ClaudeVisionService;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ClaudeVisionService],
    }).compile();
    service = moduleRef.get(ClaudeVisionService);
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  describe('isAvailable', () => {
    it('returns false when ANTHROPIC_API_KEY is not set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(service.isAvailable()).toBe(false);
    });

    it('returns true when ANTHROPIC_API_KEY is present', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-key';
      expect(service.isAvailable()).toBe(true);
    });
  });
});
