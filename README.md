# うえむき

みんなの一歩を見せ合い、スタンプで応援し合う健康アプリ「うえむき」です。ずっと無料、だれでも参加できます。
スマホのブラウザで https://miumiumiu4.github.io/uemuki/ を開き、「ホーム画面に追加」するとアプリのように使えます。

- ホーム：仲間の一歩がカードで並ぶ。応援スタンプ9種とコメント、掲示板
- からだ：筋トレメニュー表（報告で種目が増える・動画）、瞑想、呼吸法
- 歩く：GPSで歩いた道の「形」を記録（歩き始めと終わりの200mは消す。緯度経度は保存しない）
- ヒント：歩数がたまるとヒントカードが開く
- マイページ：体の記録とInBodyの推移、項目ごとの公開・非公開、iPhoneショートカットで歩数を自動送信

## 2つの動き方

- `config.js` が空：その端末だけで動く「見本」（名前と数字はすべて例）
- `config.js` に Supabase の Project URL と anon key を入れる：みんなでつながる本番

## 本番の準備（一度だけ）

1. Supabase で無料プロジェクトを作る（地域は Tokyo）
2. SQL Editor に `supabase/schema.sql` を丸ごと貼って実行（何度実行しても大丈夫）
3. Authentication の Email で「Confirm email」をオフ（メール送信の上限に当たらないように）
4. Project URL と anon public key を `config.js` に入れる

anon key は公開してよい鍵です。だれが何を読めるかはデータベース側の鍵（RLS）で決めています。
体の記録は本人しか読めず、公開を選んだ項目だけが `shared_body` 関数を通してほかの人に見えます。
脈・服薬・体調メモはいつも本人だけです。

## 見守り役

通報は `reports` テーブルに届きます。見守り役にする人は、Supabase の Table Editor で `profiles.is_admin` を true にしてください。
筋トレの動画は `menu_items.video_url` に YouTube か動画ファイルの https の URL を入れると、アプリ内で再生されます。

ファイルを置くだけで動きます（ビルド不要）。手元で見るときは `python3 -m http.server` で開いてください。
`vendor/` は supabase-js 2.45.4（MIT ライセンス）です。
