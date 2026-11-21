#!/bin/bash
# Установка слежки за MKVDrama на этот Мак. Запуск одной командой в Терминале (см. страницу приложения).
set -e
BASE="https://valeska-moon.github.io/drama-tracker/mac"
DIR="$HOME/.bl-tracker"; PLIST="$HOME/Library/LaunchAgents/com.bl-tracker.mkv.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
curl -fsSL "$BASE/mkv-watch.sh" -o "$DIR/mkv-watch.sh"; chmod +x "$DIR/mkv-watch.sh"
if [ ! -f "$DIR/config" ]; then
  echo "Нужны данные твоего Telegram-бота (те же, что вписаны на GitHub)."
  printf "Токен бота (вставь и нажми Enter, на экране он не виден): "; read -rs TOKEN < /dev/tty; echo
  printf "Твой Telegram ID (число): "; read -r CHAT < /dev/tty
  printf 'TG_TOKEN=%q\nTG_CHAT=%q\n' "$TOKEN" "$CHAT" > "$DIR/config"; chmod 600 "$DIR/config"
fi
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.bl-tracker.mkv</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/mkv-watch.sh</string></array>
<key>StartInterval</key><integer>900</integer>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>$DIR/log.txt</string>
<key>StandardErrorPath</key><string>$DIR/log.txt</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Готово. Слежка за MKVDrama работает: проверка раз в 15 минут и при включении Мака."
echo "Первое сообщение придёт в Telegram в течение минуты."
