# メール公式チェッカー（Gmail用 Chrome / Edge 拡張機能）

Gmailで開いたメールが、本当に公式の送信元から届いたものかを判定して、本文の上に表示する拡張機能です。
本文のリンクはロックされていて、押しても開かず、本当の行き先だけを表示します。

- 🟢 公式の可能性：高 ／ 🟡 注意 ／ 🔴 危険 の3段階
- 調べること：送信元認証（SPF・DKIM・DMARC）、似せたドメイン、返信先、リンクの行き先と表示の違い、急がせる文面、振込先の変更
- リンクのロック：押すと行き先だけを表示。開きたいメールだけ有効にできます
- メールの内容は外部に送りません（通信するのはGmail自身のページだけ）

## ダウンロード

[最新版をダウンロード（zip）](https://github.com/a2e-works/mailcheck-ext/releases/latest/download/mailcheck-ext.zip)

詳しい説明・入れ方・限界は、公式ページをご覧ください：
https://a2e-works.github.io/mailcheck.html

## 入れ方（5分）

1. zipを展開し、中の `mailcheck-ext` フォルダを消さない場所に置く
2. Chromeは `chrome://extensions`、Edgeは `edge://extensions` を開く
3. 「デベロッパー モード」（Edgeは「開発者モード」）をオンにする
4. 「パッケージ化されていない拡張機能を読み込む」（Edgeは「展開して読み込み」）で `mailcheck-ext` フォルダを選ぶ
5. Gmailを開き直す（Ctrl+F5）

## 限界

判定は目安です。企業のメールアカウント自体が乗っ取られた場合などは見分けられません。
ログインや支払いは、メールのリンクではなく、公式アプリやブックマークから開いてください。

## 感想・不具合

noteの紹介記事へのコメントでお知らせください：
https://note.com/a2e_works/n/nf026eb82f811

© A2E Works
