const fs = require('fs');
const path = require('path');

/**
 * Content-Specific Validation Tests
 * 
 * Tests specific requirements for each documentation file
 * based on its purpose and content
 */

describe('Content-Specific Validation', () => {
  const markdownFiles = {
    'README.md': path.join(__dirname, '../../README.md'),
    'ARCHITECTURE.md': path.join(__dirname, '../../ARCHITECTURE.md'),
    'INTEGRATIONS.md': path.join(__dirname, '../../INTEGRATIONS.md'),
    'copilot-instructions.md': path.join(__dirname, '../../.github/copilot-instructions.md')
  };

  describe('README.md Requirements', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(markdownFiles['README.md'], 'utf8');
    });

    test('should have project title', () => {
      const lines = content.split('\n');
      expect(lines[0]).toMatch(/^#\s+/);
    });

    test('should describe the project', () => {
      expect(content.length).toBeGreaterThan(1000);
      expect(content.toLowerCase()).toContain('restaurant');
    });

    test('should have documentation links section', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('documentation');
    });

    test('should list key features', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('features');
    });

    test('should have setup instructions', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('install') || expect(contentLower).toContain('setup');
    });
  });

  describe('ARCHITECTURE.md Requirements', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(markdownFiles['ARCHITECTURE.md'], 'utf8');
    });

    test('should describe technology stack', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('react');
      expect(contentLower).toContain('typescript');
      expect(contentLower).toContain('supabase');
    });

    test('should document caching strategy', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('caching');
      expect(contentLower).toContain('react query');
    });

    test('should document design system', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('design system');
      expect(contentLower).toContain('semantic tokens');
    });

    test('should document accessibility standards', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('accessibility');
      expect(contentLower).toContain('wcag') || expect(contentLower).toContain('aria');
    });

    test('should document state management', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('state management');
    });
  });

  describe('INTEGRATIONS.md Requirements', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(markdownFiles['INTEGRATIONS.md'], 'utf8');
    });

    test('should document bank integrations', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('bank');
      expect(contentLower).toContain('stripe');
    });

    test('should document POS integrations', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('pos');
      expect(contentLower).toContain('square');
    });

    test('should document AI functionality', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('ai');
      expect(contentLower).toContain('openrouter');
    });

    test('should document Edge Functions', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('edge function');
    });

    test('should document security practices', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('security');
      expect(contentLower).toContain('encryption') || expect(contentLower).toContain('webhook');
    });

    test('should have code examples', () => {
      const codeBlocks = (content.match(/```/g) || []).length / 2;
      expect(codeBlocks).toBeGreaterThan(20);
    });
  });

  describe('copilot-instructions.md Requirements', () => {
    let content;

    beforeAll(() => {
      content = fs.readFileSync(markdownFiles['copilot-instructions.md'], 'utf8');
    });

    test('should have critical rules section', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('critical rules');
    });

    test('should document caching rules', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('no manual caching');
    });

    test('should document design patterns', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('design pattern') || expect(contentLower).toContain('design system');
    });

    test('should document accessibility requirements', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('accessibility');
    });

    test('should document data fetching patterns', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('react query') || expect(contentLower).toContain('data fetching');
    });

    test('should have practical code examples', () => {
      const codeBlocks = (content.match(/```/g) || []).length / 2;
      expect(codeBlocks).toBeGreaterThan(15);
    });
  });

  describe('Cross-Document Consistency', () => {
    let allContents;

    beforeAll(() => {
      allContents = {};
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        allContents[name] = fs.readFileSync(filePath, 'utf8');
      });
    });

    test('documents should use consistent terminology', () => {
      const readme = allContents['README.md'].toLowerCase();
      const architecture = allContents['ARCHITECTURE.md'].toLowerCase();
      const integrations = allContents['INTEGRATIONS.md'].toLowerCase();

      // Key terms should be consistent across docs
      const keyTerms = ['react query', 'supabase', 'typescript'];
      
      keyTerms.forEach(term => {
        const inReadme = readme.includes(term);
        const inArch = architecture.includes(term);
        const inInteg = integrations.includes(term);
        
        // At least 2 documents should mention each key term
        const count = [inReadme, inArch, inInteg].filter(Boolean).length;
        expect(count).toBeGreaterThanOrEqual(2);
      });
    });

    test('all documents should reference the same technology stack', () => {
      const readme = allContents['README.md'].toLowerCase();
      const architecture = allContents['ARCHITECTURE.md'].toLowerCase();

      expect(readme).toContain('react');
      expect(architecture).toContain('react');
      
      expect(readme).toContain('typescript');
      expect(architecture).toContain('typescript');
    });
  });
});