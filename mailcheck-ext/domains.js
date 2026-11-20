// 公式ドメインのリスト（なりすましの多いブランド）
// names: 表示名・件名にこの名前が出たら「そのブランドを名乗っている」とみなす
// domains: 正規の送信ドメイン（サブドメインも含めて一致とみなす）
// ※ 出発点のリストです。誤判定が出たら、設定画面で信頼するドメインを追加してください。
var MAILCHECK_BRANDS = [
  { brand: 'Amazon', names: ['amazon', 'アマゾン'], domains: ['amazon.co.jp', 'amazon.com', 'amazon.jp'] },
  { brand: '楽天', names: ['楽天', 'rakuten'], domains: ['rakuten.co.jp', 'rakuten.com', 'rakuten-card.co.jp', 'rakuten-bank.co.jp', 'rakuten-sec.co.jp', 'rakuten.ne.jp', 'rakuten-mobile.co.jp'] },
  { brand: '三井住友カード', names: ['三井住友カード', 'vpass', 'smbcカード'], domains: ['smbc-card.com', 'vpass.ne.jp'] },
  { brand: '三井住友銀行', names: ['三井住友銀行', 'smbc'], domains: ['smbc.co.jp', 'smbc-card.com'] },
  { brand: '三菱UFJ銀行', names: ['三菱ufj', 'mufg'], domains: ['bk.mufg.jp', 'mufg.jp', 'cr.mufg.jp'] },
  { brand: 'みずほ銀行', names: ['みずほ', 'mizuho'], domains: ['mizuhobank.co.jp', 'mizuho-fg.co.jp'] },
  { brand: 'ゆうちょ銀行', names: ['ゆうちょ'], domains: ['jp-bank.japanpost.jp', 'japanpost.jp'] },
  { brand: '日本郵便', names: ['日本郵便', '郵便局', 'japan post'], domains: ['japanpost.jp', 'post.japanpost.jp'] },
  { brand: 'ヤマト運輸', names: ['ヤマト運輸', 'クロネコ', 'kuroneko'], domains: ['kuronekoyamato.co.jp', 'yamato-hd.co.jp'] },
  { brand: '佐川急便', names: ['佐川急便', 'sagawa'], domains: ['sagawa-exp.co.jp'] },
  { brand: 'JCB', names: ['jcb'], domains: ['jcb.co.jp', 'jcb.jp'] },
  { brand: 'イオンカード', names: ['イオンカード', 'イオン銀行', 'aeon'], domains: ['aeon.co.jp', 'aeonbank.co.jp', 'aeonfinancial.co.jp'] },
  { brand: 'エポスカード', names: ['エポス', 'epos'], domains: ['eposcard.co.jp'] },
  { brand: 'セゾンカード', names: ['セゾン', 'saison'], domains: ['saisoncard.co.jp', 'saison.co.jp'] },
  { brand: 'PayPay', names: ['paypay'], domains: ['paypay.ne.jp', 'paypay-card.co.jp', 'paypay-bank.co.jp'] },
  { brand: 'メルカリ', names: ['メルカリ', 'mercari'], domains: ['mercari.jp', 'mercari.com'] },
  { brand: 'Apple', names: ['apple', 'アップル', 'icloud'], domains: ['apple.com'] },
  { brand: 'Google', names: ['google', 'グーグル'], domains: ['google.com', 'youtube.com'] },
  { brand: 'Microsoft', names: ['microsoft', 'マイクロソフト', 'office365', 'microsoft 365'], domains: ['microsoft.com', 'microsoftonline.com', 'office.com', 'microsoftrewards.com', 'bing.com'] },
  { brand: 'Netflix', names: ['netflix', 'ネットフリックス'], domains: ['netflix.com'] },
  { brand: 'ETC利用照会', names: ['etc利用照会', 'etcマイレージ'], domains: ['etc-meisai.jp', 'smile-etc.jp'] },
  { brand: '国税庁', names: ['国税庁', 'e-tax'], domains: ['nta.go.jp'] },
  { brand: 'ドコモSMTBネット銀行', names: ['ドコモsmtbネット銀行', '住信sbiネット銀行', 'neobank'], domains: ['netbk.co.jp'] },
  { brand: 'SBI証券', names: ['sbi証券'], domains: ['sbisec.co.jp'] },
  { brand: 'auじぶん銀行', names: ['auじぶん銀行', 'じぶん銀行'], domains: ['jibunbank.co.jp'] },
  { brand: 'ソニー銀行', names: ['ソニー銀行'], domains: ['sonybank.net', 'sonybank.jp'] },
  { brand: 'PayPay銀行', names: ['paypay銀行'], domains: ['paypay-bank.co.jp'] },
  { brand: 'ドコモ', names: ['ドコモ', 'docomo'], domains: ['docomo.ne.jp', 'nttdocomo.co.jp', 'docomo.co.jp'] },
  { brand: 'ソフトバンク', names: ['ソフトバンク', 'softbank'], domains: ['softbank.jp', 'softbank.co.jp'] },
  { brand: 'au / KDDI', names: ['kddi', 'au pay', 'auじぶん'], domains: ['au.com', 'kddi.com', 'aupay.wallet.auone.jp'] },
  { brand: '東京電力', names: ['東京電力', 'tepco'], domains: ['tepco.co.jp'] },
  { brand: 'えきねっと', names: ['えきねっと', 'jr東日本'], domains: ['eki-net.com', 'jreast.co.jp'] },
  { brand: 'ANA', names: ['全日空', 'ana mileage'], domains: ['ana.co.jp'] },
  { brand: 'JAL', names: ['日本航空', 'jal mileage'], domains: ['jal.co.jp', 'jal.com'] }
];

// 誰でもアドレスを作れるフリーメール（企業を名乗っているのにここから来たら危険）
var MAILCHECK_FREEMAIL = ['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.jp', 'hotmail.com', 'hotmail.co.jp',
  'live.com', 'live.jp', 'yahoo.co.jp', 'yahoo.com', 'ymail.ne.jp', 'icloud.com', 'me.com', 'aol.com',
  'gmx.com', 'proton.me', 'protonmail.com', 'mail.ru', 'qq.com', '163.com', '126.com', 'zoho.com'];

// 短縮URLサービス（行き先が隠れる）
var MAILCHECK_SHORTENERS = ['bit.ly', 't.co', 'tinyurl.com', 'is.gd', 'x.gd', 'ow.ly', 'buff.ly', 'cutt.ly', 'rebrand.ly',
  'shorturl.at', 'rb.gy', 'qr.paps.jp', 'u0u.net', 'urx.nu', 'onl.sc', 't.ly', 'tiny.cc', 'lnkd.in', 'goo.su'];

// メール配信サービスのクリック計測用ドメイン（正規のメルマガでリンクがここを経由する）
var MAILCHECK_TRACKERS = ['cuenote.jp', 'sendgrid.net', 'list-manage.com', 'mailchimp.com', 'mcsv.net', 'exct.net', 'exacttarget.com',
  'hubspotlinks.com', 'hs-sites.com', 'hubspotemail.net', 'awstrack.me', 'mandrillapp.com', 'sparkpostmail.com', 'mlsend.com',
  'mailerlite.com', 'cmail19.com', 'cmail20.com', 'createsend.com', 'rs6.net', 'bme.jp', 'blastmail.jp', 'mpse.jp', 'smp.ne.jp',
  'mailpublisher.jp', 'm-ac.jp', 'aspmail.jp', 'mktoweb.com', 'mkt.com', 'pardot.com', 'salesforce.com', 'sfmc-content.com',
  'click.e-mail.jp', 'braze.com', 'klclick.com', 'klaviyomail.com', 'ct.sendgrid.net', 'r.mail.yahoo.co.jp', 'urldefense.com',
  'safelinks.protection.outlook.com', 'google.com', 'synergy-marketing.co.jp', 'emberpoint.com', 'customerscloud.jp'];

// 急がせる・個人情報を求める典型表現
var MAILCHECK_URGENT = ['アカウントが停止', 'アカウントを停止', '利用を停止', '利用制限', 'ご利用制限', '一時停止',
  '24時間以内', '48時間以内', '本日中', '至急', '緊急', '本人確認', 'ご本人様確認', '不正アクセス', '不正利用',
  '第三者によるアクセス', 'セキュリティ警告', 'お支払い方法の更新', '支払い情報を更新', 'カード情報', 'パスワードの有効期限',
  'ログインして確認', '情報を更新してください', '確認できない場合', '凍結', '未払い', '再配達'];

// 振込先・支払先の変更（取引先なりすまし＝ビジネスメール詐欺の典型表現）
var MAILCHECK_PAYMENT = ['振込先の変更', '振込先が変更', '振込先を変更', 'お振込先変更', '振込口座の変更', '振込口座が変更',
  '口座の変更', '口座が変更', '口座を変更', '新しい口座', '新口座', '下記口座へ', '以下の口座へ', '支払先の変更', '支払い先の変更',
  'お支払い先の変更', '入金先の変更', '振込先口座', '口座凍結', '監査中のため', '至急お振込', '本日中にお振込', '本日中のお振込',
  '海外口座', '送金先', 'change of bank', 'new bank account', 'updated bank details', 'bank details have changed'];

if (typeof module !== 'undefined') module.exports = { MAILCHECK_BRANDS, MAILCHECK_FREEMAIL, MAILCHECK_SHORTENERS, MAILCHECK_URGENT, MAILCHECK_PAYMENT, MAILCHECK_TRACKERS };
