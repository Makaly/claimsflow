import { LlmRouterService } from './llm-router.service';

describe('LlmRouterService', () => {
  // Minimal fakes that record which adapter was hit and with what model.
  const make = () => {
    const calls: Array<{ who: string; model?: string }> = [];
    const fake = (who: string) => ({
      isAvailable: () => true,
      generate: async (_s: string, _u: string, o?: any) => { calls.push({ who, model: o?.model }); return who; },
      generateFromImage: async (_s: string, _u: string, _b: string, _m: string, o?: any) => { calls.push({ who, model: o?.model }); return who; },
    });
    const gemini = fake('gemini') as any;
    const claude = fake('claude') as any;
    const ollama = fake('ollama') as any;
    return { router: new LlmRouterService(gemini, claude, ollama), calls };
  };

  describe('parse()', () => {
    const { router } = make();
    it.each([
      ['claude:claude-opus-4-7', 'claude', 'claude-opus-4-7'],
      ['gemini:gemini-2.5-pro', 'gemini', 'gemini-2.5-pro'],
      ['ollama:moondream', 'ollama', 'moondream'],
      ['claude-sonnet-4-6', 'claude', 'claude-sonnet-4-6'],   // bare → inferred
      ['llama3.2-vision', 'ollama', 'llama3.2-vision'],
      ['gemini-2.0-flash', 'gemini', 'gemini-2.0-flash'],
      ['tesseract', 'gemini', undefined],                      // can't reason → default
    ])('routes %s → %s', (id, provider, model) => {
      expect(router.parse(id)).toEqual({ provider, model });
    });

    it('defaults to gemini when no model id is given', () => {
      expect(router.parse(undefined)).toEqual({ provider: 'gemini' });
    });
  });

  describe('generate() dispatch', () => {
    it('sends each provider its bare model name', async () => {
      const { router, calls } = make();
      await router.generate('s', 'u', { model: 'claude:claude-opus-4-7' });
      await router.generate('s', 'u', { model: 'ollama:moondream' });
      await router.generate('s', 'u', { model: 'gemini-2.5-pro' });
      expect(calls).toEqual([
        { who: 'claude', model: 'claude-opus-4-7' },
        { who: 'ollama', model: 'moondream' },
        { who: 'gemini', model: 'gemini-2.5-pro' },
      ]);
    });

    it('generateFromImage routes the same way', async () => {
      const { router, calls } = make();
      await router.generateFromImage('s', 'u', 'b64', 'image/png', { model: 'claude:claude-haiku-4-5' });
      expect(calls).toEqual([{ who: 'claude', model: 'claude-haiku-4-5' }]);
    });
  });
});
