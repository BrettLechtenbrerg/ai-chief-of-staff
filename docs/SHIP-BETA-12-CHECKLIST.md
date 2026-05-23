# Ship Beta 12 — Step-By-Step Checklist

**For:** Brett
**Total time:** ~2 hours your time, ~30 min my time
**What you'll need:** Your laptop, a Google account, a test Gmail account, your Apple ID password (for code signing), Docker Desktop open

---

## How this works

You do the parts in **boxes labeled YOU**.
I do the parts in **boxes labeled ME**.
We go one box at a time. After each YOU box, just tell me "done" and I'll do the next ME box.

---

# Part 1 — Make the Google "permission code" (~45 min)

## ☐ YOU — Box 1: Open Google Cloud Console

1. Open Chrome (or any browser).
2. Go to: **https://console.cloud.google.com**
3. Sign in with the Google account you want this project under.
   - **Recommended:** your TSAI Workspace email (e.g. `brett@totalsuccessai.com`) if you have one.
   - **If not:** Manny's TSAI Workspace account.
   - **Last resort:** `brett@brettlechtenberg.com` (your personal — works fine, just means the project lives under your personal account forever).
4. If it asks you to agree to terms of service, click **Agree and Continue**.

**Tell me:** which email you used.

---

## ☐ YOU — Box 2: Create the project

1. At the very top of the page, you'll see a project dropdown (might say "Select a project" or show an existing project name).
2. Click that dropdown.
3. Click **NEW PROJECT** (top-right of the popup).
4. **Project name:** type exactly `tsai-ai-chief-of-staff`
5. **Organization:** leave whatever it defaults to.
6. **Location:** leave whatever it defaults to.
7. Click **CREATE**.
8. Wait ~30 seconds for the spinner. When it's done, you'll get a notification top-right.
9. Click the project dropdown again and **select `tsai-ai-chief-of-staff`** so it's active.

**Tell me:** "project created."

---

## ☐ YOU — Box 3: Turn on the Google APIs we need

1. In the left sidebar (might need to click the ☰ hamburger menu), find **APIs & Services** → **Library**.
2. In the search box, type and enable each of these one at a time. For each: search → click the result → click **ENABLE** → wait → back to Library:
   - `Gmail API`
   - `Google Calendar API`
   - `Google Drive API`
   - `Google Docs API`
   - `People API` (this is what gives us your email address)

**Tell me:** "5 APIs enabled."

---

## ☐ YOU — Box 4: Configure the consent screen

This is the screen users see when they sign in.

1. Left sidebar: **APIs & Services** → **OAuth consent screen**.
2. **User Type:** click **External**, then **CREATE**.
3. Fill in:
   - **App name:** `AI Chief of Staff`
   - **User support email:** your email
   - **App logo:** skip (you can add later)
   - **App domain:**
     - **Application home page:** `https://www.totalsuccessai.com`
     - **Application privacy policy link:** `https://www.totalsuccessai.com/privacy`
       - ⚠️ **If that URL doesn't exist yet, tell me — I need to know before you submit.**
     - **Application terms of service link:** leave blank or use `https://www.totalsuccessai.com/terms` if it exists.
   - **Authorized domains:** click **+ ADD DOMAIN**, type `totalsuccessai.com`, press Enter.
   - **Developer contact information:** your email.
4. Click **SAVE AND CONTINUE**.

5. **Scopes screen** — click **ADD OR REMOVE SCOPES**. In the filter box, paste these one at a time, check each, then click **UPDATE** at the bottom:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/drive.metadata.readonly`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/documents`
   - `.../auth/userinfo.email`
   - `openid`
6. Click **SAVE AND CONTINUE**.

7. **Test users screen** — click **+ ADD USERS**. Add:
   - Your own Gmail.
   - Your test Gmail (the one you'll use for the smoke test).
   - Manny's email (if he wants to test).
   - Any other client emails you want to give early access.
8. Click **SAVE AND CONTINUE**.

9. **Summary screen** — click **BACK TO DASHBOARD**.

**Tell me:** "consent screen done."

---

## ☐ YOU — Box 5: Create the credentials

This is the actual code I need.

1. Left sidebar: **APIs & Services** → **Credentials**.
2. Click **+ CREATE CREDENTIALS** at the top.
3. Click **OAuth client ID**.
4. **Application type:** select **Desktop app** (this is critical — NOT "Web application").
5. **Name:** `AI Chief of Staff Desktop`
6. Click **CREATE**.
7. A popup appears with your Client ID and Client Secret.
8. Click **DOWNLOAD JSON** (the small download icon).
9. Save the file to your `~/Downloads/` folder. It'll be named something like `client_secret_XXXX-XXXX.apps.googleusercontent.com.json`.
10. Click **OK** to close the popup.

**Tell me:** "credentials downloaded — file is at `~/Downloads/<filename>`"
(Just paste the filename, I'll figure out the path.)

---

# Part 2 — I plug in the code (5 min — ME)

## ME — Box 6

When you tell me the filename, I will:
1. Read the JSON file you downloaded.
2. Plug the `client_id` and `client_secret` into `dev/ai-chief-of-staff/src/auth/google-credentials.ts`.
3. Run `npm run build` to verify it compiles.
4. Tell you "ready to test."

---

# Part 3 — Test it on your Mac (~30 min — YOU)

## ☐ YOU — Box 7: Set up the test environment

1. **Pick a test Gmail account.** Either:
   - Make a new one at `gmail.com` (takes 5 min) — recommended so you don't mix work mail with test mail.
   - OR use an old throwaway Gmail you already own.
   - ⚠️ **It must be one of the emails you added as a test user in Box 4 step 7.**

2. **Quit AI Chief of Staff** if it's running. Cmd+Q on the menu bar icon.

**Tell me:** "test gmail is `<email>`, app is quit."

---

## ME — Box 8: Build a test version

When you tell me the test setup is ready, I will:
1. Run `npm run dist:local` to build an unsigned local DMG.
2. Tell you where the DMG is (will be at `dev/ai-chief-of-staff/release/AI-Chief-of-Staff-1.0.0-beta.12-arm64.dmg`).

---

## ☐ YOU — Box 9: Install the test build

1. In Finder, navigate to `~/dev/ai-chief-of-staff/release/`.
2. Double-click the new `.dmg` file.
3. Drag the **AI Chief of Staff** icon into the **Applications** folder.
4. ⚠️ When it asks to replace the existing app, click **Replace**.
5. Open **AI Chief of Staff** from Applications.
6. **If macOS shows a warning** ("can't be opened because Apple cannot check it for malicious software"):
   - Click **Done** to close the warning.
   - Open **System Settings** → **Privacy & Security**.
   - Scroll down to the message about AI Chief of Staff and click **Open Anyway**.
   - Confirm by clicking **Open**.

**Tell me:** "app is open."

---

## ☐ YOU — Box 10: Run the actual smoke test

This is the test that proves Connect Tools works.

1. In the app sidebar, click the **Connect Tools** button (plug icon, between "Content Writer" and "The Brain").
2. You should see a panel with cards: Gmail, Google Calendar, Google Drive & Docs, Chrome bookmarks, GoHighLevel, DataForSEO, Firecrawl.
3. **If a migration prompt pops up** (because you have manual entries on your dev machine):
   - Click **Cancel** for now — we want to test the fresh path. (You can adopt them later if you want.)
4. Click **Connect with Google** on the Gmail card.
5. Your browser should open with Google's sign-in page.
6. Sign in with your **test Gmail** account from Box 7.
7. **You will see a yellow warning:** "Google hasn't verified this app."
   - Click **Advanced** (small link at the bottom).
   - Click **Go to AI Chief of Staff (unsafe)** at the bottom.
   - This is expected and normal for Testing-mode OAuth apps.
8. Google shows a list of permissions ACOS is requesting. Click **Continue** through them.
9. Final confirmation — click **Allow**.
10. Browser shows a green ✓ "Connected" page. Close that tab.
11. Switch back to AI Chief of Staff.
12. The Gmail card should now show a green ✓ and say "Connected as `<your-test-email>`".

**Tell me:** "Gmail card shows green ✓" OR "It broke at step X — here's what I saw."

---

## ☐ YOU — Box 11: Test it actually works

1. In the main chat, type:
   > What gmail tools do you have? List them.
2. The agent should list 13 Gmail tools.
3. Then type:
   > Search my gmail for any unread emails.
4. The agent should return real results from your test Gmail.
5. Click the **Calendar** card → **Connect with Google**.
   - Since you're already signed in, this should connect instantly with no browser popup.
6. Click the **Drive** card → **Connect with Google**.
   - Same — instant.
7. **Quit and reopen the app** (Cmd+Q, then reopen).
8. Open Connect Tools again. All 3 Google cards should still show green ✓ (tokens persist).

**Tell me:** "All 3 Google cards persist after reboot" OR "Something broke."

---

## ☐ YOU — Box 12: Take screenshots for the Loom

While you're testing, take screenshots of:
1. The yellow "unverified app" warning (Box 10 step 7).
2. The permissions list Google shows (Box 10 step 8).
3. The green ✓ Gmail card after success.

These go in the Loom you'll record for testers.

**Tell me:** "screenshots taken."

---

# Part 4 — Ship it (~30 min — ME)

## ME — Box 13: Ship beta.12

When you tell me **"Ship beta.12 now"**, I will:

1. Bump `package.json` version from `1.0.0-beta.11` → `1.0.0-beta.12`.
2. Run `npm run dist:signed` — produces signed + notarized Mac DMGs (~10-15 min).
3. Verify `latest-mac.yml` matches the actual DMG sha512 hashes.
4. Confirm Docker Desktop is running, then run `npm run dist:win` — Windows installers (~6 min).
5. Run `gh release create v1.0.0-beta.12` with the release notes I drafted earlier, attaching all 18 build artifacts.
6. Bump the landing page in `~/TSAI-Site/` to point at the new release URL.
7. Run `vercel --prod` to deploy the landing page.
8. Tell you the public URL where testers can download.

**You don't have to do anything during this. Just go grab coffee.**

---

# Part 5 — Tell your testers (~15 min — YOU, after I'm done)

## ☐ YOU — Box 14: Record the Loom + email testers

1. Record a 2-min Loom showing:
   - Open ACOS → click Connect Tools → click Connect Gmail.
   - The yellow warning → click Advanced → click Go to.
   - The connected state.
   - One real Gmail query.
2. Email your ~50 testers:
   - "Beta 12 is live with Connect Tools — one-click Gmail, Calendar, Drive, GHL, DataForSEO, Firecrawl."
   - Link to download page (I'll give you the URL).
   - Link to your Loom.
   - "Heads up: Google will show a yellow 'unverified app' warning — that's normal for our private beta, click Advanced → Continue."

---

# If anything goes wrong

At ANY point in this checklist, if you hit a screen that doesn't match what I described, or you see an error, **just take a screenshot and paste it to me**. I'll figure out what's different and tell you the fix.

The most common surprises:
- **Google changed their UI** since I wrote this — labels might be slightly different but the flow is the same.
- **"App not verified" warning looks scary** — it's expected. Always click Advanced → Continue.
- **Privacy policy URL doesn't exist** — tell me before you submit Box 4, I'll adjust.
- **Project quota exceeded** — Manny might have hit a limit. Use your personal Google account instead.

---

# Quick reference: what each part takes

| Part | Who | Time |
|---|---|---|
| 1 — Make Google credentials | YOU | 45 min |
| 2 — Plug in code | ME | 5 min |
| 3 — Test on your Mac | YOU | 30 min |
| 4 — Ship | ME | 30 min |
| 5 — Tell testers | YOU | 15 min |
| **Total** | | **~2 hr** |

---

**When you're back, just say "I'm back, starting Box 1"** and we'll go.
