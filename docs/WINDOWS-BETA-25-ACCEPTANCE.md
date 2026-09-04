# Windows beta.25 acceptance

## Release decision

`v1.0.0-beta.25` is the immutable Windows release candidate. Build and Release run `31603383781` completed successfully, the downloaded x64 artifacts match their manifest, and the installer reports a valid production Authenticode signature. **Do not publish or update the website until this checklist passes on a real Windows 11 x64 PC.**

Candidate installer:

- File: `AI-Chief-of-Staff-1.0.0-beta.25-x64-setup.exe`
- SHA-256: `000d155d0db1e4eb32fde692e8f9fa262245088b5406e989969f3b3d1e69acaa`
- Source: the `ai-chief-of-staff-windows-x64-v1.0.0-beta.25` artifact from run `31603383781`

The local verified copy is under `.release-verification/v1.0.0-beta.25/github-artifacts/windows-x64/`.

## Before installing

1. Use a Windows 11 x64 PC. Quit AI Chief of Staff completely.
2. If beta.23 is already installed, **install beta.25 over it** to test the real upgrade path. Do not uninstall first and do not delete `%APPDATA%\ai-chief-of-staff`.
3. Keep `tester-rescue.ps1` from the same artifact bundle beside the installer.
4. In PowerShell, verify the exact downloaded bytes and production signature:

   ```powershell
   $Installer = "$HOME\Downloads\AI-Chief-of-Staff-1.0.0-beta.25-x64-setup.exe"
   (Get-FileHash -Algorithm SHA256 $Installer).Hash.ToLowerInvariant()
   Get-AuthenticodeSignature $Installer | Select-Object Status, StatusMessage, SignerCertificate
   ```

   The hash must equal the value above and `Status` must be `Valid`. Stop on any mismatch.

## Installed-app acceptance

Record pass/fail for every item:

- [ ] **Install/upgrade:** installer completes without administrator access; the installed app reports `1.0.0-beta.25`.
- [ ] **Startup/data:** the app opens normally, prior chat history and facts load, and no startup-error dialog appears.
- [ ] **OpenAI OAuth:** Settings shows OpenAI subscription authentication as connected after login.
- [ ] **GPT chat:** in a new GPT chat, ask `What is 17 + 25? Reply with just the number.` and receive a healthy answer (`42`) without an API-key or credential error.
- [ ] **Voice:** complete at least two spoken questions with two audible answers, then stop voice mode normally.
- [ ] **AEO paid-action gate:** ask ACOS to run AEO visibility for a configured brand. Confirm the approval shows the correct maximum—25 requests per configured provider, up to 75 for three providers—and **deny** it. No provider search should run.
- [ ] **Backup:** after startup, `%APPDATA%\ai-chief-of-staff\backups` contains a timestamped SQLite backup; do not open or copy conversation data for support.
- [ ] **Restart:** quit completely, reopen, and confirm history plus OpenAI connection state still load.

A pass requires every item above, no data loss, and no unexplained credential prompt. Record the Windows version/build, prior ACOS version, installed version, installer hash, Authenticode status, and test time.

## If anything fails

Do not uninstall, delete AppData, or manually copy the database. Quit ACOS and run the collector before changing the installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tester-rescue.ps1
```

Follow `docs/WINDOWS-TESTER-RESCUE.md`. Inspect the generated ZIP before sharing it; the collector redacts known secrets and does not include the conversation database.

## After a complete pass

1. Record the real-device result in `RECOVERY.md` and `docs/SECURITY-RELEASE-AUDIT-2026-08-10.md`.
2. Dispatch `.github/workflows/publish-existing-release.yml` with tag `v1.0.0-beta.25`, source run `31603383781`, both acceptance confirmations enabled, and `publish` enabled.
3. Approve the protected `release` environment gate.
4. Verify the public GitHub prerelease assets and updater manifests, then update the tester website from beta.22 to beta.25.
