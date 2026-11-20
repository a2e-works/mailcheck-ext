// 判定ロジック本体（Gmailに依存しない純粋な関数。Node でもテストできる）
(function (root) {
  var D = (typeof module !== 'undefined') ? require('./domains.js') : {
    MAILCHECK_BRANDS: root.MAILCHECK_BRANDS, MAILCHECK_FREEMAIL: root.MAILCHECK_FREEMAIL,
    MAILCHECK_SHORTENERS: root.MAILCHECK_SHORTENERS, MAILCHECK_URGENT: root.MAILCHECK_URGENT, MAILCHECK_PAYMENT: root.MAILCHECK_PAYMENT, MAILCHECK_TRACKERS: root.MAILCHECK_TRACKERS
  };

  var MULTI_TLD = ['co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp', 'ed.jp', 'lg.jp', 'ad.jp',
    'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.kr', 'com.cn', 'com.tw', 'com.hk', 'co.nz', 'com.br', 'com.sg'];

  function lc(s) { return (s || '').toString().trim().toLowerCase(); }

  // ---------- ヘッダー解析 ----------
  function parseHeaders(raw) {
    if (!raw) return [];
    var text = raw.replace(/\r\n/g, '\n');
    var end = text.indexOf('\n\n');
    if (end >= 0) text = text.slice(0, end);
    var lines = text.split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^[ \t]/.test(l) && out.length) { out[out.length - 1][1] += ' ' + l.trim(); continue; }
      var m = l.match(/^([!-9;-~]+):\s?(.*)$/);
      if (m) out.push([m[1].toLowerCase(), m[2]]);
    }
    return out;
  }
  function getAll(h, name) { return h.filter(function (x) { return x[0] === name; }).map(function (x) { return x[1]; }); }

  function extractEmail(v) {
    if (!v) return '';
    var m = v.match(/<([^>]+)>/);
    var e = m ? m[1] : v;
    m = e.match(/[A-Za-z0-9._%+\-=']+@[A-Za-z0-9.\-]+/);
    return m ? m[0].toLowerCase() : '';
  }
  function extractName(v) {
    if (!v) return '';
    var m = v.match(/^\s*"?([^"<]*?)"?\s*</);
    return m ? decodeMime(m[1].trim()) : '';
  }
  // =?UTF-8?B?...?= / =?ISO-2022-JP?B?...?= の簡易デコード（UTF-8のみ完全対応）
  function decodeMime(s) {
    return (s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, function (all, cs, enc, data) {
      try {
        var bytes;
        if (enc.toUpperCase() === 'B') {
          var bin = (typeof atob !== 'undefined') ? atob(data) : Buffer.from(data, 'base64').toString('binary');
          bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
        } else {
          var t = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
          bytes = Uint8Array.from(t, function (c) { return c.charCodeAt(0); });
        }
        return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : cs.toLowerCase()).decode(bytes);
      } catch (e) { return all; }
    });
  }
  function domainOf(email) { var i = (email || '').lastIndexOf('@'); return i >= 0 ? email.slice(i + 1).toLowerCase() : ''; }
  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (e) {
      var m = (url || '').match(/^[a-z]+:\/\/([^\/:?#]+)/i); return m ? m[1].toLowerCase() : '';
    }
  }
  function regDomain(host) {
    host = lc(host).replace(/\.$/, '');
    var p = host.split('.');
    if (p.length <= 2) return host;
    var last2 = p.slice(-2).join('.');
    return MULTI_TLD.indexOf(last2) >= 0 ? p.slice(-3).join('.') : last2;
  }
  function sameOrSub(host, dom) { host = lc(host); dom = lc(dom); return host === dom || host.slice(-(dom.length + 1)) === '.' + dom; }

  // 送信先サーバー（Gmailなど）が記録した認証結果
  function parseAuth(headers) {
    var ar = getAll(headers, 'authentication-results');
    if (!ar.length) ar = getAll(headers, 'arc-authentication-results');
    if (!ar.length) return null;
    var v = ar[0]; // 一番上 = 自分の受信サーバーが付けたもの
    function res(key) { var m = v.match(new RegExp('\\b' + key + '=([a-z]+)', 'i')); return m ? m[1].toLowerCase() : 'none'; }
    var hf = v.match(/header\.from=([^\s;)]+)/i);
    var dkimDomains = [];
    var re = /dkim=pass[^;]*?header\.(?:i|d)=@?([^\s;)]+)/ig, m;
    while ((m = re.exec(v))) dkimDomains.push(lc(m[1]).replace(/^@/, ''));
    return { spf: res('spf'), dkim: res('dkim'), dmarc: res('dmarc'), headerFrom: hf ? lc(hf[1]) : '', dkimDomains: dkimDomains, raw: v };
  }

  // ---------- 似せたドメインの検出 ----------
  function lev(a, b) {
    var m = a.length, n = b.length, d = [];
    for (var i = 0; i <= m; i++) { d[i] = [i]; }
    for (var j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function deconfuse(s) {
    return s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e')
      .replace(/5/g, 's').replace(/\$/g, 's').replace(/@/g, 'a').replace(/i/g, 'l');
  }
  function lookalike(fromDomain, officialDomains) {
    var rd = regDomain(fromDomain), label = rd.split('.')[0];
    if (fromDomain.indexOf('xn--') >= 0) return { domain: fromDomain, reason: '国際化ドメイン（見た目が似た文字を使える形式）' };
    for (var i = 0; i < officialDomains.length; i++) {
      var od = officialDomains[i];
      if (sameOrSub(fromDomain, od)) return null;
      var olabel = regDomain(od).split('.')[0];
      if (olabel.length < 4) continue;
      if (label === olabel && rd !== regDomain(od)) return { domain: od, reason: '公式と同じ名前で末尾（' + rd.slice(label.length + 1) + '）だけが違う' };
      if (label !== olabel && label.indexOf(olabel) >= 0) return { domain: od, reason: '公式の名前「' + olabel + '」に別の言葉を足したドメイン' };
      if (fromDomain.split('.').some(function (p) { return p === olabel; }) && !sameOrSub(fromDomain, od) && rd !== regDomain(od))
        return { domain: od, reason: 'サブドメインに公式の名前「' + olabel + '」を入れた別ドメイン' };
      var dist = lev(label, olabel);
      if (dist > 0 && dist <= (olabel.length >= 7 ? 2 : 1)) return { domain: od, reason: '公式「' + olabel + '」と1〜2文字だけ違う' };
      if (label !== olabel && deconfuse(label) === deconfuse(olabel)) return { domain: od, reason: '数字や似た文字で公式「' + olabel + '」に見せかけている' };
    }
    return null;
  }

  // ---------- ブランドの名乗り ----------
  function claimedBrands(text) {
    var t = lc(text), out = [];
    D.MAILCHECK_BRANDS.forEach(function (b) {
      var hit = b.names.some(function (n) {
        n = lc(n);
        if (/^[\x00-\x7f]+$/.test(n)) return new RegExp('(^|[^a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(t);
        return t.indexOf(n) >= 0;
      });
      if (hit) out.push(b);
    });
    return out;
  }

  // ---------- 総合判定 ----------
  // input: { raw?: 生のヘッダー全文, fromEmail?, fromName?, subject?, links?: [{href,text}], bodyText?, trusted?: [domain],
  //          partners?: [{name, domains:[]}], replyHistory?: [この差出人で過去に見た返信先ドメイン], verifiedSender?: bool }
  // ---------- 添付ファイル（v0.8） ----------
  // メールの元データから添付ファイル名を取り出す（中身は見ない）
  function decode2231(v) {
    var m = v.match(/^([^']*)'[^']*'(.*)$/);
    if (!m) return v;
    try {
      var bytes = [], s = m[2];
      for (var i = 0; i < s.length; i++) {
        if (s[i] === '%' && /^[0-9a-f]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
        else bytes.push(s.charCodeAt(i));
      }
      return new TextDecoder((m[1] || 'utf-8').toLowerCase()).decode(new Uint8Array(bytes));
    } catch (e) { return m[2]; }
  }
  function attachmentsOf(raw) {
    if (!raw) return [];
    var text = raw.replace(/\r\n/g, '\n');
    var out = [];
    var re = /^content-(?:disposition|type):[^\n]*(?:\n[ \t][^\n]*)*/gim, m;
    while ((m = re.exec(text))) {
      var h = m[0].replace(/\n[ \t]+/g, ' ');
      if (/^content-type:\s*multipart\//i.test(h)) continue;
      var name = '';
      // RFC2231 分割形式 filename*0*=... filename*1*=...
      var parts = [], pm, pre = /\b(?:file)?name\*(\d+)(\*?)=\s*("([^"]*)"|[^;\s]+)/gi;
      while ((pm = pre.exec(h))) parts.push({ i: +pm[1], enc: !!pm[2], v: pm[4] != null ? pm[4] : pm[3] });
      if (parts.length) {
        parts.sort(function (a, b) { return a.i - b.i; });
        var joined = parts.map(function (p) { return p.v; }).join('');
        name = parts[0].enc ? decode2231(joined) : joined;
      } else {
        var e1 = h.match(/\b(?:file)?name\*=\s*("([^"]*)"|[^;\s]+)/i);
        if (e1) name = decode2231(e1[2] != null ? e1[2] : e1[1]);
        else {
          var e2 = h.match(/\b(?:file)?name=\s*("([^"]*)"|[^;\s]+)/i);
          if (e2) name = decodeMime(e2[2] != null ? e2[2] : e2[1]);
        }
      }
      name = (name || '').trim();
      if (name && out.indexOf(name) < 0) out.push(name);
    }
    return out;
  }
  var EXT_EXEC = ['exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'msi', 'msp', 'ps1', 'jar', 'lnk', 'cpl', 'reg', 'scf', 'appx', 'msix', 'apk', 'dmg', 'pkg', 'app', 'command', 'sh'];
  var EXT_HTML = ['htm', 'html', 'shtml', 'xhtml', 'svg', 'mht', 'mhtml'];
  var EXT_IMAGE = ['iso', 'img', 'vhd', 'vhdx'];
  var EXT_MACRO = ['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'xlsb'];
  var EXT_OLDOFFICE = ['doc', 'xls', 'ppt', 'rtf'];
  var EXT_ARCHIVE = ['zip', 'rar', '7z', 'lzh', 'cab', 'gz', 'tgz', 'tar', 'bz2', 'xz', 'arj', 'ace'];
  var EXT_DOCLIKE = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'csv'];
  function classifyAttachment(name) {
    var clean = name.replace(/[​-‏‪-‮⁦-⁩]/g, '');
    var hidden = clean !== name;
    var parts = clean.toLowerCase().replace(/\s+$/, '').split('.');
    var ext = parts.length > 1 ? parts[parts.length - 1] : '';
    var prev = parts.length > 2 ? parts[parts.length - 2].trim() : '';
    var kind = EXT_EXEC.indexOf(ext) >= 0 ? 'exec' : EXT_HTML.indexOf(ext) >= 0 ? 'html' : EXT_IMAGE.indexOf(ext) >= 0 ? 'image'
      : EXT_MACRO.indexOf(ext) >= 0 ? 'macro' : EXT_OLDOFFICE.indexOf(ext) >= 0 ? 'oldoffice' : EXT_ARCHIVE.indexOf(ext) >= 0 ? 'archive' : 'other';
    var doubleExt = !!prev && EXT_DOCLIKE.indexOf(prev) >= 0 && kind !== 'other' && kind !== 'oldoffice' && EXT_DOCLIKE.indexOf(ext) < 0;
    var padded = /\s{3,}\.[a-z0-9]{2,5}$/i.test(clean) || /[_\-.]{6,}[a-z0-9]{2,5}$/i.test(clean);
    return { name: clean, raw: name, ext: ext, kind: kind, hidden: hidden, doubleExt: doubleExt || (padded && kind !== 'other') };
  }

  function analyze(input) {
    var reasons = [];
    function add(level, text) { reasons.push({ level: level, text: text }); }
    var headers = parseHeaders(input.raw || '');
    var fromHdr = getAll(headers, 'from')[0] || '';
    var fromEmail = lc(input.fromEmail) || extractEmail(fromHdr);
    var fromName = input.fromName || extractName(fromHdr);
    var subject = input.subject || decodeMime(getAll(headers, 'subject')[0] || '');
    var fromDomain = domainOf(fromEmail);
    var trusted = (input.trusted || []).map(lc);
    var trustedDoms = trusted.filter(function (t) { return t.indexOf('@') < 0; });
    var trustedAddrs = trusted.filter(function (t) { return t.indexOf('@') >= 0; });
    var auth = parseAuth(headers);
    var myAddrs = (input.myAddresses || []).map(lc).filter(Boolean);
    // 自分のアカウントから送ったメール：Gmailの外を通っていないため認証結果が付かない。
    // 外から自分のアドレスを名乗って届いたメールには、Gmailが必ず認証結果を付ける。
    var selfSent = !auth && headers.length > 0 && !!fromEmail && myAddrs.indexOf(fromEmail) >= 0;
    var danger = 0, caution = 0, brandUnlisted = false, softLookalike = false;

    // 1) 送信元認証
    var authOk = false, authFail = false;
    if (auth) {
      var hfOk = !auth.headerFrom || sameOrSub(fromDomain, auth.headerFrom) || sameOrSub(auth.headerFrom, regDomain(fromDomain));
      if (auth.dmarc === 'pass' && hfOk) { authOk = true; add('ok', '送信元認証（DMARC）に合格：「' + fromDomain + '」のドメインから正規に送られています'); }
      else if (auth.dmarc === 'fail') { danger++; authFail = true; add('danger', '送信元認証（DMARC）に不合格：「' + fromDomain + '」を名乗っていますが、そのドメインから送られた証明がありません'); }
      else if (auth.spf !== 'pass' && auth.dkim !== 'pass') { danger++; authFail = true; add('danger', '送信元認証（SPF・DKIM）がどちらも不合格です'); }
      else if (auth.dkim === 'pass' && auth.dkimDomains.some(function (d) { return sameOrSub(d, regDomain(fromDomain)) || sameOrSub(fromDomain, regDomain(d)); })) {
        authOk = true; add('ok', '電子署名（DKIM）が差出人のドメインと一致しています');
      } else { caution++; add('caution', '送信元認証が不完全です（SPF=' + auth.spf + ', DKIM=' + auth.dkim + ', DMARC=' + auth.dmarc + '）'); }
    } else if (selfSent) {
      add('ok', 'あなた自身のアカウント（' + fromEmail + '）から送ったメールです。Gmailの外を通っていないため、送信元認証の記録はありません');
    } else {
      add('info', '送信元認証の情報を取得できませんでした（見た目の情報だけで判定しています）');
    }

    // 1b) 確認済みの送信者（BIMI：差出人名の横の青いチェックマーク）
    var bimiPass = !!(auth && /\bbimi=pass\b/i.test(auth.raw));
    var verified = !!(input.verifiedSender || bimiPass);
    if (verified && authOk) add('ok', 'Gmailが確認済みの送信者です（差出人名の横の青いチェックマーク）');

    // 2) ブランドの名乗りと送信ドメイン
    var claims = claimedBrands(fromName + ' ' + subject + ' ' + (fromEmail.split('@')[0] || ''));
    var trustedAddrHit = !!fromEmail && trustedAddrs.indexOf(fromEmail) >= 0;
    var isTrusted = trustedAddrHit || trustedDoms.some(function (t) { return sameOrSub(fromDomain, t); });
    var official = [];
    claims.forEach(function (b) { official = official.concat(b.domains); });
    var officialHit = official.some(function (d) { return sameOrSub(fromDomain, d); });
    var allOfficial = [];
    D.MAILCHECK_BRANDS.forEach(function (b) { allOfficial = allOfficial.concat(b.domains); });
    var anyOfficial = allOfficial.some(function (d) { return sameOrSub(fromDomain, d); });

    if (trustedAddrHit) add('ok', '「' + fromEmail + '」はあなたが信頼済みに登録したアドレスです');
    else if (isTrusted) add('ok', '「' + fromDomain + '」はあなたが信頼済みに登録したドメインです');
    if (D.MAILCHECK_FREEMAIL.indexOf(regDomain(fromDomain)) >= 0 && claims.length) {
      danger++; add('danger', claims.map(function (b) { return b.brand; }).join('・') + 'を名乗っていますが、誰でも作れるフリーメール（' + fromDomain + '）から送られています');
    } else if (claims.length && !officialHit && !isTrusted) {
      var la = lookalike(fromDomain, official);
      if (la && verified && authOk) { add('ok', '公式ドメインのリストにはありませんが、Gmailが確認済みの送信者（青いチェックマーク）です'); }
      else if (la) {
        danger++; add('danger', '公式ドメイン（' + la.domain + '）に似せたドメインです：' + la.reason);
        // 公式の名前に言葉を足しただけで認証に合格している場合は、会社が実際に使う別ドメインのこともある
        if (authOk && /別の言葉を足した/.test(la.reason)) {
          softLookalike = true;
          add('info', '会社がキャンペーンなどで別ドメインを使うこともあります。公式サイトでこのドメインが正しいと確認できた場合だけ、下のボタンで信頼済みにしてください');
        }
      }
      else if (verified && authOk) { add('ok', '公式ドメインのリストにはありませんが、Gmailが確認済みの送信者（青いチェックマーク）です'); }
      else if (authOk) { caution++; brandUnlisted = true; add('caution', claims.map(function (b) { return b.brand; }).join('・') + 'の名前がありますが、送信元「' + fromDomain + '」はこのツールの公式ドメインのリストにありません。送信元の認証には合格しているので、会社の公式サイトでこのドメインが正しいか確認してください'); }
      else { danger++; brandUnlisted = true; add('danger', claims.map(function (b) { return b.brand; }).join('・') + 'を名乗っていますが、送信元「' + fromDomain + '」は登録済みの公式ドメインではなく、送信元の認証にも合格していません'); }
    } else if (officialHit && authFail) {
      add('danger', '差出人の表示は公式ドメイン「' + fromDomain + '」ですが、認証に失敗しているため偽装の可能性が高いです');
    } else if (officialHit) {
      add('ok', '送信元「' + fromDomain + '」は' + claims.filter(function (b) { return b.domains.some(function (d) { return sameOrSub(fromDomain, d); }); }).map(function (b) { return b.brand; }).join('・') + 'の公式ドメインです');
    } else if (!anyOfficial) {
      var la2 = lookalike(fromDomain, allOfficial);
      if (la2) { danger++; add('danger', '公式ドメイン（' + la2.domain + '）に似せたドメインです：' + la2.reason); }
    }

    // 2b) 登録した取引先
    var partners = (input.partners || []).filter(function (p) { return p && p.domains && p.domains.length; });
    var partnerHit = null, partnerSpoof = false;
    partners.forEach(function (p) {
      var doms = p.domains.map(lc);
      if (doms.some(function (d) { return sameOrSub(fromDomain, d); })) { partnerHit = p; return; }
    });
    if (partnerHit) {
      if (authFail) add('danger', '登録済みの取引先「' + partnerHit.name + '」のドメインを名乗っていますが、認証に失敗しています');
      else add('ok', '登録済みの取引先「' + partnerHit.name + '」のドメインからのメールです');
    } else if (partners.length && fromDomain) {
      var nameText = lc(fromName + ' ' + subject);
      partners.forEach(function (p) {
        if (partnerSpoof) return;
        var la3 = lookalike(fromDomain, p.domains.map(lc));
        if (la3) { partnerSpoof = true; danger++; add('danger', '取引先「' + p.name + '」のドメイン（' + la3.domain + '）に似せたドメインです：' + la3.reason); return; }
        var nm = lc(p.name);
        if (nm.length >= 2 && nameText.indexOf(nm) >= 0) {
          partnerSpoof = true; danger++;
          add('danger', '取引先「' + p.name + '」を名乗っていますが、登録済みのドメインではない「' + fromDomain + '」から送られています');
        }
      });
    }

    // 3) 返信先のずれ・変化
    var replyTo = extractEmail(getAll(headers, 'reply-to')[0] || '');
    var replyDomain = replyTo ? regDomain(domainOf(replyTo)) : '';
    var replyHist = (input.replyHistory || []).map(lc);
    // 返信先が受信者自身（To/Delivered-To）なら問題なし（「返信不可」の配信でよく使われる設定）
    var selfAddrs = [];
    ['to', 'delivered-to', 'x-original-to', 'cc'].forEach(function (k) {
      getAll(headers, k).forEach(function (v) { (v.match(/[A-Za-z0-9._%+\-=']+@[A-Za-z0-9.\-]+/g) || []).forEach(function (a) { selfAddrs.push(lc(a)); }); });
    });
    (input.myAddresses || []).forEach(function (a) { selfAddrs.push(lc(a)); });
    if (replyTo && selfAddrs.indexOf(lc(replyTo)) >= 0) {
      add('info', '返信先はあなた自身のアドレスになっています（返信しても送信元には届かない設定で、問題ありません）');
      replyDomain = '';
    }
    // 返信先が、差出人と同じ会社の別の公式ドメインなら問題なし（例：vpass.ne.jp → smbc-card.com）
    if (replyDomain && replyDomain !== regDomain(fromDomain)) {
      var sameCompany = D.MAILCHECK_BRANDS.some(function (b) {
        return b.domains.some(function (d) { return sameOrSub(fromDomain, d); }) && b.domains.some(function (d) { return sameOrSub(domainOf(replyTo), d); });
      }) || partners.some(function (p) {
        return p.domains.some(function (d) { return sameOrSub(fromDomain, d); }) && p.domains.some(function (d) { return sameOrSub(domainOf(replyTo), d); });
      }) || trustedDoms.some(function (t) { return sameOrSub(domainOf(replyTo), t); }) || trustedAddrs.indexOf(lc(replyTo)) >= 0;
      if (sameCompany) { add('info', '返信先（' + replyTo + '）は差出人と同じ会社の別の公式ドメインです'); replyDomain = ''; }
    }
    if (replyDomain && replyDomain !== regDomain(fromDomain)) {
      if (D.MAILCHECK_FREEMAIL.indexOf(replyDomain) >= 0 && (partnerHit || claims.length)) {
        danger++; add('danger', '返信先がフリーメール（' + replyTo + '）になっています。返信すると別人に届きます');
      } else if (replyHist.length && replyHist.indexOf(replyDomain) < 0) {
        danger++; add('danger', 'この差出人の返信先が、これまで（' + replyHist.join('、') + '）と違う「' + replyDomain + '」に変わっています');
      } else if (replyHist.indexOf(replyDomain) < 0) {
        caution++; add('caution', '返信先（' + replyTo + '）が差出人と別のドメインです');
      }
    }

    // 4) リンク
    var links = input.links || [], shortN = 0, mismatchN = 0, ipN = 0, punyN = 0, trackN = 0, examples = [];
    links.forEach(function (l) {
      var h = hostOf(l.href);
      if (!h || /^mailto:|^tel:/i.test(l.href)) return;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) { ipN++; examples.push(h); }
      if (h.indexOf('xn--') >= 0) { punyN++; examples.push(h); }
      if (D.MAILCHECK_SHORTENERS.some(function (s) { return sameOrSub(h, s); })) { shortN++; examples.push(h); }
      var shown = (l.text || '').trim().match(/^(https?:\/\/)?([a-z0-9\-]+\.)+[a-z]{2,}(\/\S*)?$/i);
      if (shown) {
        var sh = hostOf(/^https?:/i.test(l.text.trim()) ? l.text.trim() : 'https://' + l.text.trim());
        if (sh && regDomain(sh) !== regDomain(h)) {
          var isTracker = (D.MAILCHECK_TRACKERS || []).some(function (t) { return sameOrSub(h, t); }) || regDomain(h) === regDomain(fromDomain);
          if (isTracker && authOk) trackN++;
          else { mismatchN++; examples.push(sh + ' → ' + h); }
        }
      }
    });
    if (trackN) add('info', '配信サービスのクリック計測用リンクを経由するリンクが' + trackN + '件あります（正規のメルマガでよく使われます）');
    if (mismatchN && authOk && (officialHit || isTrusted || partnerHit || verified)) { caution++; add('caution', '表示されているURLと実際のリンク先が違うものが' + mismatchN + '件あります（送信元は正規のため、計測用リンクの可能性が高いです）'); }
    else if (mismatchN && authOk) { caution++; add('caution', '表示されているURLと実際のリンク先が違うものが' + mismatchN + '件あります（配信サービスの計測用リンクの可能性もあります）'); }
    else if (mismatchN) { danger++; add('danger', '表示されているURLと実際のリンク先が違うものが' + mismatchN + '件あります'); }
    if (ipN) { danger++; add('danger', 'IPアドレスに直接つながるリンクが' + ipN + '件あります'); }
    if (punyN) { caution++; add('caution', '見た目が似た文字を使える国際化ドメインへのリンクが' + punyN + '件あります'); }
    if (shortN) { caution++; add('caution', '行き先が隠れる短縮URLが' + shortN + '件あります'); }
    if (examples.length) add('info', 'リンク例：' + examples.slice(0, 3).join(' / '));

    // 5) 文面
    var body = (input.bodyText || '') + ' ' + subject;
    var urg = D.MAILCHECK_URGENT.filter(function (w) { return body.indexOf(w) >= 0; });
    if (urg.length >= 2) {
      if (authOk && (officialHit || isTrusted || partnerHit || verified)) add('info', '「' + urg.slice(0, 3).join('」「') + '」などの表現がありますが、送信元は正規です（注意喚起の定型文によくあります）');
      else { caution++; add('caution', '急がせる・個人情報を求める表現があります：「' + urg.slice(0, 4).join('」「') + '」'); }
    }

    // 6) 振込先・支払先の変更（ビジネスメール詐欺の典型）
    var pay = D.MAILCHECK_PAYMENT.filter(function (w) { return body.indexOf(w) >= 0; });
    var payAlert = false;
    if (pay.length) {
      payAlert = true;
      if ((partnerHit || officialHit || isTrusted) && authOk && !(replyDomain && replyHist.length && replyHist.indexOf(replyDomain) < 0)) {
        caution++; add('caution', '振込先・支払先に関する連絡です（「' + pay.slice(0, 3).join('」「') + '」）。正規の送信元でも、電話など別の手段で必ず確認してください');
      } else {
        danger++; add('danger', '振込先・支払先の変更をうかがわせる内容です（「' + pay.slice(0, 3).join('」「') + '」）。メール記載の連絡先ではなく、以前から知っている電話番号で確認してください');
      }
    }

    // 7) 添付ファイル（v0.8）：名前と種類だけを見る。中身（ウイルスかどうか）は調べない
    var atts = attachmentsOf(input.raw || '').map(classifyAttachment);
    var attachAlert = false, attDanger = 0;
    if (atts.length) {
      var sure = authOk && (officialHit || isTrusted || partnerHit || verified) || selfSent;
      add('info', '添付ファイル：' + atts.slice(0, 5).map(function (a) { return a.name; }).join('、') + (atts.length > 5 ? ' ほか' + (atts.length - 5) + '件' : ''));
      var pwHint = /パスワード|ﾊﾟｽﾜｰﾄﾞ|解凍|暗号化|password/i.test(body);
      atts.forEach(function (a) {
        if (a.hidden) { attachAlert = true; danger++; attDanger++; add('danger', '添付「' + a.name + '」の名前に、文字の向きを変える特殊な文字が入っています。本当の拡張子を隠す手口です'); return; }
        if (a.doubleExt) { attachAlert = true; danger++; attDanger++; add('danger', '添付「' + a.name + '」は、書類に見せかけた名前です（本当の種類は「.' + a.ext + '」）'); return; }
        var msg = {
          exec: 'はプログラム（実行ファイル）です。開くとパソコンで勝手に動きます',
          html: 'はWebページ形式のファイルです。開くと偽のログイン画面が出る手口があります',
          image: 'はディスクイメージです。中にプログラムを隠して、ウイルス対策をすり抜ける手口があります',
          macro: 'はマクロ付きのOffice文書です。「コンテンツの有効化」を押すとウイルスが動く手口があります',
          oldoffice: 'は古い形式のOffice文書です。マクロが入っていることがあるので、「コンテンツの有効化」は押さないでください'
        }[a.kind];
        if (a.kind === 'archive') {
          if (pwHint) {
            attachAlert = true;
            if (sure) { caution++; add('caution', '添付「' + a.name + '」はパスワード付きの圧縮ファイルのようです。Gmailが中身を検査できないため、送り主に心当たりがあるか確認してから開いてください'); }
            else { danger++; attDanger++; add('danger', '添付「' + a.name + '」はパスワード付きの圧縮ファイルのようです。Gmailが中身を検査できず、ウイルス（Emotetなど）で使われた手口です'); }
          } else if (!sure) { caution++; add('caution', '添付「' + a.name + '」は圧縮ファイルです。中身が分からないので、心当たりがなければ開かないでください'); }
          return;
        }
        if (!msg) return;
        attachAlert = true;
        if (a.kind === 'oldoffice') { if (!sure) { caution++; add('caution', '添付「' + a.name + '」' + msg); } return; }
        if (sure && a.kind !== 'exec') { caution++; add('caution', '添付「' + a.name + '」' + msg + '。送信元は正規ですが、心当たりがなければ開かないでください'); }
        else { danger++; attDanger++; add('danger', '添付「' + a.name + '」' + msg); }
      });
      add('info', '添付ファイルは名前と種類だけを見ています。中身がウイルスかどうかは調べていません');
    }

    // 総合
    var level, title;
    if (danger > 0) { level = 'danger'; title = payAlert && !partnerSpoof && danger === 1 ? '危険：振込先の変更などを求める内容です' : attDanger > 0 && attDanger === danger ? '危険：添付ファイルに注意してください' : '危険：なりすましの可能性が高いメールです'; }
    else if (selfSent && caution === 0) { level = 'safe'; title = '自分のアカウントから送ったメールです'; }
    else if (authOk && (officialHit || isTrusted || partnerHit) && caution === 0) { level = 'safe'; title = partnerHit && !officialHit ? '登録済みの取引先から正規に送られています' : trustedAddrHit && !officialHit ? '信頼済みに登録したアドレスから正規に送られています' : '公式の可能性：高'; }
    else if (authOk && verified && caution === 0) { level = 'safe'; title = '公式の可能性：高（Gmailが確認済みの送信者）'; }
    else if (authOk && caution === 0) { level = 'safe'; title = '送信元は正規（差出人自体が信頼できる相手かは別途確認）'; }
    else if (payAlert) { level = 'caution'; title = '注意：振込先・支払先に関する連絡です（別の手段で確認を）'; }
    else if (attachAlert) { level = 'caution'; title = '注意：添付ファイルに気をつけてください'; }
    else if (caution > 0 || !auth) { level = 'caution'; title = '注意：判断材料が足りないか、気になる点があります'; }
    else { level = 'caution'; title = '注意'; }
    var isFree = D.MAILCHECK_FREEMAIL.indexOf(regDomain(fromDomain)) >= 0;
    var trustable = !attachAlert && ((softLookalike && danger === 1 && !payAlert && !partnerSpoof) || !!fromDomain && !isTrusted && !partnerHit && !payAlert && !selfSent &&
      (isFree ? authOk && !claims.length && level !== 'danger' : (level === 'caution' || level === 'safe' && brandUnlisted)));
    // フリーメールはドメインごと信頼すると全員が信頼済みになるので、アドレス単位で登録する
    var trustTarget = isFree ? fromEmail : fromDomain;
    return { level: level, title: title, reasons: reasons, fromEmail: fromEmail, fromDomain: fromDomain, auth: auth, trustable: trustable, trustTarget: trustTarget, replyDomain: replyDomain, authOk: authOk, attachments: atts };
  }

  var api = { analyze: analyze, attachmentsOf: attachmentsOf, classifyAttachment: classifyAttachment, parseHeaders: parseHeaders, parseAuth: parseAuth, regDomain: regDomain, lookalike: lookalike, decodeMime: decodeMime };
  if (typeof module !== 'undefined') module.exports = api; else root.MailCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
