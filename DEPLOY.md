# Auto-sync this repo into Apps Script (no more pasting)

This repo is wired to push its code into your bound Apps Script project with
**clasp**. Once set up, every push to GitHub updates the script automatically —
you stop copy-pasting `Code.gs` and `Index.html`.

Only three files are pushed into the script: **`Code.gs`**, **`Index.html`**,
and **`appsscript.json`**. Everything else (the `integrations/` module, the
docs, the prompts) is ignored by `.claspignore`, so it never lands in your live
project.

---

## One-time setup (about 5 minutes)

### 1. Tell the workflow your Script ID

In the Apps Script editor: **Project Settings (gear) → IDs → Script ID**. Copy
it. Then in GitHub: **Settings → Secrets and variables → Actions → Variables →
New repository variable**.

- **Name:** `CLASP_SCRIPT_ID`
- **Value:** the Script ID

(A Script ID is not secret, so it is a Variable, not a Secret. The workflow
writes `.clasp.json` from it at run time — `.clasp.json` stays out of the repo.)

> The account you authenticate clasp with (step 2) **must have edit access to
> this script**, and — because the web app runs as `USER_DEPLOYING` — it should
> be the same Google account that has Google Ads access to your clients. Wiring
> clasp with that account also fixes the "running as the wrong identity" 403.

### 2. Generate clasp credentials on your machine (once)

On your own computer, with the right Google account:

```bash
npm install -g @google/clasp@2.4.2
clasp login          # opens a browser; sign in as the account with access
```

This writes a credentials file to `~/.clasprc.json` (macOS/Linux) or
`%USERPROFILE%\.clasprc.json` (Windows). Open it and copy its **entire**
contents.

### 3. Add the credentials to GitHub as a secret

In the GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**.

- **Name:** `CLASPRC_JSON`
- **Value:** paste the whole contents of `~/.clasprc.json`

> This is your Google OAuth token. Keep it as a secret (never commit it). Anyone
> with it can push to your Apps Script projects, so rotate it (`clasp login`
> again, update the secret) if it is ever exposed.

### 4. (Optional) auto-refresh the live web app

`clasp push` updates the **code**, but the published `/exec` web app keeps
serving its last **deployed version**. Two ways to see new code live:

- **Simplest:** use the editor's **Test deployment** (`/dev`) URL, which always
  runs the latest code (as you).
- **Auto-deploy:** in **Settings → Secrets and variables → Actions →
  Variables**, add a variable `CLASP_DEPLOYMENT_ID` set to your web-app
  deployment id (Apps Script → **Deploy → Manage deployments** → the id under
  your web app). The workflow will then bump that deployment on every sync.

---

## After setup

- Push to `main` (or the `claude/**` working branch) → the **Sync to Apps
  Script** action runs → your script is updated. Watch it under the repo's
  **Actions** tab.
- Run it by hand anytime: **Actions → Sync to Apps Script → Run workflow**.
- Want it to sync only from `main`? Edit `branches` in
  `.github/workflows/clasp-push.yml`.

## Prefer to skip the GitHub secret? Sync locally instead

If you would rather not store credentials in GitHub, sync by hand from a clone:

```bash
npm install -g @google/clasp@2.4.2
clasp login
# in the repo folder, create a local .clasp.json (it is gitignored):
printf '{ "scriptId": "YOUR_SCRIPT_ID", "rootDir": "." }\n' > .clasp.json
clasp push --force
```

That is still one command (`clasp push`) instead of copy-pasting two files.
