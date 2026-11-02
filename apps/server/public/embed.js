/*!
 * Ragfolio embed — one script tag, no build step, no framework.
 *
 *   <script src="https://YOUR-APP.vercel.app/embed.js" defer></script>
 *
 * Optional attributes on the tag:
 *   data-theme="dark|light"      pin the widget theme (default: follow the page's prefers-color-scheme)
 *   data-label="Ask me anything" launcher button text
 *   data-position="right|left"   which corner (default right)
 *   data-color="#6366f1"         launcher accent colour
 *   data-mode="launcher|inline"  inline renders the chat into the element with data-target instead of a floating button
 *   data-target="#chat"          CSS selector for inline mode
 *
 * JavaScript API (optional):
 *   window.ragfolio.open(); window.ragfolio.close(); window.ragfolio.toggle();
 *   window.ragfolio.ask('What projects has she shipped?');   // opens and submits
 *
 * The handshake with the iframe is handled here. The page never writes
 * postMessage code: the widget posts `ragfolio:ready` once a session exists,
 * and `ask()` replies with `ragfolio:ask` only to that iframe, only to its origin.
 *
 * The widget only posts to parents listed in its TRUSTED_ORIGINS, so on a host
 * that is not trusted, `ask()` queues silently and the close control is inert.
 * Add your site (and localhost for development) to TRUSTED_ORIGINS.
 */
(function () {
  if (window.ragfolio && window.ragfolio.__mounted) return;

  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src, location.href).origin;
  var theme = script.getAttribute('data-theme') || '';
  var label = script.getAttribute('data-label') || 'Ask me anything';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var color = script.getAttribute('data-color') || '#6366f1';
  var mode = script.getAttribute('data-mode') === 'inline' ? 'inline' : 'launcher';
  var target = script.getAttribute('data-target') || '';

  var frameUrl = new URL(origin + '/');
  if (theme) frameUrl.searchParams.set('theme', theme);
  frameUrl.searchParams.set('embed', '1');

  var ready = false;
  var queue = [];
  var frame = document.createElement('iframe');
  frame.src = frameUrl.toString();
  frame.title = 'Chat assistant';
  frame.allow = 'clipboard-write';
  // The server decides what this visitor may see from the parent origin the
  // browser reports. A host page with Referrer-Policy: no-referrer would
  // otherwise land every visitor in restricted mode; pin it on the frame.
  frame.referrerPolicy = 'strict-origin';
  frame.setAttribute('style', 'border:0;width:100%;height:100%;display:block;background:transparent;');

  function send(message) {
    if (!frame.contentWindow) return;
    frame.contentWindow.postMessage(message, origin);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data || {};
    if (data.type === 'ragfolio:ready') {
      ready = true;
      while (queue.length) send(queue.shift());
    }
    if (data.type === 'ragfolio:close') api.close();
  });

  var api = {
    __mounted: true,
    open: function () {},
    close: function () {},
    toggle: function () {},
    ask: function (prompt) {
      var text = String(prompt || '').trim().slice(0, 2000);
      if (!text) return;
      api.open();
      var message = { type: 'ragfolio:ask', prompt: text };
      if (ready) send(message);
      else queue.push(message);
    },
  };
  window.ragfolio = api;

  if (mode === 'inline') {
    var host = target ? document.querySelector(target) : script.parentElement;
    if (!host) return;
    if (!host.style.height && !host.getAttribute('style')) host.style.minHeight = '560px';
    host.appendChild(frame);
    return;
  }

  // --- Launcher mode: floating button + full-screen overlay -----------------
  var style = document.createElement('style');
  style.textContent =
    '.rf-launch{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;' +
    'padding:12px 18px;border:0;border-radius:999px;background:' + color + ';color:#fff;font:600 14px/1 system-ui,-apple-system,Segoe UI,sans-serif;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;transition:transform .15s ease}' +
    '.rf-launch:hover{transform:translateY(-1px)}' +
    '.rf-launch svg{width:18px;height:18px;flex:none}' +
    '.rf-overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px}' +
    '.rf-overlay.rf-open{display:flex}' +
    '.rf-panel{position:relative;width:min(960px,100%);height:min(760px,100%);border-radius:16px;overflow:hidden;background:#0b0e14;box-shadow:0 24px 80px rgba(0,0,0,.5)}' +
    '.rf-close{position:absolute;top:10px;' + side + ':10px;z-index:2;width:32px;height:32px;border:0;border-radius:999px;background:rgba(0,0,0,.4);color:#fff;font:600 18px/32px system-ui,sans-serif;cursor:pointer}' +
    '@media (max-width:640px){.rf-overlay{padding:0}.rf-panel{border-radius:0}}';
  document.head.appendChild(style);

  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'rf-launch';
  button.setAttribute('aria-label', label);
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
    '<span></span>';
  button.querySelector('span').textContent = label;

  var overlay = document.createElement('div');
  overlay.className = 'rf-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', label);

  var panel = document.createElement('div');
  panel.className = 'rf-panel';
  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'rf-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  panel.appendChild(close);
  panel.appendChild(frame);
  overlay.appendChild(panel);

  var mounted = false;
  function mount() {
    if (mounted) return;
    mounted = true;
    document.body.appendChild(overlay);
  }

  api.open = function () {
    mount();
    overlay.classList.add('rf-open');
    document.documentElement.style.overflow = 'hidden';
  };
  api.close = function () {
    overlay.classList.remove('rf-open');
    document.documentElement.style.overflow = '';
    button.focus();
  };
  api.toggle = function () {
    if (overlay.classList.contains('rf-open')) api.close();
    else api.open();
  };

  button.addEventListener('click', api.open);
  close.addEventListener('click', api.close);
  overlay.addEventListener('click', function (event) {
    if (event.target === overlay) api.close();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && overlay.classList.contains('rf-open')) api.close();
  });

  function attach() {
    document.body.appendChild(button);
  }
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);
})();
