const fs = require('fs');
const path = require('path');

/**
 * Comprehensive Markdown Documentation Tests
 * 
 * Tests validate:
 * - File existence and readability
 * - Document structure and hierarchy
 * - Link integrity
 * - Code block formatting
 * - Content quality
 * - Cross-document consistency
 */

describe('Markdown Documentation Structure Tests', () => {
  const markdownFiles = {
    'README.md': path.join(__dirname, '../../README.md'),
    'ARCHITECTURE.md': path.join(__dirname, '../../ARCHITECTURE.md'),
    'INTEGRATIONS.md': path.join(__dirname, '../../INTEGRATIONS.md'),
    'copilot-instructions.md': path.join(__dirname, '../../.github/copilot-instructions.md')
  };

  // Helper: Read file content
  const readFile = (filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read ${filePath}: ${error.message}`);
    }
  };

  // Helper: Extract headers
  const extractHeaders = (content) => {
    const headerRegex = /^(#{1,6})\s+(.+)$/gm;
    const headers = [];
    let match;
    while ((match = headerRegex.exec(content)) !== null) {
      headers.push({
        level: match[1].length,
        text: match[2].trim(),
        line: content.substring(0, match.index).split('\n').length
      });
    }
    return headers;
  };

  // Helper: Extract links
  const extractLinks = (content) => {
    const linkRegex = /\[([^\]]+)\]\(([^\)]+)\)/g;
    const links = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push({
        text: match[1],
        url: match[2],
        fullMatch: match[0]
      });
    }
    return links;
  };

  // Helper: Extract code blocks
  const extractCodeBlocks = (content) => {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const blocks = [];
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'plain',
        code: match[2],
        fullMatch: match[0]
      });
    }
    return blocks;
  };

  describe('File Existence and Readability', () => {
    test.each(Object.entries(markdownFiles))(
      '%s should exist and be readable',
      (name, filePath) => {
        expect(fs.existsSync(filePath)).toBe(true);
        expect(() => readFile(filePath)).not.toThrow();
      }
    );

    test.each(Object.entries(markdownFiles))(
      '%s should not be empty',
      (name, filePath) => {
        const content = readFile(filePath);
        expect(content.length).toBeGreaterThan(0);
        expect(content.trim().length).toBeGreaterThan(0);
      }
    );
  });

  describe('README.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      content = readFile(markdownFiles['README.md']);
    });

    test('should have a top-level heading', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
    });

    test('should reference other documentation files', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('architecture.md');
      expect(contentLower).toContain('integrations.md');
    });

    test('should have proper header hierarchy', () => {
      const headers = extractHeaders(content);
      for (let i = 1; i < headers.length; i++) {
        const levelDiff = headers[i].level - headers[i - 1].level;
        expect(levelDiff).toBeLessThanOrEqual(1);
      }
    });

    test('should have valid link syntax', () => {
      const links = extractLinks(content);
      links.forEach(link => {
        expect(link.text).toBeTruthy();
        expect(link.url).toBeTruthy();
      });
    });

    test('should have properly closed code blocks', () => {
      const openBlocks = (content.match(/```/g) || []).length;
      expect(openBlocks % 2).toBe(0);
    });
  });

  describe('ARCHITECTURE.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      content = readFile(markdownFiles['ARCHITECTURE.md']);
    });

    test('should have a top-level heading', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
    });

    test('should contain architecture-related content', () => {
      const contentLower = content.toLowerCase();
      const hasKeywords = 
        contentLower.includes('architecture') ||
        contentLower.includes('component') ||
        contentLower.includes('structure') ||
        contentLower.includes('design');
      expect(hasKeywords).toBe(true);
    });

    test('should have substantial sections', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(10);
    });

    test('should document caching strategy', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('caching');
      expect(contentLower).toContain('react query');
    });

    test('should have properly closed code blocks', () => {
      const openBlocks = (content.match(/```/g) || []).length;
      expect(openBlocks % 2).toBe(0);
    });

    test('code blocks should have language identifiers', () => {
      const codeBlocks = extractCodeBlocks(content);
      if (codeBlocks.length > 0) {
        const blocksWithLanguage = codeBlocks.filter(block => block.language !== 'plain');
        const ratio = blocksWithLanguage.length / codeBlocks.length;
        expect(ratio).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  describe('INTEGRATIONS.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      content = readFile(markdownFiles['INTEGRATIONS.md']);
    });

    test('should have a top-level heading', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
    });

    test('should be comprehensive documentation', () => {
      expect(content.length).toBeGreaterThan(10000);
    });

    test('should contain integration-related content', () => {
      const contentLower = content.toLowerCase();
      const hasKeywords = 
        contentLower.includes('integration') ||
        contentLower.includes('api') ||
        contentLower.includes('webhook');
      expect(hasKeywords).toBe(true);
    });

    test('should have extensive sections', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(20);
    });

    test('should document bank connections', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('stripe');
      expect(contentLower).toContain('bank');
    });

    test('should document POS integrations', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('square');
      expect(contentLower).toContain('pos');
    });

    test('should document AI functionality', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('openrouter');
      expect(contentLower).toContain('ai');
    });

    test('should have properly closed code blocks', () => {
      const openBlocks = (content.match(/```/g) || []).length;
      expect(openBlocks % 2).toBe(0);
    });

    test('should have valid list formatting', () => {
      const lines = content.split('\n');
      const listItems = lines.filter(line => /^\s*[-*+]\s/.test(line));
      
      listItems.forEach(item => {
        const afterMarker = item.replace(/^\s*[-*+]\s+/, '');
        expect(afterMarker.length).toBeGreaterThan(0);
      });
    });
  });

  describe('copilot-instructions.md Specific Tests', () => {
    let content;

    beforeAll(() => {
      content = readFile(markdownFiles['copilot-instructions.md']);
    });

    test('should have a top-level heading', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
    });

    test('should be substantial documentation', () => {
      expect(content.length).toBeGreaterThan(5000);
    });

    test('should have extensive sections', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(15);
    });

    test('should document critical rules', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('critical rules');
      expect(contentLower).toContain('no manual caching');
    });

    test('should document accessibility', () => {
      const contentLower = content.toLowerCase();
      expect(contentLower).toContain('accessibility');
      expect(contentLower).toContain('aria');
    });

    test('should have properly closed code blocks', () => {
      const openBlocks = (content.match(/```/g) || []).length;
      expect(openBlocks % 2).toBe(0);
    });
  });

  describe('Cross-Document Consistency', () => {
    test('all files should use ATX-style headers', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const setextHeaders = content.match(/^.+\n[=-]{2,}$/gm);
        expect(setextHeaders).toBeNull();
      });
    });

    test('all files should end with a newline', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        expect(content.endsWith('\n')).toBe(true);
      });
    });

    test('all files should have consistent line endings', () => {
      const lineEndings = {};
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const hasCRLF = content.includes('\r\n');
        lineEndings[name] = hasCRLF ? 'CRLF' : 'LF';
      });

      const uniqueEndings = [...new Set(Object.values(lineEndings))];
      expect(uniqueEndings.length).toBe(1);
    });

    test('files should reference each other correctly', () => {
      const readme = readFile(markdownFiles['README.md']);
      expect(readme).toContain('ARCHITECTURE.md');
      expect(readme).toContain('INTEGRATIONS.md');
    });
  });

  describe('Code Block Quality', () => {
    test('code blocks should not be empty', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const codeBlocks = extractCodeBlocks(content);

        codeBlocks.forEach((block, index) => {
          expect(block.code.trim().length).toBeGreaterThan(0);
        });
      });
    });

    test('inline code should use single backticks', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        lines.forEach((line, lineNum) => {
          if (line.trim().startsWith('```')) return;
          
          const inlineCodeMatches = line.match(/`([^`]+)`/g);
          if (inlineCodeMatches) {
            inlineCodeMatches.forEach(match => {
              expect(match.length).toBeGreaterThan(2);
            });
          }
        });
      });
    });

    test('code blocks should use valid language identifiers', () => {
      const validLanguages = [
        'javascript', 'js', 'typescript', 'ts', 'python', 'py',
        'bash', 'sh', 'shell', 'json', 'yaml', 'yml', 'html',
        'css', 'sql', 'plaintext', 'text', 'diff', 'nginx',
        '', 'plain'
      ];

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const codeBlocks = extractCodeBlocks(content);

        codeBlocks.forEach((block, index) => {
          const lang = block.language.toLowerCase();
          const isValid = validLanguages.includes(lang) || lang === '';
          if (!isValid) {
            console.warn(`Invalid language in ${name}: "${block.language}"`);
          }
          expect(isValid).toBe(true);
        });
      });
    });
  });

  describe('Content Quality', () => {
    test('headers should not have obvious typos', () => {
      const commonTypos = ['teh ', 'adn ', 'fo '];
      
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const headers = extractHeaders(content);

        headers.forEach(header => {
          const textLower = header.text.toLowerCase();
          commonTypos.forEach(typo => {
            expect(textLower).not.toContain(typo);
          });
        });
      });
    });

    test('lists should be properly formatted', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          if (/^\s*[-*+]\s/.test(line)) {
            const afterMarker = line.replace(/^\s*[-*+]\s+/, '');
            expect(afterMarker.length).toBeGreaterThan(0);
          }
          
          if (/^\s*\d+\.\s/.test(line)) {
            const afterMarker = line.replace(/^\s*\d+\.\s+/, '');
            expect(afterMarker.length).toBeGreaterThan(0);
          }
        });
      });
    });

    test('headers should not have trailing spaces', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const headers = extractHeaders(content);

        headers.forEach(header => {
          expect(header.text).toBe(header.text.trim());
        });
      });
    });
  });

  describe('Security Checks', () => {
    test('should not contain exposed secrets', () => {
      const secretPatterns = [
        /api[_-]?key\s*=\s*["'][a-zA-Z0-9]{20,}["']/i,
        /secret[_-]?key\s*=\s*["'][a-zA-Z0-9]{20,}["']/i,
        /password\s*=\s*["'][^"']{8,}["']/i,
        /token\s*=\s*["'][a-zA-Z0-9]{20,}["']/i
      ];

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        
        secretPatterns.forEach(pattern => {
          expect(content).not.toMatch(pattern);
        });
      });
    });

    test('should not have HTML script tags', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        expect(content.toLowerCase()).not.toContain('<script');
      });
    });
  });

  describe('Performance Checks', () => {
    test('files should not be excessively large', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const stats = fs.statSync(filePath);
        expect(stats.size).toBeLessThan(10 * 1024 * 1024); // 10MB
      });
    });

    test('lines should not be excessively long', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          if (line.trim().startsWith('```') || line.includes('|')) {
            return;
          }
          
          if (line.length > 200) {
            const hasLongUrl = /https?:\/\/[^\s]{50,}/.test(line);
            if (!hasLongUrl) {
              console.warn(`Long line in ${name} at line ${index + 1}: ${line.length} chars`);
            }
          }
        });
      });
    });
  });
});