var t = document.getElementById('t'), p = document.getElementById('p'), lk = document.getElementById('lk');
function domOk(s) { return /^[a-z0-9.\-]+\.[a-z]{2,}$/.test(s); }
chrome.storage.sync.get({ trusted: [], partners: [], lockLinks: true }, function (r) {
  lk.checked = r.lockLinks !== false;
  t.value = (r.trusted || []).join('\n');
  p.value = (r.partners || []).map(function (x) { return [x.name].concat(x.domains).join(','); }).join('\n');
});
document.getElementById('save').addEventListener('click', function () {
  var list = t.value.split(/\s+/).map(function (s) { return s.trim().toLowerCase().replace(/^@/, ''); }).filter(domOk);
  var partners = p.value.split(/\n/).map(function (line) {
    var a = line.split(/[,、，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (a.length < 2) return null;
    var doms = a.slice(1).map(function (s) { return s.toLowerCase().replace(/^.*@/, ''); }).filter(domOk);
    return doms.length ? { name: a[0], domains: doms } : null;
  }).filter(Boolean);
  chrome.storage.sync.set({ trusted: Array.from(new Set(list)), partners: partners, lockLinks: lk.checked }, function () {
    document.getElementById('msg').textContent = '保存しました（信頼済み' + list.length + '件・取引先' + partners.length + '社）';
    t.value = list.join('\n');
    p.value = partners.map(function (x) { return [x.name].concat(x.domains).join(','); }).join('\n');
  });
});
