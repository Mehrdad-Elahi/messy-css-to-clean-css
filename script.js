const inputCss = document.getElementById('input-css');
const outputCss = document.getElementById('output-css');
const cleanBtn = document.getElementById('clean-btn');
const userApiKey = document.getElementById('user-api-key');
const clearKeyBtn = document.getElementById('clear-key-btn');
const providerSelect = document.getElementById('provider-select');
const providerInfoBtn = document.getElementById('provider-info-btn');
const providerInfoPanel = document.getElementById('provider-info-panel');
const askAiBtn = document.getElementById('ask-ai-btn');
const fixItBtn = document.getElementById('fix-it-btn');
const moodBadge = document.getElementById('mood-badge');
const outputMoodBadge = document.getElementById('output-mood-badge');
const outputTooltip = document.getElementById('css-tooltip');
const diffToggleBtn = document.getElementById('diff-toggle-btn');
const diffPanel = document.getElementById('diff-panel');
const unusedHtmlInput = document.getElementById('unused-html-input');
const unusedCheckBtn = document.getElementById('unused-check-btn');
const unusedResults = document.getElementById('unused-results');
const specificityCheckBtn = document.getElementById('specificity-check-btn');
const specificityResults = document.getElementById('specificity-results');
const tokensExtractBtn = document.getElementById('tokens-extract-btn');
const tokensResults = document.getElementById('tokens-results');
const tokensApplyBtn = document.getElementById('tokens-apply-btn');
const responsiveGenerateBtn = document.getElementById('responsive-generate-btn');
const bugDescriptionInput = document.getElementById('bug-description-input');
const bugHtmlInput = document.getElementById('bug-html-input');
const bugExplainBtn = document.getElementById('bug-explain-btn');
const bugResults = document.getElementById('bug-results');

let lastErrorMessage = '';
let lastCssAttempted = '';
let lastDiffBefore = '';
let lastDiffAfter = '';
let lastTokenCss = '';
let lastColorTokens = [];
let lastSizeTokens = [];

inputCss.addEventListener('input', updateInputMood);

clearKeyBtn.addEventListener('click', () => {
  userApiKey.value = '';
  userApiKey.focus();
});

const providerInfoText = {
  gemini: 'Gemini is the recommended option here — Google\'s API is designed to be called directly from a browser like this.',
  openai: 'Heads up: OpenAI\'s API was not designed to be called directly from a browser, and doing so exposes your key more than a proper backend would. For safety, consider using Gemini instead.',
  anthropic: 'Heads up: Anthropic\'s API requires a special "direct browser access" header to work here, because it\'s not meant to be called directly from a browser — the header name itself is a built-in warning from Anthropic. For safety, consider using Gemini instead.'
};

function updateProviderInfo() {
  providerInfoPanel.textContent = providerInfoText[providerSelect.value];
}

providerInfoBtn.addEventListener('click', () => {
  providerInfoPanel.hidden = !providerInfoPanel.hidden;
  if (!providerInfoPanel.hidden) updateProviderInfo();
});

providerSelect.addEventListener('change', () => {
  if (!providerInfoPanel.hidden) updateProviderInfo();
});

function buildRequest(provider, apiKey, prompt) {
  if (provider === 'gemini') {
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      }),
      extractText: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text,
      extractError: (data) => data.error?.message
    };
  }

  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }]
      }),
      extractText: (data) => data.choices?.[0]?.message?.content,
      extractError: (data) => data.error?.message
    };
  }

  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      }),
      extractText: (data) => data.content?.[0]?.text,
      extractError: (data) => data.error?.message
    };
  }
}

async function callAI(provider, apiKey, prompt) {
  const { url, headers, body, extractText, extractError } = buildRequest(provider, apiKey, prompt);
  const response = await fetch(url, { method: 'POST', headers, body });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(extractError(data) || 'Invalid API key or request failed.');
  }

  const text = extractText(data);
  if (!text) {
    throw new Error('No response received. Please try again.');
  }
  return text;
}

function validateCss(css) {
  const errors = [];

  const ast = csstree.parse(css, {
    onParseError(error) {
      errors.push(error.formattedMessage || error.message);
    },
    positions: true
  });

  if (errors.length > 0) {
    return errors;
  }

  csstree.walk(ast, (node) => {
    if (node.type === 'Declaration') {
      const isCustomProperty = node.property.startsWith('--');
      const valueCss = csstree.generate(node.value);
      const usesVar = /var\(/i.test(valueCss);

      if (isCustomProperty || usesVar) {
        return;
      }

      const match = csstree.lexer.matchProperty(node.property, node.value);
      if (match.error) {
        errors.push(`"${node.property}: ${valueCss}" — ${match.error.message}`);
      }
    }
  });

  return errors.length > 0 ? errors : null;
}

const moodLevels = [
  { max: 0, label: '✨ Pristine', bg: '#e6f4ea', color: '#1e7d34' },
  { max: 2, label: '🙂 Tidy-ish', bg: '#eef6ff', color: '#2b5fa8' },
  { max: 5, label: '😬 Getting Messy', bg: '#fff4e0', color: '#a05a00' },
  { max: Infinity, label: '🔥 Chaos Level: High', bg: '#fdecea', color: '#b3261e' }
];

function computeChaosScore(css) {
  if (!css.trim()) return 0;

  let score = 0;

  const errors = validateCss(css);
  if (errors) {
    score += errors.length * 2;
  }

  try {
    const ast = csstree.parse(css, { onParseError() {} });
    csstree.walk(ast, (node) => {
      if (node.type === 'Rule' && node.block) {
        const seen = new Set();
        node.block.children.forEach((decl) => {
          if (decl.type === 'Declaration') {
            if (seen.has(decl.property)) score += 1;
            seen.add(decl.property);
          }
        });
      }
    });
  } catch (e) {
    // parsing already reflected via errors above
  }

  const lines = css.split('\n');
  const indentUnits = new Set(
    lines
      .filter((line) => /^\s+\S/.test(line))
      .map((line) => (line.match(/^\s+/)[0].includes('\t') ? 'tab' : 'space'))
  );
  if (indentUnits.size > 1) score += 1;

  return score;
}

function setMoodBadge(el, score) {
  const level = moodLevels.find((l) => score <= l.max);
  el.textContent = level.label;
  el.style.backgroundColor = level.bg;
  el.style.color = level.color;
}

function updateInputMood() {
  setMoodBadge(moodBadge, computeChaosScore(inputCss.value));
}

const propertyExplanations = {
  'color': 'Sets the text color of an element.',
  'background-color': 'Sets the background color of an element.',
  'background-image': 'Sets an image (or gradient) as the background of an element.',
  'font-size': 'Controls how large the text appears.',
  'font-family': 'Chooses the typeface(s) used for text.',
  'font-weight': 'Controls how bold or light text appears.',
  'line-height': 'Sets the vertical space between lines of text.',
  'text-align': 'Aligns text horizontally (left, right, center, justify).',
  'text-decoration': 'Adds or removes styling like underline or strikethrough.',
  'margin': 'Sets space outside an element, between it and neighboring elements.',
  'margin-top': 'Sets space above the element, outside its border.',
  'margin-right': 'Sets space to the right of the element, outside its border.',
  'margin-bottom': 'Sets space below the element, outside its border.',
  'margin-left': 'Sets space to the left of the element, outside its border.',
  'padding': 'Sets space inside an element, between its border and its content.',
  'padding-top': 'Sets space above the content, inside the border.',
  'padding-right': 'Sets space to the right of the content, inside the border.',
  'padding-bottom': 'Sets space below the content, inside the border.',
  'padding-left': 'Sets space to the left of the content, inside the border.',
  'border': 'Shorthand for setting an element\'s border width, style, and color at once.',
  'border-radius': 'Rounds the corners of an element\'s border box.',
  'border-width': 'Sets the thickness of an element\'s border.',
  'border-color': 'Sets the color of an element\'s border.',
  'border-style': 'Sets the line style of an element\'s border (solid, dashed, etc.).',
  'width': 'Sets the width of an element\'s content box.',
  'height': 'Sets the height of an element\'s content box.',
  'max-width': 'Sets the largest width an element is allowed to grow to.',
  'min-width': 'Sets the smallest width an element is allowed to shrink to.',
  'max-height': 'Sets the largest height an element is allowed to grow to.',
  'min-height': 'Sets the smallest height an element is allowed to shrink to.',
  'display': 'Controls how an element is laid out (block, flex, grid, none, etc.).',
  'position': 'Controls how an element is positioned (static, relative, absolute, fixed, sticky).',
  'top': 'Sets the offset of a positioned element from the top edge of its container.',
  'right': 'Sets the offset of a positioned element from the right edge of its container.',
  'bottom': 'Sets the offset of a positioned element from the bottom edge of its container.',
  'left': 'Sets the offset of a positioned element from the left edge of its container.',
  'z-index': 'Controls the stacking order of overlapping elements.',
  'overflow': 'Controls what happens to content that overflows an element\'s box.',
  'flex': 'Shorthand for how a flex item grows, shrinks, and its base size.',
  'flex-direction': 'Sets whether flex items lay out in a row or column.',
  'justify-content': 'Aligns flex/grid items along the main axis.',
  'align-items': 'Aligns flex/grid items along the cross axis.',
  'gap': 'Sets spacing between flex or grid items.',
  'grid-template-columns': 'Defines the columns of a grid layout.',
  'grid-template-rows': 'Defines the rows of a grid layout.',
  'box-shadow': 'Adds a shadow effect around an element\'s frame.',
  'text-shadow': 'Adds a shadow effect to text.',
  'opacity': 'Controls the transparency of an element (0 = invisible, 1 = fully visible).',
  'cursor': 'Sets what the mouse cursor looks like when hovering over an element.',
  'transition': 'Animates changes to a property smoothly over time.',
  'box-sizing': 'Determines whether padding/border are included in an element\'s set width and height.',
  'letter-spacing': 'Sets the spacing between characters in text.',
  'white-space': 'Controls how whitespace and line breaks inside text are handled.',
  'vertical-align': 'Aligns inline or table-cell elements vertically.',
  'visibility': 'Shows or hides an element without removing it from the layout.'
};

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCssWithHoverInfo(cssText) {
  const matches = [];

  try {
    const ast = csstree.parse(cssText, { positions: true, onParseError() {} });
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration' && node.loc) {
        const start = node.loc.start.offset;
        const propLength = node.property.length;
        const candidate = cssText.slice(start, start + propLength);
        if (candidate.toLowerCase() === node.property.toLowerCase()) {
          matches.push({ start, end: start + propLength, property: node.property });
        }
      }
    });
  } catch (e) {
    // If parsing fails here, we just skip hover-highlighting and show plain text below.
  }

  matches.sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;
  matches.forEach((m) => {
    html += escapeHtml(cssText.slice(cursor, m.start));
    const explanation = propertyExplanations[m.property.toLowerCase()] || 'A CSS property. No description available yet.';
    html += `<span class="css-property" data-explain="${escapeHtml(explanation)}">${escapeHtml(cssText.slice(m.start, m.end))}</span>`;
    cursor = m.end;
  });
  html += escapeHtml(cssText.slice(cursor));

  return html;
}

function setPlainOutput(text) {
  outputCss.textContent = text;
}

function setCssOutput(cssText) {
  outputCss.innerHTML = renderCssWithHoverInfo(cssText);
}

outputCss.addEventListener('mouseover', (e) => {
  const target = e.target.closest('.css-property');
  if (!target) return;
  outputTooltip.textContent = target.dataset.explain;
  outputTooltip.hidden = false;
});

outputCss.addEventListener('mousemove', (e) => {
  if (outputTooltip.hidden) return;
  outputTooltip.style.left = `${e.clientX + 12}px`;
  outputTooltip.style.top = `${e.clientY + 12}px`;
});

outputCss.addEventListener('mouseout', (e) => {
  if (!e.target.closest('.css-property')) return;
  outputTooltip.hidden = true;
});

function buildDiffHtml(oldStr, newStr) {
  const parts = Diff.diffLines(oldStr, newStr);
  let html = '';

  parts.forEach((part) => {
    const cls = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-unchanged';
    const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
    const lines = part.value.replace(/\n$/, '').split('\n');
    lines.forEach((line) => {
      html += `<div class="diff-line ${cls}">${prefix}${escapeHtml(line)}</div>`;
    });
  });

  return html;
}

function showDiffToggle(beforeCss, afterCss) {
  lastDiffBefore = beforeCss;
  lastDiffAfter = afterCss;
  diffToggleBtn.hidden = false;
  diffToggleBtn.textContent = 'Show what changed';
  diffPanel.hidden = true;
  diffPanel.innerHTML = '';
}

function hideDiffToggle() {
  diffToggleBtn.hidden = true;
  diffPanel.hidden = true;
  diffPanel.innerHTML = '';
}

diffToggleBtn.addEventListener('click', () => {
  if (diffPanel.hidden) {
    diffPanel.innerHTML = buildDiffHtml(lastDiffBefore, lastDiffAfter);
    diffPanel.hidden = false;
    diffToggleBtn.textContent = 'Hide what changed';
  } else {
    diffPanel.hidden = true;
    diffToggleBtn.textContent = 'Show what changed';
  }
});

const STATE_PSEUDO_CLASSES = [
  'hover', 'focus', 'focus-within', 'focus-visible', 'active', 'visited',
  'target', 'checked', 'indeterminate', 'placeholder-shown', 'autofill'
];

function sanitizeSelectorForMatching(selectorText) {
  let s = selectorText;
  s = s.replace(/::[a-zA-Z-]+(\([^)]*\))?/g, '');
  STATE_PSEUDO_CLASSES.forEach((p) => {
    const re = new RegExp(`:${p}(\\([^)]*\\))?`, 'gi');
    s = s.replace(re, '');
  });
  return s.trim();
}

function findUnusedSelectors(cssText, htmlText) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(htmlText, 'text/html');
  } catch (e) {
    return { error: 'Could not parse the HTML you pasted.' };
  }

  let ast;
  try {
    ast = csstree.parse(cssText, { onParseError() {} });
  } catch (e) {
    return { error: 'Could not parse this CSS.' };
  }

  const results = [];
  const atRuleStack = [];

  csstree.walk(ast, {
    enter(node) {
      if (node.type === 'Atrule') {
        atRuleStack.push((node.name || '').toLowerCase());
      }

      if (node.type === 'Rule' && node.prelude && node.prelude.type === 'SelectorList') {
        const skip = atRuleStack.some((n) => n.includes('keyframes') || n === 'font-face' || n === 'page');
        if (skip) return;

        node.prelude.children.forEach((selectorNode) => {
          const rawSelector = csstree.generate(selectorNode);
          const sanitized = sanitizeSelectorForMatching(rawSelector);

          if (!sanitized || sanitized === '*' || /^(html|body|:root)$/i.test(sanitized)) {
            return;
          }

          let matched = false;
          let skippedCheck = false;
          try {
            matched = doc.querySelectorAll(sanitized).length > 0;
          } catch (e) {
            skippedCheck = true;
          }

          if (!matched && !skippedCheck) {
            const inMediaOrSupports = atRuleStack.some((n) => n === 'media' || n === 'supports');
            results.push({
              selector: rawSelector,
              note: inMediaOrSupports
                ? 'Inside @media/@supports — could still apply under a condition not checked here.'
                : null
            });
          }
        });
      }
    },
    leave(node) {
      if (node.type === 'Atrule') {
        atRuleStack.pop();
      }
    }
  });

  return { results };
}

unusedCheckBtn.addEventListener('click', () => {
  const cssText = inputCss.value;
  const htmlText = unusedHtmlInput.value.trim();

  unusedResults.hidden = false;

  if (!cssText.trim()) {
    unusedResults.innerHTML = '<p>Paste some CSS in the left box first.</p>';
    return;
  }

  if (!htmlText) {
    unusedResults.innerHTML = '<p>Paste the HTML this CSS is meant to style above, then click "Find unused CSS" again.</p>';
    return;
  }

  const validationErrors = validateCss(cssText);
  if (validationErrors) {
    unusedResults.innerHTML = '<p>Your CSS has syntax errors — click "Clean it up" first to see and fix them before checking for unused selectors.</p>';
    return;
  }

  const { results, error } = findUnusedSelectors(cssText, htmlText);

  if (error) {
    unusedResults.innerHTML = `<p>${escapeHtml(error)}</p>`;
    return;
  }

  if (results.length === 0) {
    unusedResults.innerHTML = '<p class="unused-ok">✅ No unused selectors found against the HTML you provided.</p>';
    return;
  }

  let html = `<p class="unused-summary">⚠️ ${results.length} selector(s) don't match anything in your HTML:</p><ul class="unused-list">`;
  results.forEach((r) => {
    html += `<li><code>${escapeHtml(r.selector)}</code>`;
    if (r.note) {
      html += ` <span class="unused-note">— ${escapeHtml(r.note)}</span>`;
    }
    html += '</li>';
  });
  html += '</ul><p class="unused-disclaimer">This checks only the HTML pasted above. Selectors used elsewhere in your project, added dynamically by JavaScript, or matched by conditions not represented here may be falsely flagged.</p>';

  unusedResults.innerHTML = html;
});

function computeSpecificity(selectorNode) {
  let ids = 0, classes = 0, elements = 0;
  csstree.walk(selectorNode, (node) => {
    if (node.type === 'IdSelector') {
      ids++;
    } else if (node.type === 'ClassSelector' || node.type === 'AttributeSelector') {
      classes++;
    } else if (node.type === 'PseudoClassSelector') {
      if (node.name.toLowerCase() !== 'where') {
        classes++;
      }
    } else if (node.type === 'PseudoElementSelector') {
      elements++;
    } else if (node.type === 'TypeSelector' && node.name !== '*') {
      elements++;
    }
  });
  return { ids, classes, elements };
}

function extractKeyTokens(selectorNode) {
  const children = [];
  selectorNode.children.forEach((node) => children.push(node));

  const groups = [[]];
  children.forEach((node) => {
    if (node.type === 'Combinator' || node.type === 'WhiteSpace') {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(node);
    }
  });

  const lastGroup = groups[groups.length - 1];
  const tokens = new Set();
  lastGroup.forEach((node) => {
    if (node.type === 'TypeSelector' && node.name !== '*') {
      tokens.add('tag:' + node.name.toLowerCase());
    } else if (node.type === 'ClassSelector') {
      tokens.add('class:' + node.name);
    } else if (node.type === 'IdSelector') {
      tokens.add('id:' + node.name);
    } else if (node.type === 'AttributeSelector') {
      tokens.add('attr:' + csstree.generate(node));
    }
  });

  return tokens;
}

function compareSpecificity(s1, s2) {
  if (s1.ids !== s2.ids) return s1.ids - s2.ids;
  if (s1.classes !== s2.classes) return s1.classes - s2.classes;
  return s1.elements - s2.elements;
}

function formatSpecificity(s) {
  return `(${s.ids},${s.classes},${s.elements})`;
}

function findCascadeConflicts(cssText) {
  let ast;
  try {
    ast = csstree.parse(cssText, { positions: true, onParseError() {} });
  } catch (e) {
    return { error: 'Could not parse this CSS.' };
  }

  const entries = [];
  const atRuleStack = [];
  let orderCounter = 0;

  csstree.walk(ast, {
    enter(node) {
      if (node.type === 'Atrule') {
        atRuleStack.push((node.name || '').toLowerCase());
      }

      if (node.type === 'Rule' && node.prelude && node.prelude.type === 'SelectorList' && node.block) {
        const skip = atRuleStack.some((n) => n.includes('keyframes') || n === 'font-face' || n === 'page');
        if (skip) return;

        const inMediaOrSupports = atRuleStack.some((n) => n === 'media' || n === 'supports');

        node.prelude.children.forEach((selectorNode) => {
          orderCounter++;
          const order = orderCounter;
          const selectorText = csstree.generate(selectorNode);
          const specificity = computeSpecificity(selectorNode);
          const tokens = extractKeyTokens(selectorNode);
          const line = node.loc ? node.loc.start.line : null;

          node.block.children.forEach((decl) => {
            if (decl.type === 'Declaration') {
              entries.push({
                property: decl.property.toLowerCase(),
                value: csstree.generate(decl.value).trim(),
                selectorText,
                specificity,
                order,
                line,
                tokens,
                inMediaOrSupports
              });
            }
          });
        });
      }
    },
    leave(node) {
      if (node.type === 'Atrule') {
        atRuleStack.pop();
      }
    }
  });

  const byProperty = {};
  entries.forEach((e) => {
    if (!byProperty[e.property]) byProperty[e.property] = [];
    byProperty[e.property].push(e);
  });

  const conflicts = [];

  Object.keys(byProperty).forEach((prop) => {
    const list = byProperty[prop];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];

        if (a.value === b.value) continue;

        const sameSelector = a.selectorText === b.selectorText;
        const sharedToken = [...a.tokens].some((t) => b.tokens.has(t));

        if (!sameSelector && !sharedToken) continue;

        conflicts.push({ property: prop, a, b });
      }
    }
  });

  return { conflicts };
}

specificityCheckBtn.addEventListener('click', () => {
  const cssText = inputCss.value;

  specificityResults.hidden = false;

  if (!cssText.trim()) {
    specificityResults.innerHTML = '<p>Paste some CSS in the left box first.</p>';
    return;
  }

  const validationErrors = validateCss(cssText);
  if (validationErrors) {
    specificityResults.innerHTML = '<p>Your CSS has syntax errors — click "Clean it up" first to see and fix them before checking for cascade conflicts.</p>';
    return;
  }

  const { conflicts, error } = findCascadeConflicts(cssText);

  if (error) {
    specificityResults.innerHTML = `<p>${escapeHtml(error)}</p>`;
    return;
  }

  if (conflicts.length === 0) {
    specificityResults.innerHTML = '<p class="unused-ok">✅ No likely cascade conflicts found.</p>';
    return;
  }

  let html = `<p class="unused-summary">⚠️ ${conflicts.length} possible conflict(s) found:</p>`;

  conflicts.forEach((c) => {
    const cmp = compareSpecificity(c.a.specificity, c.b.specificity);
    let winner, loser, reason;
    if (cmp > 0) {
      winner = c.a; loser = c.b; reason = 'higher specificity';
    } else if (cmp < 0) {
      winner = c.b; loser = c.a; reason = 'higher specificity';
    } else {
      winner = c.a.order > c.b.order ? c.a : c.b;
      loser = winner === c.a ? c.b : c.a;
      reason = 'equal specificity — later rule in source order wins';
    }

    html += `<div class="conflict-item">`;
    html += `<div class="conflict-property"><code>${escapeHtml(c.property)}</code></div>`;
    [c.a, c.b].forEach((entry) => {
      const isWinner = entry === winner;
      html += `<div class="conflict-side ${isWinner ? 'conflict-winner' : ''}">`;
      html += `<code>${escapeHtml(entry.selectorText)}</code> ${formatSpecificity(entry.specificity)} → <code>${escapeHtml(entry.value)}</code>`;
      html += entry.line ? ` <span class="conflict-reason">(line ${entry.line}${entry.inMediaOrSupports ? ', inside @media/@supports' : ''})</span>` : '';
      html += isWinner ? ' ✓ wins' : '';
      html += `</div>`;
    });
    html += `<div class="conflict-reason">Reason: ${escapeHtml(reason)}</div>`;
    html += `</div>`;
  });

  html += '<p class="unused-disclaimer">This is a heuristic based on selector overlap, not a full simulation against real HTML — some flagged pairs may never actually target the same element, and some real conflicts involving deeper nesting may not be caught.</p>';

  specificityResults.innerHTML = html;
});

function extractDesignTokens(cssText) {
  let ast;
  try {
    ast = csstree.parse(cssText, { positions: true, onParseError() {} });
  } catch (e) {
    return { error: 'Could not parse this CSS.' };
  }

  const colorMap = new Map();
  const sizeMap = new Map();

  function addOccurrence(map, key, raw, start, end) {
    if (!map.has(key)) {
      map.set(key, { raw, count: 0, occurrences: [] });
    }
    const entry = map.get(key);
    entry.count++;
    entry.occurrences.push({ start, end });
  }

  csstree.walk(ast, (node) => {
    if (!node.loc) return;

    if (node.type === 'Hash') {
      const raw = '#' + node.value;
      addOccurrence(colorMap, raw.toLowerCase(), raw, node.loc.start.offset, node.loc.end.offset);
    } else if (node.type === 'Function' && /^(rgba?|hsla?)$/i.test(node.name)) {
      const raw = csstree.generate(node);
      addOccurrence(colorMap, raw.replace(/\s+/g, '').toLowerCase(), raw, node.loc.start.offset, node.loc.end.offset);
    } else if (node.type === 'Dimension' && /^(px|rem|em)$/i.test(node.unit)) {
      if (parseFloat(node.value) === 0) return;
      const raw = node.value + node.unit;
      addOccurrence(sizeMap, raw.toLowerCase(), raw, node.loc.start.offset, node.loc.end.offset);
    }
  });

  const colorTokens = [...colorMap.values()]
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map((t, i) => ({ ...t, varName: `--color-${i + 1}` }));

  const sizeNameOrder = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];
  const sizeTokens = [...sizeMap.values()]
    .filter((e) => e.count >= 2)
    .sort((a, b) => parseFloat(a.raw) - parseFloat(b.raw))
    .map((t, i) => ({ ...t, varName: `--spacing-${sizeNameOrder[i] || (i + 1)}` }));

  return { colorTokens, sizeTokens };
}

function applyDesignTokens(cssText, colorTokens, sizeTokens) {
  const replacements = [];
  [...colorTokens, ...sizeTokens].forEach((t) => {
    t.occurrences.forEach((o) => {
      replacements.push({ start: o.start, end: o.end, varName: t.varName });
    });
  });
  replacements.sort((a, b) => b.start - a.start);

  let result = cssText;
  replacements.forEach((r) => {
    result = result.slice(0, r.start) + `var(${r.varName})` + result.slice(r.end);
  });

  let rootBlock = ':root {\n';
  colorTokens.forEach((t) => {
    rootBlock += `  ${t.varName}: ${t.raw};\n`;
  });
  sizeTokens.forEach((t) => {
    rootBlock += `  ${t.varName}: ${t.raw};\n`;
  });
  rootBlock += '}\n\n';

  return rootBlock + result;
}

tokensExtractBtn.addEventListener('click', () => {
  const cssText = inputCss.value;

  tokensResults.hidden = false;
  tokensApplyBtn.hidden = true;

  if (!cssText.trim()) {
    tokensResults.innerHTML = '<p>Paste some CSS in the left box first.</p>';
    return;
  }

  const validationErrors = validateCss(cssText);
  if (validationErrors) {
    tokensResults.innerHTML = '<p>Your CSS has syntax errors — click "Clean it up" first to see and fix them before extracting tokens.</p>';
    return;
  }

  const { colorTokens, sizeTokens, error } = extractDesignTokens(cssText);

  if (error) {
    tokensResults.innerHTML = `<p>${escapeHtml(error)}</p>`;
    return;
  }

  if (colorTokens.length === 0 && sizeTokens.length === 0) {
    tokensResults.innerHTML = '<p class="unused-ok">No repeated color or size values found worth extracting.</p>';
    return;
  }

  lastTokenCss = cssText;
  lastColorTokens = colorTokens;
  lastSizeTokens = sizeTokens;

  let html = '';

  if (colorTokens.length > 0) {
    html += '<div class="token-group-title">Colors</div><ul class="token-list">';
    colorTokens.forEach((t) => {
      html += `<li class="token-item"><span class="token-swatch" style="background:${escapeHtml(t.raw)}"></span><code>${escapeHtml(t.varName)}</code>: <code>${escapeHtml(t.raw)}</code> <span class="unused-note">(used ${t.count}×)</span></li>`;
    });
    html += '</ul>';
  }

  if (sizeTokens.length > 0) {
    html += '<div class="token-group-title">Sizes</div><ul class="token-list">';
    sizeTokens.forEach((t) => {
      html += `<li class="token-item"><code>${escapeHtml(t.varName)}</code>: <code>${escapeHtml(t.raw)}</code> <span class="unused-note">(used ${t.count}×)</span></li>`;
    });
    html += '</ul>';
  }

  html += '<p class="unused-disclaimer">Click "Apply tokens to output" to insert a :root block with these variables and replace the matching values in a copy sent to the Clean CSS box on the right.</p>';

  tokensResults.innerHTML = html;
  tokensApplyBtn.hidden = false;
});

tokensApplyBtn.addEventListener('click', () => {
  const result = applyDesignTokens(lastTokenCss, lastColorTokens, lastSizeTokens);
  setCssOutput(result);
  setMoodBadge(outputMoodBadge, computeChaosScore(result));
});

function showError(message, cssAttempted) {
  lastErrorMessage = message;
  lastCssAttempted = cssAttempted;
  setPlainOutput(`Error: ${message}`);
  outputCss.classList.add('has-error');
  askAiBtn.hidden = false;
  fixItBtn.hidden = true;
  hideDiffToggle();
}

function clearError() {
  outputCss.classList.remove('has-error');
  askAiBtn.hidden = true;
  fixItBtn.hidden = true;
  hideDiffToggle();
}

cleanBtn.addEventListener('click', async () => {
  const messyCss = inputCss.value;
  const apiKey = userApiKey.value.trim();
  const provider = providerSelect.value;

  clearError();

  if (!apiKey) {
    setPlainOutput('Please enter your API key first.');
    return;
  }

  if (!messyCss.trim()) {
    setPlainOutput('');
    return;
  }

  const validationErrors = validateCss(messyCss);
  if (validationErrors) {
    showError(validationErrors.join('\n'), messyCss);
    return;
  }

  setPlainOutput('Cleaning...');

  const prompt = `Clean up and reformat this CSS. Keep it functionally identical — do not change any visual behavior. Apply these rules:

1. Formatting: consistent indentation, one property per line, consistent use of double quotes.
2. Remove duplicate or redundant properties within the same rule (keep the last occurrence, since that's what would actually apply).
3. Shorthand simplification:
   - If padding/margin/border-width/border-radius has the same value on all four sides, collapse to a single value (e.g. "padding: 4px 4px 4px 4px" becomes "padding: 4px").
   - If top/bottom values match each other AND left/right values match each other (but top/bottom ≠ left/right), collapse to two values (e.g. "margin: 10px 5px 10px 5px" becomes "margin: 10px 5px").
   - Shorten 6-digit hex colors to 3-digit form only when it's a valid exact collapse (e.g. "#ffffff" becomes "#fff", but "#ff00aa" stays as is since it can't shorten losslessly).
4. Do not merge separate background properties (background-color, background-image, etc.) into a single background shorthand, since this can silently change behavior if not done carefully.
5. Organize properties within each rule in a consistent, logical order (e.g. positioning, box model, typography, visual).

Return ONLY the cleaned CSS, no explanations, no markdown code fences.

CSS:
${messyCss}`;

  try {
    const cleanedCss = await callAI(provider, apiKey, prompt);
    setCssOutput(cleanedCss);
    setMoodBadge(outputMoodBadge, computeChaosScore(cleanedCss));
    showDiffToggle(messyCss, cleanedCss);
  } catch (error) {
    console.error('Error:', error);
    showError(error.message, messyCss);
  }
});

askAiBtn.addEventListener('click', async () => {
  const apiKey = userApiKey.value.trim();
  const provider = providerSelect.value;

  if (!apiKey) {
    setPlainOutput('Please enter your API key first.');
    return;
  }

  outputCss.classList.remove('has-error');
  setPlainOutput('Asking AI...');
  askAiBtn.hidden = true;

  const prompt = `A user's CSS caused this error: "${lastErrorMessage}"

Their CSS:
${lastCssAttempted}

In 3-5 short sentences or bullet points, explain briefly and effectively what is likely wrong and how to fix it. Be direct and practical, no long explanations, no markdown code fences.`;

  try {
    const answer = await callAI(provider, apiKey, prompt);
    setPlainOutput(answer);
    fixItBtn.hidden = false;
  } catch (error) {
    console.error('Error:', error);
    showError(error.message, lastCssAttempted);
  }
});

fixItBtn.addEventListener('click', async () => {
  const apiKey = userApiKey.value.trim();
  const provider = providerSelect.value;
  const currentCss = inputCss.value;

  if (!apiKey) {
    setPlainOutput('Please enter your API key first.');
    return;
  }

  outputCss.classList.remove('has-error', 'has-warning');
  setPlainOutput('Checking...');
  hideDiffToggle();

  const prompt = `Review this CSS for problems and respond in one of two modes:

MODE A — If it contains one or more declarations with a missing, empty, or ambiguous value (e.g. "font-size: px;", "padding: ;", "margin: solid;") where you cannot safely infer a specific value, do NOT modify or guess it. Instead respond with a short message starting exactly with "MISSING_VALUES:" followed by a bullet list, one line per problem, naming the exact selector/property and what's missing, and ending with a line telling the user to fill in the value(s) in the left box and click "Fix it for me" again. Say nothing else. Example:
MISSING_VALUES:
- .api-key-note → font-size is missing a number and unit (e.g. 14px)
Please fill in the missing value(s) above in the left box, then click "Fix it for me" again.

MODE B — If there are no missing/ambiguous values (only unambiguous mistakes like typos in property names, mismatched quotes/braces, missing semicolons/colons), fix those automatically and also clean up and reformat the CSS: consistent indentation, one property per line, consistent double quotes, remove duplicate properties (keep the last occurrence), collapse padding/margin/border-radius shorthand where all sides match or top/bottom and left/right pairs match, shorten 6-digit hex colors to 3-digit only when it's a lossless collapse, organize properties in a logical order (positioning, box model, typography, visual), and do not merge separate background properties into a single shorthand. Return ONLY the resulting CSS, no explanations, no markdown code fences.

CSS:
${currentCss}`;

  try {
    const result = await callAI(provider, apiKey, prompt);
    const trimmed = result.trim();

    if (trimmed.startsWith('MISSING_VALUES:')) {
      setPlainOutput(trimmed.replace(/^MISSING_VALUES:\s*/, ''));
      outputCss.classList.add('has-warning');
      fixItBtn.hidden = false;
    } else {
      setCssOutput(trimmed);
      fixItBtn.hidden = true;
      showDiffToggle(currentCss, trimmed);
    }
  } catch (error) {
    console.error('Error:', error);
    showError(error.message, currentCss);
  }
});

responsiveGenerateBtn.addEventListener('click', async () => {
  const currentCss = inputCss.value;
  const apiKey = userApiKey.value.trim();
  const provider = providerSelect.value;

  clearError();

  if (!apiKey) {
    setPlainOutput('Please enter your API key first.');
    return;
  }

  if (!currentCss.trim()) {
    setPlainOutput('Paste some CSS in the left box first.');
    return;
  }

  const validationErrors = validateCss(currentCss);
  if (validationErrors) {
    showError(validationErrors.join('\n'), currentCss);
    return;
  }

  setPlainOutput('Generating responsive breakpoints...');

  const prompt = `This is a desktop-first CSS file. Add responsive support for smaller screens without changing any of the existing desktop styles.

Rules:
1. Do NOT modify, remove, or reorder any existing rule or declaration. The current CSS represents desktop behavior and must stay exactly as-is.
2. Add two new @media blocks at the end of the file:
   - @media (max-width: 768px) { ... } for tablet
   - @media (max-width: 480px) { ... } for mobile
3. Only use selectors that already exist in the CSS below — do not invent new class names or target elements not already styled.
4. Inside each media query, adjust values that commonly need to differ per screen size: scale down large fixed pixel widths/heights/padding/margins/font-sizes sensibly, and where a rule uses "flex-direction: row" or a multi-column grid, consider switching to a stacked/column layout on mobile if that matches the apparent intent.
5. Do not add breakpoint overrides for every single rule — only for ones where a real desktop-to-mobile difference makes sense (e.g. don't touch color or font-family).
6. Keep formatting consistent with the rest of the file: one property per line, consistent indentation.

Return ONLY the complete resulting CSS (the original rules, unchanged, followed by the two new @media blocks). No explanations, no markdown code fences.

CSS:
${currentCss}`;

  try {
    const result = await callAI(provider, apiKey, prompt);
    setCssOutput(result);
    setMoodBadge(outputMoodBadge, computeChaosScore(result));
    showDiffToggle(currentCss, result);
  } catch (error) {
    console.error('Error:', error);
    showError(error.message, currentCss);
  }
});

bugExplainBtn.addEventListener('click', async () => {
  const currentCss = inputCss.value;
  const bugDescription = bugDescriptionInput.value.trim();
  const bugHtml = bugHtmlInput.value.trim();
  const apiKey = userApiKey.value.trim();
  const provider = providerSelect.value;

  bugResults.hidden = false;

  if (!apiKey) {
    bugResults.innerHTML = '<p>Please enter your API key first.</p>';
    return;
  }

  if (!currentCss.trim()) {
    bugResults.innerHTML = '<p>Paste some CSS in the left box first.</p>';
    return;
  }

  if (!bugDescription) {
    bugResults.innerHTML = '<p>Describe the problem you\'re seeing above, then click "Explain my bug and fix it" again.</p>';
    return;
  }

  bugResults.innerHTML = '<p>Diagnosing and fixing...</p>';

  const prompt = `A developer is having a CSS problem. Diagnose the most likely cause, then fix it.

Problem they described: "${bugDescription}"

Their CSS:
${currentCss}
${bugHtml ? `\nRelevant HTML for context:\n${bugHtml}` : '\n(No HTML was provided — if the diagnosis depends heavily on markup structure, make your best guess based on the CSS alone and say so in the explanation.)'}

Respond in exactly this format, with both section markers included:

EXPLANATION:
(3-5 short sentences or bullet points naming the likely cause. Be direct and practical. No markdown code fences here.)

FIXED_CSS:
(The complete corrected CSS. Keep everything that wasn't part of the bug unchanged. Return ONLY valid CSS in this section, no explanations, no markdown code fences.)`;

  try {
    const raw = await callAI(provider, apiKey, prompt);

    const fixedMarker = raw.indexOf('FIXED_CSS:');
    if (fixedMarker === -1) {
      bugResults.innerHTML = `<p>${escapeHtml(raw).replace(/\n/g, '<br>')}</p>`;
      return;
    }

    const explanation = raw.slice(0, fixedMarker).replace(/^EXPLANATION:\s*/, '').trim();
    const fixedCss = raw.slice(fixedMarker).replace(/^FIXED_CSS:\s*/, '').trim();

    bugResults.innerHTML = `<p>${escapeHtml(explanation).replace(/\n/g, '<br>')}</p>`;

    setCssOutput(fixedCss);
    setMoodBadge(outputMoodBadge, computeChaosScore(fixedCss));
    showDiffToggle(currentCss, fixedCss);
  } catch (error) {
    console.error('Error:', error);
    bugResults.innerHTML = `<p>Error: ${escapeHtml(error.message)}</p>`;
  }
});

updateInputMood();