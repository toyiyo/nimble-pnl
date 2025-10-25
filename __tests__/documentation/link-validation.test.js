const fs = require('fs');
const path = require('path');

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
        url: match[2],
        fullMatch: match[0]
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

  describe('Internal Link Validation', () => {
    test('all internal anchor links should point to existing headers', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);
        const headers = extractHeaders(content);
        
        const anchorLinks = links.filter(link => link.url.startsWith('#'));
        const validAnchors = headers.map(h => headerToAnchor(h.text));

        anchorLinks.forEach(link => {
          const isValid = validAnchors.includes(link.url);
          if (!isValid) {
            console.log(`Invalid anchor in ${name}: ${link.url}`);
            console.log(`Available anchors: ${validAnchors.join(', ')}`);
          }
          expect(isValid).toBe(true);
        });
      });
    });

    test('all relative file links should point to existing files', () => {
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
          // Remove anchor part if present
          const linkPath = link.url.split('#')[0];
          const fileDir = path.dirname(filePath);
          const absolutePath = path.resolve(fileDir, linkPath);
          
          const exists = fs.existsSync(absolutePath);
          if (!exists) {
            console.log(`Broken link in ${name}: ${link.url} -> ${absolutePath}`);
          }
          expect(exists).toBe(true);
        });
      });
    });

    test('cross-references between documentation files should be valid', () => {
      const fileContents = {};
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        fileContents[name] = fs.readFileSync(filePath, 'utf8');
      });

      Object.entries(fileContents).forEach(([sourceName, content]) => {
        const links = extractLinks(content);
        
        links.forEach(link => {
          // Check for links to other docs
          Object.keys(markdownFiles).forEach(targetName => {
            if (link.url.includes(targetName)) {
              // If linking to another doc with an anchor
              if (link.url.includes('#')) {
                const [file, anchor] = link.url.split('#');
                const targetContent = fileContents[targetName];
                const targetHeaders = extractHeaders(targetContent);
                const validAnchors = targetHeaders.map(h => headerToAnchor(h.text));
                
                expect(validAnchors.includes('#' + anchor)).toBe(true);
              }
            }
          });
        });
      });
    });
  });

  describe('External Link Format Validation', () => {
    test('all HTTP/HTTPS links should have valid URL format', () => {
      const urlPattern = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/;

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);
        
        const externalLinks = links.filter(link => 
          link.url.startsWith('http://') || link.url.startsWith('https://')
        );

        externalLinks.forEach(link => {
          expect(link.url).toMatch(urlPattern);
        });
      });
    });

    test('email links should use mailto: protocol', () => {
      const emailPattern = /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          if (emailPattern.test(link.url) && !link.url.startsWith('http')) {
            expect(link.url.startsWith('mailto:')).toBe(true);
          }
        });
      });
    });

    test('no links should have URL encoding errors', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          // Should not have double encoding
          expect(link.url).not.toMatch(/%25[0-9A-F]{2}/);
          // Should not have malformed encoding
          expect(link.url).not.toMatch(/%[^0-9A-F]/);
          expect(link.url).not.toMatch(/%[0-9A-F][^0-9A-F]/);
        });
      });
    });

    test('links should not have trailing spaces or punctuation', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          expect(link.url).toBe(link.url.trim());
          // Common mistake: including trailing period or comma
          if (link.url.length > 1) {
            const lastChar = link.url[link.url.length - 1];
            if (link.url.startsWith('http')) {
              expect(['.', ',', ';', '!']).not.toContain(lastChar);
            }
          }
        });
      });
    });
  });

  describe('Link Text Quality', () => {
    test('link text should be descriptive', () => {
      const vagueTexts = ['click here', 'here', 'link', 'this', 'read more'];

      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          const textLower = link.text.toLowerCase().trim();
          const isVague = vagueTexts.includes(textLower);
          
          if (isVague) {
            console.log(`Vague link text in ${name}: "${link.text}"`);
          }
          expect(isVague).toBe(false);
        });
      });
    });

    test('link text should not be the same as the URL', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          // It's okay if URL is shown in text for reference docs
          // But exact duplication is usually poor practice
          if (link.text === link.url) {
            // Allow for anchor links
            expect(link.url.startsWith('#') || link.url.startsWith('http')).toBe(true);
          }
        });
      });
    });

    test('link text should not be excessively long', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          // Link text should be under 100 characters for readability
          expect(link.text.length).toBeLessThan(100);
        });
      });
    });
  });

  describe('Link Accessibility', () => {
    test('all links should have non-empty link text', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        links.forEach(link => {
          expect(link.text.trim().length).toBeGreaterThan(0);
        });
      });
    });

    test('image links should have descriptive alt text', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const imagePattern = /!\[([^\]]*)\]\(([^\)]+)\)/g;
        let match;

        while ((match = imagePattern.exec(content)) !== null) {
          const altText = match[1];
          const imagePath = match[2];

          // Alt text should exist and be meaningful
          expect(altText.length).toBeGreaterThan(0);
          expect(altText.length).toBeGreaterThan(3);
          
          // Should not just be the filename
          const filename = imagePath.split('/').pop().replace(/\.[^.]+$/, '');
          expect(altText.toLowerCase()).not.toBe(filename.toLowerCase());
        }
      });
    });
  });

  describe('Link Organization', () => {
    test('should not have duplicate links in the same document', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content);

        const linkUrls = links.map(l => l.url);
        const uniqueUrls = [...new Set(linkUrls)];

        // Allow some duplication (like common internal links)
        // but flag if more than 30% are duplicates
        const duplicationRatio = (linkUrls.length - uniqueUrls.length) / linkUrls.length;
        expect(duplicationRatio).toBeLessThan(0.3);
      });
    });

    test('reference-style links should be defined', () => {
      Object.entries(markdownFiles).forEach(([name, filePath]) => {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Find reference-style link usage: [text][ref]
        const refUsagePattern = /\[([^\]]+)\]\[([^\]]+)\]/g;
        const refDefinitionPattern = /^\[([^\]]+)\]:\s*(.+)$/gm;
        
        const usedRefs = new Set();
        let match;
        while ((match = refUsagePattern.exec(content)) !== null) {
          usedRefs.add(match[2]);
        }

        const definedRefs = new Set();
        while ((match = refDefinitionPattern.exec(content)) !== null) {
          definedRefs.add(match[1]);
        }

        // All used references should be defined
        usedRefs.forEach(ref => {
          expect(definedRefs.has(ref)).toBe(true);
        });
      });
    });
  });
});