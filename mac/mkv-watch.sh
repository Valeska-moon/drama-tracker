#!/bin/bash
# Слежка за MKVDrama с этого Мака. Запускается раз в 15 минут и после включения Мака.
# Если пока Мак был выключен или спал, вышли серии, об этом придёт сообщение при следующем запуске.
DIR="${BL_DIR:-$HOME/.bl-tracker}"
[ -f "$DIR/config" ] && . "$DIR/config"        # TG_TOKEN, TG_CHAT
SHOWS_URL="${SHOWS_URL:-https://valeska-moon.github.io/drama-tracker/shows.json}"
MKV="${MKV_URL:-https://mkvdrama.net}"
STATE="$DIR/state.txt"; DOWN="$DIR/down"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
mkdir -p "$DIR"; touch "$STATE"

say() { # отправка в Telegram (без токена просто печатает)
  echo "Telegram: $1"
  [ -n "$TG_TOKEN" ] && curl -s -m 20 "https://api.telegram.org/bot$TG_TOKEN/sendMessage" --data-urlencode "chat_id=$TG_CHAT" --data-urlencode "text=$1" >/dev/null
}
get() { # адрес -> тело страницы; при ошибке причина пишется в файл (из $(...) переменные наружу не попадают)
  local out code; rm -f "$DIR/err"
  out=$(curl -s -m 25 -L -A "$UA" -H 'Accept-Language: en' -w '\n%{http_code}' "$1") || { echo "нет соединения с сайтом" > "$DIR/err"; return 1; }
  code=${out##*$'\n'}; [ "$code" = 200 ] || { echo "сайт ответил кодом $code" > "$DIR/err"; return 1; }
  printf '%s' "${out%$'\n'*}"
}
why() { cat "$DIR/err" 2>/dev/null || echo "неизвестная ошибка"; }
flat() { printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -e "s/’//g" -e "s/‘//g" -e "s/[\`'\"]//g" -e 's/([0-9]\{4\})//g' | tr -cd 'a-z0-9'; }
query() { printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -e "s/’//g" -e "s/‘//g" -e "s/[\`'\"]//g" -e 's/([0-9]\{4\})/ /g' -e 's/[^a-z0-9]\{1,\}/+/g' -e 's/^+//' -e 's/+$//'; }

SHOWS=$(curl -s -m 25 "$SHOWS_URL?$(date +%s)") || exit 0
LIST=$(printf '%s\n' "$SHOWS" | awk '
  /"id":/    { split($0, a, "\""); id = a[4] }
  /"title":/ { split($0, a, "\""); title = a[4] }
  /"siteName":/ { split($0, a, "\""); site = a[4] }
  /"startDate":/ { print id "|" (site != "" ? site : title) "|" title; site = "" }')
[ -n "$LIST" ] || exit 0

FOUND=""; MISSING=""; MSGARR=(); NEWSTATE=""; FIRST=0; [ -s "$STATE" ] || FIRST=1
while IFS='|' read -r id name title; do
  [ -z "$id" ] && continue
  want=$(flat "$name"); [ -z "$want" ] && continue
  old=$(grep "^$id|" "$STATE" | head -1); oldurl=$(echo "$old" | cut -d'|' -f2); oldmax=$(echo "$old" | cut -d'|' -f3)
  url="$oldurl"
  if [ -z "$url" ]; then
    html=$(get "$MKV/search?q=$(query "$name")") || { PROBLEM="$(why)"; break; }
    for path in $(printf '%s' "$html" | grep -oE 'href="(https?://[^"/]*)?/[a-zA-Z0-9][a-zA-Z0-9-]*/?"' | sed -E 's/^href="(https?:\/\/[^"\/]*)?\///; s/\/?"$//' | sort -u); do
      base=$(printf '%s' "$path" | sed -E 's/-[a-zA-Z0-9]{5,12}$//; s/-(19|20)[0-9]{2}$//')
      [ "$(flat "$base")" = "$want" ] && { url="$MKV/$path"; break; }
    done
  fi
  max=""
  if [ -n "$url" ]; then
    page=$(get "$url") || { PROBLEM="$(why)"; break; }
    m=$(printf '%s' "$page" | sed -e 's/<[^>]*>/ /g' | grep -oiE 'Episodes? *0*[0-9]+( *(-|–|—|to) *0*[0-9]+)?' | head -1)
    max=$(printf '%s' "$m" | grep -oE '[0-9]+' | sed 's/^0*//' | sort -n | tail -1)
  fi
  if [ -z "$old" ]; then
    if [ -n "$url" ]; then FOUND="$FOUND
• $title${max:+ (сейчас серии до $max)}"; else MISSING="$MISSING
• $title"; fi
  elif [ -z "$oldurl" ] && [ -n "$url" ]; then
    MSGARR+=("Сериал «$title» появился на MKVDrama${max:+ (серии до $max)}
$url")
  elif [ -n "$max" ] && [ -n "$oldmax" ] && [ "$max" -gt "$oldmax" ]; then
    if [ $((max - oldmax)) -gt 1 ]; then t="вышли серии $((oldmax + 1))–$max"; else t="вышла серия $max"; fi
    MSGARR+=("На MKVDrama $t «$title»
$url")
  fi
  [ -n "$max" ] && [ -n "$oldmax" ] && [ "$max" -lt "$oldmax" ] && max="$oldmax"
  NEWSTATE="$NEWSTATE$id|$url|${max:-$oldmax}
"
done <<< "$LIST"

if [ -n "$PROBLEM" ]; then
  echo "MKVDrama: $PROBLEM"
  [ -f "$DOWN" ] || { say "MKVDrama не открывается с этого Мака: $PROBLEM. Напишу, когда заработает."; touch "$DOWN"; }
  exit 0
fi
[ -f "$DOWN" ] && { say "MKVDrama снова доступен."; rm -f "$DOWN"; }
if [ -n "$FOUND$MISSING" ]; then
  T="MKVDrama, слежка с Мака включена."
  [ -n "$FOUND" ] && T="$T

Нашла страницы:$FOUND"
  [ -n "$MISSING" ] && T="$T

Пока нет на MKVDrama (напишу, когда появятся):$MISSING"
  say "$T"
fi
for one in "${MSGARR[@]}"; do say "$one"; done
# сохраняем состояние (сериалы, которых больше нет в списке, пропадают)
printf '%s' "$NEWSTATE" > "$STATE"
