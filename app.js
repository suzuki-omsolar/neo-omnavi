(function () {
'use strict';

/* ================= 復号 ================= */
var DATA = null;            // {cards, bukken, koumuten, products, directory}
var IDX = {};               // code/no → object の索引

function b64d(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

async function tryUnlock(password) {
  var enc = window.OM_ENC;
  var baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  var key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64d(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(enc.iv) }, key, b64d(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ================= ユーティリティ ================= */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function pillClass(status) {
  if (/未対応/.test(status)) return 'pill-open';
  if (/対応中/.test(status)) return 'pill-progress';
  if (/済/.test(status)) return 'pill-done';
  return 'pill-neutral';
}
function today() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
var toastTimer = null;
function toast(msg) {
  var t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
}

/* ================= 保留入力(localStorage) ================= */
function loadPending() {
  try { var p = JSON.parse(localStorage.getItem('neo_pending') || '{}'); return { cards: p.cards || [], details: p.details || [] }; }
  catch (e) { return { cards: [], details: [] }; }
}
function savePending(p) { localStorage.setItem('neo_pending', JSON.stringify(p)); }

/* ================= CSV ================= */
function csvField(v) {
  v = String(v == null ? '' : v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function downloadCsv(filename, header, rows) {
  var lines = [header.map(csvField).join(',')];
  rows.forEach(function (r) { lines.push(r.map(csvField).join(',')); });
  var blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ================= 共通描画部品 ================= */
function attrGrid(rows) {
  var wide = ['受付内容（詳細内容）', '原因考察', '今後の対策', '物件備考', '販管備考', '住所', '現場住所'];
  return '<dl class="attr-grid">' + rows.map(function (r) {
    var linked = linkifyRow(r[0], r[1]);
    return '<div class="attr-item' + (wide.indexOf(r[0]) >= 0 ? ' wide' : '') + '"><dt>' + esc(r[0]) + '</dt><dd>' + linked + '</dd></div>';
  }).join('') + '</dl>';
}
function linkifyRow(label, value) {
  if (value === '-' || !value) return esc(value);
  var code = String(value).split(' ')[0];
  if (label === '物件' && IDX.bukken[code]) return '<a class="link-bukken" href="#/bukken/' + esc(code) + '">' + esc(value) + '</a>';
  if ((label === '建築工務店' || label === '対応工務店' || label === '工務店') && IDX.koumuten[code]) {
    return '<a class="link-koumuten" href="#/koumuten/' + esc(code) + '">' + esc(value) + '</a>';
  }
  return esc(value);
}
function pageHeader(code, title, status, type) {
  return '<div class="page-header"><div class="page-header-main">' +
    (type ? '<span class="pill pill-neutral">' + esc(type) + '</span>' : '') +
    (code ? '<span class="page-header-code">' + esc(code) + '</span>' : '') +
    '<h1 class="page-header-title">' + esc(title) + '</h1>' +
    (status ? '<span class="pill ' + pillClass(status) + '">' + esc(status) + '</span>' : '') +
    '</div></div>';
}
function sectionHeading(title, extraHtml) {
  return '<div class="section-heading"><h2>' + esc(title) + '</h2>' + (extraHtml || '') + '</div>';
}
function fieldHtml(id, label, inner) {
  return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + inner + '</div>';
}

/* ================= 画面: ダッシュボード ================= */
function viewDashboard() {
  var counts = { '未対応': 0, '対応中': 0, '済': 0 };
  DATA.cards.forEach(function (c) { if (counts[c.status_raw] != null) counts[c.status_raw]++; });
  var recentB = DATA.bukken.slice().sort(function (a, b) { return (b.received_date || '').localeCompare(a.received_date || ''); }).slice(0, 10);
  var recentC = DATA.cards.slice().sort(function (a, b) { return (b.received_date || '').localeCompare(a.received_date || ''); }).slice(0, 10);

  var html = '<div class="stat-grid">' +
    stat('全アンサーカード', DATA.cards.length, 'accent', '#/cards') +
    stat('未対応', counts['未対応'], 'open') +
    stat('対応中', counts['対応中'], 'progress') +
    stat('解決済', counts['済'], 'done') +
    stat('登録物件数', DATA.bukken.length, '') + '</div>';

  html += sectionHeading('最近登録された物件', '<a class="btn btn-ghost" href="#/bukken">すべて見る →</a>');
  html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>物件</th><th>工務店</th><th>種別</th><th>受付日</th></tr></thead><tbody>' +
    recentB.map(function (b) {
      return '<tr class="clickable" data-href="#/bukken/' + esc(b.code) + '">' +
        '<td><a class="link-bukken" href="#/bukken/' + esc(b.code) + '">' + esc(b.name) + '</a></td>' +
        '<td>' + (b.koumuten_code && IDX.koumuten[b.koumuten_code] ? '<a class="link-koumuten" href="#/koumuten/' + esc(b.koumuten_code) + '">' + esc(b.koumuten_name) + '</a>' : esc(b.koumuten_name)) + '</td>' +
        '<td>' + esc(b.type) + '</td><td>' + esc(b.received_date) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  html += sectionHeading('最近更新されたアンサーカード', '<a class="btn btn-ghost" href="#/cards">すべて見る →</a>');
  html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>件名</th><th>対応工務店</th><th>状況</th><th>受付日</th></tr></thead><tbody>' +
    recentC.map(function (c) {
      return '<tr class="clickable" data-href="#/cards/' + esc(c.no) + '">' +
        '<td><a href="#/cards/' + esc(c.no) + '">' + esc(c.title) + '</a></td>' +
        '<td>' + (c.koumuten_code && IDX.koumuten[c.koumuten_code] ? '<a class="link-koumuten" href="#/koumuten/' + esc(c.koumuten_code) + '">' + esc(c.koumuten_name) + '</a>' : esc(c.koumuten_name)) + '</td>' +
        '<td><span class="pill ' + pillClass(c.status) + '">' + esc(c.status) + '</span></td>' +
        '<td>' + esc(c.received_date) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  return html;

  function stat(label, value, tone, href) {
    var inner = '<div class="stat-value' + (tone ? ' tone-' + tone : '') + '">' + esc(value) + '</div><div class="stat-label">' + esc(label) + '</div>';
    return '<div class="stat-card">' + (href ? '<a href="' + href + '" style="color:inherit;">' + inner + '</a>' : inner) + '</div>';
  }
}

/* ================= 画面: アンサーカード一覧 ================= */
var cardFilter = { status: '', from: '', to: '', bukken: '', koumuten: '', type: '' };
function viewCards() {
  var f = cardFilter;
  var html = '<div class="search-bar">' +
    fieldHtml('f-status', '状況',
      '<select id="f-status"><option value="">すべて</option><option' + sel(f.status, '未対応') + '>未対応</option><option' + sel(f.status, '対応中') + '>対応中</option><option value="済"' + (f.status === '済' ? ' selected' : '') + '>解決済</option></select>') +
    fieldHtml('f-from', '受付日(from)', '<input type="date" id="f-from" value="' + esc(f.from) + '">') +
    fieldHtml('f-to', '受付日(to)', '<input type="date" id="f-to" value="' + esc(f.to) + '">') +
    fieldHtml('f-bukken', '物件コード', '<input type="text" id="f-bukken" value="' + esc(f.bukken) + '">') +
    fieldHtml('f-koumuten', '工務店コード', '<input type="text" id="f-koumuten" value="' + esc(f.koumuten) + '">') +
    fieldHtml('f-type', '種別', '<input type="text" id="f-type" placeholder="OM/OMX/PA/AIR" value="' + esc(f.type) + '">') +
    '</div><div id="cardTable"></div>';
  setTimeout(function () {
    ['f-status', 'f-from', 'f-to', 'f-bukken', 'f-koumuten', 'f-type'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        cardFilter = {
          status: val('f-status'), from: val('f-from'), to: val('f-to'),
          bukken: val('f-bukken'), koumuten: val('f-koumuten'), type: val('f-type'),
        };
        renderCardTable();
      });
    });
    renderCardTable();
  }, 0);
  return html;

  function sel(cur, v) { return ' value="' + v + '"' + (cur === v ? ' selected' : ''); }
  function val(id) { return document.getElementById(id).value; }
}
function renderCardTable() {
  var f = cardFilter;
  var items = DATA.cards.filter(function (c) {
    if (f.status && c.status_raw !== f.status) return false;
    if (f.from && (c.received_date || '') < f.from) return false;
    if (f.to && (c.received_date || '') > f.to) return false;
    if (f.bukken && (c.bukken_code || '').indexOf(f.bukken) < 0) return false;
    if (f.koumuten && (c.koumuten_code || '').indexOf(f.koumuten) < 0) return false;
    if (f.type && c.type !== f.type) return false;
    return true;
  }).sort(function (a, b) { return (b.received_date || '').localeCompare(a.received_date || ''); });

  document.getElementById('cardTable').innerHTML =
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>番号</th><th>件名</th><th>物件</th><th>対応工務店</th><th>種別</th><th>状況</th><th>受付日</th></tr></thead><tbody>' +
    (items.length ? items.map(function (c) {
      return '<tr class="clickable" data-href="#/cards/' + esc(c.no) + '">' +
        '<td class="mono">' + esc(c.no) + '</td>' +
        '<td><a href="#/cards/' + esc(c.no) + '">' + esc(c.title) + '</a></td>' +
        '<td>' + (c.bukken_code ? '<a class="link-bukken" href="#/bukken/' + esc(c.bukken_code) + '">' + esc(c.bukken_name) + '</a>' : '') + '</td>' +
        '<td>' + (c.koumuten_code && IDX.koumuten[c.koumuten_code] ? '<a class="link-koumuten" href="#/koumuten/' + esc(c.koumuten_code) + '">' + esc(c.koumuten_name) + '</a>' : esc(c.koumuten_name)) + '</td>' +
        '<td>' + esc(c.type) + '</td>' +
        '<td><span class="pill ' + pillClass(c.status) + '">' + esc(c.status) + '</span></td>' +
        '<td>' + esc(c.received_date) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="text-muted">該当するアンサーカードがありません。</td></tr>') +
    '</tbody></table></div><p class="text-muted" style="margin-top:8px;">' + items.length + '件</p>';
}

/* ================= 画面: アンサーカード詳細 ================= */
function viewCardDetail(no) {
  var c = IDX.cards[no];
  if (!c) return '<div class="empty">アンサーカードが見つかりません。</div>';
  var html = pageHeader(c.no, c.title, c.status, null);
  html += '<div class="card"><div class="card-header">詳細情報</div><div class="card-body">' + attrGrid(c.rows) + '</div></div>';
  html += sectionHeading('対応履歴');
  if (c.details.length) {
    html += '<div class="timeline">' + c.details.map(function (d) {
      return '<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-card">' +
        '<div class="timeline-head"><span>対応履歴' + esc(d.seq) + '　<span class="timeline-meta">' + esc(d.date) + '・' + esc(d.type) + '・' + esc(d.by) + '</span></span></div>' +
        '<div class="timeline-body">' + esc(d.text) + '</div></div></div>';
    }).join('') + '</div>';
  } else {
    html += '<p class="text-muted">記録はまだありません。</p>';
  }
  if (c.sales.length) {
    html += sectionHeading('売上部材');
    html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>売上日</th><th>商品</th><th>数量</th><th>金額</th><th>区分</th></tr></thead><tbody>' +
      c.sales.map(function (s) {
        return '<tr><td>' + esc(s.date) + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.qty) + '</td><td>' + esc(s.amount) + '</td><td>' + esc(s.category) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  return html;
}

/* ================= 画面: 物件 ================= */
var bukkenFilter = { name: '', pref: '', koumuten: '', type: '' };
function viewBukken() {
  var f = bukkenFilter;
  var html = '<div class="search-bar">' +
    fieldHtml('f-name', '物件名', '<input type="text" id="f-name" value="' + esc(f.name) + '">') +
    fieldHtml('f-pref', '都道府県', '<input type="text" id="f-pref" value="' + esc(f.pref) + '">') +
    fieldHtml('f-koumuten', '工務店コード', '<input type="text" id="f-koumuten" value="' + esc(f.koumuten) + '">') +
    fieldHtml('f-type', '種別', '<input type="text" id="f-type" placeholder="OM/OMX/PA/AIR" value="' + esc(f.type) + '">') +
    '</div><div id="bukkenTable"></div>';
  setTimeout(function () {
    ['f-name', 'f-pref', 'f-koumuten', 'f-type'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        bukkenFilter = {
          name: document.getElementById('f-name').value, pref: document.getElementById('f-pref').value,
          koumuten: document.getElementById('f-koumuten').value, type: document.getElementById('f-type').value,
        };
        renderBukkenTable();
      });
    });
    renderBukkenTable();
  }, 0);
  return html;
}
function renderBukkenTable() {
  var f = bukkenFilter;
  var items = DATA.bukken.filter(function (b) {
    if (f.name && b.name.indexOf(f.name) < 0) return false;
    if (f.pref && (b.prefecture || '').indexOf(f.pref) < 0) return false;
    if (f.koumuten && (b.koumuten_code || '').indexOf(f.koumuten) < 0) return false;
    if (f.type && b.type !== f.type) return false;
    return true;
  });
  document.getElementById('bukkenTable').innerHTML =
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>物件コード</th><th>物件名</th><th>種別</th><th>都道府県</th><th>工務店</th></tr></thead><tbody>' +
    (items.length ? items.map(function (b) {
      return '<tr class="clickable" data-href="#/bukken/' + esc(b.code) + '">' +
        '<td class="mono">' + esc(b.code) + '</td>' +
        '<td><a class="link-bukken" href="#/bukken/' + esc(b.code) + '">' + esc(b.name) + '</a></td>' +
        '<td>' + esc(b.type) + '</td><td>' + esc(b.prefecture) + '</td>' +
        '<td>' + (b.koumuten_code && IDX.koumuten[b.koumuten_code] ? '<a class="link-koumuten" href="#/koumuten/' + esc(b.koumuten_code) + '">' + esc(b.koumuten_name) + '</a>' : esc(b.koumuten_name)) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="text-muted">該当する物件がありません。</td></tr>') +
    '</tbody></table></div><p class="text-muted" style="margin-top:8px;">' + items.length + '件</p>';
}
function viewBukkenDetail(code) {
  var b = IDX.bukken[code];
  if (!b) return '<div class="empty">物件が見つかりません。</div>';
  var html = pageHeader(b.code, b.name, null, b.type);
  html += '<div class="card"><div class="card-header">物件情報</div><div class="card-body">' + attrGrid(b.info_rows) + '</div></div>';
  html += '<div class="card"><div class="card-header">施主情報</div><div class="card-body">' + attrGrid(b.owner_rows) + '</div></div>';
  html += '<div class="card"><div class="card-header">その他</div><div class="card-body">' + attrGrid(b.other_rows) + '</div></div>';
  if (b.related_cards.length) {
    html += sectionHeading('関連アンサーカード');
    html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>番号</th><th>件名</th><th>状況</th><th>受付日</th></tr></thead><tbody>' +
      b.related_cards.map(function (c) {
        return '<tr class="clickable" data-href="#/cards/' + esc(c.no) + '">' +
          '<td class="mono">' + esc(c.no) + '</td>' +
          '<td><a href="#/cards/' + esc(c.no) + '">' + esc(c.title) + '</a></td>' +
          '<td><span class="pill ' + pillClass(c.status) + '">' + esc(c.status) + '</span></td>' +
          '<td>' + esc(c.received_date) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  return html;
}

/* ================= 画面: 工務店 ================= */
var koumutenFilter = { name: '', pref: '', membership: '' };
function viewKoumuten() {
  var f = koumutenFilter;
  var html = '<div class="search-bar">' +
    fieldHtml('f-name', '工務店名', '<input type="text" id="f-name" value="' + esc(f.name) + '">') +
    fieldHtml('f-pref', '都道府県', '<input type="text" id="f-pref" value="' + esc(f.pref) + '">') +
    fieldHtml('f-mem', '在会状況',
      '<select id="f-mem"><option value="">すべて</option><option value="在会"' + (f.membership === '在会' ? ' selected' : '') + '>在会</option><option value="退会"' + (f.membership === '退会' ? ' selected' : '') + '>退会</option></select>') +
    '</div><div id="koumutenTable"></div>';
  setTimeout(function () {
    ['f-name', 'f-pref', 'f-mem'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        koumutenFilter = {
          name: document.getElementById('f-name').value, pref: document.getElementById('f-pref').value,
          membership: document.getElementById('f-mem').value,
        };
        renderKoumutenTable();
      });
    });
    renderKoumutenTable();
  }, 0);
  return html;
}
function renderKoumutenTable() {
  var f = koumutenFilter;
  var items = DATA.koumuten.filter(function (k) {
    if (f.name && k.name.indexOf(f.name) < 0) return false;
    if (f.pref && (k.prefecture || '').indexOf(f.pref) < 0) return false;
    if (f.membership && k.membership !== f.membership) return false;
    return true;
  });
  document.getElementById('koumutenTable').innerHTML =
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>工務店コード</th><th>工務店名</th><th>在会状況</th><th>都道府県</th><th>区分</th></tr></thead><tbody>' +
    (items.length ? items.map(function (k) {
      return '<tr class="clickable" data-href="#/koumuten/' + esc(k.code) + '">' +
        '<td class="mono">' + esc(k.code) + '</td>' +
        '<td><a class="link-koumuten" href="#/koumuten/' + esc(k.code) + '">' + esc(k.name) + '</a></td>' +
        '<td><span class="pill ' + (k.is_withdrawn ? 'pill-open' : 'pill-done') + '">' + esc(k.membership) + '</span></td>' +
        '<td>' + esc(k.prefecture) + '</td><td>' + esc(k.member_class) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="text-muted">該当する工務店がありません。</td></tr>') +
    '</tbody></table></div><p class="text-muted" style="margin-top:8px;">' + items.length + '件</p>';
}
function viewKoumutenDetail(code) {
  var k = IDX.koumuten[code];
  if (!k) return '<div class="empty">工務店が見つかりません。（名簿のみの工務店は<a href="https://suzuki-omsolar.github.io/om-navi-koumuten/" target="_blank" rel="noopener">工務店コード検索</a>を参照）</div>';
  var html = pageHeader(k.code, k.name, k.membership, null);
  html += '<div class="card"><div class="card-header">基本情報</div><div class="card-body">' + attrGrid(k.basic_rows) + '</div></div>';
  html += '<div class="card"><div class="card-header">与信情報</div><div class="card-body">' + attrGrid(k.credit_rows) + '</div></div>';
  html += sectionHeading('工務店社員情報');
  html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>名前</th><th>ヨミ</th><th>職種</th><th>携帯番号</th><th>メールアドレス</th><th>備考</th></tr></thead><tbody>' +
    (k.staff.length ? k.staff.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.kana) + '</td><td>' + esc(s.role) + '</td><td>' + esc(s.tel) + '</td><td>' + esc(s.email) + '</td><td>' + esc(s.notes) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="text-muted">登録された社員はいません。</td></tr>') +
    '</tbody></table></div>';
  return html;
}

/* ================= 画面: 商品 ================= */
var productFilter = { name: '', status: '' };
function viewProducts() {
  var f = productFilter;
  var html = '<div class="search-bar">' +
    fieldHtml('f-name', '商品名', '<input type="text" id="f-name" value="' + esc(f.name) + '">') +
    fieldHtml('f-status', '状態',
      '<select id="f-status"><option value="">すべて</option>' +
      ['取扱品(通常)', '取扱品(準)', '終了品'].map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
      '</select>') +
    '</div><div id="productTable"></div>';
  setTimeout(function () {
    ['f-name', 'f-status'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        productFilter = { name: document.getElementById('f-name').value, status: document.getElementById('f-status').value };
        renderProductTable();
      });
    });
    renderProductTable();
  }, 0);
  return html;
}
function renderProductTable() {
  var f = productFilter;
  var items = DATA.products.filter(function (p) {
    if (f.name && p.name.indexOf(f.name) < 0) return false;
    if (f.status && p.status !== f.status) return false;
    return true;
  });
  document.getElementById('productTable').innerHTML =
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>コード</th><th>商品名</th><th>規格</th><th>状態</th><th>標準単価</th></tr></thead><tbody>' +
    (items.length ? items.map(function (p) {
      return '<tr class="clickable" data-href="#/products/' + esc(p.code) + '">' +
        '<td class="mono">' + esc(p.code) + '</td>' +
        '<td><a href="#/products/' + esc(p.code) + '">' + esc(p.name) + '</a></td>' +
        '<td>' + esc(p.spec) + '</td>' +
        '<td><span class="pill ' + (p.is_discontinued ? 'pill-open' : 'pill-done') + '">' + esc(p.status) + '</span></td>' +
        '<td>' + (p.price ? '¥' + esc(p.price) : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="text-muted">該当する商品がありません。</td></tr>') +
    '</tbody></table></div><p class="text-muted" style="margin-top:8px;">' + items.length + '件</p>';
}
function viewProductDetail(code) {
  var p = IDX.products[code];
  if (!p) return '<div class="empty">商品が見つかりません。</div>';
  var html = pageHeader(p.code, p.name, p.status, null);
  html += '<div class="card"><div class="card-header">商品情報</div><div class="card-body">' + attrGrid(p.rows) + '</div></div>';
  return html;
}

/* ================= 画面: 今日の入力 ================= */
var CARD_CSV_HEADER = ['番号', '受付日', '件名', '受付区分', '受付種別', '受付分類', 'タイプ', '種別', '物件コード', '建築工務店コード', '対応工務店コード', '状況', '担当者', '連絡先TEL', '連絡先住所', '詳細内容', '原因考察', '今後の対策', '交換部材コード', '交換数量', '対応完了日'];
var DETAIL_CSV_HEADER = ['番号', '連番', '対応日', '対応区分', '対応者', '対応内容'];

function nextSeq(cardNo) {
  var max = 0;
  var c = IDX.cards[cardNo];
  if (c) c.details.forEach(function (d) { if (d.seq > max) max = d.seq; });
  loadPending().details.forEach(function (d) { if (d['番号'] === cardNo && d['連番'] > max) max = d['連番']; });
  return max + 1;
}

function viewInput() {
  var html = '<p class="text-muted" style="margin-bottom:14px;">ここで入力した内容はこのブラウザに保存されます。CSVでダウンロードしてRPA転記に使い、翌朝の実OMナビからのCSVで正式データとして取り込みます。</p>';

  /* --- 新規アンサーカード --- */
  html += '<div class="card"><div class="card-header">新規アンサーカード</div><div class="card-body">' +
    '<div class="form-grid">' +
    fieldHtml('c-title', '件名 *', '<input type="text" id="c-title" placeholder="症状などを簡潔に">') +
    fieldHtml('c-date', '受付日', '<input type="date" id="c-date" value="' + today() + '">') +
    fieldHtml('c-kubun', '受付区分', selectHtml('c-kubun', ['', '工務店から', 'ユーザーから', '業者から'])) +
    fieldHtml('c-cat', '受付種別', selectHtml('c-cat', ['', '故障連絡', 'クレーム', '質問', '要望', '見積依頼'])) +
    fieldHtml('c-class', '受付分類', '<input type="text" id="c-class" placeholder="ハンドリング 等">') +
    fieldHtml('c-type2', 'タイプ', '<input type="text" id="c-type2" placeholder="機器型番 等">') +
    fieldHtml('c-btype', '種別', selectHtml('c-btype', ['', 'OM', 'OMX', 'PA', 'AIR', '施設'])) +
    fieldHtml('c-status', '状況', selectHtml('c-status', ['未対応', '対応中', '済'])) +
    fieldHtml('c-bukken', '物件コード', '<input type="text" id="c-bukken" list="dl-bukken"><span class="suggest-note" id="c-bukken-name"></span>') +
    fieldHtml('c-build', '建築工務店コード', '<input type="text" id="c-build" list="dl-koumuten"><span class="suggest-note" id="c-build-name"></span>') +
    fieldHtml('c-support', '対応工務店コード', '<input type="text" id="c-support" list="dl-koumuten"><span class="suggest-note" id="c-support-name"></span>') +
    fieldHtml('c-staff', '担当者', '<input type="text" id="c-staff">') +
    fieldHtml('c-tel', '連絡先TEL', '<input type="text" id="c-tel" placeholder="000-0000-0000">') +
    fieldHtml('c-addr', '連絡先住所', '<input type="text" id="c-addr">') +
    '<div class="field wide"><label for="c-detail">詳細内容</label><textarea id="c-detail" rows="4"></textarea></div>' +
    '<div class="field wide"><label for="c-cause">原因考察</label><textarea id="c-cause" rows="2"></textarea></div>' +
    '<div class="field wide"><label for="c-action">今後の対策</label><textarea id="c-action" rows="2"></textarea></div>' +
    fieldHtml('c-product', '交換部材コード', '<input type="text" id="c-product" list="dl-product"><span class="suggest-note" id="c-product-name"></span>') +
    fieldHtml('c-qty', '交換数量', '<input type="number" id="c-qty" min="0" step="1">') +
    fieldHtml('c-done', '対応完了日', '<input type="date" id="c-done">') +
    '</div><div class="form-actions"><button class="btn btn-primary" id="addCardBtn">この内容を追加</button></div>' +
    '</div></div>';

  /* --- 対応履歴追記 --- */
  html += '<div class="card"><div class="card-header">既存アンサーへの対応履歴追記</div><div class="card-body">' +
    '<div class="form-grid">' +
    fieldHtml('d-no', 'アンサー番号 *', '<input type="text" id="d-no" list="dl-cards"><span class="suggest-note" id="d-no-name"></span>') +
    fieldHtml('d-date', '対応日', '<input type="date" id="d-date" value="' + today() + '">') +
    fieldHtml('d-type', '対応区分', selectHtml('d-type', ['電話対応', '現地調査', '部品交換', 'メール対応', '見積・請求書発行', '部品発注', 'その他'])) +
    fieldHtml('d-by', '対応者', '<input type="text" id="d-by">') +
    '<div class="field wide"><label for="d-text">対応内容 *</label><textarea id="d-text" rows="3"></textarea></div>' +
    '</div><div class="form-actions"><button class="btn btn-primary" id="addDetailBtn">この内容を追加</button></div>' +
    '</div></div>';

  /* --- 保留リスト --- */
  html += '<div id="pendingArea"></div>';

  /* datalist */
  html += '<datalist id="dl-bukken">' + DATA.bukken.map(function (b) { return '<option value="' + esc(b.code) + '">' + esc(b.name) + '</option>'; }).join('') + '</datalist>';
  html += '<datalist id="dl-koumuten">' + DATA.directory.map(function (d) { return '<option value="' + esc(d.c) + '">' + esc(d.n) + '</option>'; }).join('') + '</datalist>';
  html += '<datalist id="dl-product">' + DATA.products.map(function (p) { return '<option value="' + esc(p.code) + '">' + esc(p.name) + '</option>'; }).join('') + '</datalist>';
  html += '<datalist id="dl-cards">' + DATA.cards.map(function (c) { return '<option value="' + esc(c.no) + '">' + esc(c.title) + '</option>'; }).join('') + '</datalist>';

  setTimeout(bindInputView, 0);
  return html;

  function selectHtml(id, options) {
    return '<select id="' + id + '">' + options.map(function (o) { return '<option value="' + esc(o) + '">' + (o === '' ? '（未選択）' : esc(o)) + '</option>'; }).join('') + '</select>';
  }
}

function bindInputView() {
  function v(id) { return (document.getElementById(id).value || '').trim(); }
  function nameHint(inputId, hintId, lookup) {
    var el = document.getElementById(inputId);
    el.addEventListener('input', function () {
      var hit = lookup(el.value.trim());
      document.getElementById(hintId).textContent = hit ? '→ ' + hit : '';
    });
  }
  var dirIdx = {};
  DATA.directory.forEach(function (d) { dirIdx[d.c] = d.n; });
  nameHint('c-bukken', 'c-bukken-name', function (x) { return IDX.bukken[x] ? IDX.bukken[x].name : ''; });
  nameHint('c-build', 'c-build-name', function (x) { return dirIdx[x] || ''; });
  nameHint('c-support', 'c-support-name', function (x) { return dirIdx[x] || ''; });
  nameHint('c-product', 'c-product-name', function (x) { return IDX.products[x] ? IDX.products[x].name : ''; });
  nameHint('d-no', 'd-no-name', function (x) { return IDX.cards[x] ? IDX.cards[x].title : ''; });

  document.getElementById('addCardBtn').addEventListener('click', function () {
    if (!v('c-title')) { toast('件名を入力してください'); return; }
    var p = loadPending();
    p.cards.push({
      '番号': '', '受付日': v('c-date'), '件名': v('c-title'), '受付区分': v('c-kubun'),
      '受付種別': v('c-cat'), '受付分類': v('c-class'), 'タイプ': v('c-type2'), '種別': v('c-btype'),
      '物件コード': v('c-bukken'), '建築工務店コード': v('c-build'), '対応工務店コード': v('c-support'),
      '状況': v('c-status'), '担当者': v('c-staff'), '連絡先TEL': v('c-tel'), '連絡先住所': v('c-addr'),
      '詳細内容': v('c-detail'), '原因考察': v('c-cause'), '今後の対策': v('c-action'),
      '交換部材コード': v('c-product'), '交換数量': v('c-qty'), '対応完了日': v('c-done'),
      '_at': new Date().toLocaleString('ja-JP'),
    });
    savePending(p);
    ['c-title', 'c-class', 'c-type2', 'c-bukken', 'c-build', 'c-support', 'c-staff', 'c-tel', 'c-addr', 'c-detail', 'c-cause', 'c-action', 'c-product', 'c-qty', 'c-done'].forEach(function (id) { document.getElementById(id).value = ''; });
    renderPending();
    toast('新規アンサーカードを追加しました');
  });

  document.getElementById('addDetailBtn').addEventListener('click', function () {
    var no = v('d-no');
    if (!no) { toast('アンサー番号を入力してください'); return; }
    if (!v('d-text')) { toast('対応内容を入力してください'); return; }
    var p = loadPending();
    p.details.push({
      '番号': no, '連番': nextSeq(no), '対応日': v('d-date'), '対応区分': v('d-type'),
      '対応者': v('d-by'), '対応内容': v('d-text'), '_at': new Date().toLocaleString('ja-JP'),
    });
    savePending(p);
    document.getElementById('d-text').value = '';
    renderPending();
    toast('対応履歴を追加しました');
  });

  renderPending();
}

function renderPending() {
  var area = document.getElementById('pendingArea');
  if (!area) return;
  var p = loadPending();
  var html = sectionHeading('未転記の入力', '<span class="badge-count">' + (p.cards.length + p.details.length) + '件</span>');

  if (!p.cards.length && !p.details.length) {
    html += '<div class="empty">未転記の入力はありません。</div>';
    area.innerHTML = html;
    return;
  }
  if (p.cards.length) {
    html += '<div class="table-wrap" style="margin-bottom:12px;"><table class="data-table"><thead><tr><th>入力日時</th><th>件名</th><th>物件</th><th>状況</th><th></th></tr></thead><tbody>' +
      p.cards.map(function (c, i) {
        return '<tr><td class="mono">' + esc(c['_at']) + '</td><td>' + esc(c['件名']) + '</td><td>' + esc(c['物件コード']) + '</td><td>' + esc(c['状況']) + '</td>' +
          '<td><button class="btn btn-ghost" data-del-card="' + i + '">削除</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  if (p.details.length) {
    html += '<div class="table-wrap" style="margin-bottom:12px;"><table class="data-table"><thead><tr><th>入力日時</th><th>番号</th><th>連番</th><th>対応区分</th><th>対応内容</th><th></th></tr></thead><tbody>' +
      p.details.map(function (d, i) {
        var text = d['対応内容'].length > 30 ? d['対応内容'].slice(0, 30) + '…' : d['対応内容'];
        return '<tr><td class="mono">' + esc(d['_at']) + '</td><td class="mono">' + esc(d['番号']) + '</td><td>' + esc(d['連番']) + '</td><td>' + esc(d['対応区分']) + '</td><td>' + esc(text) + '</td>' +
          '<td><button class="btn btn-ghost" data-del-detail="' + i + '">削除</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  html += '<div class="form-actions">' +
    (p.cards.length ? '<button class="btn btn-secondary" id="expCardsBtn">📥 新規アンサーカードCSV</button>' : '') +
    (p.details.length ? '<button class="btn btn-secondary" id="expDetailsBtn">📥 対応履歴CSV</button>' : '') +
    '<button class="btn btn-danger" id="clearPendingBtn">転記済みとしてクリア</button></div>';
  area.innerHTML = html;

  area.querySelectorAll('[data-del-card]').forEach(function (b) {
    b.addEventListener('click', function () {
      var q = loadPending(); q.cards.splice(+b.dataset.delCard, 1); savePending(q); renderPending();
    });
  });
  area.querySelectorAll('[data-del-detail]').forEach(function (b) {
    b.addEventListener('click', function () {
      var q = loadPending(); q.details.splice(+b.dataset.delDetail, 1); savePending(q); renderPending();
    });
  });
  var d8 = today().replace(/-/g, '');
  var expC = document.getElementById('expCardsBtn');
  if (expC) expC.addEventListener('click', function () {
    var q = loadPending();
    downloadCsv('新規アンサーカード_' + d8 + '.csv', CARD_CSV_HEADER, q.cards.map(function (c) {
      return CARD_CSV_HEADER.map(function (h) { return c[h] || ''; });
    }));
    toast('CSVをダウンロードしました');
  });
  var expD = document.getElementById('expDetailsBtn');
  if (expD) expD.addEventListener('click', function () {
    var q = loadPending();
    downloadCsv('対応履歴追記_' + d8 + '.csv', DETAIL_CSV_HEADER, q.details.map(function (d) {
      return DETAIL_CSV_HEADER.map(function (h) { return d[h] != null ? d[h] : ''; });
    }));
    toast('CSVをダウンロードしました');
  });
  document.getElementById('clearPendingBtn').addEventListener('click', function () {
    if (!confirm('未転記の入力をすべてクリアします。CSVはダウンロード済みですか？')) return;
    savePending({ cards: [], details: [] });
    renderPending();
  });
}

/* ================= 画面: 工務店コード検索 =================
   om-navi-koumuten/index.html の検索ロジックを移植。
   データは復号済みの DATA.directory を使うので追加ログイン不要。 */
var KS = { list: null, byCode: {} };
var KS_NOISE_RE = /[\s　()（）株有限会社合同名事業協同組合・･.,、。／/\-ー–—~〜「」『』【】\[\]]+/g;
function ksKataToHira(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    out += (c >= 0x30A1 && c <= 0x30F6) ? String.fromCharCode(c - 0x60) : s[i];
  }
  return out;
}
function ksNormalize(text) {
  if (!text) return '';
  return ksKataToHira(text.normalize('NFKC').toLowerCase()).replace(KS_NOISE_RE, '');
}
function ksBigrams(s) {
  if (s.length < 2) return s ? [s] : [];
  var set = {}, out = [];
  for (var i = 0; i < s.length - 1; i++) { var g = s.substr(i, 2); if (!set[g]) { set[g] = 1; out.push(g); } }
  return out;
}
function ksSimilarity(a, b) {
  if (!a || !b) return 0;
  var A = ksBigrams(a), B = ksBigrams(b);
  if (!A.length || !B.length) return 0;
  var setB = {}; B.forEach(function (g) { setB[g] = 1; });
  var inter = 0; A.forEach(function (g) { if (setB[g]) inter++; });
  return 2 * inter / (A.length + B.length);
}
/* お気に入り・利用履歴は独立ページ版と同じ保存場所(omk_*)を使い、引き継ぎ可能にする */
function ksLoadFavs() { try { return JSON.parse(localStorage.getItem('omk_favs') || '[]'); } catch (e) { return []; } }
function ksSaveFavs(a) { localStorage.setItem('omk_favs', JSON.stringify(a)); }
function ksLoadUsage() { try { return JSON.parse(localStorage.getItem('omk_usage') || '{}'); } catch (e) { return {}; } }
function ksSaveUsage(o) { localStorage.setItem('omk_usage', JSON.stringify(o)); }

var KS_SUBSTRING_LIMIT = 60, KS_RESULT_LIMIT = 40, KS_SIM_FALLBACK = 8, KS_SIM_MIN = 0.3;
function ksScore(e, qn, favSet, usage) {
  var s = 0;
  if (favSet[e.c]) s += 1000;
  s += Math.min(usage[e.c] || 0, 50) * 5;
  var nn = ksNormalize(e.n), kn = ksNormalize(e.k);
  if (nn === qn) s += 500;
  else if (nn.indexOf(qn) === 0) s += 200;
  else if (kn.indexOf(qn) === 0) s += 120;
  if (nn) s += 30 * (qn.length / Math.max(nn.length, 1));
  if (e.w) s -= 40;
  return s;
}
function ksSearch(query) {
  var qn = ksNormalize(query);
  var favSet = {}; ksLoadFavs().forEach(function (c) { favSet[c] = 1; });
  var usage = ksLoadUsage();
  if (!qn) return { mode: 'landing', favSet: favSet, usage: usage };
  var scored = [], seen = {};
  for (var i = 0; i < KS.list.length && scored.length < KS_SUBSTRING_LIMIT; i++) {
    var e = KS.list[i];
    if (e.norm.indexOf(qn) !== -1) { scored.push([ksScore(e, qn, favSet, usage), e]); seen[e.c] = 1; }
  }
  if (scored.length < KS_SIM_FALLBACK && qn.length >= 2) {
    for (var j = 0; j < KS.list.length; j++) {
      var t = KS.list[j];
      if (seen[t.c]) continue;
      var sim = ksSimilarity(qn, ksNormalize(t.n));
      if (sim < KS_SIM_MIN) sim = Math.max(sim, ksSimilarity(qn, ksNormalize(t.k)));
      if (sim >= KS_SIM_MIN) scored.push([sim * 100 - 300, t]);
    }
  }
  scored.sort(function (a, b) { return b[0] - a[0]; });
  return { mode: 'search', items: scored.slice(0, KS_RESULT_LIMIT).map(function (x) { return x[1]; }), favSet: favSet, usage: usage };
}
function ksItemHtml(e, favSet, usage) {
  var use = usage[e.c] || 0;
  return '<div class="ks-item' + (e.w ? ' is-withdrawn' : '') + '">' +
    '<button type="button" class="ks-fav-btn' + (favSet[e.c] ? ' is-favorite' : '') + '" data-code="' + esc(e.c) + '" title="お気に入り">' + (favSet[e.c] ? '&#9733;' : '&#9734;') + '</button>' +
    '<button type="button" class="ks-code-btn" data-code="' + esc(e.c) + '" title="クリックでコードをコピー">' + esc(e.c) + '</button>' +
    '<div class="ks-item-main">' +
      '<span class="ks-item-name">' + esc(e.n) + '</span>' +
      '<span class="ks-item-meta">' + (e.p ? esc(e.p) : '') +
        (e.w ? '<span class="badge-withdrawn">退会</span>' : '') +
        (use ? '<span class="badge-use">利用' + use + '回</span>' : '') +
      '</span>' +
    '</div></div>';
}
function ksListHtml(items, favSet, usage) {
  return '<div class="ks-list">' + items.map(function (e) { return ksItemHtml(e, favSet, usage); }).join('') + '</div>';
}
function ksRenderResults() {
  var el = document.getElementById('ksResults');
  var q = document.getElementById('ksQuery');
  if (!el || !q) return;
  var r = ksSearch(q.value);
  var html = '';
  if (r.mode === 'landing') {
    var favs = ksLoadFavs().map(function (c) { return KS.byCode[c]; }).filter(Boolean).slice(0, 10);
    var usagePairs = Object.keys(r.usage).map(function (c) { return [r.usage[c], KS.byCode[c]]; })
      .filter(function (x) { return x[1] && !r.favSet[x[1].c]; });
    usagePairs.sort(function (a, b) { return b[0] - a[0]; });
    var freq = usagePairs.slice(0, 10).map(function (x) { return x[1]; });
    html += '<div class="ks-section"><div class="ks-section-title">&#9733; お気に入り <span class="ks-section-count">' + favs.length + '件</span></div>' +
      (favs.length ? ksListHtml(favs, r.favSet, r.usage) : '<div class="empty">お気に入りはまだありません。検索結果の★を押すと登録できます。</div>') + '</div>';
    html += '<div class="ks-section"><div class="ks-section-title">&#128337; よく使う工務店 <span class="ks-section-count">' + freq.length + '件</span></div>' +
      (freq.length ? ksListHtml(freq, r.favSet, r.usage) : '<div class="empty">まだ利用履歴がありません。コードをコピーするとここに並びます。</div>') + '</div>';
  } else {
    html += '<div class="ks-section"><div class="ks-section-title">検索結果 <span class="ks-section-count">' + r.items.length + '件</span></div>' +
      (r.items.length ? ksListHtml(r.items, r.favSet, r.usage) : '<div class="empty">一致する工務店が見つかりませんでした。</div>') + '</div>';
  }
  el.innerHTML = html;
}
function viewKoumutenSearch() {
  if (!KS.list) {
    KS.list = DATA.directory.map(function (e) {
      var o = { c: e.c, n: e.n, k: e.k, p: e.p, w: e.w };
      o.norm = ksNormalize(o.n) + ksNormalize(o.k);
      return o;
    });
    KS.list.forEach(function (e) { KS.byCode[e.c] = e; });
  }
  setTimeout(function () {
    var q = document.getElementById('ksQuery');
    if (!q) return;
    var debounce = null;
    q.addEventListener('input', function () { clearTimeout(debounce); debounce = setTimeout(ksRenderResults, 150); });
    q.focus();
    ksRenderResults();
  }, 0);
  return '<div class="ks-searchbox-wrap">' +
    '<span class="ks-searchbox-icon">&#128269;</span>' +
    '<input type="text" class="ks-searchbox" id="ksQuery" autocomplete="off" placeholder="工務店名を入力（漢字・ひらがな・カタカナ・一部でOK）">' +
    '<p class="ks-hint">一文字からあいまい検索できます。数字のコードをクリックするとコードだけをコピーします。</p>' +
    '</div><div id="ksResults"></div>';
}
function ksCopyText(t) {
  return navigator.clipboard.writeText(t).catch(function () {
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.remove();
  });
}
document.addEventListener('click', function (ev) {
  var codeBtn = ev.target.closest('.ks-code-btn');
  if (codeBtn) {
    var code = codeBtn.dataset.code;
    ksCopyText(code);
    var usage = ksLoadUsage(); usage[code] = (usage[code] || 0) + 1; ksSaveUsage(usage);
    var orig = codeBtn.textContent;
    codeBtn.classList.add('copied'); codeBtn.textContent = 'コピー✓';
    setTimeout(function () { codeBtn.classList.remove('copied'); codeBtn.textContent = orig; }, 1200);
    return;
  }
  var favBtn = ev.target.closest('.ks-fav-btn');
  if (favBtn) {
    var c = favBtn.dataset.code, favs = ksLoadFavs(), i = favs.indexOf(c);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(c);
    ksSaveFavs(favs);
    ksRenderResults();
  }
});

/* ================= 画面: 商品検索 =================
   工務店コード検索と同じ仕組み。データは DATA.product_list ({c,n,s,v,st,u,pr}) を使う。 */
var PS = { list: null, byCode: {} };
function psLoadFavs() { try { return JSON.parse(localStorage.getItem('omp_favs') || '[]'); } catch (e) { return []; } }
function psSaveFavs(a) { localStorage.setItem('omp_favs', JSON.stringify(a)); }
function psLoadUsage() { try { return JSON.parse(localStorage.getItem('omp_usage') || '{}'); } catch (e) { return {}; } }
function psSaveUsage(o) { localStorage.setItem('omp_usage', JSON.stringify(o)); }

function psScore(e, qn, favSet, usage) {
  var s = 0;
  if (favSet[e.c]) s += 1000;
  s += Math.min(usage[e.c] || 0, 50) * 5;
  if (e.c === qn) s += 600;
  else if (e.c.indexOf(qn) === 0) s += 250;
  var nn = e.nn;
  if (nn === qn) s += 500;
  else if (nn.indexOf(qn) === 0) s += 200;
  if (nn) s += 30 * (qn.length / Math.max(nn.length, 1));
  if (e.st && e.st.indexOf('終了') !== -1) s -= 40;
  return s;
}
function psSearch(query) {
  var qn = ksNormalize(query);
  var favSet = {}; psLoadFavs().forEach(function (c) { favSet[c] = 1; });
  var usage = psLoadUsage();
  if (!qn) return { mode: 'landing', favSet: favSet, usage: usage };
  var scored = [], seen = {};
  for (var i = 0; i < PS.list.length && scored.length < 200; i++) {
    var e = PS.list[i];
    if (e.norm.indexOf(qn) !== -1) { scored.push([psScore(e, qn, favSet, usage), e]); seen[e.c] = 1; }
  }
  if (scored.length < KS_SIM_FALLBACK && qn.length >= 2) {
    for (var j = 0; j < PS.list.length; j++) {
      var t = PS.list[j];
      if (seen[t.c]) continue;
      var sim = ksSimilarity(qn, t.nn);
      if (sim >= KS_SIM_MIN) scored.push([sim * 100 - 300, t]);
    }
  }
  scored.sort(function (a, b) { return b[0] - a[0]; });
  return { mode: 'search', items: scored.slice(0, 50).map(function (x) { return x[1]; }), favSet: favSet, usage: usage };
}
function psItemHtml(e, favSet, usage) {
  var use = usage[e.c] || 0;
  var ended = e.st && e.st.indexOf('終了') !== -1;
  return '<div class="ps-item' + (ended ? ' is-ended' : '') + '">' +
    '<button type="button" class="ps-fav-btn' + (favSet[e.c] ? ' is-favorite' : '') + '" data-code="' + esc(e.c) + '" title="お気に入り">' + (favSet[e.c] ? '&#9733;' : '&#9734;') + '</button>' +
    '<button type="button" class="ps-code-btn" data-code="' + esc(e.c) + '" title="クリックでコードをコピー">' + esc(e.c) + '</button>' +
    '<span class="ps-name">' + esc(e.n) + '</span>' +
    '<span class="ps-spec">' + esc(e.s) + '</span>' +
    '<span class="ps-vendor">' + esc(e.v) + '</span>' +
    '<span class="ps-price">' + (e.pr && e.pr !== '0' ? '¥' + Number(e.pr).toLocaleString() + (e.u ? '/' + esc(e.u) : '') : '') + '</span>' +
    '<span class="ps-badges">' +
      (ended ? '<span class="badge-withdrawn">終了品</span>' : (e.st ? '<span class="badge-use">' + esc(e.st) + '</span>' : '')) +
      (use ? '<span class="badge-use">利用' + use + '回</span>' : '') +
    '</span></div>';
}
function psListHtml(items, favSet, usage) {
  return '<div class="ps-list">' + items.map(function (e) { return psItemHtml(e, favSet, usage); }).join('') + '</div>';
}
function psRenderResults() {
  var el = document.getElementById('psResults');
  var q = document.getElementById('psQuery');
  if (!el || !q) return;
  var r = psSearch(q.value);
  var html = '';
  if (r.mode === 'landing') {
    var favs = psLoadFavs().map(function (c) { return PS.byCode[c]; }).filter(Boolean).slice(0, 10);
    var usagePairs = Object.keys(r.usage).map(function (c) { return [r.usage[c], PS.byCode[c]]; })
      .filter(function (x) { return x[1] && !r.favSet[x[1].c]; });
    usagePairs.sort(function (a, b) { return b[0] - a[0]; });
    var freq = usagePairs.slice(0, 10).map(function (x) { return x[1]; });
    html += '<div class="ks-section"><div class="ks-section-title">&#9733; お気に入り <span class="ks-section-count">' + favs.length + '件</span></div>' +
      (favs.length ? psListHtml(favs, r.favSet, r.usage) : '<div class="empty">お気に入りはまだありません。検索結果の★を押すと登録できます。</div>') + '</div>';
    html += '<div class="ks-section"><div class="ks-section-title">&#128337; よく使う商品 <span class="ks-section-count">' + freq.length + '件</span></div>' +
      (freq.length ? psListHtml(freq, r.favSet, r.usage) : '<div class="empty">まだ利用履歴がありません。コードをコピーするとここに並びます。</div>') + '</div>';
  } else {
    html += '<div class="ks-section"><div class="ks-section-title">検索結果 <span class="ks-section-count">' + r.items.length + '件</span></div>' +
      (r.items.length ? psListHtml(r.items, r.favSet, r.usage) : '<div class="empty">一致する商品が見つかりませんでした。</div>') + '</div>';
  }
  el.innerHTML = html;
}
function viewProductSearch() {
  if (!PS.list) {
    PS.list = (DATA.product_list || []).map(function (e) {
      var o = { c: e.c, n: e.n, s: e.s, v: e.v, st: e.st, u: e.u, pr: e.pr };
      o.nn = ksNormalize(o.n);
      o.norm = o.c + '|' + o.nn + ksNormalize(o.s) + ksNormalize(o.v);
      return o;
    });
    PS.list.forEach(function (e) { PS.byCode[e.c] = e; });
  }
  setTimeout(function () {
    var q = document.getElementById('psQuery');
    if (!q) return;
    var debounce = null;
    q.addEventListener('input', function () { clearTimeout(debounce); debounce = setTimeout(psRenderResults, 150); });
    q.focus();
    psRenderResults();
  }, 0);
  return '<div class="ks-searchbox-wrap">' +
    '<span class="ks-searchbox-icon">&#128269;</span>' +
    '<input type="text" class="ks-searchbox" id="psQuery" autocomplete="off" placeholder="商品名・規格・コード・仕入先名（一部でOK）">' +
    '<p class="ks-hint">全' + (DATA.product_list || []).length.toLocaleString() + '件から一文字であいまい検索できます。コードをクリックするとコードだけをコピーします。</p>' +
    '</div><div id="psResults"></div>';
}
document.addEventListener('click', function (ev) {
  var codeBtn = ev.target.closest('.ps-code-btn');
  if (codeBtn) {
    var code = codeBtn.dataset.code;
    ksCopyText(code);
    var usage = psLoadUsage(); usage[code] = (usage[code] || 0) + 1; psSaveUsage(usage);
    var orig = codeBtn.textContent;
    codeBtn.classList.add('copied'); codeBtn.textContent = 'コピー✓';
    setTimeout(function () { codeBtn.classList.remove('copied'); codeBtn.textContent = orig; }, 1200);
    return;
  }
  var favBtn = ev.target.closest('.ps-fav-btn');
  if (favBtn) {
    var c = favBtn.dataset.code, favs = psLoadFavs(), i = favs.indexOf(c);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(c);
    psSaveFavs(favs);
    psRenderResults();
  }
});

/* ================= ルーター ================= */
var ROUTES = [
  { re: /^#?\/?$/, title: 'ダッシュボード', nav: 'dashboard', fn: viewDashboard },
  { re: /^#\/cards$/, title: 'アンサーカード', nav: 'cards', fn: viewCards },
  { re: /^#\/cards\/(.+)$/, title: 'アンサーカード', nav: 'cards', fn: viewCardDetail },
  { re: /^#\/bukken$/, title: '物件', nav: 'bukken', fn: viewBukken },
  { re: /^#\/bukken\/(.+)$/, title: '物件', nav: 'bukken', fn: viewBukkenDetail },
  { re: /^#\/koumuten-search$/, title: '工務店コード検索', nav: 'ksearch', fn: viewKoumutenSearch },
  { re: /^#\/koumuten$/, title: '工務店', nav: 'koumuten', fn: viewKoumuten },
  { re: /^#\/koumuten\/(.+)$/, title: '工務店', nav: 'koumuten', fn: viewKoumutenDetail },
  { re: /^#\/product-search$/, title: '商品検索', nav: 'psearch', fn: viewProductSearch },
  { re: /^#\/products$/, title: '商品', nav: 'products', fn: viewProducts },
  { re: /^#\/products\/(.+)$/, title: '商品', nav: 'products', fn: viewProductDetail },
  { re: /^#\/input$/, title: '今日の入力', nav: 'input', fn: viewInput },
];
function route() {
  if (!DATA) return;
  var hash = location.hash || '#/';
  for (var i = 0; i < ROUTES.length; i++) {
    var m = hash.match(ROUTES[i].re);
    if (m) {
      document.getElementById('pageTitle').textContent = ROUTES[i].title;
      document.querySelectorAll('.nav-item[data-nav]').forEach(function (el) {
        el.classList.toggle('active', el.dataset.nav === ROUTES[i].nav);
      });
      document.getElementById('view').innerHTML = ROUTES[i].fn(m[1] ? decodeURIComponent(m[1]) : undefined);
      window.scrollTo(0, 0);
      return;
    }
  }
  document.getElementById('view').innerHTML = '<div class="empty">ページが見つかりません。</div>';
}
window.addEventListener('hashchange', route);

/* 行クリックで遷移(リンククリックはそのまま) */
document.addEventListener('click', function (e) {
  var tr = e.target.closest('tr.clickable');
  if (tr && !e.target.closest('a') && !e.target.closest('button')) location.hash = tr.dataset.href;
});

/* ================= 起動 ================= */
/* 通話ツール(call.html)が会社名→工務店コードを引けるよう、コードと名称だけを共有保存する */
function cacheDirectory() {
  try {
    var slim = (DATA.directory || []).map(function (d) { return { c: d.c, n: d.n, k: d.k }; });
    localStorage.setItem('omk_dir', JSON.stringify(slim));
  } catch (e) { /* 容量超過などは無視(照合機能が使えないだけ) */ }
}

function boot(data) {
  DATA = data;
  IDX = { cards: {}, bukken: {}, koumuten: {}, products: {} };
  DATA.cards.forEach(function (c) { IDX.cards[c.no] = c; });
  DATA.bukken.forEach(function (b) { IDX.bukken[b.code] = b; });
  DATA.koumuten.forEach(function (k) { IDX.koumuten[k.code] = k; });
  DATA.products.forEach(function (p) { IDX.products[p.code] = p; });
  cacheDirectory();
  document.getElementById('gate').style.display = 'none';
  document.getElementById('shell').style.display = '';
  route();
}

var btn = document.getElementById('unlockBtn'), pw = document.getElementById('pwInput'), err = document.getElementById('gateErr');
async function attempt() {
  var p = pw.value;
  if (!p) return;
  btn.disabled = true; err.textContent = '';
  try {
    var data = await tryUnlock(p);
    sessionStorage.setItem('neo_pw', p);
    boot(data);
  } catch (e) {
    err.textContent = 'パスワードが違います';
    btn.disabled = false; pw.select();
  }
}
btn.addEventListener('click', attempt);
pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
var saved = sessionStorage.getItem('neo_pw');
if (saved) { pw.value = saved; attempt(); }
})();
