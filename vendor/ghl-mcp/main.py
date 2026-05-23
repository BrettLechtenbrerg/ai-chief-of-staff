#!/usr/bin/env python3
"""
GoHighLevel MCP Server (Sub-Account)
Connect Claude to a single GHL sub-account via a Private Integration Token.
"""

import os
import json
from typing import Optional

import httpx
from fastmcp import FastMCP

# ── Constants ────────────────────────────────────────────────────────────────

BASE_URL = "https://services.leadconnectorhq.com"
API_VERSION = "2021-07-28"
CHARACTER_LIMIT = 25_000

mcp = FastMCP("ghl")


# ── Auth ─────────────────────────────────────────────────────────────────────

def _headers() -> dict:
    token = os.environ.get("GHL_PRIVATE_TOKEN")
    if not token:
        raise ValueError("GHL_PRIVATE_TOKEN environment variable is not set.")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Version": API_VERSION,
    }


def _loc() -> str:
    loc = os.environ.get("GHL_LOCATION_ID")
    if not loc:
        raise ValueError("GHL_LOCATION_ID environment variable is not set.")
    return loc


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def _truncate(text: str) -> str:
    if len(text) > CHARACTER_LIMIT:
        return text[:CHARACTER_LIMIT] + "\n\n[Truncated — use filters to narrow results]"
    return text


async def _get(url: str, params: dict | None = None) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(url, headers=_headers(), params=params or {})
            resp.raise_for_status()
            return _truncate(resp.text)
        except httpx.HTTPStatusError as e:
            return f"HTTP {e.response.status_code}: {e.response.text[:500]}"
        except httpx.RequestError as e:
            return f"Request error: {str(e)}"


async def _post(url: str, body: dict) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(url, headers=_headers(), json=body)
            resp.raise_for_status()
            return resp.text
        except httpx.HTTPStatusError as e:
            return f"HTTP {e.response.status_code}: {e.response.text[:500]}"
        except httpx.RequestError as e:
            return f"Request error: {str(e)}"


async def _put(url: str, body: dict) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.put(url, headers=_headers(), json=body)
            resp.raise_for_status()
            return resp.text
        except httpx.HTTPStatusError as e:
            return f"HTTP {e.response.status_code}: {e.response.text[:500]}"
        except httpx.RequestError as e:
            return f"Request error: {str(e)}"


async def _delete(url: str) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.delete(url, headers=_headers())
            resp.raise_for_status()
            return resp.text or '{"success": true}'
        except httpx.HTTPStatusError as e:
            return f"HTTP {e.response.status_code}: {e.response.text[:500]}"
        except httpx.RequestError as e:
            return f"Request error: {str(e)}"


async def _patch(url: str, body: dict) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.patch(url, headers=_headers(), json=body)
            resp.raise_for_status()
            return resp.text
        except httpx.HTTPStatusError as e:
            return f"HTTP {e.response.status_code}: {e.response.text[:500]}"
        except httpx.RequestError as e:
            return f"Request error: {str(e)}"


# ════════════════════════════════════════════════════════════════════════════
# TOOLS
# ════════════════════════════════════════════════════════════════════════════

# ── Contacts ─────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def search_contacts(
    query: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = 25,
    page: int = 1,
) -> str:
    """Search contacts in the GHL sub-account. Supports full-text search and filters.

    Args:
        query: Full-text search across name, email, phone
        email: Filter by exact email
        phone: Filter by phone number
        tag: Filter by tag name
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
    """
    # Tag-filtered search must go through the advanced POST /contacts/search
    # endpoint. GHL's deprecated GET /contacts/ does not accept `tags[]` and
    # returns 422. The advanced endpoint takes a body with `filters` and uses
    # `pageLimit` instead of `limit`/`page`.
    if tag:
        body: dict = {
            "locationId": _loc(),
            "filters": [{"field": "tags", "operator": "contains", "value": tag}],
            "pageLimit": min(limit, 100),
            "page": page,
        }
        if query:
            body["query"] = query
        return await _post(f"{BASE_URL}/contacts/search", body)

    params: dict = {"locationId": _loc(), "limit": limit, "page": page}
    if query:
        params["query"] = query
    if email:
        params["email"] = email
    if phone:
        params["phone"] = phone
    return await _get(f"{BASE_URL}/contacts/", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_contact(contact_id: str) -> str:
    """Get full contact details including notes, tags, custom fields, and activity.

    Args:
        contact_id: Contact ID
    """
    return await _get(f"{BASE_URL}/contacts/{contact_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_contact(
    first_name: str,
    last_name: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    company_name: Optional[str] = None,
    tags: Optional[list[str]] = None,
    source: Optional[str] = None,
    address: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: Optional[str] = None,
    website: Optional[str] = None,
) -> str:
    """Create a new contact in the sub-account.

    Args:
        first_name: Contact first name
        last_name: Contact last name
        email: Email address
        phone: Phone in E.164 format (e.g. +14155552671)
        company_name: Company or organization name
        tags: List of tag strings to apply
        source: Lead source (e.g. "website", "referral", "cold outreach")
        address: Street address
        city: City
        state: State/province
        country: Country code (e.g. "US")
        website: Website URL
    """
    body: dict = {"locationId": _loc(), "firstName": first_name}
    if last_name:
        body["lastName"] = last_name
    if email:
        body["email"] = email
    if phone:
        body["phone"] = phone
    if company_name:
        body["companyName"] = company_name
    if tags:
        body["tags"] = tags
    if source:
        body["source"] = source
    if address:
        body["address1"] = address
    if city:
        body["city"] = city
    if state:
        body["state"] = state
    if country:
        body["country"] = country
    if website:
        body["website"] = website
    return await _post(f"{BASE_URL}/contacts/", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_contact(
    contact_id: str,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    company_name: Optional[str] = None,
    tags: Optional[list[str]] = None,
    address: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: Optional[str] = None,
    website: Optional[str] = None,
) -> str:
    """Update an existing contact. Only provided fields will be changed.

    Args:
        contact_id: Contact ID to update
        first_name: New first name
        last_name: New last name
        email: New email address
        phone: New phone in E.164 format
        company_name: New company name
        tags: Replace all tags with this list
        address: New street address
        city: New city
        state: New state/province
        country: New country code
        website: New website URL
    """
    body: dict = {}
    if first_name:
        body["firstName"] = first_name
    if last_name:
        body["lastName"] = last_name
    if email:
        body["email"] = email
    if phone:
        body["phone"] = phone
    if company_name:
        body["companyName"] = company_name
    if tags is not None:
        body["tags"] = tags
    if address:
        body["address1"] = address
    if city:
        body["city"] = city
    if state:
        body["state"] = state
    if country:
        body["country"] = country
    if website:
        body["website"] = website
    return await _put(f"{BASE_URL}/contacts/{contact_id}", body)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_contact_notes(contact_id: str) -> str:
    """Get all notes for a contact.

    Args:
        contact_id: Contact ID
    """
    return await _get(f"{BASE_URL}/contacts/{contact_id}/notes")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def add_contact_note(contact_id: str, note: str) -> str:
    """Add a note to a contact.

    Args:
        contact_id: Contact ID
        note: Note text content
    """
    return await _post(f"{BASE_URL}/contacts/{contact_id}/notes", {"body": note})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def add_contact_tags(contact_id: str, tags: list[str]) -> str:
    """Add one or more tags to a contact.

    Args:
        contact_id: Contact ID
        tags: List of tag strings to add (e.g. ["vip", "lead", "follow-up"])
    """
    return await _post(f"{BASE_URL}/contacts/{contact_id}/tags", {"tags": tags})


# ── Conversations ─────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def search_conversations(
    contact_id: Optional[str] = None,
    query: Optional[str] = None,
    assigned_to: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 25,
    last_id: Optional[str] = None,
) -> str:
    """Search conversations in the sub-account.

    Args:
        contact_id: Filter to a specific contact's conversations
        query: Search query across conversation content
        assigned_to: Filter by assigned user ID
        status: Filter by status — "open", "read", "unread", "starred", "recents"
        limit: Number of results (max 100)
        last_id: Last conversation ID from previous page (for pagination)
    """
    params: dict = {"locationId": _loc(), "limit": limit}
    if contact_id:
        params["contactId"] = contact_id
    if query:
        params["query"] = query
    if assigned_to:
        params["assignedTo"] = assigned_to
    if status:
        params["status"] = status
    if last_id:
        params["lastId"] = last_id
    return await _get(f"{BASE_URL}/conversations/search", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_conversation(conversation_id: str) -> str:
    """Get full details for a specific conversation.

    Args:
        conversation_id: Conversation ID
    """
    return await _get(f"{BASE_URL}/conversations/{conversation_id}")


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_messages(
    conversation_id: str,
    limit: int = 25,
    last_id: Optional[str] = None,
) -> str:
    """Get messages in a conversation, newest first.

    Args:
        conversation_id: Conversation ID
        limit: Number of messages to return (max 100)
        last_id: Last message ID from previous page (for pagination)
    """
    params: dict = {"limit": limit}
    if last_id:
        params["lastId"] = last_id
    return await _get(f"{BASE_URL}/conversations/{conversation_id}/messages", params)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def send_message(
    contact_id: str,
    type: str,
    message: str,
    from_number: Optional[str] = None,
    subject: Optional[str] = None,
    html: Optional[str] = None,
    scheduled_timestamp: Optional[int] = None,
) -> str:
    """Send a message to a contact via SMS, email, or other channel.

    Args:
        contact_id: Contact ID to message
        type: Channel — "SMS", "Email", "WhatsApp", "GMB", "IG", "FB"
        message: Plain text message body
        from_number: Sender phone number for SMS (E.164 format)
        subject: Email subject line (Email only)
        html: HTML email body (Email only, optional)
        scheduled_timestamp: Unix timestamp (seconds) to schedule delivery
    """
    body: dict = {
        "type": type,
        "contactId": contact_id,
        "locationId": _loc(),
        "message": message,
    }
    if from_number:
        body["fromNumber"] = from_number
    if subject:
        body["subject"] = subject
    if html:
        body["html"] = html
    if scheduled_timestamp:
        body["scheduledTimestamp"] = scheduled_timestamp
    return await _post(f"{BASE_URL}/conversations/messages", body)


# ── Pipelines & Opportunities ─────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_pipelines() -> str:
    """Get all sales pipelines and their stages in the sub-account."""
    return await _get(f"{BASE_URL}/opportunities/pipelines", {"locationId": _loc()})


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def search_opportunities(
    pipeline_id: Optional[str] = None,
    stage_id: Optional[str] = None,
    contact_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    status: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 25,
    page: int = 1,
) -> str:
    """Search opportunities (deals) across all pipelines, or filtered to one.

    pipeline_id is OPTIONAL — omit it to search every pipeline in the location.

    Args:
        pipeline_id: (optional) Filter by pipeline ID
        stage_id: Filter by pipeline stage ID
        contact_id: Filter by associated contact
        assigned_to: Filter by assigned user ID
        status: Filter by status — "open", "won", "lost", "abandoned"
        query: Search query
        limit: Number of results (max 100)
        page: 1-indexed page number for pagination (GHL /opportunities/search
              does NOT accept a `skip` offset — use page instead)
    """
    params: dict = {"location_id": _loc(), "limit": limit, "page": page}
    if pipeline_id:
        params["pipeline_id"] = pipeline_id
    if stage_id:
        params["pipeline_stage_id"] = stage_id
    if contact_id:
        params["contact_id"] = contact_id
    if assigned_to:
        params["assigned_to"] = assigned_to
    if status:
        params["status"] = status
    if query:
        params["q"] = query
    return await _get(f"{BASE_URL}/opportunities/search", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_opportunity(opportunity_id: str) -> str:
    """Get full details for a specific opportunity.

    Args:
        opportunity_id: Opportunity ID
    """
    return await _get(f"{BASE_URL}/opportunities/{opportunity_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_opportunity(
    pipeline_id: str,
    stage_id: str,
    contact_id: str,
    name: str,
    status: str = "open",
    monetary_value: Optional[float] = None,
    assigned_to: Optional[str] = None,
    close_date: Optional[str] = None,
) -> str:
    """Create a new opportunity (deal) in a pipeline.

    Args:
        pipeline_id: Pipeline ID (get from get_pipelines)
        stage_id: Pipeline stage ID
        contact_id: Associated contact ID
        name: Opportunity name/title
        status: "open", "won", "lost", or "abandoned" (default: "open")
        monetary_value: Deal value in dollars
        assigned_to: User ID to assign the deal to
        close_date: Expected close date in ISO 8601 (e.g. "2025-12-31")
    """
    body: dict = {
        "pipelineId": pipeline_id,
        "locationId": _loc(),
        "name": name,
        "pipelineStageId": stage_id,
        "status": status,
        "contactId": contact_id,
    }
    if monetary_value is not None:
        body["monetaryValue"] = monetary_value
    if assigned_to:
        body["assignedTo"] = assigned_to
    if close_date:
        body["closeDate"] = close_date
    return await _post(f"{BASE_URL}/opportunities/", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_opportunity(
    opportunity_id: str,
    name: Optional[str] = None,
    status: Optional[str] = None,
    stage_id: Optional[str] = None,
    monetary_value: Optional[float] = None,
    assigned_to: Optional[str] = None,
    close_date: Optional[str] = None,
) -> str:
    """Update an existing opportunity. Only provided fields will be changed.

    Args:
        opportunity_id: Opportunity ID to update
        name: New name
        status: New status — "open", "won", "lost", "abandoned"
        stage_id: New pipeline stage ID
        monetary_value: New deal value in dollars
        assigned_to: New assigned user ID
        close_date: New expected close date (ISO 8601)
    """
    body: dict = {}
    if name:
        body["name"] = name
    if status:
        body["status"] = status
    if stage_id:
        body["pipelineStageId"] = stage_id
    if monetary_value is not None:
        body["monetaryValue"] = monetary_value
    if assigned_to:
        body["assignedTo"] = assigned_to
    if close_date:
        body["closeDate"] = close_date
    return await _put(f"{BASE_URL}/opportunities/{opportunity_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_opportunity(opportunity_id: str) -> str:
    """Permanently delete an opportunity. This cannot be undone.

    Args:
        opportunity_id: Opportunity ID to delete
    """
    return await _delete(f"{BASE_URL}/opportunities/{opportunity_id}")


# ── Calendar & Appointments ───────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_calendars() -> str:
    """List all calendars in the sub-account."""
    return await _get(f"{BASE_URL}/calendars/", {"locationId": _loc()})


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_appointments(
    start_time: str,
    end_time: str,
    calendar_id: Optional[str] = None,
    user_id: Optional[str] = None,
    group_id: Optional[str] = None,
) -> str:
    """Get appointments/bookings in the sub-account within a date range.

    GHL's /calendars/events endpoint REQUIRES start_time + end_time AND exactly
    one of (calendar_id, user_id, group_id). It does NOT accept `limit`, `page`,
    `offset`, or `contactId`. To list ALL of a user's appointments across every
    calendar, prefer `user_id`. To list bookings on a specific calendar (e.g.
    "Discovery Calls"), call `get_calendars` first to find its id, then pass it
    as `calendar_id`.

    Args:
        start_time: Start of date range, required. ISO 8601 string
                    (e.g. "2026-05-17T00:00:00Z") OR epoch-millis string.
        end_time:   End of date range, required. Same format as start_time.
        calendar_id: Specific calendar to query (mutually exclusive with
                     user_id and group_id).
        user_id:    Specific user whose appointments to list across every
                     calendar they own (use for "my appointments this week").
        group_id:   Specific calendar group to query.
    """
    if not (calendar_id or user_id or group_id):
        return (
            "Error: get_appointments requires exactly one of calendar_id, "
            "user_id, or group_id. Call get_calendars to discover calendar IDs."
        )
    params: dict = {
        "locationId": _loc(),
        "startTime": start_time,
        "endTime": end_time,
    }
    if calendar_id:
        params["calendarId"] = calendar_id
    if user_id:
        params["userId"] = user_id
    if group_id:
        params["groupId"] = group_id
    return await _get(f"{BASE_URL}/calendars/events", params)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_appointment(
    calendar_id: str,
    contact_id: str,
    start_time: str,
    end_time: str,
    title: Optional[str] = None,
    notes: Optional[str] = None,
    assigned_user_id: Optional[str] = None,
) -> str:
    """Create a new appointment/booking.

    Args:
        calendar_id: Calendar ID (get from get_calendars)
        contact_id: Contact ID
        start_time: Start datetime in ISO 8601 (e.g. "2025-12-31T10:00:00-05:00")
        end_time: End datetime in ISO 8601
        title: Appointment title/description
        notes: Internal notes for the appointment
        assigned_user_id: User ID to assign appointment to
    """
    body: dict = {
        "calendarId": calendar_id,
        "locationId": _loc(),
        "contactId": contact_id,
        "startTime": start_time,
        "endTime": end_time,
    }
    if title:
        body["title"] = title
    if notes:
        body["notes"] = notes
    if assigned_user_id:
        body["assignedUserId"] = assigned_user_id
    return await _post(f"{BASE_URL}/calendars/events/appointments", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_appointment(event_id: str) -> str:
    """Delete a calendar appointment. This cannot be undone.

    Args:
        event_id: Calendar event/appointment ID
    """
    return await _delete(f"{BASE_URL}/calendars/events/{event_id}")


# ── Users ─────────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_users() -> str:
    """Get all users (team members) in the sub-account."""
    return await _get(f"{BASE_URL}/users/", {"locationId": _loc()})


# ── Custom Fields ─────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_custom_fields() -> str:
    """Get all custom fields defined in the sub-account."""
    return await _get(f"{BASE_URL}/locations/{_loc()}/customFields")


# ── Tags ──────────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_tags() -> str:
    """Get all tags defined in the sub-account."""
    return await _get(f"{BASE_URL}/locations/{_loc()}/tags")


# ── Email Templates ───────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_email_templates(
    limit: int = 25,
    page: int = 1,
    type: Optional[str] = None,
) -> str:
    """List all email templates in the sub-account.

    Args:
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
        type: Template type filter — "html" or "unlayer"
    """
    params: dict = {"locationId": _loc(), "limit": limit, "page": page}
    if type:
        params["type"] = type
    return await _get(f"{BASE_URL}/emails/builder", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_email_template(template_id: str) -> str:
    """Get a specific email template by ID.

    Args:
        template_id: Email template ID
    """
    return await _get(f"{BASE_URL}/emails/builder/{template_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_email_template(
    title: str,
    html: str,
    preview_text: Optional[str] = None,
) -> str:
    """Create a new HTML email template and save its content.

    Args:
        title: Template name/title
        html: Full HTML content of the email
        preview_text: Preview/preheader text shown in inbox
    """
    loc = _loc()
    create_body: dict = {
        "locationId": loc,
        "title": title,
        "name": title,
        "type": "html",
    }
    create_result = await _post(f"{BASE_URL}/emails/builder", create_body)

    try:
        result_data = json.loads(create_result) if isinstance(create_result, str) else create_result
        template_id = result_data.get("redirect") or result_data.get("id")
    except Exception:
        return create_result

    if not template_id:
        return create_result

    save_body: dict = {
        "locationId": loc,
        "templateId": template_id,
        "updatedBy": loc,
        "html": html,
        "editorType": "html",
        "dnd": {"elements": [], "attrs": {}, "templateSettings": {}},
    }
    if preview_text:
        save_body["previewText"] = preview_text
    return await _post(f"{BASE_URL}/emails/builder/data", save_body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_email_template(
    template_id: str,
    html: str,
    preview_text: Optional[str] = None,
) -> str:
    """Update the HTML content of an existing email template.

    Args:
        template_id: Email template ID to update
        html: New HTML content for the template
        preview_text: New preview/preheader text shown in inbox
    """
    loc = _loc()
    body: dict = {
        "locationId": loc,
        "templateId": template_id,
        "updatedBy": loc,
        "html": html,
        "editorType": "html",
        "dnd": {"elements": [], "attrs": {}, "templateSettings": {}},
    }
    if preview_text:
        body["previewText"] = preview_text
    return await _post(f"{BASE_URL}/emails/builder/data", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_email_template(template_id: str) -> str:
    """Permanently delete an email template. This cannot be undone.

    Args:
        template_id: Email template ID to delete
    """
    return await _delete(f"{BASE_URL}/emails/builder/{template_id}")


# ── Email Marketing Campaigns ─────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_campaigns(
    status: Optional[str] = None,
    limit: int = 25,
    page: int = 1,
) -> str:
    """List email marketing campaigns (broadcasts).

    Args:
        status: Filter by status — "draft", "scheduled", "sent", "archived"
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
    """
    params: dict = {"locationId": _loc(), "limit": limit, "page": page}
    if status:
        params["status"] = status
    return await _get(f"{BASE_URL}/email-marketing/campaigns", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_campaign(campaign_id: str) -> str:
    """Get full details for a specific email marketing campaign.

    Args:
        campaign_id: Campaign ID
    """
    return await _get(f"{BASE_URL}/email-marketing/campaigns/{campaign_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_campaign(
    name: str,
    subject: str,
    from_name: str,
    from_email: str,
    template_id: Optional[str] = None,
    html: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> str:
    """Create a new email marketing campaign (broadcast).

    Args:
        name: Internal campaign name (not shown to recipients)
        subject: Email subject line
        from_name: Sender display name
        from_email: Sender email address
        template_id: ID of an existing email template to use
        html: Raw HTML content — use this if not providing a template_id
        reply_to: Reply-to email address (defaults to from_email if omitted)
    """
    body: dict = {
        "locationId": _loc(),
        "name": name,
        "subject": subject,
        "sender": {"name": from_name, "email": from_email},
    }
    if template_id:
        body["templateId"] = template_id
    if html:
        body["html"] = html
    if reply_to:
        body["replyTo"] = reply_to
    return await _post(f"{BASE_URL}/email-marketing/campaigns", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_campaign(
    campaign_id: str,
    name: Optional[str] = None,
    subject: Optional[str] = None,
    from_name: Optional[str] = None,
    from_email: Optional[str] = None,
    template_id: Optional[str] = None,
    html: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> str:
    """Update an existing email marketing campaign. Only provided fields will be changed.

    Args:
        campaign_id: Campaign ID to update
        name: New internal campaign name
        subject: New subject line
        from_name: New sender display name
        from_email: New sender email address
        template_id: New template ID to use
        html: New raw HTML content
        reply_to: New reply-to email address
    """
    body: dict = {}
    if name:
        body["name"] = name
    if subject:
        body["subject"] = subject
    if from_name or from_email:
        body["sender"] = {}
        if from_name:
            body["sender"]["name"] = from_name
        if from_email:
            body["sender"]["email"] = from_email
    if template_id:
        body["templateId"] = template_id
    if html:
        body["html"] = html
    if reply_to:
        body["replyTo"] = reply_to
    return await _put(f"{BASE_URL}/email-marketing/campaigns/{campaign_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def schedule_campaign(campaign_id: str, scheduled_at: str) -> str:
    """Schedule an email campaign to send at a future date and time.

    Args:
        campaign_id: Campaign ID to schedule (must be in draft status)
        scheduled_at: ISO 8601 datetime to send (e.g. "2026-03-01T10:00:00-05:00")
    """
    return await _post(
        f"{BASE_URL}/email-marketing/campaigns/{campaign_id}/schedule",
        {"scheduledAt": scheduled_at},
    )


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def send_campaign_now(campaign_id: str) -> str:
    """Immediately send an email campaign (no scheduling — sends right now).

    Args:
        campaign_id: Campaign ID to send (must be in draft status)
    """
    return await _post(f"{BASE_URL}/email-marketing/campaigns/{campaign_id}/send", {})


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_campaign(campaign_id: str) -> str:
    """Permanently delete an email campaign. This cannot be undone.

    Args:
        campaign_id: Campaign ID to delete
    """
    return await _delete(f"{BASE_URL}/email-marketing/campaigns/{campaign_id}")


# ── Workflows ─────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_workflows(status: Optional[str] = None) -> str:
    """List all automation workflows in the sub-account.

    Args:
        status: Filter by status — "draft", "published"
    """
    params: dict = {"locationId": _loc()}
    if status:
        params["status"] = status
    return await _get(f"{BASE_URL}/workflows/", params)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def add_contact_to_workflow(
    workflow_id: str,
    contact_id: str,
    event_start_time: Optional[str] = None,
) -> str:
    """Add a contact to an automation workflow.

    Args:
        workflow_id: Workflow ID (get from list_workflows)
        contact_id: Contact ID to enroll
        event_start_time: ISO 8601 datetime to start the workflow (defaults to now)
    """
    body: dict = {"contactId": contact_id}
    if event_start_time:
        body["eventStartTime"] = event_start_time
    return await _post(f"{BASE_URL}/contacts/{contact_id}/workflow/{workflow_id}", body)


# ── Funnels & Landing Pages ───────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_funnels(
    type: Optional[str] = None,
    limit: int = 25,
    page: int = 1,
) -> str:
    """List all funnels and landing pages in the sub-account.

    Args:
        type: Filter by type — "funnel" or "website"
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
    """
    params: dict = {"locationId": _loc(), "limit": limit, "page": page}
    if type:
        params["type"] = type
    return await _get(f"{BASE_URL}/funnels/funnel/list", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_funnel_pages(
    funnel_id: str,
    limit: int = 20,
    offset: int = 0,
) -> str:
    """List all pages within a specific funnel.

    Args:
        funnel_id: Funnel ID (get from list_funnels)
        limit: Number of results (max 20)
        offset: Offset for pagination
    """
    params: dict = {
        "locationId": _loc(),
        "funnelId": funnel_id,
        "limit": limit,
        "offset": offset,
    }
    return await _get(f"{BASE_URL}/funnels/page", params)


# ── Forms ─────────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_forms(limit: int = 25, page: int = 1) -> str:
    """List all forms in the sub-account.

    Args:
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
    """
    return await _get(f"{BASE_URL}/forms/", {"locationId": _loc(), "limit": limit, "page": page})


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_form_submissions(
    form_id: Optional[str] = None,
    limit: int = 25,
    page: int = 1,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
) -> str:
    """Get form submission data.

    Args:
        form_id: Filter to a specific form ID (optional — returns all if omitted)
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
        start_at: Filter submissions after this date (ISO 8601)
        end_at: Filter submissions before this date (ISO 8601)
    """
    params: dict = {"locationId": _loc(), "limit": limit, "page": page}
    if form_id:
        params["formId"] = form_id
    if start_at:
        params["startAt"] = start_at
    if end_at:
        params["endAt"] = end_at
    return await _get(f"{BASE_URL}/forms/submissions", params)


# ── Surveys ───────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_surveys(limit: int = 25, page: int = 1) -> str:
    """List all surveys in the sub-account.

    Args:
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
    """
    return await _get(f"{BASE_URL}/surveys/", {"locationId": _loc(), "limit": limit, "page": page})


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_survey_submissions(
    survey_id: Optional[str] = None,
    limit: int = 25,
    page: int = 1,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
) -> str:
    """Get survey submission data.

    Args:
        survey_id: Filter to a specific survey ID (optional)
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
        start_at: Filter submissions after this date (ISO 8601)
        end_at: Filter submissions before this date (ISO 8601)
    """
    params: dict = {"locationId": _loc(), "limit": limit, "page": page}
    if survey_id:
        params["surveyId"] = survey_id
    if start_at:
        params["startAt"] = start_at
    if end_at:
        params["endAt"] = end_at
    return await _get(f"{BASE_URL}/surveys/submissions", params)


# ── Blog ──────────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_blog_posts(limit: int = 25, offset: int = 0) -> str:
    """List all blog posts in the sub-account.

    Args:
        limit: Number of results (max 100)
        offset: Offset for pagination
    """
    return await _get(f"{BASE_URL}/blogs/posts", {"locationId": _loc(), "limit": limit, "offset": offset})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_blog_post(
    title: str,
    html: str,
    status: str = "draft",
    author_id: Optional[str] = None,
    image_url: Optional[str] = None,
    meta_description: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> str:
    """Create a new blog post.

    Args:
        title: Blog post title
        html: Full HTML content of the post
        status: "draft" (default) or "published"
        author_id: User ID of the author (get from get_users)
        image_url: Featured image URL
        meta_description: SEO meta description
        tags: List of tag strings for the post
    """
    body: dict = {
        "locationId": _loc(),
        "title": title,
        "rawHTML": html,
        "status": status,
    }
    if author_id:
        body["authorId"] = author_id
    if image_url:
        body["imageUrl"] = image_url
    if meta_description:
        body["metaDescription"] = meta_description
    if tags:
        body["tags"] = tags
    return await _post(f"{BASE_URL}/blogs/posts", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_blog_post(
    post_id: str,
    title: Optional[str] = None,
    html: Optional[str] = None,
    status: Optional[str] = None,
    image_url: Optional[str] = None,
    meta_description: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> str:
    """Update an existing blog post. Only provided fields will be changed.

    Args:
        post_id: Blog post ID to update
        title: New title
        html: New HTML content
        status: New status — "draft" or "published"
        image_url: New featured image URL
        meta_description: New SEO meta description
        tags: New tag list (replaces existing tags)
    """
    body: dict = {}
    if title:
        body["title"] = title
    if html:
        body["rawHTML"] = html
    if status:
        body["status"] = status
    if image_url:
        body["imageUrl"] = image_url
    if meta_description:
        body["metaDescription"] = meta_description
    if tags is not None:
        body["tags"] = tags
    return await _put(f"{BASE_URL}/blogs/posts/{post_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_blog_post(post_id: str) -> str:
    """Permanently delete a blog post. This cannot be undone.

    Args:
        post_id: Blog post ID to delete
    """
    return await _delete(f"{BASE_URL}/blogs/posts/{post_id}")


# ── Social Media Posting ──────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_social_accounts() -> str:
    """Get all connected social media accounts (Facebook, Instagram, Google, LinkedIn, TikTok, etc.)."""
    return await _get(f"{BASE_URL}/social-media-posting/oauth/{_loc()}/accounts")


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_social_posts(
    account_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 25,
    page: int = 1,
) -> str:
    """List social media posts.

    Args:
        account_id: Filter by a specific connected social account ID
        status: Filter by status — "draft", "scheduled", "published", "failed"
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
    """
    params: dict = {"locationId": _loc(), "limit": limit, "page": page}
    if account_id:
        params["accountId"] = account_id
    if status:
        params["status"] = status
    return await _get(f"{BASE_URL}/social-media-posting/posts", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_social_post(post_id: str) -> str:
    """Get details for a specific social media post.

    Args:
        post_id: Post ID
    """
    return await _get(f"{BASE_URL}/social-media-posting/posts/{post_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_social_post(
    account_ids: list[str],
    content: str,
    status: str = "draft",
    scheduled_at: Optional[str] = None,
    image_urls: Optional[list[str]] = None,
) -> str:
    """Create a social media post for one or more connected accounts.

    Args:
        account_ids: List of connected social account IDs to post to
        content: Post text/caption
        status: "draft" (default) or "scheduled" (requires scheduled_at)
        scheduled_at: ISO 8601 datetime to publish
        image_urls: List of image URLs to attach to the post
    """
    body: dict = {
        "locationId": _loc(),
        "accountIds": account_ids,
        "summary": content,
        "status": status,
    }
    if scheduled_at:
        body["scheduledAt"] = scheduled_at
    if image_urls:
        body["mediaUrls"] = image_urls
    return await _post(f"{BASE_URL}/social-media-posting/posts", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_social_post(
    post_id: str,
    content: Optional[str] = None,
    status: Optional[str] = None,
    scheduled_at: Optional[str] = None,
    image_urls: Optional[list[str]] = None,
) -> str:
    """Update an existing social media post (only works on drafts/scheduled posts).

    Args:
        post_id: Post ID to update
        content: New post text/caption
        status: New status — "draft" or "scheduled"
        scheduled_at: New ISO 8601 scheduled datetime
        image_urls: New list of image URLs
    """
    body: dict = {}
    if content:
        body["summary"] = content
    if status:
        body["status"] = status
    if scheduled_at:
        body["scheduledAt"] = scheduled_at
    if image_urls:
        body["mediaUrls"] = image_urls
    return await _put(f"{BASE_URL}/social-media-posting/posts/{post_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_social_post(post_id: str) -> str:
    """Delete a social media post. This cannot be undone.

    Args:
        post_id: Post ID to delete
    """
    return await _delete(f"{BASE_URL}/social-media-posting/posts/{post_id}")


# ── Products ──────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_products(limit: int = 25, offset: int = 0) -> str:
    """List all products (courses, services, physical goods, etc.).

    Args:
        limit: Number of results (max 100)
        offset: Offset for pagination
    """
    return await _get(f"{BASE_URL}/products/", {"locationId": _loc(), "limit": limit, "offset": offset})


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_product(product_id: str) -> str:
    """Get full details for a specific product.

    Args:
        product_id: Product ID
    """
    return await _get(f"{BASE_URL}/products/{product_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_product(
    name: str,
    product_type: str = "SERVICE",
    description: Optional[str] = None,
    image_url: Optional[str] = None,
) -> str:
    """Create a new product.

    Args:
        name: Product name
        product_type: "SERVICE" (default), "PHYSICAL", or "DIGITAL"
        description: Product description
        image_url: Product image URL
    """
    body: dict = {"locationId": _loc(), "name": name, "productType": product_type}
    if description:
        body["description"] = description
    if image_url:
        body["image"] = image_url
    return await _post(f"{BASE_URL}/products/", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_product(
    product_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    image_url: Optional[str] = None,
) -> str:
    """Update an existing product.

    Args:
        product_id: Product ID to update
        name: New product name
        description: New product description
        image_url: New product image URL
    """
    body: dict = {}
    if name:
        body["name"] = name
    if description:
        body["description"] = description
    if image_url:
        body["image"] = image_url
    return await _put(f"{BASE_URL}/products/{product_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_product(product_id: str) -> str:
    """Permanently delete a product. This cannot be undone.

    Args:
        product_id: Product ID to delete
    """
    return await _delete(f"{BASE_URL}/products/{product_id}")


# ── Product Prices ────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_prices(product_id: str) -> str:
    """List all prices for a product.

    Args:
        product_id: Product ID
    """
    return await _get(f"{BASE_URL}/products/{product_id}/prices", {"locationId": _loc()})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_price(
    product_id: str,
    name: str,
    amount: int,
    currency: str = "USD",
    recurring_interval: Optional[str] = None,
    recurring_interval_count: int = 1,
    trial_days: Optional[int] = None,
) -> str:
    """Create a new price for a product.

    Args:
        product_id: Product ID
        name: Price name (e.g. "Monthly", "One-Time", "Annual")
        amount: Price in cents (e.g. 9700 = $97.00)
        currency: Currency code (default: "USD")
        recurring_interval: For subscriptions — "day", "week", "month", or "year". Omit for one-time.
        recurring_interval_count: How many intervals per billing cycle (default: 1)
        trial_days: Number of free trial days before billing starts
    """
    body: dict = {
        "locationId": _loc(),
        "name": name,
        "amount": amount,
        "currency": currency.upper(),
    }
    if recurring_interval:
        body["recurring"] = {
            "interval": recurring_interval,
            "intervalCount": recurring_interval_count,
        }
        if trial_days:
            body["trialDays"] = trial_days
    return await _post(f"{BASE_URL}/products/{product_id}/prices", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_price(
    product_id: str,
    price_id: str,
    name: Optional[str] = None,
    amount: Optional[int] = None,
    currency: Optional[str] = None,
) -> str:
    """Update an existing price.

    Args:
        product_id: Product ID
        price_id: Price ID to update
        name: New price name
        amount: New amount in cents
        currency: New currency code
    """
    body: dict = {}
    if name:
        body["name"] = name
    if amount is not None:
        body["amount"] = amount
    if currency:
        body["currency"] = currency.upper()
    return await _put(f"{BASE_URL}/products/{product_id}/prices/{price_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_price(product_id: str, price_id: str) -> str:
    """Delete a price from a product. This cannot be undone.

    Args:
        product_id: Product ID
        price_id: Price ID to delete
    """
    return await _delete(f"{BASE_URL}/products/{product_id}/prices/{price_id}")


# ── Invoices ──────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_invoices(
    status: Optional[str] = None,
    contact_id: Optional[str] = None,
    limit: int = 25,
    offset: int = 0,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
) -> str:
    """List invoices in the sub-account.

    Args:
        status: Filter — "draft", "sent", "payment_processing", "paid", "void", "overdue"
        contact_id: Filter by contact ID
        limit: Number of results (max 100)
        offset: Offset for pagination
        start_at: Filter invoices created after this date (ISO 8601)
        end_at: Filter invoices created before this date (ISO 8601)
    """
    loc = _loc()
    params: dict = {"altId": loc, "altType": "location", "limit": limit, "offset": offset}
    if status:
        params["status"] = status
    if contact_id:
        params["contactId"] = contact_id
    if start_at:
        params["startAt"] = start_at
    if end_at:
        params["endAt"] = end_at
    return await _get(f"{BASE_URL}/invoices/", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_invoice(invoice_id: str) -> str:
    """Get full details for a specific invoice.

    Args:
        invoice_id: Invoice ID
    """
    return await _get(f"{BASE_URL}/invoices/{invoice_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_invoice(
    contact_id: str,
    title: str,
    items: list[dict],
    due_date: Optional[str] = None,
    currency: str = "USD",
    notes: Optional[str] = None,
) -> str:
    """Create a new invoice for a contact.

    Args:
        contact_id: Contact ID to bill
        title: Invoice title/name
        items: List of line items. Each item: {"name": str, "amount": int (cents), "qty": int}
        due_date: Due date in ISO 8601 format (e.g. "2026-03-31")
        currency: Currency code (default: "USD")
        notes: Internal or customer-facing notes on the invoice
    """
    loc = _loc()
    body: dict = {
        "altId": loc,
        "altType": "location",
        "contactDetails": {"id": contact_id},
        "title": title,
        "currency": currency.upper(),
        "lineItems": [
            {"name": item.get("name", ""), "amount": item.get("amount", 0), "qty": item.get("qty", 1)}
            for item in items
        ],
    }
    if due_date:
        body["dueDate"] = due_date
    if notes:
        body["internalNotes"] = notes
    return await _post(f"{BASE_URL}/invoices/", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def send_invoice(invoice_id: str, action: str = "send") -> str:
    """Send an invoice to the contact via email.

    Args:
        invoice_id: Invoice ID to send
        action: "send" (default) or "resend"
    """
    loc = _loc()
    return await _post(
        f"{BASE_URL}/invoices/{invoice_id}/send",
        {"altId": loc, "altType": "location", "action": action},
    )


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def void_invoice(invoice_id: str) -> str:
    """Void an invoice (marks it as cancelled — cannot be undone).

    Args:
        invoice_id: Invoice ID to void
    """
    loc = _loc()
    return await _post(f"{BASE_URL}/invoices/{invoice_id}/void", {"altId": loc, "altType": "location"})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def record_invoice_payment(
    invoice_id: str,
    amount: int,
    mode: str = "cash",
    notes: Optional[str] = None,
) -> str:
    """Record a manual payment against an invoice.

    Args:
        invoice_id: Invoice ID
        amount: Amount paid in cents (e.g. 9700 = $97.00)
        mode: Payment mode — "cash", "cheque", "bank_transfer", "other" (default: "cash")
        notes: Payment notes
    """
    loc = _loc()
    body: dict = {"altId": loc, "altType": "location", "amount": amount, "mode": mode}
    if notes:
        body["notes"] = notes
    return await _post(f"{BASE_URL}/invoices/{invoice_id}/record-payment", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_invoice(invoice_id: str) -> str:
    """Permanently delete a draft invoice. This cannot be undone.

    Args:
        invoice_id: Invoice ID to delete (must be in draft status)
    """
    return await _delete(f"{BASE_URL}/invoices/{invoice_id}")


# ── Payments ──────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_orders(
    contact_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 25,
    offset: int = 0,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
) -> str:
    """List payment orders.

    Args:
        contact_id: Filter by contact ID
        status: Filter — "pending", "completed", "cancelled", "refunded"
        limit: Number of results (max 100)
        offset: Offset for pagination
        start_at: Filter orders created after this date (ISO 8601)
        end_at: Filter orders created before this date (ISO 8601)
    """
    loc = _loc()
    params: dict = {"altId": loc, "altType": "location", "limit": limit, "offset": offset}
    if contact_id:
        params["contactId"] = contact_id
    if status:
        params["status"] = status
    if start_at:
        params["startAt"] = start_at
    if end_at:
        params["endAt"] = end_at
    return await _get(f"{BASE_URL}/payments/orders", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_order(order_id: str) -> str:
    """Get full details for a specific payment order.

    Args:
        order_id: Order ID
    """
    loc = _loc()
    return await _get(f"{BASE_URL}/payments/orders/{order_id}", {"altId": loc, "altType": "location"})


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_transactions(
    contact_id: Optional[str] = None,
    limit: int = 25,
    offset: int = 0,
    start_at: Optional[str] = None,
    end_at: Optional[str] = None,
) -> str:
    """List payment transactions.

    Args:
        contact_id: Filter by contact ID
        limit: Number of results (max 100)
        offset: Offset for pagination
        start_at: Filter transactions after this date (ISO 8601)
        end_at: Filter transactions before this date (ISO 8601)
    """
    loc = _loc()
    params: dict = {"altId": loc, "altType": "location", "limit": limit, "offset": offset}
    if contact_id:
        params["contactId"] = contact_id
    if start_at:
        params["startAt"] = start_at
    if end_at:
        params["endAt"] = end_at
    return await _get(f"{BASE_URL}/payments/transactions", params)


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_subscriptions(
    contact_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 25,
    offset: int = 0,
) -> str:
    """List payment subscriptions.

    Args:
        contact_id: Filter by contact ID
        status: Filter — "active", "canceled", "past_due", "trialing"
        limit: Number of results (max 100)
        offset: Offset for pagination
    """
    loc = _loc()
    params: dict = {"altId": loc, "altType": "location", "limit": limit, "offset": offset}
    if contact_id:
        params["contactId"] = contact_id
    if status:
        params["status"] = status
    return await _get(f"{BASE_URL}/payments/subscriptions", params)


# ── Media Library ─────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_media_files(
    query: Optional[str] = None,
    type: Optional[str] = None,
    limit: int = 25,
    offset: int = 0,
    sort_by: str = "updatedAt",
    sort_order: str = "desc",
) -> str:
    """List files in the media library.

    Args:
        query: Search term to filter files by name
        type: Filter by file type — "image", "video", "pdf", "audio"
        limit: Number of results (max 100)
        offset: Offset for pagination
        sort_by: Field to sort by — "updatedAt" (default), "createdAt", "name", "size"
        sort_order: "desc" (default) or "asc"
    """
    loc = _loc()
    params: dict = {
        "altId": loc,
        "altType": "location",
        "limit": limit,
        "offset": offset,
        "sortBy": sort_by,
        "sortOrder": sort_order,
    }
    if query:
        params["query"] = query
    if type:
        params["type"] = type
    return await _get(f"{BASE_URL}/medias/", params)


# ── Businesses ────────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_businesses(limit: int = 25, page: int = 1) -> str:
    """List all businesses (companies) in the sub-account.

    Args:
        limit: Number of results (max 100)
        page: 1-indexed page number (GHL rejects `skip` on most endpoints; use page)
    """
    return await _get(f"{BASE_URL}/businesses/", {"locationId": _loc(), "limit": limit, "page": page})


@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def get_business(business_id: str) -> str:
    """Get full details for a specific business.

    Args:
        business_id: Business ID
    """
    return await _get(f"{BASE_URL}/businesses/{business_id}")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_business(
    name: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    website: Optional[str] = None,
    address: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: Optional[str] = None,
    description: Optional[str] = None,
) -> str:
    """Create a new business record.

    Args:
        name: Business name
        email: Business email address
        phone: Business phone (E.164 format)
        website: Business website URL
        address: Street address
        city: City
        state: State/province
        country: Country code (e.g. "US")
        description: Business description or notes
    """
    body: dict = {"locationId": _loc(), "name": name}
    if email:
        body["email"] = email
    if phone:
        body["phone"] = phone
    if website:
        body["website"] = website
    if address:
        body["address"] = address
    if city:
        body["city"] = city
    if state:
        body["state"] = state
    if country:
        body["country"] = country
    if description:
        body["description"] = description
    return await _post(f"{BASE_URL}/businesses/", body)


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_business(
    business_id: str,
    name: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    website: Optional[str] = None,
    address: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: Optional[str] = None,
    description: Optional[str] = None,
) -> str:
    """Update an existing business record. Only provided fields will be changed.

    Args:
        business_id: Business ID to update
        name: New business name
        email: New email
        phone: New phone
        website: New website URL
        address: New street address
        city: New city
        state: New state
        country: New country code
        description: New description
    """
    body: dict = {}
    if name:
        body["name"] = name
    if email:
        body["email"] = email
    if phone:
        body["phone"] = phone
    if website:
        body["website"] = website
    if address:
        body["address"] = address
    if city:
        body["city"] = city
    if state:
        body["state"] = state
    if country:
        body["country"] = country
    if description:
        body["description"] = description
    return await _put(f"{BASE_URL}/businesses/{business_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_business(business_id: str) -> str:
    """Permanently delete a business record. This cannot be undone.

    Args:
        business_id: Business ID to delete
    """
    return await _delete(f"{BASE_URL}/businesses/{business_id}")


# ── Custom Values ─────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_custom_values() -> str:
    """List all custom values (location-level variables like business name, links, etc.)."""
    loc = _loc()
    return await _get(f"{BASE_URL}/locations/{loc}/customValues")


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_custom_value(name: str, value: str) -> str:
    """Create a new custom value (reusable variable).

    Args:
        name: Variable name (e.g. "Offer Deadline", "Zoom Link")
        value: Variable value
    """
    loc = _loc()
    return await _post(f"{BASE_URL}/locations/{loc}/customValues", {"name": name, "value": value})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_custom_value(
    custom_value_id: str,
    name: Optional[str] = None,
    value: Optional[str] = None,
) -> str:
    """Update an existing custom value.

    Args:
        custom_value_id: Custom value ID
        name: New variable name
        value: New variable value
    """
    body: dict = {}
    if name:
        body["name"] = name
    if value:
        body["value"] = value
    loc = _loc()
    return await _put(f"{BASE_URL}/locations/{loc}/customValues/{custom_value_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_custom_value(custom_value_id: str) -> str:
    """Delete a custom value. This cannot be undone.

    Args:
        custom_value_id: Custom value ID to delete
    """
    loc = _loc()
    return await _delete(f"{BASE_URL}/locations/{loc}/customValues/{custom_value_id}")


# ── Trigger Links ─────────────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_trigger_links() -> str:
    """List all trigger links. Trigger links fire automations when clicked by a contact."""
    return await _get(f"{BASE_URL}/links/", {"locationId": _loc()})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def create_trigger_link(name: str, redirect_to: str) -> str:
    """Create a new trigger link that fires automations when clicked.

    Args:
        name: Link name (e.g. "Clicked Offer Button")
        redirect_to: URL to redirect the contact to after clicking
    """
    return await _post(f"{BASE_URL}/links/", {"locationId": _loc(), "name": name, "redirectTo": redirect_to})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def update_trigger_link(
    link_id: str,
    name: Optional[str] = None,
    redirect_to: Optional[str] = None,
) -> str:
    """Update an existing trigger link.

    Args:
        link_id: Trigger link ID
        name: New link name
        redirect_to: New redirect URL
    """
    body: dict = {}
    if name:
        body["name"] = name
    if redirect_to:
        body["redirectTo"] = redirect_to
    return await _put(f"{BASE_URL}/links/{link_id}", body)


@mcp.tool(annotations={"readOnlyHint": False, "destructiveHint": True, "openWorldHint": True})
async def delete_trigger_link(link_id: str) -> str:
    """Delete a trigger link. This cannot be undone.

    Args:
        link_id: Trigger link ID to delete
    """
    return await _delete(f"{BASE_URL}/links/{link_id}")


# ── Courses & Memberships ─────────────────────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_courses(limit: int = 25, offset: int = 0) -> str:
    """List all courses/memberships in the sub-account.

    Args:
        limit: Number of results (max 100)
        offset: Offset for pagination
    """
    return await _get(f"{BASE_URL}/courses/", {"locationId": _loc(), "limit": limit, "offset": offset})


# ── Drip Campaigns (legacy automation) ───────────────────────────────────────

@mcp.tool(annotations={"readOnlyHint": True, "openWorldHint": True})
async def list_drip_campaigns() -> str:
    """List all drip campaigns (legacy automation sequences under Contacts > Campaigns)."""
    return await _get(f"{BASE_URL}/campaigns/", {"locationId": _loc()})


@mcp.tool(annotations={"readOnlyHint": False, "openWorldHint": True})
async def add_contact_to_campaign(contact_id: str, campaign_id: str) -> str:
    """Add a contact to a drip campaign (legacy automation sequence).

    Args:
        contact_id: Contact ID
        campaign_id: Campaign ID (get from list_drip_campaigns)
    """
    return await _post(f"{BASE_URL}/contacts/{contact_id}/campaigns/{campaign_id}", {})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
