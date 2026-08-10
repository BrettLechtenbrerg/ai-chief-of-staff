# Windows tester rescue bundle

Use this collector when AI Chief of Staff will not install, start, open chat, load SQLite, or update correctly on Windows. Until beta.23 is signed and published, the public beta.22 page intentionally links the tested beta.20 x64 installer (324,192,956 bytes; SHA-256 `7464181a0dbb60bdce8aa3b9948ba164898b326aff84703c94468cf919c46d6e`), not the universal installer.

## Run it

1. Download `tester-rescue.ps1` from the same GitHub prerelease as the installer.
2. Open **PowerShell** in Downloads; administrator access is not required.
3. Run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\tester-rescue.ps1
   ```

4. Send support the `AI-Chief-of-Staff-rescue-YYYYMMDD-HHMMSS.zip` file created on the Desktop. Run it before uninstalling so install/updater/startup evidence is still present.

If Windows marks the downloaded script as blocked, right-click it, choose **Properties**, select **Unblock**, then repeat step 3.

## What it collects

- Windows version/build, OS and process architecture, and hardware model.
- The ACOS uninstall/install record, executable location, version, size, SHA-256, PE machine architecture, and Authenticode status.
- Redacted updater metadata and the app's `startup-health.json` flags for IPC registration, SQLite load, and completed initialization.
- The packaged `better-sqlite3` native module's PE machine type and SHA-256, plus an in-memory SQLite load probe when the installed app is available.
- Database/WAL/SHM **sizes and ACL metadata only**. It does not copy the conversation database.
- Up to the final 2 MiB of known application logs after API-key, bearer-token, password/secret, email, and user-profile-path redaction.

Open the ZIP before sending if you want to inspect it. The collector does not upload anything; it only writes the local ZIP.
