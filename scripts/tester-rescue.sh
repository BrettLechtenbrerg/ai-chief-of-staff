#!/bin/bash
# AI Chief of Staff — Tester Rescue Script
# For: "No handler registered" errors / version stuck on "Loading..."
#
# What it does (safe — never deletes anything):
#   1. DIAGNOSE: prints chip vs app architecture, checks the database.
#   2. FIX (asks first): renames the app's database aside so the app
#      rebuilds a fresh one on next launch. Your old file is kept as .bak.
#
# How to run:
#   1. Quit AI Chief of Staff completely (right-click Dock icon -> Quit,
#      and quit it from the menu-bar tray icon too).
#   2. Open Terminal, then:  bash ~/Downloads/tester-rescue.sh
#   3. Send Brett a screenshot of everything it prints.

set -u

APP="/Applications/AI Chief of Staff.app"
DATA="$HOME/Library/Application Support/ai-chief-of-staff"
DB="$DATA/ai-chief-of-staff.db"
STAMP=$(date +%Y%m%d-%H%M%S)

echo "================ AI CHIEF OF STAFF RESCUE ================"
echo

# --- 0. Make sure the app isn't running -------------------------------------
if pgrep -f "AI Chief of Staff.app/Contents/MacOS" >/dev/null 2>&1; then
  echo "!! AI Chief of Staff is still running. Please quit it fully"
  echo "   (Dock AND the menu-bar tray icon), then run this again."
  exit 1
fi

# --- 1. Chip vs app architecture --------------------------------------------
echo "--- 1. Architecture check ---"
CHIP=$(uname -m)
echo "Your Mac chip:        $CHIP"
if [ -x "$APP/Contents/MacOS/AI Chief of Staff" ]; then
  file "$APP/Contents/MacOS/AI Chief of Staff" | sed 's/^.*: /App binary:           /'
  NODE_MOD="$APP/Contents/Resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  if [ -f "$NODE_MOD" ]; then
    file "$NODE_MOD" | sed 's/^.*: /Database module:      /'
    MOD_ARCH=$(file "$NODE_MOD")
    case "$CHIP" in
      x86_64) if echo "$MOD_ARCH" | grep -q arm64 && ! echo "$MOD_ARCH" | grep -q x86_64; then
                echo
                echo ">> MISMATCH: Intel Mac but Apple Silicon app."
                echo ">> FIX: re-download using the 'Mac (Intel)' button on the download page."
                exit 0
              fi ;;
    esac
    echo "Architecture: OK (app matches your chip)"
  else
    echo "!! Database module not found — the app may be damaged. Re-download and reinstall."
  fi
else
  echo "!! App not found at: $APP"
  echo "   Install it in /Applications first."
  exit 1
fi
echo

# --- 2. Database health -------------------------------------------------------
echo "--- 2. Database check ---"
if [ ! -f "$DB" ]; then
  echo "No database found (fresh state) — the database is not the problem."
  DB_OK="missing"
else
  ls -lh "$DB" | awk '{print "Database file:        " $5 "  " $9}'
  RESULT=$(sqlite3 "$DB" "PRAGMA integrity_check;" 2>&1 | head -3)
  echo "Integrity check:      $RESULT"
  if [ "$RESULT" = "ok" ]; then
    DB_OK="yes"
  else
    DB_OK="no"
  fi
fi
echo

# --- 3. Offer the fix ---------------------------------------------------------
if [ "${DB_OK:-}" = "no" ]; then
  echo ">> Your database is damaged. This is very likely the cause."
elif [ "${DB_OK:-}" = "yes" ]; then
  echo "Database passed the basic check, but a bad SETTING inside it can"
  echo "still crash startup. Setting it aside is still worth trying."
fi

if [ -f "$DB" ]; then
  echo
  echo "The fix renames your app data aside (nothing is deleted):"
  echo "  $DB"
  echo "  -> ai-chief-of-staff.db.bak-$STAMP"
  echo
  echo "NOTE: the app will start fresh — you'll sign in to Claude again and"
  echo "chat history/settings will look empty. Your old data stays in the"
  echo ".bak file and can be restored by renaming it back."
  echo
  read -r -p "Rename the database aside now? [y/N] " ANSWER
  if [ "$ANSWER" = "y" ] || [ "$ANSWER" = "Y" ]; then
    mv "$DB" "$DB.bak-$STAMP"
    # WAL sidecar files belong to the old DB — set them aside too.
    [ -f "$DB-wal" ] && mv "$DB-wal" "$DB-wal.bak-$STAMP"
    [ -f "$DB-shm" ] && mv "$DB-shm" "$DB-shm.bak-$STAMP"
    echo
    echo "Done. Now open AI Chief of Staff and try sending a chat message."
    echo "If it works: tell Brett 'database was the problem'."
    echo "If it's still broken: run this to capture the real error and"
    echo "send Brett a screenshot of the output:"
    echo
    echo "  \"$APP/Contents/MacOS/AI Chief of Staff\" 2>&1 | grep -A5 FATAL"
  else
    echo "No changes made."
  fi
else
  echo "Nothing to rename. Launch the app from Terminal to capture the error:"
  echo "  \"$APP/Contents/MacOS/AI Chief of Staff\" 2>&1 | grep -A5 FATAL"
fi
echo
echo "=========================================================="
