# Local data protection, backup, and restore

AI Chief of Staff stores conversations, memories, routines, tasks, facts, and settings in `ai-chief-of-staff.db` under Electron's per-user application-data directory.

## Protection boundary

- On macOS/Linux, ACOS enforces `0700` on its user-data and backup directories and `0600` on the SQLite database, WAL, SHM, rotating backups, and startup-health marker.
- On Windows, ACOS uses the current user's private AppData directory and inherited user ACL. The Windows rescue collector reports the effective database ACL for diagnosis.
- Provider secrets managed in Settings are encrypted with Electron `safeStorage`; ordinary conversation/database content is not independently field-encrypted.
- MCP connector configuration, OAuth caches, and proposal records are not `safeStorage` field-encrypted. They stay under private per-user app data; ACOS enforces `0600`/`0700` where POSIX modes exist, and Windows relies on the user's inherited AppData ACL.
- Enable **FileVault** on macOS or **BitLocker / Device Encryption** on Windows for whole-database and connector-secret protection at rest. ACOS file permissions do not replace full-disk encryption or a locked OS account.

## Automatic backups

After SQLite initializes, ACOS creates an online SQLite backup under `<userData>/backups/`. SQLite's online backup API includes committed WAL data, so the snapshot remains consistent while the application is running.

- Backups are created no more than once every 20 hours.
- The newest seven timestamped backups are retained.
- Every completed backup passes SQLite `quick_check` before rotation.
- Backup names use `ai-chief-of-staff-YYYYMMDDTHHMMSSmmmZ.db`.
- Backups remain local and are never uploaded by ACOS.

Backups protect against a damaged application database; they do not replace an encrypted system backup such as Time Machine or Windows Backup.

## Restore

Quit ACOS before restoring. The restore command accepts only an exact filename from the private `backups` directory, validates it with SQLite `quick_check`, and creates a `pre-restore-*.db` emergency snapshot of the current database before atomically replacing it.

macOS:

```bash
open -a "AI Chief of Staff" --args --restore-backup=ai-chief-of-staff-YYYYMMDDTHHMMSSmmmZ.db
```

Windows PowerShell:

```powershell
& "$env:LOCALAPPDATA\Programs\AI Chief of Staff\AI Chief of Staff.exe" --restore-backup=ai-chief-of-staff-YYYYMMDDTHHMMSSmmmZ.db
```

If the restore fails validation, ACOS leaves the current database in place and shows an error. Do not manually copy a lone database file while ACOS is running: uncheckpointed committed records may still be in the WAL.
