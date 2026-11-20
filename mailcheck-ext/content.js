// Gmailの画面を見張り、開かれたメールごとに判定結果を本文の上に表示する
(function () {
  'use strict';
  var IK = null;
  var ME = '';   // 開いているGmailアカウントのアドレス（自分あてメールの判定用）
  var trusted = [];
  var partners = [];
  var lockOn = true;   // 本文のリンクをロックする（オプションで切り替え）
  var cache = {};

  window.addEventListener('message', function (e) {
    if ((e.source === window || e.origin === location.origin) && e.data && e.data.__mailcheck && e.data.ik) {
      IK = e.data.ik;
      if (e.data.me && /@/.test(e.data.me)) ME = String(e.data.me).toLowerCase();
    }
  });
  function loadTrusted() {
    try { chrome.storage.sync.get({ trusted: [], partners: [], lockLinks: true }, function (r) { trusted = r.trusted || []; partners = r.partners || []; lockOn = r.lockLinks !== false; }); } catch (e) {}
  }
  // 差出人ごとに、過去に見た返信先ドメインを端末内に記録する（認証に合格したメールだけ）
  function getReplyHist(email) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get({ replyHist: {} }, function (r) { resolve((r.replyHist || {})[email] || []); }); } catch (e) { resolve([]); }
    });
  }
  function saveReplyHist(email, dom) {
    if (!email || !dom) return;
    try {
      chrome.storage.local.get({ replyHist: {} }, function (r) {
        var h = r.replyHist || {}, list = h[email] || [];
        if (list.indexOf(dom) >= 0) return;
        list.push(dom); h[email] = list.slice(-5);
        var keys = Object.keys(h);
        if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(function (k) { delete h[k]; });
        chrome.storage.local.set({ replyHist: h });
      });
    } catch (e) {}
  }
  // 差出人名の横の青いチェックマーク（確認済みの送信者）を探す
  function hasVerifiedMark(container) {
    var sender = container.querySelector('span[email]');
    var scope = sender ? (sender.closest('h3') || sender.parentElement.parentElement || container) : container;
    var els = scope.querySelectorAll('*');
    var re = /確認済み|確認され|所有して|verified|owns? the domain/i;
    for (var i = 0; i < els.length && i < 300; i++) {
      var e = els[i];
      if (e.closest && e.closest('.a3s')) continue;
      var t = ['aria-label', 'data-tooltip', 'title', 'alt', 'data-hovercard-id', 'src'].map(function (a) { return e.getAttribute(a) || ''; }).join(' ');
      if (re.test(t)) return true;
    }
    return false;
  }
  loadTrusted();
  try { chrome.storage.onChanged.addListener(function () { loadTrusted(); }); } catch (e) {}

  function lcEmail(s) { return (s || '').trim().toLowerCase(); }
  function myAddresses() {
    var a = [];
    if (ME) a.push(ME);
    var m = (document.title || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
    if (m) a.push(m[0].toLowerCase());
    return a;
  }
  function accountIndex() { var m = location.pathname.match(/\/mail\/u\/(\d+)/); return m ? m[1] : '0'; }

  function waitIk(ms) {
    return new Promise(function (resolve) {
      if (IK) return resolve(IK);
      window.postMessage({ __mailcheck_req: true }, location.origin);
      var t0 = Date.now();
      (function poll() {
        if (IK) return resolve(IK);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(poll, 200);
      })();
    });
  }

  // 「メッセージのソースを表示」と同じページを同じGmailの中から読み込む（外部には送らない）
  async function fetchRaw(msgId, legacyId) {
    var ik = await waitIk(3000);
    if (!ik) return null;
    var u = accountIndex();
    var urls = [];
    if (msgId) urls.push('/mail/u/' + u + '/?ik=' + ik + '&view=om&permmsgid=msg-f:' + msgId);
    if (legacyId) urls.push('/mail/u/' + u + '/?ik=' + ik + '&view=om&th=' + legacyId);
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i], { credentials: 'include' });
        if (!res.ok) continue;
        var html = await res.text();
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var pre = doc.querySelector('#raw_message_text') || doc.querySelector('pre');
        var text = pre ? pre.textContent : '';
        if (/^(received|delivered-to|return-path|authentication-results|from):/im.test(text)) return text;
      } catch (e) {}
    }
    return null;
  }

  function idsOf(container) {
    var mid = container.getAttribute('data-message-id') || '';
    var m = mid.match(/msg-f:(\d+)/);
    var legacy = container.getAttribute('data-legacy-message-id') || '';
    var dec = m ? m[1] : '';
    if (!dec && /^[0-9a-f]+$/i.test(legacy)) { try { dec = BigInt('0x' + legacy).toString(); } catch (e) {} }
    return { msgId: dec, legacyId: legacy, key: dec || legacy };
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function render(container, body, result, fromAuthSource) {
    var old = container.querySelector('.mailcheck-banner');
    if (old) old.remove();
    var icon = { safe: '🟢', caution: '🟡', danger: '🔴' }[result.level] || '⚪';
    var box = el('div', 'mailcheck-banner mailcheck-' + result.level);
    var head = el('div', 'mailcheck-head');
    head.appendChild(el('span', 'mailcheck-title', icon + ' ' + result.title));
    var right = el('span', 'mailcheck-right');
    var ver = ''; try { ver = 'v' + chrome.runtime.getManifest().version; } catch (e) {}
    right.appendChild(el('span', 'mailcheck-ver', ver));
    var toggle = el('button', 'mailcheck-toggle', '理由を見る');
    right.appendChild(toggle);
    head.appendChild(right);
    box.appendChild(head);
    var list = el('ul', 'mailcheck-reasons');
    result.reasons.forEach(function (r) {
      var mark = { ok: '✔', danger: '✖', caution: '！', info: '・' }[r.level] || '・';
      list.appendChild(el('li', 'mailcheck-r-' + r.level, mark + ' ' + r.text));
    });
    if (!fromAuthSource) list.appendChild(el('li', 'mailcheck-r-info', '・認証情報なしの簡易判定です（ページを再読み込みすると取得できる場合があります）'));
    if (result.level === 'danger') list.appendChild(el('li', 'mailcheck-r-info', '・リンクは開かず、公式アプリやブックマークから自分でログインして確認してください'));
    if (result.trustable) {
      var li = el('li', 'mailcheck-r-info');
      var target = result.trustTarget || result.fromDomain;
      var isAddr = target.indexOf('@') >= 0;
      var btn = el('button', 'mailcheck-trust', '「' + target + '」を信頼済みにする（' + (isAddr ? '本人と確認できた場合のみ' : '公式と確認できた場合のみ') + '）');
      btn.addEventListener('click', function () {
        var q = result.level === 'danger'
          ? '「' + result.fromDomain + '」は公式ドメインに似せた形のため「危険」と判定しています。\n会社の公式サイト（メールのリンクではなく、自分で開いたページ）で、このドメインが本物だと確認できましたか？\n確認できた場合だけ「OK」を押してください。'
          : isAddr ? '「' + target + '」を信頼済みアドレスに追加します（このアドレスだけが対象です）。送り主本人のアドレスだと確認できましたか？'
          : '「' + target + '」を信頼済みドメインに追加します。公式サイトなどで本物と確認できましたか？';
        if (!confirm(q)) return;
        chrome.storage.sync.get({ trusted: [] }, function (r) {
          var t = r.trusted || [];
          if (t.indexOf(target) < 0) t.push(target);
          chrome.storage.sync.set({ trusted: t }, function () { btn.textContent = '追加しました（再表示で反映）'; btn.disabled = true; });
        });
      });
      li.appendChild(btn); list.appendChild(li);
    }
    list.style.display = result.level === 'safe' ? 'none' : 'block';
    toggle.textContent = result.level === 'safe' ? '理由を見る' : '閉じる';
    toggle.addEventListener('click', function () {
      var open = list.style.display !== 'none';
      list.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? '理由を見る' : '閉じる';
    });
    box.appendChild(list);
    container.setAttribute('data-mailcheck-level', result.level);
    var bar = container.querySelector('.mailcheck-lockbar');
    body.parentNode.insertBefore(box, bar && bar.parentNode === body.parentNode ? bar : body);
  }

  // ===== リンクのロック（v0.7） =====
  // 本文のリンクから行き先を外して、押しても開かないようにする。行き先は data 属性に残し、押すと中身を表示する。
  function isLockable(href) { return !!href && !/^(mailto:|tel:|#|javascript:)/i.test(href.trim()); }
  function realUrl(href) {
    try {
      var u = new URL(href, location.href);
      if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url') || href;
      return u.href;
    } catch (e) { return href; }
  }
  function lockLinks(container, body) {
    var n = 0;
    body.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!isLockable(href)) return;
      a.setAttribute('data-mailcheck-href', href);
      var safe = a.getAttribute('data-saferedirecturl');
      if (safe) { a.setAttribute('data-mailcheck-safe', safe); a.removeAttribute('data-saferedirecturl'); }
      a.removeAttribute('href');
      a.classList.add('mailcheck-locked');
      a.setAttribute('title', '🔒 リンクはロック中（押すと行き先を表示）');
      n++;
    });
    return n;
  }
  function unlockLinks(body) {
    body.querySelectorAll('a.mailcheck-locked').forEach(function (a) {
      a.setAttribute('href', a.getAttribute('data-mailcheck-href'));
      var safe = a.getAttribute('data-mailcheck-safe');
      if (safe) a.setAttribute('data-saferedirecturl', safe);
      a.classList.remove('mailcheck-locked');
      a.removeAttribute('title');
    });
  }
  function renderLockBar(container, body) {
    var bar = container.querySelector('.mailcheck-lockbar');
    if (!bar) { bar = el('div', 'mailcheck-lockbar'); body.parentNode.insertBefore(bar, body); }
    bar.textContent = '';
    var unlocked = container.getAttribute('data-mailcheck-unlocked') === '1';
    var n = unlocked ? body.querySelectorAll('a[data-mailcheck-href]').length : body.querySelectorAll('a.mailcheck-locked').length;
    if (!n) { bar.remove(); return; }
    bar.appendChild(el('span', null, unlocked ? '🔓 このメールのリンクは有効です（' + n + '件）' : '🔒 本文のリンクはロック中です（' + n + '件）。押すと行き先だけを表示します'));
    var btn = el('button', 'mailcheck-toggle', unlocked ? 'もう一度ロックする' : 'このメールのリンクを有効にする');
    btn.addEventListener('click', function () {
      if (unlocked) { container.removeAttribute('data-mailcheck-unlocked'); lockLinks(container, body); }
      else {
        var lv = container.getAttribute('data-mailcheck-level');
        var msg = lv === 'danger'
          ? '「危険」と判定されたメールです。リンク先で ID・パスワード・カード番号を入力すると盗まれるおそれがあります。\nそれでもリンクを有効にしますか？'
          : 'このメールのリンクを有効にします。ログインが必要な操作は、リンクからではなく公式アプリやブックマークから行うのが安全です。\n有効にしますか？';
        if (!confirm(msg)) return;
        container.setAttribute('data-mailcheck-unlocked', '1'); unlockLinks(body);
      }
      renderLockBar(container, body);
    });
    bar.appendChild(btn);
  }
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function showPop(a) {
    closePop();
    var href = realUrl(a.getAttribute('data-mailcheck-href'));
    var host = ''; try { host = new URL(href).hostname; } catch (e) {}
    var rd = host ? MailCheck.regDomain(host) : '';
    var text = (a.textContent || '').trim();
    pop = el('div', 'mailcheck-pop');
    pop.appendChild(el('div', 'mailcheck-pop-title', '🔒 このリンクはロックされています'));
    var d = el('div', 'mailcheck-pop-row'); d.appendChild(document.createTextNode('行き先：'));
    d.appendChild(el('b', null, rd || '（不明）'));
    if (host && host !== rd) d.appendChild(document.createTextNode('（' + host + '）'));
    pop.appendChild(d);
    if (text && text.length < 120 && text.replace(/^https?:\/\//, '').indexOf(host) < 0 && /[a-z0-9-]+\.[a-z]{2,}/i.test(text))
      pop.appendChild(el('div', 'mailcheck-pop-row mailcheck-pop-warn', '！ 表示されている文字（' + text + '）と行き先が違います'));
    pop.appendChild(el('div', 'mailcheck-pop-url', href.length > 200 ? href.slice(0, 200) + '…' : href));
    pop.appendChild(el('div', 'mailcheck-pop-row', 'ログインや支払いが必要なら、このリンクではなく公式アプリやブックマークから開いてください。'));
    var btns = el('div', 'mailcheck-pop-btns');
    var copy = el('button', 'mailcheck-toggle', 'URLをコピー');
    copy.addEventListener('click', function () {
      try { navigator.clipboard.writeText(href).then(function () { copy.textContent = 'コピーしました'; }); } catch (e) {}
    });
    var close = el('button', 'mailcheck-toggle', '閉じる');
    close.addEventListener('click', closePop);
    btns.appendChild(copy); btns.appendChild(close); pop.appendChild(btns);
    document.body.appendChild(pop);
    var r = a.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 6, left = Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - pop.offsetWidth - 16));
    if (r.bottom + pop.offsetHeight + 12 > window.innerHeight) top = Math.max(8, r.top + window.scrollY - pop.offsetHeight - 6);
    pop.style.top = top + 'px'; pop.style.left = left + 'px';
  }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a.mailcheck-locked') : null;
    if (a) { e.preventDefault(); e.stopPropagation(); showPop(a); return; }
    if (pop && !pop.contains(e.target)) closePop();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); }, true);

  async function processContainer(container) {
    var body = container.querySelector('.a3s');
    if (!body) return;
    var ids = idsOf(container);
    if (!ids.key || container.getAttribute('data-mailcheck') === ids.key) return;
    container.setAttribute('data-mailcheck', ids.key);

    var sender = container.querySelector('span[email]');
    var subjectEl = document.querySelector('h2.hP');
    var links = Array.prototype.slice.call(body.querySelectorAll('a[href]')).map(function (a) {
      return { href: a.getAttribute('href'), text: a.textContent || '' };
    });
    var base = {
      fromEmail: sender ? sender.getAttribute('email') : '',
      fromName: sender ? (sender.getAttribute('name') || sender.textContent || '') : '',
      subject: subjectEl ? subjectEl.textContent : '',
      links: links,
      bodyText: (body.innerText || body.textContent || '').slice(0, 8000),
      trusted: trusted,
      partners: partners,
      verifiedSender: hasVerifiedMark(container),
      myAddresses: myAddresses()
    };
    base.replyHistory = await getReplyHist(lcEmail(base.fromEmail));
    // まず見た目の情報で即時表示 → ヘッダーが取れたら差し替え
    render(container, body, MailCheck.analyze(base), false);
    if (lockOn) { lockLinks(container, body); renderLockBar(container, body); }
    var raw = cache[ids.key];
    if (raw === undefined) { raw = await fetchRaw(ids.msgId, ids.legacyId); cache[ids.key] = raw; }
    if (raw) {
      var full = Object.assign({}, base, { raw: raw });
      var res = MailCheck.analyze(full);
      render(container, body, res, true);
      if (res.authOk && res.level !== 'danger') saveReplyHist(res.fromEmail, res.replyDomain || MailCheck.regDomain(res.fromDomain));
    }
  }

  var timer = null;
  function scan() {
    var cs = document.querySelectorAll('[data-message-id], [data-legacy-message-id]');
    cs.forEach(function (c) {
      // 本文を持つ一番内側の要素だけを対象にする（入れ子で二重に表示しないため）
      if (c.querySelector('.a3s') && !c.querySelector(':scope [data-message-id] .a3s, :scope [data-legacy-message-id] .a3s')) {
        processContainer(c);
        // Gmailが本文を描き直したときに、外したリンクが戻っていたらもう一度ロックする
        var b = c.querySelector('.a3s');
        if (lockOn && b && c.getAttribute('data-mailcheck') && c.getAttribute('data-mailcheck-unlocked') !== '1' &&
            Array.prototype.some.call(b.querySelectorAll('a[href]'), function (a) { return isLockable(a.getAttribute('href')); })) {
          lockLinks(c, b); renderLockBar(c, b);
        }
      }
    });
  }
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(scan, 400); })
    .observe(document.body, { childList: true, subtree: true });
  setTimeout(scan, 1500);
})();
