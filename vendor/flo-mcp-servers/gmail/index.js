#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { oauthManager, ProposalCache, SafetyChecker } from '@flo/shared';
// Safety config (can be loaded from config file)
const safetyConfig = {
    allowed_domains: ['brettlechtenberg.com'], // Your domain configured
    allow_external_recipients: true, // ✅ ENABLED - PMAI has its own approval process
    allow_deletes: true, // ✅ ENABLED - Allows deleting emails with approval
    time_guard_start_hour: 0, // ✅ No time restrictions
    time_guard_end_hour: 24, // ✅ No time restrictions
    require_human_approval: false // ✅ DISABLED - PMAI handles confirmation
};
const proposalCache = new ProposalCache();
const safetyChecker = new SafetyChecker(safetyConfig);
// Attachment schema
const AttachmentSchema = z.object({
    filename: z.string(),
    path: z.string().optional(), // File path to read from
    content: z.string().optional(), // Base64 encoded content (alternative to path)
    mimeType: z.string().optional(), // Optional mime type, will be inferred if not provided
});
// Tool schemas
const ProposeSendSchema = z.object({
    to: z.array(z.string().email()),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    subject: z.string(),
    body: z.string(),
    html: z.boolean().optional(),
    attachments: z.array(AttachmentSchema).optional(),
});
const ProposeDeleteSchema = z.object({
    message_ids: z.array(z.string()),
    reason: z.string().optional(),
});
const ProposeEmptyTrashSchema = z.object({
    confirm: z.boolean(),
});
const ProposeModifyLabelsSchema = z.object({
    message_ids: z.array(z.string()),
    add_labels: z.array(z.string()).optional(),
    remove_labels: z.array(z.string()).optional(),
});
const SearchEmailsSchema = z.object({
    query: z.string().optional(),
    label_ids: z.array(z.string()).optional(),
    max_results: z.number().optional(),
    include_spam_trash: z.boolean().optional(),
});
const ExecuteSchema = z.object({
    proposal_ids: z.array(z.string()),
    allow_external_recipients: z.boolean().optional(),
    allow_deletes: z.boolean().optional(),
});
const DeleteBySearchSchema = z.object({
    query: z.string(),
    reason: z.string().optional(),
});
const CreateLabelSchema = z.object({
    name: z.string(),
    label_list_visibility: z.enum(['labelShow', 'labelHide', 'labelShowIfUnread']).optional(),
    message_list_visibility: z.enum(['show', 'hide']).optional(),
});
const DeleteLabelSchema = z.object({
    label_name: z.string(),
    reason: z.string().optional(),
});
const GetMessageSchema = z.object({
    id: z.string(),
    format: z.enum(['full', 'plain']).optional(),
});
class GmailMCPServer {
    server;
    gmail;
    constructor() {
        this.server = new Server({
            name: 'flo-gmail-server',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error('[MCP Error]', error);
        };
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'gmail_propose_send',
                    description: 'Propose sending an email with optional attachments. Returns a proposal ID for approval. Does NOT send the email.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            to: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Recipient email addresses',
                            },
                            cc: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'CC recipients (optional)',
                            },
                            bcc: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'BCC recipients (optional)',
                            },
                            subject: {
                                type: 'string',
                                description: 'Email subject',
                            },
                            body: {
                                type: 'string',
                                description: 'Email body (plain text or HTML)',
                            },
                            html: {
                                type: 'boolean',
                                description: 'Whether body is HTML (default: false)',
                            },
                            attachments: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        filename: { type: 'string', description: 'Name of the attachment file' },
                                        path: { type: 'string', description: 'Absolute file path to attach (optional)' },
                                        content: { type: 'string', description: 'Base64 encoded content (optional, alternative to path)' },
                                        mimeType: { type: 'string', description: 'MIME type (optional, will be inferred)' },
                                    },
                                    required: ['filename'],
                                },
                                description: 'Optional file attachments (provide either path or content for each)',
                            },
                        },
                        required: ['to', 'subject', 'body'],
                    },
                },
                {
                    name: 'gmail_send',
                    description: 'SEND AN EMAIL DIRECTLY. Use this tool to send emails immediately without separate approval. Combines propose and execute into one step.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            to: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Recipient email addresses',
                            },
                            cc: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'CC recipients (optional)',
                            },
                            bcc: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'BCC recipients (optional)',
                            },
                            subject: {
                                type: 'string',
                                description: 'Email subject',
                            },
                            body: {
                                type: 'string',
                                description: 'Email body (plain text or HTML)',
                            },
                            html: {
                                type: 'boolean',
                                description: 'Whether body is HTML (default: false)',
                            },
                        },
                        required: ['to', 'subject', 'body'],
                    },
                },
                {
                    name: 'gmail_execute',
                    description: 'Execute approved proposals (emails, deletions, etc.). Sends the emails and returns receipts.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            proposal_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Array of proposal IDs to execute',
                            },
                            allow_external_recipients: {
                                type: 'boolean',
                                description: 'Override safety check for external recipients',
                            },
                            allow_deletes: {
                                type: 'boolean',
                                description: 'Override safety check for email deletions',
                            },
                        },
                        required: ['proposal_ids'],
                    },
                },
                {
                    name: 'gmail_list_pending',
                    description: 'List all pending (not executed) email proposals.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'gmail_propose_delete',
                    description: 'Propose deleting (moving to trash) one or more emails. Returns a proposal ID for approval. Does NOT delete emails immediately.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            message_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Gmail message IDs to delete (move to trash)',
                            },
                            reason: {
                                type: 'string',
                                description: 'Optional reason for deletion (for audit trail)',
                            },
                        },
                        required: ['message_ids'],
                    },
                },
                {
                    name: 'gmail_propose_empty_trash',
                    description: 'Propose permanently deleting all emails in trash. This is IRREVERSIBLE. Returns a proposal ID for approval.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            confirm: {
                                type: 'boolean',
                                description: 'Must be true to proceed (safety check)',
                            },
                        },
                        required: ['confirm'],
                    },
                },
                {
                    name: 'gmail_list_labels',
                    description: 'List all Gmail labels (folders) available in the account. Shows both system labels (INBOX, SENT, etc.) and user-created labels.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'gmail_search_emails',
                    description: 'Search for emails using Gmail query syntax and/or label filters. Returns email details including subject, sender, snippet, and labels.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Gmail search query (e.g., "from:john@example.com", "subject:invoice", "is:unread")',
                            },
                            label_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Filter by label IDs (e.g., ["INBOX", "UNREAD"])',
                            },
                            max_results: {
                                type: 'number',
                                description: 'Maximum number of results to return (default: 20, max: 100)',
                            },
                            include_spam_trash: {
                                type: 'boolean',
                                description: 'Include emails from spam and trash (default: false)',
                            },
                        },
                    },
                },
                {
                    name: 'gmail_propose_modify_labels',
                    description: 'Propose adding or removing labels (folders) from emails. Returns a proposal ID for approval. Does NOT modify emails immediately.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            message_ids: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Gmail message IDs to modify',
                            },
                            add_labels: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Label IDs to add to these emails',
                            },
                            remove_labels: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Label IDs to remove from these emails',
                            },
                        },
                        required: ['message_ids'],
                    },
                },
                {
                    name: 'gmail_delete_by_search',
                    description: 'Search for emails and propose deleting them in one step. Finds emails matching your query, then creates a deletion proposal for approval. Much simpler than searching separately!',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Gmail search query (e.g., "subject:dan wardrobe", "from:sender@example.com", "is:unread")',
                            },
                            reason: {
                                type: 'string',
                                description: 'Optional reason for deletion (for audit trail)',
                            },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'gmail_create_label',
                    description: 'Create a new Gmail label (folder/tag) for organizing emails. Labels are created immediately and can then be applied to emails.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Name of the new label (e.g., "ABCs of AI", "Project X")',
                            },
                            label_list_visibility: {
                                type: 'string',
                                enum: ['labelShow', 'labelHide', 'labelShowIfUnread'],
                                description: 'Whether the label appears in the label list (default: labelShow)',
                            },
                            message_list_visibility: {
                                type: 'string',
                                enum: ['show', 'hide'],
                                description: 'Whether the label appears when viewing a message (default: show)',
                            },
                        },
                        required: ['name'],
                    },
                },
                {
                    name: 'gmail_delete_label',
                    description: 'Delete a Gmail label (folder/tag) entirely. This action is permanent. All emails with this label will keep their other labels, but this label will be removed.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            label_name: {
                                type: 'string',
                                description: 'Name of the label to delete (e.g., "ABCs of AI", "Old Project")',
                            },
                            reason: {
                                type: 'string',
                                description: 'Optional reason for deletion (for audit trail)',
                            },
                        },
                        required: ['label_name'],
                    },
                },
                {
                    name: 'gmail_get_message',
                    description: 'Fetch the FULL body of a Gmail message by ID. Use this AFTER gmail_search_emails to fetch the complete message body (not just the snippet) so you can draft accurate replies. Returns headers (From, To, Cc, Subject, Date), the full text body, and attachment metadata.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: 'Gmail message ID (from gmail_search_emails)',
                            },
                            format: {
                                type: 'string',
                                enum: ['full', 'plain'],
                                description: 'full = headers + body + attachment list (default); plain = body only',
                            },
                        },
                        required: ['id'],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                if (!oauthManager.isAuthenticated()) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Error: Not authenticated. Run OAuth flow first.',
                            },
                        ],
                    };
                }
                switch (request.params.name) {
                    case 'gmail_propose_send':
                        return await this.handleProposeSend(request.params.arguments);
                    case 'gmail_send':
                        return await this.handleDirectSend(request.params.arguments);
                    case 'gmail_propose_delete':
                        return await this.handleProposeDelete(request.params.arguments);
                    case 'gmail_propose_empty_trash':
                        return await this.handleProposeEmptyTrash(request.params.arguments);
                    case 'gmail_propose_modify_labels':
                        return await this.handleProposeModifyLabels(request.params.arguments);
                    case 'gmail_list_labels':
                        return await this.handleListLabels();
                    case 'gmail_search_emails':
                        return await this.handleSearchEmails(request.params.arguments);
                    case 'gmail_execute':
                        return await this.handleExecute(request.params.arguments);
                    case 'gmail_list_pending':
                        return await this.handleListPending();
                    case 'gmail_delete_by_search':
                        return await this.handleDeleteBySearch(request.params.arguments);
                    case 'gmail_create_label':
                        return await this.handleCreateLabel(request.params.arguments);
                    case 'gmail_delete_label':
                        return await this.handleDeleteLabel(request.params.arguments);
                    case 'gmail_get_message':
                        return await this.handleGetMessage(request.params.arguments);
                    default:
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Unknown tool: ${request.params.name}`,
                                },
                            ],
                            isError: true,
                        };
                }
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error.message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async handleProposeSend(args) {
        const parsed = ProposeSendSchema.parse(args);
        // Process attachments if provided
        const processedAttachments = [];
        let attachmentViolations = [];
        const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB (Gmail limit)
        let totalAttachmentSize = 0;
        if (parsed.attachments && parsed.attachments.length > 0) {
            for (const attachment of parsed.attachments) {
                try {
                    const prepared = await this.prepareAttachment(attachment);
                    // Check file size
                    if (prepared.size > MAX_ATTACHMENT_SIZE) {
                        attachmentViolations.push(`Attachment ${prepared.filename} exceeds 25MB limit (${(prepared.size / 1024 / 1024).toFixed(2)}MB)`);
                    }
                    totalAttachmentSize += prepared.size;
                    processedAttachments.push(prepared);
                }
                catch (error) {
                    attachmentViolations.push(`Attachment error: ${error.message}`);
                }
            }
            // Check total size
            if (totalAttachmentSize > MAX_ATTACHMENT_SIZE) {
                attachmentViolations.push(`Total attachment size exceeds 25MB limit (${(totalAttachmentSize / 1024 / 1024).toFixed(2)}MB)`);
            }
        }
        // Check safety
        const violations = [
            ...safetyChecker.checkEmail(parsed.to, parsed.cc || [], parsed.bcc || []),
            ...attachmentViolations,
        ];
        const risk = safetyChecker.assessRisk(violations);
        // Create proposal with processed attachments
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#email-${parsed.to.join('-')}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        // Store payload with processed attachments
        const payloadWithAttachments = {
            ...parsed,
            attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
        };
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'gmail.send',
            payload: payloadWithAttachments,
            risk,
            violations,
            created_at: timestamp,
            executed: false,
        };
        // Check for duplicates
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ Duplicate detected: This email was already sent.\nClient Action ID: ${clientActionId}`,
                    },
                ],
            };
        }
        // Save proposal
        proposalCache.saveProposal(proposal);
        const bodyPreview = parsed.body.substring(0, 150) + (parsed.body.length > 150 ? '...' : '');
        // Build attachment summary
        let attachmentSummary = '';
        if (processedAttachments.length > 0) {
            attachmentSummary = '\n📎 Attachments:\n';
            processedAttachments.forEach((att) => {
                const sizeMB = (att.size / 1024 / 1024).toFixed(2);
                attachmentSummary += `   - ${att.filename} (${att.mimeType}, ${sizeMB}MB)\n`;
            });
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `📧 Email Proposal Created\n\n` +
                        `ID: ${proposalId}\n` +
                        `To: ${parsed.to.join(', ')}\n` +
                        (parsed.cc ? `CC: ${parsed.cc.join(', ')}\n` : '') +
                        (parsed.bcc ? `BCC: ${parsed.bcc.join(', ')}\n` : '') +
                        `Subject: ${parsed.subject}\n` +
                        `Body Preview: ${bodyPreview}${attachmentSummary}\n\n` +
                        `Risk: ${risk.toUpperCase()}\n` +
                        (violations.length > 0 ? `⚠️ Violations: ${violations.join(', ')}\n\n` : '') +
                        `To send this email, say: "approve ${proposalId}"`,
                },
            ],
        };
    }
    // Direct send - combines propose + execute into one step
    async handleDirectSend(args) {
        const parsed = ProposeSendSchema.parse(args);
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        try {
            // Build the email
            const boundary = '----=_Part_' + Date.now().toString(36);
            let emailContent = '';
            const headers = [
                `From: me`,
                `To: ${parsed.to.join(', ')}`,
                parsed.cc ? `Cc: ${parsed.cc.join(', ')}` : '',
                parsed.bcc ? `Bcc: ${parsed.bcc.join(', ')}` : '',
                `Subject: ${parsed.subject}`,
                `MIME-Version: 1.0`,
                `Content-Type: ${parsed.html ? 'text/html' : 'text/plain'}; charset=UTF-8`,
            ].filter(h => h).join('\r\n');
            emailContent = headers + '\r\n\r\n' + parsed.body;
            // Encode to base64url
            const encodedEmail = Buffer.from(emailContent)
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            // Send directly
            const response = await this.gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: encodedEmail,
                },
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ **Email Sent Successfully!**\n\n` +
                            `To: ${parsed.to.join(', ')}\n` +
                            `Subject: ${parsed.subject}\n\n` +
                            `**Message ID**: ${response.data.id}`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Failed to send email: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleExecute(args) {
        const parsed = ExecuteSchema.parse(args);
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        const results = [];
        for (const proposalId of parsed.proposal_ids) {
            const proposal = proposalCache.getProposal(proposalId);
            if (!proposal) {
                results.push(`❌ ${proposalId}: Not found`);
                continue;
            }
            if (proposal.executed) {
                results.push(`⚠️ ${proposalId}: Already executed`);
                continue;
            }
            // Re-check safety with overrides
            let violations = proposal.violations;
            if (parsed.allow_external_recipients) {
                violations = violations.filter((v) => !v.includes('external_recipients'));
            }
            if (parsed.allow_deletes && (proposal.type === 'gmail.delete' || proposal.type === 'gmail.empty_trash')) {
                // Override delete protection if explicitly allowed
                violations = [];
            }
            if (violations.length > 0) {
                results.push(`❌ ${proposalId}: Safety violations - ${violations.join(', ')}`);
                continue;
            }
            // Execute based on proposal type
            try {
                if (proposal.type === 'gmail.send') {
                    // Send email
                    const payload = proposal.payload;
                    const raw = this.createRawEmail(payload);
                    const response = await this.gmail.users.messages.send({
                        userId: 'me',
                        requestBody: {
                            raw,
                        },
                    });
                    const receipt = {
                        messageId: response.data.id,
                        threadId: response.data.threadId,
                        labelIds: response.data.labelIds,
                    };
                    proposalCache.markExecuted(proposalId, receipt);
                    results.push(`✅ ${proposalId}: Sent successfully\n` +
                        `   Message ID: ${receipt.messageId}\n` +
                        `   Thread ID: ${receipt.threadId}`);
                }
                else if (proposal.type === 'gmail.delete') {
                    // Delete emails (move to trash)
                    const payload = proposal.payload;
                    const deletedIds = [];
                    for (const messageId of payload.message_ids) {
                        await this.gmail.users.messages.trash({
                            userId: 'me',
                            id: messageId,
                        });
                        deletedIds.push(messageId);
                    }
                    const receipt = {
                        deletedCount: deletedIds.length,
                        messageIds: deletedIds,
                    };
                    proposalCache.markExecuted(proposalId, receipt);
                    results.push(`✅ ${proposalId}: Deleted ${deletedIds.length} email(s)\n` +
                        `   Moved to trash (recoverable for 30 days)`);
                }
                else if (proposal.type === 'gmail.empty_trash') {
                    // Empty trash permanently
                    await this.gmail.users.messages.emptyTrash({
                        userId: 'me',
                    });
                    const receipt = {
                        action: 'empty_trash',
                        timestamp: new Date().toISOString(),
                    };
                    proposalCache.markExecuted(proposalId, receipt);
                    results.push(`✅ ${proposalId}: Trash emptied successfully\n` +
                        `   All emails permanently deleted`);
                }
                else if (proposal.type === 'gmail.modify_labels') {
                    // Modify labels on emails
                    const payload = proposal.payload;
                    const modifiedIds = [];
                    for (const messageId of payload.message_ids) {
                        await this.gmail.users.messages.modify({
                            userId: 'me',
                            id: messageId,
                            requestBody: {
                                addLabelIds: payload.add_labels || [],
                                removeLabelIds: payload.remove_labels || [],
                            },
                        });
                        modifiedIds.push(messageId);
                    }
                    const receipt = {
                        modifiedCount: modifiedIds.length,
                        messageIds: modifiedIds,
                        addedLabels: payload.add_labels || [],
                        removedLabels: payload.remove_labels || [],
                    };
                    proposalCache.markExecuted(proposalId, receipt);
                    let actionSummary = '';
                    if (payload.add_labels && payload.add_labels.length > 0) {
                        actionSummary += `Added labels: ${payload.add_labels.join(', ')}\n`;
                    }
                    if (payload.remove_labels && payload.remove_labels.length > 0) {
                        actionSummary += `Removed labels: ${payload.remove_labels.join(', ')}`;
                    }
                    results.push(`✅ ${proposalId}: Modified ${modifiedIds.length} email(s)\n` +
                        `   ${actionSummary}`);
                }
                else {
                    results.push(`❌ ${proposalId}: Unknown proposal type - ${proposal.type}`);
                }
            }
            catch (error) {
                results.push(`❌ ${proposalId}: Failed - ${error.message}`);
            }
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `📨 Execution Results\n\n${results.join('\n\n')}`,
                },
            ],
        };
    }
    async handleListPending() {
        const pending = proposalCache.getPending();
        if (pending.length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '📭 No pending email proposals.',
                    },
                ],
            };
        }
        const list = pending
            .map((p) => {
            const payload = p.payload;
            return (`${p.id}\n` +
                `  To: ${payload.to.join(', ')}\n` +
                `  Subject: ${payload.subject}\n` +
                `  Risk: ${p.risk.toUpperCase()}\n` +
                `  Created: ${p.created_at}`);
        })
            .join('\n\n');
        return {
            content: [
                {
                    type: 'text',
                    text: `📬 Pending Email Proposals\n\n${list}`,
                },
            ],
        };
    }
    async handleProposeDelete(args) {
        const parsed = ProposeDeleteSchema.parse(args);
        if (!safetyConfig.allow_deletes) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '⚠️ Email deletion is disabled in safety configuration.\nTo enable, set allow_deletes: true in the Gmail server configuration.',
                    },
                ],
            };
        }
        // Get email details for preview
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        const emailDetails = [];
        for (const messageId of parsed.message_ids) {
            try {
                const message = await this.gmail.users.messages.get({
                    userId: 'me',
                    id: messageId,
                    format: 'metadata',
                    metadataHeaders: ['Subject', 'From'],
                });
                const headers = message.data.payload?.headers || [];
                const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)';
                const from = headers.find((h) => h.name === 'From')?.value || '(Unknown sender)';
                const snippet = message.data.snippet || '';
                emailDetails.push({ id: messageId, subject, from, snippet });
            }
            catch (error) {
                emailDetails.push({
                    id: messageId,
                    subject: '(Error loading email)',
                    from: error.message,
                    snippet: '',
                });
            }
        }
        // Create proposal
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#delete-${parsed.message_ids.join('-')}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'gmail.delete',
            payload: parsed,
            risk: 'high',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        // Check for duplicates
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ Duplicate detected: These emails were already deleted.\nClient Action ID: ${clientActionId}`,
                    },
                ],
            };
        }
        // Save proposal
        proposalCache.saveProposal(proposal);
        // Build preview
        let preview = `🗑️ Email Deletion Proposal\n\nID: ${proposalId}\nEmails to delete: ${parsed.message_ids.length}\n${parsed.reason ? `Reason: ${parsed.reason}\n` : ''}\n\n`;
        emailDetails.forEach((email, index) => {
            preview += `${index + 1}. ${email.subject}\n   From: ${email.from}\n   Snippet: ${email.snippet.substring(0, 80)}...\n\n`;
        });
        preview += `Risk: HIGH ⚠️\n⚠️ These emails will be moved to Trash. They can be recovered within 30 days.\n\nTo delete these emails, say: "approve ${proposalId}"`;
        return {
            content: [
                {
                    type: 'text',
                    text: preview,
                },
            ],
        };
    }
    async handleProposeEmptyTrash(args) {
        const parsed = ProposeEmptyTrashSchema.parse(args);
        if (!parsed.confirm) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '⚠️ Empty trash requires confirmation.\nSet confirm: true to proceed.',
                    },
                ],
            };
        }
        if (!safetyConfig.allow_deletes) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '⚠️ Email deletion is disabled in safety configuration.\nTo enable, set allow_deletes: true in the Gmail server configuration.',
                    },
                ],
            };
        }
        // Get trash count
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        let trashCount = 0;
        try {
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                labelIds: ['TRASH'],
                maxResults: 500,
            });
            trashCount = response.data.messages?.length || 0;
        }
        catch (error) {
            trashCount = 0;
        }
        // Create proposal
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#empty-trash`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'gmail.empty_trash',
            payload: parsed,
            risk: 'high',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        // Save proposal
        proposalCache.saveProposal(proposal);
        return {
            content: [
                {
                    type: 'text',
                    text: `🗑️ Empty Trash Proposal\n\n` +
                        `ID: ${proposalId}\n` +
                        `Emails in trash: ~${trashCount}\n\n` +
                        `⚠️ WARNING: This action is IRREVERSIBLE!\n` +
                        `All emails in your trash will be permanently deleted.\n` +
                        `They CANNOT be recovered after this operation.\n\n` +
                        `Risk: HIGH ⚠️\n\n` +
                        `To permanently delete all trash, say: "approve ${proposalId}"`,
                },
            ],
        };
    }
    async handleListLabels() {
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        try {
            const response = await this.gmail.users.labels.list({
                userId: 'me',
            });
            const labels = response.data.labels || [];
            // Separate system and user labels
            const systemLabels = labels.filter((l) => l.type === 'system');
            const userLabels = labels.filter((l) => l.type === 'user');
            let output = '📁 Gmail Labels (Folders)\n\n';
            if (systemLabels.length > 0) {
                output += '🔧 System Labels:\n';
                systemLabels.forEach((label) => {
                    output += `   - ${label.name} (ID: ${label.id})\n`;
                });
                output += '\n';
            }
            if (userLabels.length > 0) {
                output += '📂 Your Labels:\n';
                userLabels.forEach((label) => {
                    output += `   - ${label.name} (ID: ${label.id})\n`;
                });
            }
            else {
                output += '📂 Your Labels: None created yet\n';
            }
            output += `\nTotal: ${labels.length} labels`;
            return {
                content: [
                    {
                        type: 'text',
                        text: output,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error listing labels: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleSearchEmails(args) {
        const parsed = SearchEmailsSchema.parse(args);
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        const maxResults = Math.min(parsed.max_results || 20, 100);
        try {
            const listParams = {
                userId: 'me',
                maxResults,
            };
            if (parsed.query) {
                listParams.q = parsed.query;
            }
            if (parsed.label_ids && parsed.label_ids.length > 0) {
                listParams.labelIds = parsed.label_ids;
            }
            if (parsed.include_spam_trash) {
                listParams.includeSpamTrash = true;
            }
            const response = await this.gmail.users.messages.list(listParams);
            const messages = response.data.messages || [];
            if (messages.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: '📭 No emails found matching your criteria.',
                        },
                    ],
                };
            }
            // Fetch details for each message
            const emailDetails = [];
            for (const message of messages) {
                try {
                    const details = await this.gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'metadata',
                        metadataHeaders: ['Subject', 'From', 'Date'],
                    });
                    const headers = details.data.payload?.headers || [];
                    const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)';
                    const from = headers.find((h) => h.name === 'From')?.value || '(Unknown)';
                    const date = headers.find((h) => h.name === 'Date')?.value || '';
                    const snippet = details.data.snippet || '';
                    const labels = details.data.labelIds || [];
                    emailDetails.push({ id: message.id, subject, from, snippet, labels, date });
                }
                catch (error) {
                    emailDetails.push({
                        id: message.id,
                        subject: '(Error loading)',
                        from: error.message,
                        snippet: '',
                        labels: [],
                        date: '',
                    });
                }
            }
            // Format output
            let output = `📧 Found ${emailDetails.length} email(s)\n\n`;
            emailDetails.forEach((email, index) => {
                output += `${index + 1}. ${email.subject}\n`;
                output += `   From: ${email.from}\n`;
                output += `   Date: ${email.date}\n`;
                output += `   Labels: ${email.labels.join(', ') || 'None'}\n`;
                output += `   Snippet: ${email.snippet.substring(0, 100)}...\n`;
                output += `   Message ID: ${email.id}\n\n`;
            });
            if (messages.length === maxResults) {
                output += `\n(Showing first ${maxResults} results. Use max_results parameter to see more.)`;
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: output,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error searching emails: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleProposeModifyLabels(args) {
        const parsed = ProposeModifyLabelsSchema.parse(args);
        if (!parsed.add_labels && !parsed.remove_labels) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '⚠️ You must specify at least one of: add_labels or remove_labels',
                    },
                ],
            };
        }
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        // Get email details for preview
        const emailDetails = [];
        for (const messageId of parsed.message_ids) {
            try {
                const message = await this.gmail.users.messages.get({
                    userId: 'me',
                    id: messageId,
                    format: 'metadata',
                    metadataHeaders: ['Subject', 'From'],
                });
                const headers = message.data.payload?.headers || [];
                const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)';
                const from = headers.find((h) => h.name === 'From')?.value || '(Unknown sender)';
                const currentLabels = message.data.labelIds || [];
                emailDetails.push({ id: messageId, subject, from, currentLabels });
            }
            catch (error) {
                emailDetails.push({
                    id: messageId,
                    subject: '(Error loading email)',
                    from: error.message,
                    currentLabels: [],
                });
            }
        }
        // Create proposal
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#modify-labels-${parsed.message_ids.join('-')}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'gmail.modify_labels',
            payload: parsed,
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        // Check for duplicates
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ Duplicate detected: These labels were already modified.\nClient Action ID: ${clientActionId}`,
                    },
                ],
            };
        }
        // Save proposal
        proposalCache.saveProposal(proposal);
        // Build preview
        let preview = `📁 Label Modification Proposal\n\nID: ${proposalId}\n`;
        preview += `Emails to modify: ${parsed.message_ids.length}\n\n`;
        if (parsed.add_labels && parsed.add_labels.length > 0) {
            preview += `➕ Labels to add: ${parsed.add_labels.join(', ')}\n`;
        }
        if (parsed.remove_labels && parsed.remove_labels.length > 0) {
            preview += `➖ Labels to remove: ${parsed.remove_labels.join(', ')}\n`;
        }
        preview += '\nEmails:\n';
        emailDetails.forEach((email, index) => {
            preview += `${index + 1}. ${email.subject}\n`;
            preview += `   From: ${email.from}\n`;
            preview += `   Current labels: ${email.currentLabels.join(', ') || 'None'}\n\n`;
        });
        preview += `Risk: LOW\n\nTo apply these changes, say: "approve ${proposalId}"`;
        return {
            content: [
                {
                    type: 'text',
                    text: preview,
                },
            ],
        };
    }
    async handleDeleteBySearch(args) {
        const parsed = DeleteBySearchSchema.parse(args);
        if (!safetyConfig.allow_deletes) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '⚠️ Email deletion is disabled in safety configuration.\nTo enable, set allow_deletes: true in the Gmail server configuration.',
                    },
                ],
            };
        }
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        try {
            // Search for emails
            const searchResponse = await this.gmail.users.messages.list({
                userId: 'me',
                q: parsed.query,
                maxResults: 100,
            });
            const messages = searchResponse.data.messages || [];
            if (messages.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `📭 No emails found matching: "${parsed.query}"`,
                        },
                    ],
                };
            }
            // Fetch details for each message
            const emailDetails = [];
            for (const message of messages) {
                try {
                    const details = await this.gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'metadata',
                        metadataHeaders: ['Subject', 'From'],
                    });
                    const headers = details.data.payload?.headers || [];
                    const subject = headers.find((h) => h.name === 'Subject')?.value || '(No subject)';
                    const from = headers.find((h) => h.name === 'From')?.value || '(Unknown sender)';
                    const snippet = details.data.snippet || '';
                    emailDetails.push({ id: message.id, subject, from, snippet });
                }
                catch (error) {
                    emailDetails.push({
                        id: message.id,
                        subject: '(Error loading email)',
                        from: error.message,
                        snippet: '',
                    });
                }
            }
            // Create proposal with found message IDs
            const timestamp = new Date().toISOString();
            const clientActionId = `${timestamp}#delete-search-${parsed.query}`;
            const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const proposal = {
                id: proposalId,
                client_action_id: clientActionId,
                type: 'gmail.delete',
                payload: {
                    message_ids: emailDetails.map(e => e.id),
                    reason: parsed.reason || `Deleted by search query: "${parsed.query}"`,
                },
                risk: 'high',
                violations: [],
                created_at: timestamp,
                executed: false,
            };
            // Check for duplicates
            if (proposalCache.checkDuplicate(clientActionId)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `⚠️ Duplicate detected: These emails were already deleted.\nClient Action ID: ${clientActionId}`,
                        },
                    ],
                };
            }
            // Save proposal
            proposalCache.saveProposal(proposal);
            // Build preview
            let preview = `🗑️ Delete by Search Proposal\n\n`;
            preview += `ID: ${proposalId}\n`;
            preview += `Query: "${parsed.query}"\n`;
            preview += `Emails found: ${emailDetails.length}\n`;
            if (parsed.reason) {
                preview += `Reason: ${parsed.reason}\n`;
            }
            preview += '\n';
            emailDetails.forEach((email, index) => {
                preview += `${index + 1}. ${email.subject}\n`;
                preview += `   From: ${email.from}\n`;
                preview += `   Snippet: ${email.snippet.substring(0, 60)}...\n\n`;
            });
            preview += `Risk: HIGH ⚠️\n`;
            preview += `These ${emailDetails.length} email(s) will be moved to Trash.\n`;
            preview += `They can be recovered within 30 days.\n\n`;
            preview += `To delete these emails, say: "approve ${proposalId}"`;
            return {
                content: [
                    {
                        type: 'text',
                        text: preview,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error searching for emails: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleCreateLabel(args) {
        const parsed = CreateLabelSchema.parse(args);
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        try {
            // Create the label
            const response = await this.gmail.users.labels.create({
                userId: 'me',
                requestBody: {
                    name: parsed.name,
                    labelListVisibility: parsed.label_list_visibility || 'labelShow',
                    messageListVisibility: parsed.message_list_visibility || 'show',
                },
            });
            const label = response.data;
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Label Created Successfully!\n\n` +
                            `📂 Label: "${label.name}"\n` +
                            `ID: ${label.id}\n` +
                            `List Visibility: ${label.labelListVisibility}\n` +
                            `Message Visibility: ${label.messageListVisibility}\n\n` +
                            `You can now use this label to organize your emails. ` +
                            `Use the "propose_modify_labels" tool to apply this label to emails!`,
                    },
                ],
            };
        }
        catch (error) {
            // Check if label already exists
            if (error.message && error.message.includes('Label name exists')) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `⚠️ Label Already Exists\n\nThe label "${parsed.name}" already exists in your Gmail account. ` +
                                `You can use it to organize your emails by applying it with the "propose_modify_labels" tool.`,
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error creating label: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleDeleteLabel(args) {
        const parsed = DeleteLabelSchema.parse(args);
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        try {
            // First, list all labels to find the label ID by name
            const labelsResponse = await this.gmail.users.labels.list({
                userId: 'me',
            });
            const labels = labelsResponse.data.labels || [];
            const labelToDelete = labels.find((label) => label.name === parsed.label_name);
            if (!labelToDelete) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ Label Not Found\n\nThe label "${parsed.label_name}" does not exist in your Gmail account. ` +
                                `Check the spelling and try again.`,
                        },
                    ],
                    isError: true,
                };
            }
            // Delete the label
            await this.gmail.users.labels.delete({
                userId: 'me',
                id: labelToDelete.id,
            });
            const reasonText = parsed.reason ? `\nReason: ${parsed.reason}` : '';
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Label Deleted Successfully!\n\n` +
                            `🗑️ Deleted Label: "${parsed.label_name}"\n` +
                            `ID: ${labelToDelete.id}\n\n` +
                            `This label has been permanently removed from your Gmail account. ` +
                            `All emails that had this label will retain their other labels.${reasonText}`,
                    },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error deleting label: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    async handleGetMessage(args) {
        const parsed = GetMessageSchema.parse(args);
        const format = parsed.format || 'full';
        // Ensure token is valid before proceeding
        const isValidToken = await oauthManager.ensureValidToken();
        if (!isValidToken) {
            return {
                content: [
                    {
                        type: 'text',
                        text: '❌ Authentication failed: Token expired or invalid. Please restart Claude Desktop and re-authenticate.',
                    },
                ],
            };
        }
        if (!this.gmail) {
            const auth = oauthManager.getClient();
            this.gmail = google.gmail({ version: 'v1', auth });
        }
        try {
            const response = await this.gmail.users.messages.get({
                userId: 'me',
                id: parsed.id,
                format: 'full',
            });
            const data = response.data;
            const payload = data.payload || {};
            const headers = payload.headers || [];
            const getHeader = (name) => {
                const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
                return h?.value || '';
            };
            const extracted = this.extractBodyFromPayload(payload);
            if (format === 'plain') {
                let out = extracted.body || '(No text body found)';
                if (extracted.partial) {
                    out += '\n\n⚠️ Body extraction incomplete — some parts were stored as attachments. Open in Gmail to see full content.';
                }
                return {
                    content: [{ type: 'text', text: out }],
                };
            }
            const from = getHeader('From');
            const to = getHeader('To');
            const cc = getHeader('Cc');
            const subject = getHeader('Subject');
            const date = getHeader('Date');
            const labels = (data.labelIds || []).join(', ') || 'None';
            const threadId = data.threadId || '';
            let out = `📧 Message ID: ${parsed.id}\n`;
            out += `From: ${from}\n`;
            out += `To: ${to}\n`;
            if (cc)
                out += `Cc: ${cc}\n`;
            out += `Subject: ${subject}\n`;
            out += `Date: ${date}\n`;
            out += `Labels: ${labels}\n`;
            out += `Thread ID: ${threadId}\n`;
            out += `\n──── Body ────\n`;
            out += extracted.body || '(No text body found)';
            if (extracted.attachments.length > 0) {
                out += `\n\n──── Attachments (${extracted.attachments.length}) ────\n`;
                for (const att of extracted.attachments) {
                    const sizeKB = (att.size / 1024).toFixed(1);
                    out += `- ${att.filename} (${att.mimeType}, ${sizeKB} KB)\n`;
                }
            }
            if (extracted.partial) {
                out += `\n\n⚠️ Body extraction incomplete — some text parts were stored as attachments. Open in Gmail to see full content.`;
            }
            return {
                content: [{ type: 'text', text: out }],
            };
        }
        catch (error) {
            const status = error?.code || error?.response?.status;
            if (status === 404) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: '❌ Message not found. ID may be stale — try gmail_search_emails again.',
                        },
                    ],
                    isError: true,
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Error fetching message: ${error.message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    extractBodyFromPayload(payload) {
        const attachments = [];
        let plainText = '';
        let htmlText = '';
        let partial = false;
        const stripHtml = (html) => {
            return html
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        };
        const decodeBase64Url = (data) => {
            try {
                return Buffer.from(data, 'base64url').toString('utf8');
            }
            catch {
                // Fallback for older Node: convert base64url to base64
                const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
                return Buffer.from(b64, 'base64').toString('utf8');
            }
        };
        const walk = (part) => {
            if (!part)
                return;
            const mimeType = part.mimeType || '';
            const body = part.body || {};
            const filename = part.filename || '';
            // Attachment part: has filename + attachmentId
            if (filename && body.attachmentId) {
                attachments.push({
                    filename,
                    size: body.size || 0,
                    mimeType: mimeType || 'application/octet-stream',
                });
            }
            else if (mimeType === 'text/plain' && body.data) {
                if (!plainText) {
                    plainText = decodeBase64Url(body.data);
                }
                else {
                    plainText += '\n\n' + decodeBase64Url(body.data);
                }
            }
            else if (mimeType === 'text/html' && body.data) {
                if (!htmlText) {
                    htmlText = decodeBase64Url(body.data);
                }
                else {
                    htmlText += '\n\n' + decodeBase64Url(body.data);
                }
            }
            else if ((mimeType === 'text/plain' || mimeType === 'text/html') && body.attachmentId && !filename) {
                // Body part too large, split out as separate fetch — flag partial
                partial = true;
            }
            if (Array.isArray(part.parts)) {
                for (const child of part.parts) {
                    walk(child);
                }
            }
        };
        walk(payload);
        // Prefer plain text; fall back to stripped HTML
        let body = plainText.trim();
        if (!body && htmlText) {
            body = stripHtml(htmlText);
        }
        return { body, partial, attachments };
    }
    getMimeType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.ppt': 'application/vnd.ms-powerpoint',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.txt': 'text/plain',
            '.csv': 'text/csv',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.zip': 'application/zip',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime',
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
    async prepareAttachment(attachment) {
        let content;
        let size;
        if (attachment.path) {
            // Read from file
            if (!fs.existsSync(attachment.path)) {
                throw new Error(`Attachment file not found: ${attachment.path}`);
            }
            const buffer = fs.readFileSync(attachment.path);
            content = buffer.toString('base64');
            size = buffer.length;
        }
        else if (attachment.content) {
            // Use provided base64 content
            content = attachment.content;
            size = Buffer.from(content, 'base64').length;
        }
        else {
            throw new Error(`Attachment ${attachment.filename} must have either 'path' or 'content'`);
        }
        const mimeType = attachment.mimeType || this.getMimeType(attachment.filename);
        return { filename: attachment.filename, content, mimeType, size };
    }
    createRawEmail(payload) {
        const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const lines = [];
        // Email headers
        lines.push(`To: ${payload.to.join(', ')}`);
        if (payload.cc)
            lines.push(`Cc: ${payload.cc.join(', ')}`);
        if (payload.bcc)
            lines.push(`Bcc: ${payload.bcc.join(', ')}`);
        lines.push(`Subject: ${payload.subject}`);
        lines.push('MIME-Version: 1.0');
        if (payload.attachments && payload.attachments.length > 0) {
            // Multipart email with attachments
            lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
            lines.push('');
            // Body part
            lines.push(`--${boundary}`);
            if (payload.html) {
                lines.push('Content-Type: text/html; charset=utf-8');
            }
            else {
                lines.push('Content-Type: text/plain; charset=utf-8');
            }
            lines.push('');
            lines.push(payload.body);
            lines.push('');
            // Attachment parts
            for (const attachment of payload.attachments) {
                lines.push(`--${boundary}`);
                lines.push(`Content-Type: ${attachment.mimeType || 'application/octet-stream'}`);
                lines.push('Content-Transfer-Encoding: base64');
                lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
                lines.push('');
                lines.push(attachment.content || '');
                lines.push('');
            }
            lines.push(`--${boundary}--`);
        }
        else {
            // Simple email without attachments
            if (payload.html) {
                lines.push('Content-Type: text/html; charset=utf-8');
            }
            else {
                lines.push('Content-Type: text/plain; charset=utf-8');
            }
            lines.push('');
            lines.push(payload.body);
        }
        const email = lines.join('\r\n');
        return Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    async run() {
        await oauthManager.initialize();
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
}
const server = new GmailMCPServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map