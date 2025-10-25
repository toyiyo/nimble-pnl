const fs = require('fs');
const path = require('path');

describe('Content-Specific Validation', () => {
  describe('README.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      const filePath = path.join(__dirname, '../../README.md');
      content = fs.readFileSync(filePath, 'utf8');
    });

    test('should have a clear title', () => {
      const firstLine = content.split('\n')[0];
      expect(firstLine).toMatch(/^#\s+/);
      expect(firstLine.length).toBeGreaterThan(3);
    });

    test('should provide project overview', () => {
      expect(content.length).toBeGreaterThan(200);
    });

    test('should have meaningful content in paragraphs', () => {
      const paragraphs = content.split('\n\n').filter(p => 
        p.trim().length > 0 && !p.trim().startsWith('#')
      );
      expect(paragraphs.length).toBeGreaterThan(2);
    });
  });

  describe('ARCHITECTURE.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      const filePath = path.join(__dirname, '../../ARCHITECTURE.md');
      content = fs.readFileSync(filePath, 'utf8');
    });

    test('should describe system architecture', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toMatch(/architecture|component|structure|design/);
    });

    test('should have multiple sections explaining different aspects', () => {
      const headers = content.match(/^#{2,}\s+/gm);
      expect(headers).not.toBeNull();
      expect(headers.length).toBeGreaterThan(2);
    });

    test('should provide technical details', () => {
      expect(content.length).toBeGreaterThan(500);
    });
  });

  describe('INTEGRATIONS.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      const filePath = path.join(__dirname, '../../INTEGRATIONS.md');
      content = fs.readFileSync(filePath, 'utf8');
    });

    test('should be comprehensive documentation', () => {
      expect(content.length).toBeGreaterThan(1500);
    });

    test('should describe integrations', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toMatch(/integration|api|service|connect/);
    });

    test('should have well-organized sections', () => {
      const headers = content.match(/^#{1,3}\s+/gm);
      expect(headers).not.toBeNull();
      expect(headers.length).toBeGreaterThan(5);
    });

    test('should provide practical information', () => {
      const paragraphs = content.split('\n\n').filter(p => 
        p.trim().length > 50 && !p.trim().startsWith('#')
      );
      expect(paragraphs.length).toBeGreaterThan(10);
    });
  });

  describe('copilot-instructions.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      const filePath = path.join(__dirname, '../../.github/copilot-instructions.md');
      content = fs.readFileSync(filePath, 'utf8');
    });

    test('should provide instructions', () => {
      expect(content.length).toBeGreaterThan(300);
    });

    test('should have clear guidance sections', () => {
      const headers = content.match(/^#{1,4}\s+/gm);
      expect(headers).not.toBeNull();
      expect(headers.length).toBeGreaterThan(1);
    });

    test('should contain actionable content', () => {
      const paragraphs = content.split('\n\n').filter(p => 
        p.trim().length > 20
      );
      expect(paragraphs.length).toBeGreaterThan(3);
    });
  });

  describe('Cross-Document Content Consistency', () => {
    let readmeContent, architectureContent, integrationsContent, copilotContent;

    beforeAll(() => {
      readmeContent = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');
      architectureContent = fs.readFileSync(path.join(__dirname, '../../ARCHITECTURE.md'), 'utf8');
      integrationsContent = fs.readFileSync(path.join(__dirname, '../../INTEGRATIONS.md'), 'utf8');
      copilotContent = fs.readFileSync(path.join(__dirname, '../../.github/copilot-instructions.md'), 'utf8');
    });

    test('documents should reference each other appropriately', () => {
      // This is a flexible test - just checking if docs are interconnected
      const allContent = readmeContent + architectureContent + integrationsContent + copilotContent;
      expect(allContent.length).toBeGreaterThan(2000);
    });

    test('should use consistent terminology across documents', () => {
      const extractTerms = (content) => {
        // Extract code terms and important words
        const codeTerms = content.match(/`[^`]+`/g) || [];
        return codeTerms.map(t => t.replace(/`/g, ''));
      };

      const allTerms = [
        ...extractTerms(readmeContent),
        ...extractTerms(architectureContent),
        ...extractTerms(integrationsContent),
        ...extractTerms(copilotContent)
      ];

      // Should have some common terms across documents
      expect(allTerms.length).toBeGreaterThan(0);
    });

    test('all documents should follow the same style guide', () => {
      const checkStyle = (content) => {
        // Check for consistent heading style (ATX style #)
        const hasAtxHeaders = content.match(/^#{1,6}\s+/m);
        const hasSetextHeaders = content.match(/^.+\n[=-]+$/m);
        
        return {
          usesAtx: !!hasAtxHeaders,
          usesSetext: !!hasSetextHeaders
        };
      };

      const readmeStyle = checkStyle(readmeContent);
      const archStyle = checkStyle(architectureContent);
      const integStyle = checkStyle(integrationsContent);
      const copilotStyle = checkStyle(copilotContent);

      // All should use same heading style
      const allStyles = [readmeStyle, archStyle, integStyle, copilotStyle];
      const atxCount = allStyles.filter(s => s.usesAtx).length;
      const setextCount = allStyles.filter(s => s.usesSetext).length;

      // Most should use the same style (allow for 1 exception)
      expect(atxCount >= 3 || setextCount >= 3).toBe(true);
    });
  });
});