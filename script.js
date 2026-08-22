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

// Remembers the most recent error and the CSS that caused it, so the
// "Ask AI" and "Fix it for me" buttons know what to send without the
// user having to resubmit anything.
let lastErrorMessage = '';
let lastCssAttempted = '';

// Clears the API key field with one click (e.g. on a shared computer).
clearKeyBtn.addEventListener('click', () => {
  userApiKey.value = '';
  userApiKey.focus();
});

// Short, provider-specific notes shown when the ⓘ button is clicked.
// Gemini is flagged as the safe default since it's designed for direct
// browser calls; OpenAI/Anthropic are not, and need extra caveats.
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

// Keep the info text in sync if the user switches providers while the panel is open.
providerSelect.addEventListener('change', () => {
  if (!providerInfoPanel.hidden) updateProviderInfo();
});

// Builds the provider-specific request details: URL, headers, body shape,
// and functions to pull the generated text (or an error message) back out
// of that provider's particular response format.
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
        // This header is intentionally named as a warning by Anthropic:
        // calling their API directly from a browser is not the intended
        // integration pattern, but it does work with this header set.
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

// Single entry point used by every AI-driven feature in the app.
// Handles the actual fetch + error normalization so callers don't
// need to know which provider is selected.
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

// Real CSS syntax + property/value validation using csstree, rather than
// hand-rolled regex checks. Catches both structural errors (mismatched
// braces/quotes) and semantic ones (unknown properties, wrong value types).
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
      const valueCss = csstree.generate(node.value);
      const match = csstree.lexer.matchProperty(node.property, node.value);
      if (match.error) {
        errors.push(`"${node.property}: ${valueCss}" — ${match.error.message}`);
      }
    }
  });

  return errors.length > 0 ? errors : null;
}

function showError(message, cssAttempted) {
  lastErrorMessage = message;
  lastCssAttempted = cssAttempted;
  outputCss.value = `Error: ${message}`;
  outputCss.classList.add('has-error');
  askAiBtn.hidden = false;
  fixItBtn.hidden = true;
}

function clearError() {
  outputCss.classList.remove('has-error');
  askAiBtn.hidden = true;
  fixItBtn.hidden = true;
}

cleanBtn.addEventListener('click', async () => {
  const messyCss = inputCss.value;
  const apiKey = userApiKey.value.trim();
  const provider = providerSelect.value;

  clearError();

  if (!apiKey) {
    outputCss.value = 'Please enter your API key first.';
    return;
  }

  if (!messyCss.trim()) {
    outputCss.value = '';
    return;
  }

  // Validate locally first — catches obvious syntax mistakes instantly,
  // without spending an API call on CSS that's already broken.
  const validationErrors = validateCss(messyCss);
  if (validationErrors) {
    showError(validationErrors.join('\n'), messyCss);
    return;
  }

  outputCss.value = 'Cleaning...';

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
    outputCss.value = cleanedCss;
  } catch (error) {
    console.error('Error:', error);
    showError(error.message, messyCss);
  }
});

askAiBtn.addEventListener('click', async () => {
  const apiKey = userApiKey.value.trim();
  const provider = providerSelect.value;

  if (!apiKey) {
    outputCss.value = 'Please enter your API key first.';
    return;
  }

  outputCss.classList.remove('has-error');
  outputCss.value = 'Asking AI...';
  askAiBtn.hidden = true;

  const prompt = `A user's CSS caused this error: "${lastErrorMessage}"

Their CSS:
${lastCssAttempted}

In 3-5 short sentences or bullet points, explain briefly and effectively what is likely wrong and how to fix it. Be direct and practical, no long explanations, no markdown code fences.`;

  try {
    const answer = await callAI(provider, apiKey, prompt);
    outputCss.value = answer;
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
    outputCss.value = 'Please enter your API key first.';
    return;
  }

  outputCss.classList.remove('has-error', 'has-warning');
  outputCss.value = 'Checking...';

  // Two-mode prompt: the AI must not guess missing values (e.g. "font-size: px;")
  // since inventing a number could silently change the user's intended design.
  // Ambiguous cases are reported back for the user to fill in themselves.
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
      outputCss.value = trimmed.replace(/^MISSING_VALUES:\s*/, '');
      outputCss.classList.add('has-warning');
      fixItBtn.hidden = false;
    } else {
      outputCss.value = trimmed;
      fixItBtn.hidden = true;
    }
  } catch (error) {
    console.error('Error:', error);
    showError(error.message, currentCss);
  }
});