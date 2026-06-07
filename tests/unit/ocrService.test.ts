import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const setParameters = vi.fn().mockResolvedValue(undefined);
const terminate = vi.fn().mockResolvedValue(undefined);
const createWorker = vi.fn().mockResolvedValue({ setParameters, recognize: vi.fn(), terminate });

// Hoisted mock — intercepts both static and dynamic `import('tesseract.js')`.
vi.mock('tesseract.js', () => ({ createWorker }));

import { ocrService } from '@/services/ocrService';

describe('ocrService.initialize', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => { await ocrService.terminate(); });

  it('dynamically imports tesseract and creates a worker', async () => {
    await ocrService.initialize();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(setParameters).toHaveBeenCalledTimes(1);
  });
});
