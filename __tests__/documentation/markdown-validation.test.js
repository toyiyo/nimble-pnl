const fs = require('fs');
const path = require('path');

describe('Markdown Documentation Tests', () => {
  const markdownFiles = {
    'README.md': path.join(__dirname, '../../README.md'),
    'ARCHITECTURE.md': path.join(__dirname, '../../ARCHITECTURE.md'),
    'INTEGRATIONS.md': path.join(__dirname, '../../INTEGRATIONS.md'),
    'copilot-instructions.md': path.join(__dirname, '../../.github/copilot-instructions.md')
  };

  // Helper function to read file content
  const readFile = (filePath) => {
    return fs.readFileSync(filePath, 'utf8');
  };

  // Helper function to extract headers
  const extractHeaders = (content) => {
    const headerRegex = /^(#{1,6})\s+(.+)$/gm;
    const headers = [];
    let match;
    while ((match = headerRegex.exec(content)) !== null) {
      headers.push({
        level: match[1].length,
        text: match[2].trim()
      });
    }
    return headers;
  };

  // Helper function to extract links
  const extractLinks = (content) => {
    const linkRegex = /\[([^\]]+)\]\(([^\)]+)\)/g;
    const links = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push({
        text: match[1],
        url: match[2]
      });
    }
    return links;
  };

  // Helper function to extract code blocks
  const extractCodeBlocks = (content) => {
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const blocks = [];
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'plain',
        code: match[2]
      });
    }
    return blocks;
  };

  describe('File Existence and Readability', () => {
    Object.entries(markdownFiles).forEach(([name, filePath]) => {
      test(`${name} should exist and be readable`, () => {
        expect(fs.existsSync(filePath)).toBe(true);
        expect(() => readFile(filePath)).not.toThrow();
      });

      test(`${name} should not be empty`, () => {
        const content = readFile(filePath);
        expect(content.length).toBeGreaterThan(0);
      });

      test(`${name} should have content with more than just whitespace`, () => {
        const content = readFile(filePath);
        expect(content.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('README.md Structure and Content', () => {
    let content;

    beforeAll(() => {
      content = readFile(markdownFiles['README.md']);
    });

    test('should have a top-level heading', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
    });

    test('should contain essential sections', () => {
      const contentLower = content.toLowerCase();
      // READMEs typically have these sections
      const hasDescription = contentLower.length > 100; // Has substantial content
      expect(hasDescription).toBe(true);
    });

    test('should have proper header hierarchy', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      
      // Headers should not skip levels (e.g., h1 -> h3 without h2)
      for (let i = 1; i < headers.length; i++) {
        const levelDiff = headers[i].level - headers[i - 1].level;
        expect(levelDiff).toBeLessThanOrEqual(1);
      }
    });

    test('should not have consecutive duplicate headers', () => {
      const headers = extractHeaders(content);
      for (let i = 1; i < headers.length; i++) {
        if (headers[i].level === headers[i - 1].level) {
          expect(headers[i].text).not.toBe(headers[i - 1].text);
        }
      }
    });

    test('should have valid link syntax', () => {
      const links = extractLinks(content);
      links.forEach(link => {
        expect(link.text).toBeTruthy();
        expect(link.url).toBeTruthy();
        expect(link.url).not.toContain(' '); // URLs shouldn't have spaces
      });
    });

    test('should have properly closed code blocks', () => {
      const openBlocks = (content.match(/```/g) || []).length;
      expect(openBlocks % 2).toBe(0); // Even number of ``` markers
    });

    test('should not have trailing whitespace on lines', () => {
      const lines = content.split('\n');
      const linesWithTrailingWhitespace = lines.filter(line => 
        line.length > 0 && line !== line.trimEnd()
      );
      expect(linesWithTrailingWhitespace.length).toBe(0);
    });
  });

  describe('ARCHITECTURE.md Structure and Content', () => {
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
      const hasArchitectureKeywords = 
        contentLower.includes('architecture') ||
        contentLower.includes('component') ||
        contentLower.includes('structure') ||
        contentLower.includes('design') ||
        contentLower.includes('system');
      expect(hasArchitectureKeywords).toBe(true);
    });

    test('should have multiple sections', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(1);
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

    test('should not have excessive blank lines', () => {
      const consecutiveBlankLines = content.match(/\n\n\n\n+/g);
      expect(consecutiveBlankLines).toBeNull();
    });

    test('code blocks should have language identifiers', () => {
      const codeBlocks = extractCodeBlocks(content);
      if (codeBlocks.length > 0) {
        const blocksWithLanguage = codeBlocks.filter(block => block.language !== 'plain');
        // At least 50% of code blocks should have language identifiers
        expect(blocksWithLanguage.length / codeBlocks.length).toBeGreaterThanOrEqual(0.5);
      }
    });
  });

  describe('INTEGRATIONS.md Structure and Content', () => {
    let content;

    beforeAll(() => {
      content = readFile(markdownFiles['INTEGRATIONS.md']);
    });

    test('should have a top-level heading', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
    });

    test('should be substantial in length', () => {
      // INTEGRATIONS.md appears to be the largest file
      expect(content.length).toBeGreaterThan(1000);
    });

    test('should contain integration-related content', () => {
      const contentLower = content.toLowerCase();
      const hasIntegrationKeywords = 
        contentLower.includes('integration') ||
        contentLower.includes('api') ||
        contentLower.includes('service') ||
        contentLower.includes('connect');
      expect(hasIntegrationKeywords).toBe(true);
    });

    test('should have multiple sections', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(5); // Substantial documentation
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

    test('should have valid internal anchor links', () => {
      const links = extractLinks(content);
      const internalLinks = links.filter(link => link.url.startsWith('#'));
      
      internalLinks.forEach(link => {
        // Internal links should not have spaces (should be kebab-case)
        expect(link.url).toMatch(/^#[a-z0-9-]+$/);
      });
    });

    test('should not have broken list formatting', () => {
      const lines = content.split('\n');
      const listItems = lines.filter(line => /^\s*[-*+]\s/.test(line));
      
      listItems.forEach(item => {
        // List items should have content after the marker
        expect(item.trim().length).toBeGreaterThan(2);
      });
    });
  });

  describe('copilot-instructions.md Structure and Content', () => {
    let content;

    beforeAll(() => {
      content = readFile(markdownFiles['copilot-instructions.md']);
    });

    test('should have a top-level heading', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(0);
      expect(headers[0].level).toBe(1);
    });

    test('should be substantial in length', () => {
      expect(content.length).toBeGreaterThan(500);
    });

    test('should have multiple sections', () => {
      const headers = extractHeaders(content);
      expect(headers.length).toBeGreaterThan(2);
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

  describe('Cross-Document Consistency', () => {
    test('all files should use consistent header styles', () => {
      // Check that all files use ATX-style headers (# Header) not Setext (underlined)
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const setextHeaders = content.match(/^.+\n[=-]+$/gm);
        expect(setextHeaders).toBeNull();
      });
    });

    test('all files should use consistent line endings', () => {
      const lineEndings = {};
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const hasCRLF = content.includes('\r\n');
        const hasLF = content.includes('\n');
        lineEndings[name] = hasCRLF ? 'CRLF' : 'LF';
      });

      // All files should use the same line ending
      const uniqueEndings = [...new Set(Object.values(lineEndings))];
      expect(uniqueEndings.length).toBe(1);
    });

    test('all files should end with a newline', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        expect(content.endsWith('\n')).toBe(true);
      });
    });

    test('internal references between files should be consistent', () => {
      const allContent = {};
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        allContent[name] = readFile(filePath);
      });

      // Check if files reference each other correctly
      Object.entries(allContent).forEach(([name, content]) => {
        const links = extractLinks(content);
        const mdLinks = links.filter(link => 
          link.url.endsWith('.md') && !link.url.startsWith('http')
        );

        mdLinks.forEach(link => {
          const referencedFile = link.url.split('/').pop();
          const fileExists = Object.keys(markdownFiles).some(file => 
            file === referencedFile
          );
          if (!link.url.startsWith('http')) {
            // If it's a local .md link, it should exist
            expect(fileExists || link.url.startsWith('http')).toBe(true);
          }
        });
      });
    });
  });

  describe('Link Validation', () => {
    test('external URLs should have valid format', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const links = extractLinks(content);
        const externalLinks = links.filter(link => 
          link.url.startsWith('http://') || link.url.startsWith('https://')
        );

        externalLinks.forEach(link => {
          expect(link.url).toMatch(/^https?:\/\/.+/);
          // Should not have obvious typos
          expect(link.url).not.toContain('http:/https://');
          expect(link.url).not.toContain('https:/http://');
        });
      });
    });

    test('relative file paths should use forward slashes', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const links = extractLinks(content);
        const relativeLinks = links.filter(link => 
          !link.url.startsWith('http') && !link.url.startsWith('#')
        );

        relativeLinks.forEach(link => {
          expect(link.url).not.toContain('\\');
        });
      });
    });

    test('anchor links should be properly formatted', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const links = extractLinks(content);
        const anchorLinks = links.filter(link => link.url.startsWith('#'));

        anchorLinks.forEach(link => {
          // Should be lowercase and use hyphens
          expect(link.url).toMatch(/^#[a-z0-9-]+$/);
          // Should not have spaces or underscores
          expect(link.url).not.toContain(' ');
          expect(link.url).not.toContain('_');
        });
      });
    });
  });

  describe('Code Block Validation', () => {
    test('code blocks should be properly formatted', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const codeBlocks = extractCodeBlocks(content);

        codeBlocks.forEach(block => {
          // Code blocks should not be empty
          expect(block.code.trim().length).toBeGreaterThan(0);
          // Code should not have common markdown artifacts
          expect(block.code).not.toContain('```');
        });
      });
    });

    test('inline code should use single backticks', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          // Skip code block markers
          if (line.trim().startsWith('```')) return;
          
          const inlineCodeMatches = line.match(/`([^`]+)`/g);
          if (inlineCodeMatches) {
            inlineCodeMatches.forEach(match => {
              // Inline code should not be empty
              expect(match.length).toBeGreaterThan(2);
            });
          }
        });
      });
    });

    test('code blocks with specific languages should have valid syntax indicators', () => {
      const validLanguages = [
        'javascript', 'js', 'typescript', 'ts', 'python', 'py',
        'bash', 'sh', 'shell', 'json', 'yaml', 'yml', 'html',
        'css', 'markdown', 'md', 'sql', 'java', 'c', 'cpp',
        'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'xml',
        'dockerfile', 'makefile', 'plaintext', 'text'
      ];

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const codeBlocks = extractCodeBlocks(content);

        codeBlocks.forEach(block => {
          if (block.language !== 'plain') {
            const isValidOrEmpty = 
              validLanguages.includes(block.language.toLowerCase()) ||
              block.language === '';
            expect(isValidOrEmpty).toBe(true);
          }
        });
      });
    });
  });

  describe('Content Quality Checks', () => {
    test('files should not have obvious spelling mistakes in headers', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const headers = extractHeaders(content);

        headers.forEach(header => {
          // Should not have double spaces
          expect(header.text).not.toMatch(/  +/);
          // Should not have common typos
          expect(header.text.toLowerCase()).not.toContain('teh ');
          expect(header.text.toLowerCase()).not.toContain('adn ');
        });
      });
    });

    test('files should not have malformed lists', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          // If it starts with a list marker
          if (/^\s*[-*+]\s/.test(line)) {
            // It should have content after the marker
            const afterMarker = line.replace(/^\s*[-*+]\s+/, '');
            expect(afterMarker.length).toBeGreaterThan(0);
          }
        });
      });
    });

    test('files should not have malformed numbered lists', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          // If it starts with a numbered list marker
          if (/^\s*\d+\.\s/.test(line)) {
            // It should have content after the marker
            const afterMarker = line.replace(/^\s*\d+\.\s+/, '');
            expect(afterMarker.length).toBeGreaterThan(0);
          }
        });
      });
    });

    test('files should use consistent list markers', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        let lastIndentLevel = -1;
        let lastMarker = null;

        lines.forEach((line, index) => {
          const listMatch = line.match(/^(\s*)([-*+])\s/);
          if (listMatch) {
            const indent = listMatch[1].length;
            const marker = listMatch[2];

            // At the same indent level, markers should be consistent
            if (indent === lastIndentLevel && lastMarker) {
              expect(marker).toBe(lastMarker);
            }

            lastIndentLevel = indent;
            lastMarker = marker;
          } else if (line.trim() === '') {
            // Reset on blank lines
            lastIndentLevel = -1;
            lastMarker = null;
          }
        });
      });
    });

    test('headers should not be followed immediately by another header', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          if (/^#{1,6}\s/.test(lines[i])) {
            // Next non-empty line should not also be a header
            let nextNonEmpty = i + 1;
            while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
              nextNonEmpty++;
            }
            if (nextNonEmpty < lines.length) {
              // Allow for consecutive headers only if the next one is deeper level
              const currentLevel = lines[i].match(/^(#{1,6})/)[1].length;
              const nextLine = lines[nextNonEmpty];
              if (/^#{1,6}\s/.test(nextLine)) {
                const nextLevel = nextLine.match(/^(#{1,6})/)[1].length;
                expect(nextLevel).toBeGreaterThan(currentLevel);
              }
            }
          }
        }
      });
    });
  });

  describe('Formatting Consistency', () => {
    test('bold text should use consistent syntax', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const doubleAsterisk = (content.match(/\*\*[^*]+\*\*/g) || []).length;
        const doubleUnderscore = (content.match(/__[^_]+__/g) || []).length;

        // If both are used, the more common one should be at least 80% of usage
        if (doubleAsterisk > 0 && doubleUnderscore > 0) {
          const total = doubleAsterisk + doubleUnderscore;
          const maxRatio = Math.max(doubleAsterisk, doubleUnderscore) / total;
          expect(maxRatio).toBeGreaterThanOrEqual(0.8);
        }
      });
    });

    test('italic text should use consistent syntax', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        // Exclude code blocks and bold markers
        const withoutCode = content.replace(/```[\s\S]*?```/g, '');
        const withoutBold = withoutCode.replace(/\*\*[^*]+\*\*/g, '').replace(/__[^_]+__/g, '');
        
        const singleAsterisk = (withoutBold.match(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g) || []).length;
        const singleUnderscore = (withoutBold.match(/(?<!_)_(?!_)([^_]+)_(?!_)/g) || []).length;

        // If both are used, the more common one should be at least 80% of usage
        if (singleAsterisk > 0 && singleUnderscore > 0) {
          const total = singleAsterisk + singleUnderscore;
          const maxRatio = Math.max(singleAsterisk, singleUnderscore) / total;
          expect(maxRatio).toBeGreaterThanOrEqual(0.8);
        }
      });
    });

    test('files should not mix tabs and spaces for indentation', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        const linesWithTabs = lines.filter(line => line.startsWith('\t'));
        const linesWithSpaces = lines.filter(line => line.match(/^  +/));

        // Either all tabs or all spaces, not both
        if (linesWithTabs.length > 0 && linesWithSpaces.length > 0) {
          // Allow if one is significantly less (< 5% of total indented lines)
          const total = linesWithTabs.length + linesWithSpaces.length;
          const minRatio = Math.min(linesWithTabs.length, linesWithSpaces.length) / total;
          expect(minRatio).toBeLessThan(0.05);
        }
      });
    });
  });

  describe('Security and Best Practices', () => {
    test('should not contain exposed secrets or tokens', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        
        // Check for common secret patterns
        expect(content).not.toMatch(/api[_-]?key[_-]?=\s*["'][a-zA-Z0-9]{20,}["']/i);
        expect(content).not.toMatch(/secret[_-]?key[_-]?=\s*["'][a-zA-Z0-9]{20,}["']/i);
        expect(content).not.toMatch(/password[_-]?=\s*["'][^"']{8,}["']/i);
        expect(content).not.toMatch(/token[_-]?=\s*["'][a-zA-Z0-9]{20,}["']/i);
      });
    });

    test('external links should use HTTPS where possible', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const links = extractLinks(content);
        const httpLinks = links.filter(link => 
          link.url.startsWith('http://') && 
          !link.url.includes('localhost') &&
          !link.url.includes('127.0.0.1')
        );

        // Most external links should use HTTPS
        const httpsLinks = links.filter(link => link.url.startsWith('https://'));
        if (httpLinks.length > 0 && httpsLinks.length > 0) {
          const httpsRatio = httpsLinks.length / (httpLinks.length + httpsLinks.length);
          expect(httpsRatio).toBeGreaterThanOrEqual(0.7);
        }
      });
    });

    test('should not have HTML script tags', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        expect(content.toLowerCase()).not.toContain('<script');
      });
    });

    test('should not have HTML event handlers', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const dangerousAttributes = ['onclick', 'onerror', 'onload', 'onmouseover'];
        
        dangerousAttributes.forEach(attr => {
          expect(content.toLowerCase()).not.toContain(attr + '=');
        });
      });
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    test('should handle files with unicode characters', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        expect(() => {
          const encoded = Buffer.from(content, 'utf8').toString('utf8');
          expect(encoded).toBe(content);
        }).not.toThrow();
      });
    });

    test('should not have unclosed brackets or parentheses in links', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        
        // Count brackets and parentheses in link contexts
        const linkPattern = /\[([^\]]*)\]\(([^\)]*)\)/g;
        let match;
        while ((match = linkPattern.exec(content)) !== null) {
          const text = match[1];
          const url = match[2];
          
          // Text should have balanced brackets
          const openBrackets = (text.match(/\[/g) || []).length;
          const closeBrackets = (text.match(/\]/g) || []).length;
          expect(openBrackets).toBe(closeBrackets);
          
          // URL should have balanced parentheses (accounting for URL encoding)
          const openParens = (url.match(/\(/g) || []).length;
          const closeParens = (url.match(/\)/g) || []).length;
          const encodedParens = (url.match(/%28|%29/g) || []).length;
          // Allow for encoded parentheses
          expect(Math.abs(openParens - closeParens)).toBeLessThanOrEqual(encodedParens);
        }
      });
    });

    test('should handle empty lines correctly', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        // Should not have lines with only whitespace (except truly empty lines)
        const whitespaceOnlyLines = lines.filter(line => 
          line.length > 0 && line.trim().length === 0
        );
        
        // Allow some whitespace-only lines but not excessive
        expect(whitespaceOnlyLines.length).toBeLessThan(lines.length * 0.1);
      });
    });

    test('should not have broken image references', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const imagePattern = /!\[([^\]]*)\]\(([^\)]+)\)/g;
        let match;
        
        while ((match = imagePattern.exec(content)) !== null) {
          const altText = match[1];
          const imagePath = match[2];
          
          // Image should have alt text (accessibility)
          expect(altText).toBeTruthy();
          
          // Image path should not be empty
          expect(imagePath.trim().length).toBeGreaterThan(0);
          
          // For local images, check file extension
          if (!imagePath.startsWith('http')) {
            expect(imagePath).toMatch(/\.(png|jpg|jpeg|gif|svg|webp)$/i);
          }
        }
      });
    });
  });

  describe('Performance and Size Checks', () => {
    test('no single file should be excessively large', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const stats = fs.statSync(filePath);
        // No file should be larger than 5MB
        expect(stats.size).toBeLessThan(5 * 1024 * 1024);
      });
    });

    test('lines should not be excessively long', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          // Skip code blocks and tables
          if (line.trim().startsWith('```') || line.includes('|')) {
            return;
          }
          
          // Lines should generally be under 120 characters (soft limit)
          // Allow some exceptions for long URLs
          if (line.length > 120) {
            const hasLongUrl = /https?:\/\/[^\s]{50,}/.test(line);
            expect(hasLongUrl || line.length < 200).toBe(true);
          }
        });
      });
    });

    test('should not have excessive nesting in lists', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = readFile(filePath);
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          if (/^\s*[-*+]\s/.test(line)) {
            const indent = line.match(/^(\s*)/)[1].length;
            // Maximum nesting level of 6 (indent of 12 spaces for 2-space indents)
            expect(indent).toBeLessThan(13);
          }
        });
      });
    });
  });
});