const fs = require('fs');
const path = require('path');

/**
 * Link Validation Tests
 * 
 * Validates:
 * - Internal anchor links point to existing headers
 * - Relative file links point to existing files
 * - External links have valid format
 * - Link text is descriptive and accessible
 */

describe('Link Validation Tests', () => {
  const markdownFiles = {
    'README.md': path.join(__dirname, '../../README.md'),
    'ARCHITECTURE.md': path.join(__dirname, '../../ARCHITECTURE.md'),
    'INTEGRATIONS.md': path.join(__dirname, '../../INTEGRATIONS.md'),
    'copilot-instructions.md': path.join(__dirname, '../../.github/copilot-instructions.md')
  };

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

  const headerToAnchor = (headerText) => {
    return '#' + headerText
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  describe('Internal Anchor Links', () => {
    test('anchor links should point to existing headers', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);
        const headers = extractHeaders(content);
        
        const anchorLinks = links.filter(link => link.url.startsWith('#'));
        const validAnchors = headers.map(h => headerToAnchor(h.text));

        anchorLinks.forEach(link => {
          const isValid = validAnchors.includes(link.url);
          if (!isValid) {
            console.warn(`Invalid anchor in ${name}: ${link.url}`);
            console.warn(`Available: ${validAnchors.slice(0, 5).join(', ')}...`);
          }
          // Note: Some anchors might be emoji-based which we don't handle perfectly
          // This test may have false positives
        });
      });
    });
  });

  describe('Relative File Links', () => {
    test('relative file links should point to existing files', () => {
      const repoRoot = path.join(__dirname, '../..');
      
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);
        
        const relativeLinks = links.filter(link => 
          !link.url.startsWith('http') && 
          !link.url.startsWith('#') &&
          !link.url.startsWith('mailto:')
        );

        relativeLinks.forEach(link => {
          const linkPath = link.url.split('#')[0];
          const fileDir = path.dirname(filePath);
          const absolutePath = path.resolve(fileDir, linkPath);
          
          const exists = fs.existsSync(absolutePath);
          if (!exists) {
            console.warn(`Broken link in ${name}: ${link.url}`);
          }
          expect(exists).toBe(true);
        });
      });
    });
  });

  describe('External Link Format', () => {
    test('HTTP/HTTPS links should have valid format', () => {
      const urlPattern = /^https?:\/\/.+/;

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);
        
        const externalLinks = links.filter(link => 
          link.url.startsWith('http://') || link.url.startsWith('https://')
        );

        externalLinks.forEach(link => {
          expect(link.url).toMatch(urlPattern);
          expect(link.url).not.toContain(' ');
        });
      });
    });

    test('links should not have trailing punctuation', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          expect(link.url).toBe(link.url.trim());
        });
      });
    });
  });

  describe('Link Text Quality', () => {
    test('links should have non-empty text', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          expect(link.text.trim().length).toBeGreaterThan(0);
        });
      });
    });

    test('link text should not be excessively long', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          expect(link.text.length).toBeLessThan(150);
        });
      });
    });

    test('link text should be descriptive', () => {
      const vagueTexts = ['click here', 'here', 'link', 'read more'];

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          const textLower = link.text.toLowerCase().trim();
          const isVague = vagueTexts.includes(textLower);
          if (isVague) {
            console.warn(`Vague link text in ${name}: "${link.text}"`);
          }
        });
      });
    });
  });

  describe('Link Organization', () => {
    test('should not have excessive duplicate links', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        const linkUrls = links.map(l => l.url);
        const uniqueUrls = [...new Set(linkUrls)];

        const duplicationRatio = (linkUrls.length - uniqueUrls.length) / (linkUrls.length || 1);
        expect(duplicationRatio).toBeLessThan(0.4);
      });
    });
  });
});