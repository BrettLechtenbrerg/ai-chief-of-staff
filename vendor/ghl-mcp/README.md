# GoHighLevel MCP Server (Sub-Account)

Connect your GoHighLevel sub-account to Claude Code. Talk to your CRM, contacts, pipelines, calendars, invoices, and more — all from your terminal.

## One-Command Install

```bash
git clone https://github.com/tenfoldmarc/ghl-mcp.git && cd ghl-mcp && bash install.sh
```

The installer will:
1. Create a Python virtual environment
2. Install dependencies
3. Ask for your **Private Integration Token** and **Location ID**
4. Register the MCP server with Claude Code

Restart Claude Code and you're live.

---

## Before You Install

You need two things from GoHighLevel:

### 1. Private Integration Token

1. Open your GHL **Sub-Account** (not the agency view)
2. Go to **Settings → Integrations → Private Integrations**
3. Click **Create New**
4. Name it (e.g. "Claude")
5. Select the scopes you need (recommended: select all read + write scopes)
6. Click **Create** and copy the token

### 2. Location ID

Look at your browser URL when inside the sub-account:

```
https://app.gohighlevel.com/v2/location/abc123xyz/dashboard
                                        ^^^^^^^^^
                                        This is your Location ID
```

---

## What You Can Do

Once connected, just talk to Claude naturally:

- "Show me all contacts tagged VIP"
- "Create a contact for John Smith, john@example.com"
- "What deals are open in my pipeline?"
- "Send an SMS to contact xyz saying 'Your appointment is confirmed'"
- "List all my workflows"
- "Show me invoices from last month"
- "Create a blog post about..."

### Full Tool List

| Category | Tools |
|----------|-------|
| **Contacts** | search, get, create, update, notes, tags |
| **Conversations** | search, get messages, send (SMS/Email/WhatsApp) |
| **Pipelines & Deals** | get pipelines, search/create/update/delete opportunities |
| **Calendar** | list calendars, get/create/delete appointments |
| **Email Templates** | list, get, create, update, delete |
| **Email Campaigns** | list, get, create, update, schedule, send, delete |
| **Workflows** | list, add contact to workflow |
| **Funnels** | list funnels, list pages |
| **Forms & Surveys** | list, get submissions |
| **Blog** | list, create, update, delete posts |
| **Social Media** | accounts, list/create/update/delete posts |
| **Products & Prices** | full CRUD |
| **Invoices** | list, create, send, void, record payment, delete |
| **Payments** | orders, transactions, subscriptions |
| **Media Library** | list/search files |
| **Businesses** | full CRUD |
| **Custom Values** | list, create, update, delete |
| **Trigger Links** | list, create, update, delete |
| **Courses** | list |
| **Drip Campaigns** | list, add contact |
| **Users** | list team members |
| **Custom Fields & Tags** | list |

---

## Manual Setup (if you prefer)

```bash
# Clone and install
git clone https://github.com/tenfoldmarc/ghl-mcp.git
cd ghl-mcp
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Register with Claude Code
claude mcp add ghl \
    -e GHL_PRIVATE_TOKEN="your_token_here" \
    -e GHL_LOCATION_ID="your_location_id_here" \
    -- "$(pwd)/.venv/bin/python" "$(pwd)/main.py"
```

Then restart Claude Code.

---

## Troubleshooting

**"GHL_PRIVATE_TOKEN environment variable is not set"**
→ Re-run the installer or check your MCP config with `claude mcp list`

**HTTP 401 errors**
→ Your token may be expired or invalid. Create a new Private Integration in GHL.

**HTTP 403 on a specific tool**
→ Your Private Integration is missing the required scope. Edit it in GHL and add the missing permission.

**Tools not showing up**
→ Make sure you restarted Claude Code after installing.

---

## Requirements

- Python 3.10+
- Claude Code CLI
- A GoHighLevel sub-account with a Private Integration

---

Built by [@tenfoldmarc](https://instagram.com/tenfoldmarc) — follow for more AI automation builds.
