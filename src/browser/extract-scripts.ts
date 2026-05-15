/**
 * Shared browser JavaScript evaluation scripts
 *
 * These functions return JavaScript code strings that can be evaluated
 * in either CDP (page.evaluate) or Electron (executeJavaScript) contexts.
 * This eliminates duplication between cdp-tier.ts and electron-tier.ts.
 */

/**
 * Returns JS code string for extracting data from a page.
 * The returned script is an IIFE that returns the extraction result object.
 */
export function getExtractionScript(type: string, selector: string): string {
  return `
    (function() {
      var selector = ${JSON.stringify(selector)};
      var el = document.querySelector(selector) || document.body;
      var extractType = ${JSON.stringify(type)};

      switch (extractType) {
        case 'text':
          return { text: el.innerText };

        case 'html':
          return { html: el.innerHTML };

        case 'links':
          var links = [];
          el.querySelectorAll('a[href]').forEach(function(a) {
            links.push({ href: a.href, text: (a.textContent || '').trim() });
          });
          return { links: links };

        case 'tables':
          var tables = [];
          el.querySelectorAll('table').forEach(function(table) {
            var tableData = [];
            table.querySelectorAll('tr').forEach(function(row) {
              var rowData = [];
              row.querySelectorAll('td, th').forEach(function(cell) {
                rowData.push((cell.textContent || '').trim());
              });
              if (rowData.length) tableData.push(rowData);
            });
            if (tableData.length) tables.push(tableData);
          });
          return { tables: tables };

        case 'structured':
        default:
          var mainEl = document.querySelector('main, article, [role="main"], .content') || document.body;
          return {
            title: document.title,
            url: window.location.href,
            description: (document.querySelector('meta[name="description"]') || {}).content || '',
            headings: Array.from(document.querySelectorAll('h1, h2, h3'))
              .slice(0, 20)
              .map(function(h) { return (h.textContent || '').trim(); }),
            mainContent: (mainEl.innerText || '').slice(0, 3000)
          };
      }
    })()
  `;
}

/**
 * Returns JS code string for scrolling the page or an element.
 */
export function getScrollScript(direction: string, amount: number, selector?: string): string {
  return `
    (function() {
      var target = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'window'};
      if (${selector ? 'true' : 'false'} && !target) {
        return { success: false, error: 'Element not found' };
      }

      var scrollTarget = target === window ? window : target;
      var direction = ${JSON.stringify(direction)};
      var amount = ${amount};

      switch (direction) {
        case 'up':
          scrollTarget.scrollBy(0, -amount);
          break;
        case 'down':
          scrollTarget.scrollBy(0, amount);
          break;
        case 'left':
          scrollTarget.scrollBy(-amount, 0);
          break;
        case 'right':
          scrollTarget.scrollBy(amount, 0);
          break;
      }

      return {
        success: true,
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth
      };
    })()
  `;
}

/**
 * Returns JS code string for clicking an element.
 */
export function getClickScript(selector: string): string {
  return `
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { success: false, error: 'Element not found' };
      el.click();
      return { success: true };
    })()
  `;
}

/**
 * Returns JS code string for hovering over an element.
 */
export function getHoverScript(selector: string): string {
  return `
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { success: false, error: 'Element not found' };

      var rect = el.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var centerY = rect.top + rect.height / 2;

      var mouseEnter = new MouseEvent('mouseenter', {
        bubbles: true,
        clientX: centerX,
        clientY: centerY
      });
      var mouseOver = new MouseEvent('mouseover', {
        bubbles: true,
        clientX: centerX,
        clientY: centerY
      });

      el.dispatchEvent(mouseEnter);
      el.dispatchEvent(mouseOver);

      return { success: true };
    })()
  `;
}

/**
 * Returns JS code string for typing text into an element.
 */
export function getTypeScript(selector: string, text: string): string {
  return `
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { success: false, error: 'Element not found' };
      if (!('value' in el)) return { success: false, error: 'Element is not an input' };

      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true };
    })()
  `;
}

/**
 * Returns JS code string for getting visible text from the page body.
 */
export function getVisibleTextScript(): string {
  return `document.body.innerText.slice(0, 5000)`;
}
