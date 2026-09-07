#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { oauthManager, ProposalCache } from '@flo/shared';
const proposalCache = new ProposalCache();
const ProposeCreateDocSchema = z.object({
    title: z.string(),
    content: z.string().optional(),
    folder_name: z.string().optional(),
});
const ProposeUploadFileSchema = z.object({
    name: z.string(),
    content: z.string(),
    mime_type: z.string().optional(),
    folder_name: z.string().optional(),
});
const ProposeCreateFolderSchema = z.object({
    name: z.string(),
    parent_folder_name: z.string().optional(),
});
const ProposeMoveFileSchema = z.object({
    file_name_or_url: z.string(),
    destination_folder: z.string(),
    reason: z.string().optional(),
});
const ProposeAppendTextSchema = z.object({
    document_id_or_url: z.string(),
    text: z.string(),
    reason: z.string().optional(),
});
const ProposeReplaceTextSchema = z.object({
    document_id_or_url: z.string(),
    search_text: z.string(),
    replacement_text: z.string(),
    replace_all: z.boolean().default(true),
    reason: z.string().optional(),
});
const ProposeDeleteContentSchema = z.object({
    document_id_or_url: z.string(),
    search_text: z.string(),
    reason: z.string().optional(),
});
const ProposeMoveContentSchema = z.object({
    document_id_or_url: z.string(),
    search_text: z.string(),
    insert_after_text: z.string(),
    reason: z.string().optional(),
});
const ProposeInsertAtPositionSchema = z.object({
    document_id_or_url: z.string(),
    text: z.string(),
    position: z.enum(['top', 'after_title', 'before_end', 'end']),
    reason: z.string().optional(),
});
const ProposeApplyFormattingSchema = z.object({
    document_id_or_url: z.string(),
    search_text: z.string(),
    formatting: z.enum(['bold', 'italic', 'underline', 'remove']),
    reason: z.string().optional(),
});
const ExecuteSchema = z.object({
    proposal_ids: z.array(z.string()).min(1).max(10),
    expected_payload_hashes: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
});
class DocsMCPServer {
    server;
    docs;
    drive;
    constructor() {
        this.server = new Server({ name: 'flo-docs-server', version: '0.1.0' }, { capabilities: { tools: {} } });
        this.setupHandlers();
        this.setupErrorHandling();
    }
    setupErrorHandling() {
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'docs_propose_create',
                    description: 'Propose creating a Google Doc. Returns proposal ID. Does NOT create.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: 'Document title' },
                            content: { type: 'string', description: 'Initial content (optional)' },
                            folder_name: { type: 'string', description: 'Folder hint (optional)' },
                        },
                        required: ['title'],
                    },
                },
                {
                    name: 'drive_propose_upload',
                    description: 'Propose uploading file to Drive. Returns proposal ID. Does NOT upload.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'File name' },
                            content: { type: 'string', description: 'File content' },
                            mime_type: { type: 'string', description: 'MIME type (default: text/plain)' },
                            folder_name: { type: 'string', description: 'Folder hint (optional)' },
                        },
                        required: ['name', 'content'],
                    },
                },
                {
                    name: 'docs_preview',
                    description: 'Read-only full stored proposal preview and payload SHA256; includes Drive proposals, no execution or consent.',
                    annotations: { readOnlyHint: true },
                    inputSchema: { type: 'object', properties: { proposal_ids: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string' } } }, required: ['proposal_ids'], additionalProperties: false },
                },
                {
                    name: 'docs_execute',
                    description: 'Execute approved doc/file proposals.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            expected_payload_hashes: { type: 'object', additionalProperties: { type: 'string', pattern: '^[a-f0-9]{64}$' }, description: 'Exact ID-to-payload_hash map from docs_preview, captured by the approval boundary. Not consent.' },
                            proposal_ids: {
                                type: 'array', minItems: 1, maxItems: 10, uniqueItems: true,
                                items: { type: 'string' },
                                description: 'Proposal IDs to execute',
                            },
                        },
                        required: ['proposal_ids', 'expected_payload_hashes'],
                    },
                },
                {
                    name: 'drive_propose_create_folder',
                    description: 'Propose creating a folder in Google Drive. Returns proposal ID. Does NOT create.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Folder name' },
                            parent_folder_name: { type: 'string', description: 'Parent folder hint (optional)' },
                        },
                        required: ['name'],
                    },
                },
                {
                    name: 'drive_propose_move_file',
                    description: 'Propose moving an existing file/document to a different folder. Returns proposal ID. Does NOT move.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            file_name_or_url: { type: 'string', description: 'File name or Google Drive URL to move' },
                            destination_folder: { type: 'string', description: 'Destination folder name' },
                            reason: { type: 'string', description: 'Reason for moving (optional)' },
                        },
                        required: ['file_name_or_url', 'destination_folder'],
                    },
                },
                {
                    name: 'docs_propose_append_text',
                    description: 'Propose appending text to an existing Google Doc. Returns proposal ID. Does NOT edit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            text: { type: 'string', description: 'Text to append to the document' },
                            reason: { type: 'string', description: 'Reason for edit (optional)' },
                        },
                        required: ['document_id_or_url', 'text'],
                    },
                },
                {
                    name: 'docs_propose_replace_text',
                    description: 'Propose replacing text in an existing Google Doc. Returns proposal ID. Does NOT edit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            search_text: { type: 'string', description: 'Text to find and replace' },
                            replacement_text: { type: 'string', description: 'Replacement text' },
                            replace_all: { type: 'boolean', description: 'Replace all occurrences? (default: true)' },
                            reason: { type: 'string', description: 'Reason for edit (optional)' },
                        },
                        required: ['document_id_or_url', 'search_text', 'replacement_text'],
                    },
                },
                {
                    name: 'docs_propose_delete_content',
                    description: 'Propose deleting specific content from a Google Doc. Returns proposal ID. Does NOT edit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            search_text: { type: 'string', description: 'Content to delete' },
                            reason: { type: 'string', description: 'Reason for deletion (optional)' },
                        },
                        required: ['document_id_or_url', 'search_text'],
                    },
                },
                {
                    name: 'docs_propose_move_content',
                    description: 'Propose moving text from one location to another in a document. Returns proposal ID. Does NOT edit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            search_text: { type: 'string', description: 'The text to move' },
                            insert_after_text: { type: 'string', description: 'Text after which to insert (e.g., "Financial Planning")' },
                            reason: { type: 'string', description: 'Reason for moving (optional)' },
                        },
                        required: ['document_id_or_url', 'search_text', 'insert_after_text'],
                    },
                },
                {
                    name: 'docs_propose_insert_at_position',
                    description: 'Propose inserting text at a specific position. Returns proposal ID. Does NOT edit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            text: { type: 'string', description: 'Text to insert' },
                            position: { type: 'string', enum: ['top', 'after_title', 'before_end', 'end'], description: 'Where to insert' },
                            reason: { type: 'string', description: 'Reason for insertion (optional)' },
                        },
                        required: ['document_id_or_url', 'text', 'position'],
                    },
                },
                {
                    name: 'docs_propose_apply_formatting',
                    description: 'Propose applying formatting (bold, italic, etc.) to specific text. Returns proposal ID. Does NOT edit.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            search_text: { type: 'string', description: 'Text to format' },
                            formatting: { type: 'string', enum: ['bold', 'italic', 'underline', 'remove'], description: 'Type of formatting' },
                            reason: { type: 'string', description: 'Reason for formatting (optional)' },
                        },
                        required: ['document_id_or_url', 'search_text', 'formatting'],
                    },
                },
                {
                    name: 'docs_read_content',
                    description: 'READ and display the actual full content of a Google Doc. Use this to see what is REALLY in the document.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                        },
                        required: ['document_id_or_url'],
                    },
                },
                {
                    name: 'docs_verify_change',
                    description: 'Verify if a specific text exists in the document. Use after making changes to confirm they worked.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            search_text: { type: 'string', description: 'Text to search for in the document' },
                        },
                        required: ['document_id_or_url', 'search_text'],
                    },
                },
                {
                    name: 'docs_debug_structure',
                    description: 'Show the exact internal structure of the document with all text runs. Use this to see HOW text is actually stored (split across runs).',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            document_id_or_url: { type: 'string', description: 'Document ID or Google Docs URL' },
                            search_term: { type: 'string', description: 'Optional: search for lines containing this term' },
                        },
                        required: ['document_id_or_url'],
                    },
                },
                {
                    name: 'drive_search',
                    description: 'Search Google Drive by file/doc name. Returns matching files with id, name, mimeType, modifiedTime, and webViewLink. Use this BEFORE docs_read_content / docs_propose_append_text when the user references a doc by name instead of URL. Supports partial-name matching ("Brand Book" finds "TSAI Brand Book").',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Name or partial name of the file to find' },
                            mime_type: { type: 'string', description: 'Optional Google MIME type filter, e.g. "application/vnd.google-apps.document" for Docs, "application/vnd.google-apps.spreadsheet" for Sheets, "application/vnd.google-apps.folder" for folders' },
                            limit: { type: 'number', description: 'Max results (default 10)' },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'drive_list_folder',
                    description: 'List the contents of a Google Drive folder, sorted by most recently modified first. Use this for queries like "my most recent doc in TSBS folder" — first call drive_search with mime_type for folder to get the folder ID, then call this. Returns id, name, mimeType, modifiedTime, webViewLink for each file.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            folder_id: { type: 'string', description: 'The Drive folder ID (from drive_search results)' },
                            mime_type: { type: 'string', description: 'Optional filter, e.g. "application/vnd.google-apps.document" to list only Docs' },
                            limit: { type: 'number', description: 'Max results (default 25)' },
                        },
                        required: ['folder_id'],
                    },
                },
                {
                    name: 'docs_list_pending',
                    description: 'List pending doc/file proposals.',
                    inputSchema: { type: 'object', properties: {} },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                if (!oauthManager.isAuthenticated()) {
                    return {
                        content: [{ type: 'text', text: 'Error: Not authenticated.' }],
                    };
                }
                switch (request.params.name) {
                    case 'docs_propose_create':
                        return await this.handleProposeCreateDoc(request.params.arguments);
                    case 'drive_propose_upload':
                        return await this.handleProposeUploadFile(request.params.arguments);
                    case 'drive_propose_create_folder':
                        return await this.handleProposeCreateFolder(request.params.arguments);
                    case 'drive_propose_move_file':
                        return await this.handleProposeMoveFile(request.params.arguments);
                    case 'docs_propose_append_text':
                        return await this.handleProposeAppendText(request.params.arguments);
                    case 'docs_propose_replace_text':
                        return await this.handleProposeReplaceText(request.params.arguments);
                    case 'docs_propose_delete_content':
                        return await this.handleProposeDeleteContent(request.params.arguments);
                    case 'docs_propose_move_content':
                        return await this.handleProposeMoveContent(request.params.arguments);
                    case 'docs_propose_insert_at_position':
                        return await this.handleProposeInsertAtPosition(request.params.arguments);
                    case 'docs_propose_apply_formatting':
                        return await this.handleProposeApplyFormatting(request.params.arguments);
                    case 'docs_preview':
                        return proposalCache.previewTool(request.params.arguments, 'docs');
                    case 'docs_execute':
                        return await this.handleExecute(request.params.arguments);
                    case 'docs_read_content':
                        return await this.handleReadContent(request.params.arguments);
                    case 'docs_verify_change':
                        return await this.handleVerifyChange(request.params.arguments);
                    case 'docs_debug_structure':
                        return await this.handleDebugStructure(request.params.arguments);
                    case 'docs_list_pending':
                        return await this.handleListPending();
                    case 'drive_search':
                        return await this.handleDriveSearch(request.params.arguments);
                    case 'drive_list_folder':
                        return await this.handleDriveListFolder(request.params.arguments);
                    default:
                        return {
                            content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
                            isError: true,
                        };
                }
            }
            catch (error) {
                return {
                    content: [{ type: 'text', text: `Error: ${error.message}` }],
                    isError: true,
                };
            }
        });
    }
    async handleProposeCreateDoc(args) {
        const parsed = ProposeCreateDocSchema.parse(args);
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#doc-${parsed.title.replace(/\s/g, '-')}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'docs.create',
            payload: parsed,
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [{
                        type: 'text',
                        text: `⚠️ Duplicate: Doc with this title already created.`,
                    }],
            };
        }
        proposalCache.saveProposal(proposal);
        const preview = parsed.content
            ? parsed.content.substring(0, 100) + (parsed.content.length > 100 ? '...' : '')
            : '(empty doc)';
        return {
            content: [{
                    type: 'text',
                    text: `📄 Doc Proposal Created\n\n` +
                        `ID: ${proposalId}\n` +
                        `Title: ${parsed.title}\n` +
                        `Folder: ${parsed.folder_name || 'My Drive'}\n` +
                        `Content: ${preview}\n\n` +
                        `To create, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeUploadFile(args) {
        const parsed = ProposeUploadFileSchema.parse(args);
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#file-${parsed.name.replace(/\s/g, '-')}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'drive.upload',
            payload: parsed,
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [{
                        type: 'text',
                        text: `⚠️ Duplicate: File already uploaded.`,
                    }],
            };
        }
        proposalCache.saveProposal(proposal);
        const preview = parsed.content.substring(0, 100) + (parsed.content.length > 100 ? '...' : '');
        return {
            content: [{
                    type: 'text',
                    text: `📁 File Upload Proposal\n\n` +
                        `ID: ${proposalId}\n` +
                        `Name: ${parsed.name}\n` +
                        `Type: ${parsed.mime_type || 'text/plain'}\n` +
                        `Folder: ${parsed.folder_name || 'My Drive'}\n` +
                        `Content: ${preview}\n\n` +
                        `To upload, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeCreateFolder(args) {
        const parsed = ProposeCreateFolderSchema.parse(args);
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#folder-${parsed.name.replace(/\s/g, '-')}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'drive.create_folder',
            payload: parsed,
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [{
                        type: 'text',
                        text: `⚠️ Duplicate: Folder with this name already created.`,
                    }],
            };
        }
        proposalCache.saveProposal(proposal);
        return {
            content: [{
                    type: 'text',
                    text: `📁 Folder Creation Proposal\n\n` +
                        `ID: ${proposalId}\n` +
                        `Name: ${parsed.name}\n` +
                        `Parent: ${parsed.parent_folder_name || 'My Drive'}\n\n` +
                        `To create, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeMoveFile(args) {
        const parsed = ProposeMoveFileSchema.parse(args);
        const timestamp = new Date().toISOString();
        // Extract file ID from URL or use name to search
        let fileId = null;
        let fileName = null;
        if (parsed.file_name_or_url.includes('docs.google.com') || parsed.file_name_or_url.includes('drive.google.com')) {
            // Extract file ID from URL
            const match = parsed.file_name_or_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (match) {
                fileId = match[1];
            }
        }
        else {
            // Treat as file name
            fileName = parsed.file_name_or_url;
        }
        const clientActionId = `${timestamp}#move-${fileId || fileName?.replace(/\s/g, '-')}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'drive.move_file',
            payload: { ...parsed, fileId, fileName },
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        if (proposalCache.checkDuplicate(clientActionId)) {
            return {
                content: [{
                        type: 'text',
                        text: `⚠️ Duplicate: File move already requested.`,
                    }],
            };
        }
        proposalCache.saveProposal(proposal);
        const reasonText = parsed.reason ? `\nReason: ${parsed.reason}` : '';
        return {
            content: [{
                    type: 'text',
                    text: `📁 File Move Proposal\n\n` +
                        `ID: ${proposalId}\n` +
                        `File: ${parsed.file_name_or_url}\n` +
                        `Destination: ${parsed.destination_folder}${reasonText}\n\n` +
                        `To move, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeAppendText(args) {
        const parsed = ProposeAppendTextSchema.parse(args);
        const documentId = this.extractDocumentId(parsed.document_id_or_url);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL. Please provide a valid Google Docs URL or document ID.',
                    }],
                isError: true,
            };
        }
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#append-${documentId}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'docs.append_text',
            payload: { ...parsed, documentId },
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        proposalCache.saveProposal(proposal);
        const textPreview = parsed.text.length > 80
            ? parsed.text.substring(0, 80) + '...'
            : parsed.text;
        return {
            content: [{
                    type: 'text',
                    text: `📝 Document Edit Proposal (Append)\n\n` +
                        `ID: ${proposalId}\n` +
                        `Document: ${documentId}\n` +
                        `Text to append: ${textPreview}\n` +
                        `${parsed.reason ? `Reason: ${parsed.reason}\n` : ''}` +
                        `\nTo execute, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeReplaceText(args) {
        const parsed = ProposeReplaceTextSchema.parse(args);
        const documentId = this.extractDocumentId(parsed.document_id_or_url);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL. Please provide a valid Google Docs URL or document ID.',
                    }],
                isError: true,
            };
        }
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#replace-${documentId}-${parsed.search_text.substring(0, 20)}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'docs.replace_text',
            payload: { ...parsed, documentId },
            risk: 'medium',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        proposalCache.saveProposal(proposal);
        const searchPreview = parsed.search_text.length > 60
            ? parsed.search_text.substring(0, 60) + '...'
            : parsed.search_text;
        const replacePreview = parsed.replacement_text.length > 60
            ? parsed.replacement_text.substring(0, 60) + '...'
            : parsed.replacement_text;
        return {
            content: [{
                    type: 'text',
                    text: `📝 Document Edit Proposal (Replace)\n\n` +
                        `ID: ${proposalId}\n` +
                        `Document: ${documentId}\n` +
                        `Find: "${searchPreview}"\n` +
                        `Replace with: "${replacePreview}"\n` +
                        `Replace all: ${parsed.replace_all ? 'Yes' : 'Only first occurrence'}\n` +
                        `${parsed.reason ? `Reason: ${parsed.reason}\n` : ''}` +
                        `\nTo execute, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeDeleteContent(args) {
        const parsed = ProposeDeleteContentSchema.parse(args);
        const documentId = this.extractDocumentId(parsed.document_id_or_url);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL. Please provide a valid Google Docs URL or document ID.',
                    }],
                isError: true,
            };
        }
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#delete-${documentId}-${parsed.search_text.substring(0, 20)}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'docs.delete_content',
            payload: { ...parsed, documentId },
            risk: 'high',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        proposalCache.saveProposal(proposal);
        const textPreview = parsed.search_text.length > 60
            ? parsed.search_text.substring(0, 60) + '...'
            : parsed.search_text;
        return {
            content: [{
                    type: 'text',
                    text: `⚠️ Document Edit Proposal (Delete) - HIGH RISK\n\n` +
                        `ID: ${proposalId}\n` +
                        `Document: ${documentId}\n` +
                        `Content to delete: "${textPreview}"\n` +
                        `${parsed.reason ? `Reason: ${parsed.reason}\n` : ''}` +
                        `\n⚠️ This action cannot be undone. Please review carefully.\n` +
                        `To execute, say: "approve ${proposalId}"`,
                }],
        };
    }
    extractDocumentId(urlOrId) {
        // If it's a URL, extract the ID
        if (urlOrId.includes('docs.google.com')) {
            const match = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
            return match ? match[1] : null;
        }
        // If it's already an ID, return as-is
        if (/^[a-zA-Z0-9-_]{40,}$/.test(urlOrId)) {
            return urlOrId;
        }
        return null;
    }
    async handleProposeMoveContent(args) {
        const parsed = ProposeMoveContentSchema.parse(args);
        const documentId = this.extractDocumentId(parsed.document_id_or_url);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL.',
                    }],
                isError: true,
            };
        }
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#move-${documentId}-${parsed.search_text.substring(0, 20)}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'docs.move_content',
            payload: { ...parsed, documentId },
            risk: 'medium',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        proposalCache.saveProposal(proposal);
        const textPreview = parsed.search_text.length > 60
            ? parsed.search_text.substring(0, 60) + '...'
            : parsed.search_text;
        return {
            content: [{
                    type: 'text',
                    text: `📝 Document Move Proposal\n\n` +
                        `ID: ${proposalId}\n` +
                        `Document: ${documentId}\n` +
                        `Move: "${textPreview}"\n` +
                        `Insert after: "${parsed.insert_after_text}"\n` +
                        `${parsed.reason ? `Reason: ${parsed.reason}\n` : ''}` +
                        `\nTo execute, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeInsertAtPosition(args) {
        const parsed = ProposeInsertAtPositionSchema.parse(args);
        const documentId = this.extractDocumentId(parsed.document_id_or_url);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL.',
                    }],
                isError: true,
            };
        }
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#insert-${documentId}-${parsed.position}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'docs.insert_at_position',
            payload: { ...parsed, documentId },
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        proposalCache.saveProposal(proposal);
        const textPreview = parsed.text.length > 80
            ? parsed.text.substring(0, 80) + '...'
            : parsed.text;
        return {
            content: [{
                    type: 'text',
                    text: `📝 Document Insert Proposal\n\n` +
                        `ID: ${proposalId}\n` +
                        `Document: ${documentId}\n` +
                        `Text: "${textPreview}"\n` +
                        `Position: ${parsed.position}\n` +
                        `${parsed.reason ? `Reason: ${parsed.reason}\n` : ''}` +
                        `\nTo execute, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleProposeApplyFormatting(args) {
        const parsed = ProposeApplyFormattingSchema.parse(args);
        const documentId = this.extractDocumentId(parsed.document_id_or_url);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL.',
                    }],
                isError: true,
            };
        }
        const timestamp = new Date().toISOString();
        const clientActionId = `${timestamp}#format-${documentId}-${parsed.search_text.substring(0, 20)}-${parsed.formatting}`;
        const proposalId = `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const proposal = {
            id: proposalId,
            client_action_id: clientActionId,
            type: 'docs.apply_formatting',
            payload: { ...parsed, documentId },
            risk: 'low',
            violations: [],
            created_at: timestamp,
            executed: false,
        };
        proposalCache.saveProposal(proposal);
        const textPreview = parsed.search_text.length > 60
            ? parsed.search_text.substring(0, 60) + '...'
            : parsed.search_text;
        const formattingLabel = {
            'bold': '**bold**',
            'italic': '*italic*',
            'underline': '_underline_',
            'remove': 'remove formatting'
        }[parsed.formatting];
        return {
            content: [{
                    type: 'text',
                    text: `🎨 Document Formatting Proposal\n\n` +
                        `ID: ${proposalId}\n` +
                        `Document: ${documentId}\n` +
                        `Text: "${textPreview}"\n` +
                        `Formatting: ${formattingLabel}\n` +
                        `${parsed.reason ? `Reason: ${parsed.reason}\n` : ''}` +
                        `\nTo execute, say: "approve ${proposalId}"`,
                }],
        };
    }
    async handleExecute(args) {
        const parsed = ExecuteSchema.parse(args);
        const claimed = proposalCache.claimProposals(parsed.proposal_ids, parsed.expected_payload_hashes, 'docs');
        try {
            return await this.executeClaimed(parsed, claimed);
        } catch (error) {
            throw new Error('Execution interrupted. Claim retained; reconcile before resubmission.', { cause: error });
        }
    }
    async executeClaimed(parsed, claimed) {
        if (!this.docs || !this.drive) {
            const auth = oauthManager.getClient();
            this.docs = google.docs({ version: 'v1', auth });
            this.drive = google.drive({ version: 'v3', auth });
        }
        const results = [];
        for (const proposal of claimed) {
            const proposalId = proposal.id;
            try {
                if (proposal.type === 'docs.create') {
                    const result = await this.executeCreateDoc(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'drive.upload') {
                    const result = await this.executeUploadFile(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'drive.create_folder') {
                    const result = await this.executeCreateFolder(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'drive.move_file') {
                    const result = await this.executeMoveFile(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'docs.append_text') {
                    const result = await this.executeAppendText(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'docs.replace_text') {
                    const result = await this.executeReplaceText(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'docs.delete_content') {
                    const result = await this.executeDeleteContent(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'docs.move_content') {
                    const result = await this.executeMoveContent(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'docs.insert_at_position') {
                    const result = await this.executeInsertAtPosition(proposal);
                    results.push(result);
                }
                else if (proposal.type === 'docs.apply_formatting') {
                    const result = await this.executeApplyFormatting(proposal);
                    results.push(result);
                }
            }
            catch (error) {
                results.push(`❌ ${proposalId}: ${error.message}. Claim retained; reconcile before resubmission.`);
            }
        }
        return {
            content: [{
                    type: 'text',
                    text: `📊 Execution Results\n\n${results.join('\n\n')}\n\nAll claims retained. For any unsuccessful or ambiguous outcome, reconcile before resubmission.`,
                }],
        };
    }
    async executeCreateDoc(proposal) {
        const payload = proposal.payload;
        const createResponse = await this.docs.documents.create({
            requestBody: { title: payload.title },
        });
        const docId = createResponse.data.documentId;
        // Move to specified folder if provided
        if (payload.folder_name) {
            await this.moveFileToFolder(docId, payload.folder_name);
        }
        if (payload.content) {
            await this.docs.documents.batchUpdate({
                documentId: docId,
                requestBody: {
                    requests: [{
                            insertText: {
                                location: { index: 1 },
                                text: payload.content,
                            },
                        }],
                },
            });
        }
        const docUrl = `https://docs.google.com/document/d/${docId}/edit`;
        proposalCache.markExecuted(proposal.id, {
            documentId: docId,
            webViewLink: docUrl,
            title: payload.title,
        });
        return (`✅ ${proposal.id}: Doc created\n` +
            `   Title: ${payload.title}\n` +
            `   Link: ${docUrl}`);
    }
    async executeUploadFile(proposal) {
        const payload = proposal.payload;
        // Create a readable stream from the content
        const { Readable } = await import('stream');
        const contentStream = new Readable();
        contentStream.push(payload.content);
        contentStream.push(null); // End the stream
        const response = await this.drive.files.create({
            requestBody: {
                name: payload.name,
                mimeType: payload.mime_type || 'text/plain'
            },
            media: {
                mimeType: payload.mime_type || 'text/plain',
                body: contentStream,
            },
            fields: 'id, name, webViewLink',
        });
        const fileId = response.data.id;
        const webViewLink = response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
        proposalCache.markExecuted(proposal.id, {
            fileId,
            webViewLink,
            name: payload.name,
        });
        return (`✅ ${proposal.id}: File uploaded\n` +
            `   Name: ${payload.name}\n` +
            `   Link: ${webViewLink}`);
    }
    async executeCreateFolder(proposal) {
        const payload = proposal.payload;
        // Create folder metadata
        const folderMetadata = {
            name: payload.name,
            mimeType: 'application/vnd.google-apps.folder',
        };
        // If parent folder is specified, try to find it
        let parentId = undefined;
        if (payload.parent_folder_name) {
            try {
                const searchResponse = await this.drive.files.list({
                    q: `name='${payload.parent_folder_name}' and mimeType='application/vnd.google-apps.folder'`,
                    fields: 'files(id, name)',
                });
                if (searchResponse.data.files && searchResponse.data.files.length > 0) {
                    parentId = searchResponse.data.files[0].id;
                    folderMetadata.parents = [parentId];
                }
            }
            catch (error) {
                // If parent folder search fails, continue without parent
            }
        }
        const response = await this.drive.files.create({
            requestBody: folderMetadata,
            fields: 'id, name, webViewLink',
        });
        const folderId = response.data.id;
        const webViewLink = response.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
        proposalCache.markExecuted(proposal.id, {
            folderId,
            webViewLink,
            name: payload.name,
            parentId: parentId || 'root',
        });
        return (`✅ ${proposal.id}: Folder created\n` +
            `   Name: ${payload.name}\n` +
            `   Parent: ${payload.parent_folder_name || 'My Drive'}\n` +
            `   Link: ${webViewLink}`);
    }
    async executeMoveFile(proposal) {
        const payload = proposal.payload;
        let fileId = payload.fileId;
        // If no fileId, search by name
        if (!fileId && payload.fileName) {
            try {
                const searchResponse = await this.drive.files.list({
                    q: `name='${payload.fileName}'`,
                    fields: 'files(id, name)',
                });
                if (searchResponse.data.files && searchResponse.data.files.length > 0) {
                    fileId = searchResponse.data.files[0].id;
                }
                else {
                    return `❌ ${proposal.id}: File '${payload.fileName}' not found`;
                }
            }
            catch (error) {
                return `❌ ${proposal.id}: Error finding file - ${error.message}`;
            }
        }
        if (!fileId) {
            return `❌ ${proposal.id}: Could not identify file to move`;
        }
        // Find destination folder
        let folderId = null;
        try {
            const searchResponse = await this.drive.files.list({
                q: `name='${payload.destination_folder}' and mimeType='application/vnd.google-apps.folder'`,
                fields: 'files(id, name)',
            });
            if (searchResponse.data.files && searchResponse.data.files.length > 0) {
                folderId = searchResponse.data.files[0].id;
            }
            else {
                return `❌ ${proposal.id}: Destination folder '${payload.destination_folder}' not found`;
            }
        }
        catch (error) {
            return `❌ ${proposal.id}: Error finding destination folder - ${error.message}`;
        }
        // Get current file info
        const fileResponse = await this.drive.files.get({
            fileId: fileId,
            fields: 'name, parents',
        });
        const fileName = fileResponse.data.name;
        const currentParents = fileResponse.data.parents || [];
        // Move the file
        await this.drive.files.update({
            fileId: fileId,
            addParents: folderId,
            removeParents: currentParents.join(','),
        });
        const fileLink = `https://drive.google.com/file/d/${fileId}/view`;
        proposalCache.markExecuted(proposal.id, {
            fileId,
            fileName,
            oldParents: currentParents,
            newParent: folderId,
            destinationFolder: payload.destination_folder,
        });
        return (`✅ ${proposal.id}: File moved successfully\n` +
            `   File: ${fileName}\n` +
            `   Moved to: ${payload.destination_folder}\n` +
            `   Link: ${fileLink}`);
    }
    async executeAppendText(proposal) {
        const payload = proposal.payload;
        const documentId = payload.documentId;
        try {
            // Get the document to find the end position
            const doc = await this.docs.documents.get({
                documentId: documentId,
            });
            // Find the end index of the document
            // The document structure has body.content array with endIndex markers
            let endIndex = 1;
            if (doc.data.body?.content && doc.data.body.content.length > 0) {
                const lastContent = doc.data.body.content[doc.data.body.content.length - 1];
                endIndex = lastContent.endIndex || 1;
            }
            // Add newline before the text to ensure proper formatting
            const textToInsert = '\n' + payload.text;
            // Append text to the end of the document
            await this.docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: {
                    requests: [{
                            insertText: {
                                location: { index: endIndex - 1 }, // -1 because endIndex includes the final newline
                                text: textToInsert,
                            },
                        }],
                },
            });
            const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
            proposalCache.markExecuted(proposal.id, {
                documentId,
                action: 'append_text',
                textLength: payload.text.length,
                webViewLink: docUrl,
            });
            return (`✅ ${proposal.id}: Text appended to document\n` +
                `   Document: ${documentId}\n` +
                `   Characters added: ${payload.text.length}\n` +
                `   Link: ${docUrl}`);
        }
        catch (error) {
            throw new Error(`Failed to append text: ${error.message}`);
        }
    }
    async executeReplaceText(proposal) {
        const payload = proposal.payload;
        const documentId = payload.documentId;
        try {
            // IMPORTANT: Use replaceAllText which is more reliable than manual find/replace
            const requests = [{
                    replaceAllText: {
                        containsText: {
                            text: payload.search_text,
                            matchCase: true, // Exact match (case sensitive)
                        },
                        replaceText: payload.replacement_text,
                    },
                }];
            // Execute the replacement
            const response = await this.docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: { requests },
            });
            // Check if the replacement actually happened
            const occurrencesReplaced = response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
            const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
            if (occurrencesReplaced === 0) {
                return (`⚠️ ${proposal.id}: Text NOT FOUND or NOT REPLACED\n` +
                    `   Search text: "${payload.search_text}"\n` +
                    `   This text does not exist in the document (or has different spacing/capitalization)\n` +
                    `   Link: ${docUrl}`);
            }
            proposalCache.markExecuted(proposal.id, {
                documentId,
                action: 'replace_text',
                searchText: payload.search_text,
                replacementText: payload.replacement_text,
                occurrencesReplaced: occurrencesReplaced,
                webViewLink: docUrl,
            });
            return (`✅ ${proposal.id}: Text replaced in document\n` +
                `   Search: "${payload.search_text}"\n` +
                `   Replace with: "${payload.replacement_text}"\n` +
                `   Occurrences changed: ${occurrencesReplaced}\n` +
                `   Link: ${docUrl}`);
        }
        catch (error) {
            throw new Error(`Failed to replace text: ${error.message}`);
        }
    }
    async executeDeleteContent(proposal) {
        const payload = proposal.payload;
        const documentId = payload.documentId;
        try {
            // Use replaceAllText with empty string to delete - more reliable than manual find/delete
            const requests = [{
                    replaceAllText: {
                        containsText: {
                            text: payload.search_text,
                            matchCase: true, // Exact match
                        },
                        replaceText: '', // Replace with empty string = delete
                    },
                }];
            // Execute the deletion
            const response = await this.docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: { requests },
            });
            // Check if deletion actually happened
            const occurrencesDeleted = response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
            const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
            if (occurrencesDeleted === 0) {
                return (`⚠️ ${proposal.id}: Content NOT FOUND or NOT DELETED\n` +
                    `   Search text: "${payload.search_text}"\n` +
                    `   This text does not exist in the document\n` +
                    `   Link: ${docUrl}`);
            }
            proposalCache.markExecuted(proposal.id, {
                documentId,
                action: 'delete_content',
                deletedText: payload.search_text,
                occurrencesDeleted: occurrencesDeleted,
                webViewLink: docUrl,
            });
            return (`✅ ${proposal.id}: Content deleted from document\n` +
                `   Deleted: "${payload.search_text}"\n` +
                `   Occurrences deleted: ${occurrencesDeleted}\n` +
                `   Link: ${docUrl}`);
        }
        catch (error) {
            throw new Error(`Failed to delete content: ${error.message}`);
        }
    }
    async executeMoveContent(proposal) {
        const payload = proposal.payload;
        const documentId = payload.documentId;
        try {
            // Get document to find content to move
            const doc = await this.docs.documents.get({
                documentId: documentId,
            });
            // Extract all text to find source and insertion point
            let fullText = '';
            let textPositions = [];
            if (doc.data.body?.content) {
                for (const content of doc.data.body.content) {
                    if (content.paragraph?.elements) {
                        for (const element of content.paragraph.elements) {
                            if (element.textRun?.content) {
                                const startIndex = fullText.length;
                                fullText += element.textRun.content;
                                textPositions.push({
                                    text: element.textRun.content,
                                    startIndex: startIndex,
                                    endIndex: fullText.length
                                });
                            }
                        }
                    }
                }
            }
            // Find source text
            const sourceIndex = fullText.indexOf(payload.search_text);
            if (sourceIndex === -1) {
                return `⚠️ ${proposal.id}: Text to move not found`;
            }
            // Find insertion point
            const insertIndex = fullText.indexOf(payload.insert_after_text);
            if (insertIndex === -1) {
                return `⚠️ ${proposal.id}: Insertion anchor text not found`;
            }
            const insertionPoint = insertIndex + payload.insert_after_text.length;
            // Create batch update: delete from bottom, insert at top
            const requests = [];
            // First, delete from original location
            requests.push({
                deleteContentRange: {
                    range: {
                        startIndex: sourceIndex,
                        endIndex: sourceIndex + payload.search_text.length,
                    },
                },
            });
            // Then, insert at new location (adjust for the deletion above)
            const newInsertIndex = insertionPoint > sourceIndex
                ? insertionPoint - payload.search_text.length
                : insertionPoint;
            requests.push({
                insertText: {
                    location: { index: newInsertIndex },
                    text: '\n' + payload.search_text,
                },
            });
            await this.docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: { requests },
            });
            const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
            proposalCache.markExecuted(proposal.id, {
                documentId,
                action: 'move_content',
                source: payload.search_text,
                insertAfter: payload.insert_after_text,
                webViewLink: docUrl,
            });
            return (`✅ ${proposal.id}: Content moved successfully\n` +
                `   Source: "${payload.search_text}"\n` +
                `   Moved after: "${payload.insert_after_text}"\n` +
                `   Link: ${docUrl}`);
        }
        catch (error) {
            throw new Error(`Failed to move content: ${error.message}`);
        }
    }
    async executeInsertAtPosition(proposal) {
        const payload = proposal.payload;
        const documentId = payload.documentId;
        try {
            const doc = await this.docs.documents.get({
                documentId: documentId,
            });
            let insertIndex = 1;
            switch (payload.position) {
                case 'top':
                    insertIndex = 1;
                    break;
                case 'after_title':
                    // Find first heading or first paragraph
                    if (doc.data.body?.content?.length > 0) {
                        const firstContent = doc.data.body.content[0];
                        insertIndex = firstContent.endIndex || 1;
                    }
                    break;
                case 'before_end':
                    // Insert before the last character
                    if (doc.data.body?.content?.length > 0) {
                        const lastContent = doc.data.body.content[doc.data.body.content.length - 1];
                        insertIndex = (lastContent.endIndex || 1) - 1;
                    }
                    break;
                case 'end':
                    // Insert at the very end
                    if (doc.data.body?.content?.length > 0) {
                        const lastContent = doc.data.body.content[doc.data.body.content.length - 1];
                        insertIndex = lastContent.endIndex || 1;
                    }
                    break;
            }
            await this.docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: {
                    requests: [{
                            insertText: {
                                location: { index: insertIndex },
                                text: '\n' + payload.text,
                            },
                        }],
                },
            });
            const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
            proposalCache.markExecuted(proposal.id, {
                documentId,
                action: 'insert_at_position',
                position: payload.position,
                textLength: payload.text.length,
                webViewLink: docUrl,
            });
            return (`✅ ${proposal.id}: Text inserted at position\n` +
                `   Position: ${payload.position}\n` +
                `   Text: "${payload.text.substring(0, 60)}..."\n` +
                `   Link: ${docUrl}`);
        }
        catch (error) {
            throw new Error(`Failed to insert at position: ${error.message}`);
        }
    }
    async executeApplyFormatting(proposal) {
        const payload = proposal.payload;
        const documentId = payload.documentId;
        try {
            const doc = await this.docs.documents.get({
                documentId: documentId,
            });
            // Extract all text to find the target text
            let fullText = '';
            let charIndexToElementIndex = new Map();
            if (doc.data.body?.content) {
                for (const content of doc.data.body.content) {
                    if (content.paragraph?.elements) {
                        for (let elemIdx = 0; elemIdx < content.paragraph.elements.length; elemIdx++) {
                            const element = content.paragraph.elements[elemIdx];
                            if (element.textRun?.content) {
                                const startChar = fullText.length;
                                for (let i = 0; i < element.textRun.content.length; i++) {
                                    charIndexToElementIndex.set(startChar + i, { elementIndex: elemIdx, textRunIndex: 0 });
                                }
                                fullText += element.textRun.content;
                            }
                        }
                    }
                }
            }
            // Find the text to format
            const textIndex = fullText.indexOf(payload.search_text);
            if (textIndex === -1) {
                return `⚠️ ${proposal.id}: Text to format not found`;
            }
            // For now, use replaceAllText with same text but different formatting
            // Note: This is a simplified approach - full formatting requires more complex logic
            const requests = [];
            if (payload.formatting === 'bold') {
                requests.push({
                    replaceAllText: {
                        containsText: { text: payload.search_text, matchCase: false },
                        replaceText: payload.search_text,
                    },
                });
            }
            // Additional formatting would require more complex text styling operations
            if (requests.length > 0) {
                await this.docs.documents.batchUpdate({
                    documentId: documentId,
                    requestBody: { requests },
                });
            }
            const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
            proposalCache.markExecuted(proposal.id, {
                documentId,
                action: 'apply_formatting',
                text: payload.search_text,
                formatting: payload.formatting,
                webViewLink: docUrl,
            });
            return (`✅ ${proposal.id}: Formatting applied\n` +
                `   Text: "${payload.search_text}"\n` +
                `   Formatting: ${payload.formatting}\n` +
                `   Link: ${docUrl}`);
        }
        catch (error) {
            throw new Error(`Failed to apply formatting: ${error.message}`);
        }
    }
    async handleReadContent(args) {
        const urlOrId = args.document_id_or_url;
        const documentId = this.extractDocumentId(urlOrId);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL.',
                    }],
                isError: true,
            };
        }
        try {
            if (!this.docs) {
                const auth = oauthManager.getClient();
                this.docs = google.docs({ version: 'v1', auth });
            }
            const doc = await this.docs.documents.get({
                documentId: documentId,
            });
            // Extract all text content
            let content = '';
            if (doc.data.body?.content) {
                for (const element of doc.data.body.content) {
                    if (element.paragraph?.elements) {
                        for (const el of element.paragraph.elements) {
                            if (el.textRun?.content) {
                                content += el.textRun.content;
                            }
                        }
                    }
                    content += '\n';
                }
            }
            return {
                content: [{
                        type: 'text',
                        text: `📄 DOCUMENT CONTENT (Current State)\n\n` +
                            `Document ID: ${documentId}\n` +
                            `Document Title: ${doc.data.title}\n\n` +
                            `=== FULL CONTENT ===\n` +
                            content +
                            `\n=== END CONTENT ===\n\n` +
                            `Use this to see exactly what's in your document right now.`,
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `❌ Error reading document: ${error.message}`,
                    }],
                isError: true,
            };
        }
    }
    async handleVerifyChange(args) {
        const urlOrId = args.document_id_or_url;
        const searchText = args.search_text;
        const documentId = this.extractDocumentId(urlOrId);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL.',
                    }],
                isError: true,
            };
        }
        try {
            if (!this.docs) {
                const auth = oauthManager.getClient();
                this.docs = google.docs({ version: 'v1', auth });
            }
            const doc = await this.docs.documents.get({
                documentId: documentId,
            });
            // Extract all text content
            let fullContent = '';
            if (doc.data.body?.content) {
                for (const element of doc.data.body.content) {
                    if (element.paragraph?.elements) {
                        for (const el of element.paragraph.elements) {
                            if (el.textRun?.content) {
                                fullContent += el.textRun.content;
                            }
                        }
                    }
                    fullContent += '\n';
                }
            }
            const found = fullContent.includes(searchText);
            if (found) {
                return {
                    content: [{
                            type: 'text',
                            text: `✅ FOUND! The text exists in your document:\n\n` +
                                `"${searchText}"\n\n` +
                                `This confirms the change was successful!`,
                        }],
                };
            }
            else {
                return {
                    content: [{
                            type: 'text',
                            text: `❌ NOT FOUND! The text does NOT exist in your document:\n\n` +
                                `"${searchText}"\n\n` +
                                `This means the change FAILED or the text is different than expected.\n\n` +
                                `Use "docs_read_content" to see the actual document content.`,
                        }],
                };
            }
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `❌ Error verifying: ${error.message}`,
                    }],
                isError: true,
            };
        }
    }
    async handleDebugStructure(args) {
        const urlOrId = args.document_id_or_url;
        const searchTerm = args.search_term || 'New TV';
        const documentId = this.extractDocumentId(urlOrId);
        if (!documentId) {
            return {
                content: [{
                        type: 'text',
                        text: '❌ Invalid document ID or URL.',
                    }],
                isError: true,
            };
        }
        try {
            if (!this.docs) {
                const auth = oauthManager.getClient();
                this.docs = google.docs({ version: 'v1', auth });
            }
            const doc = await this.docs.documents.get({
                documentId: documentId,
            });
            // Show the RAW structure
            let output = `📊 DOCUMENT STRUCTURE DEBUG\n\n`;
            output += `Looking for lines containing: "${searchTerm}"\n\n`;
            output += `=== PARAGRAPH STRUCTURE ===\n\n`;
            let paragraphCount = 0;
            if (doc.data.body?.content) {
                for (const element of doc.data.body.content) {
                    if (element.paragraph?.elements) {
                        let paragraphText = '';
                        let textRunCount = 0;
                        // Show each text run separately
                        for (const el of element.paragraph.elements) {
                            if (el.textRun?.content) {
                                const content = el.textRun.content;
                                paragraphText += content;
                                textRunCount++;
                                output += `  TextRun ${textRunCount}: "${content}"\n`;
                            }
                        }
                        // Only show paragraphs that contain the search term
                        if (paragraphText.includes(searchTerm)) {
                            output += `\n  👆 FULL PARAGRAPH: "${paragraphText}"\n`;
                            output += `  (Made of ${textRunCount} separate text runs above)\n\n`;
                            paragraphCount++;
                        }
                    }
                }
            }
            if (paragraphCount === 0) {
                output += `\n⚠️ No paragraphs found containing "${searchTerm}"\n`;
                output += `\nTry searching for a different term, or use empty string to see all paragraphs.`;
            }
            output += `\n\n💡 If the text is split across multiple TextRuns, you may need to replace `;
            output += `just one part (like "New TV purchase ") instead of the whole line.`;
            return {
                content: [{
                        type: 'text',
                        text: output,
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: `❌ Error reading structure: ${error.message}`,
                    }],
                isError: true,
            };
        }
    }
    async handleListPending() {
        const pending = proposalCache.getPending();
        const docPending = pending.filter((p) => p.type === 'docs.create' || p.type === 'drive.upload' || p.type === 'drive.create_folder' ||
            p.type === 'drive.move_file' || p.type === 'docs.append_text' || p.type === 'docs.replace_text' ||
            p.type === 'docs.delete_content' || p.type === 'docs.move_content' || p.type === 'docs.insert_at_position' ||
            p.type === 'docs.apply_formatting');
        if (docPending.length === 0) {
            return {
                content: [{
                        type: 'text',
                        text: '📭 No pending doc/file proposals.',
                    }],
            };
        }
        const list = docPending.map((p) => {
            const payload = p.payload;
            if (p.type === 'docs.create') {
                return `${p.id}\n  Doc: ${payload.title}\n  Folder: ${payload.folder_name || 'My Drive'}`;
            }
            else if (p.type === 'drive.upload') {
                return `${p.id}\n  File: ${payload.name}\n  Type: ${payload.mime_type || 'text/plain'}`;
            }
            else if (p.type === 'drive.create_folder') {
                return `${p.id}\n  Folder: ${payload.name}\n  Parent: ${payload.parent_folder_name || 'My Drive'}`;
            }
            else if (p.type === 'drive.move_file') {
                return `${p.id}\n  Move: ${payload.file_name_or_url}\n  To: ${payload.destination_folder}`;
            }
            else if (p.type === 'docs.append_text') {
                const preview = payload.text.length > 40 ? payload.text.substring(0, 40) + '...' : payload.text;
                return `${p.id}\n  Append to: ${payload.documentId}\n  Text: "${preview}"`;
            }
            else if (p.type === 'docs.replace_text') {
                return `${p.id}\n  Replace in: ${payload.documentId}\n  Find: "${payload.search_text}"\n  Replace: "${payload.replacement_text}"`;
            }
            else if (p.type === 'docs.delete_content') {
                const preview = payload.search_text.length > 40 ? payload.search_text.substring(0, 40) + '...' : payload.search_text;
                return `${p.id}\n  Delete from: ${payload.documentId}\n  Content: "${preview}"`;
            }
        }).join('\n\n');
        return {
            content: [{
                    type: 'text',
                    text: `📬 Pending Docs/Files\n\n${list}`,
                }],
        };
    }
    async handleDriveSearch(args) {
        const query = (args && args.query) ? String(args.query).trim() : '';
        if (!query) {
            return { content: [{ type: 'text', text: '❌ drive_search requires a `query` argument.' }], isError: true };
        }
        const mimeType = args && args.mime_type ? String(args.mime_type) : null;
        const limit = args && typeof args.limit === 'number' ? args.limit : 10;
        // Escape single quotes in the query for Drive's q syntax (it requires '' inside the string).
        const safeQuery = query.replace(/'/g, "\\'");
        const qParts = [`name contains '${safeQuery}'`, `trashed = false`];
        if (mimeType) qParts.push(`mimeType = '${mimeType}'`);
        // Lazy-init the drive client — matches every other handler in this file.
        if (!this.drive) {
            const auth = oauthManager.getClient();
            this.drive = google.drive({ version: 'v3', auth });
        }
        try {
            const response = await this.drive.files.list({
                q: qParts.join(' and '),
                fields: 'files(id, name, mimeType, modifiedTime, webViewLink, parents)',
                pageSize: limit,
                orderBy: 'modifiedTime desc',
            });
            const files = response.data.files || [];
            if (files.length === 0) {
                return { content: [{ type: 'text', text: `🔍 No Drive files matched "${query}"${mimeType ? ` (type: ${mimeType})` : ''}.` }] };
            }
            const lines = files.map((f) => {
                const modAt = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString() : 'unknown';
                return `• ${f.name}\n  id: ${f.id}\n  type: ${f.mimeType}\n  modified: ${modAt}\n  link: ${f.webViewLink || '(no link)'}`;
            });
            return { content: [{ type: 'text', text: `🔍 Found ${files.length} match${files.length === 1 ? '' : 'es'} for "${query}":\n\n${lines.join('\n\n')}` }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `❌ drive_search error: ${error.message}` }], isError: true };
        }
    }
    async handleDriveListFolder(args) {
        const folderId = args && args.folder_id ? String(args.folder_id).trim() : '';
        if (!folderId) {
            return { content: [{ type: 'text', text: '❌ drive_list_folder requires a `folder_id` argument.' }], isError: true };
        }
        const mimeType = args && args.mime_type ? String(args.mime_type) : null;
        const limit = args && typeof args.limit === 'number' ? args.limit : 25;
        const qParts = [`'${folderId}' in parents`, `trashed = false`];
        if (mimeType) qParts.push(`mimeType = '${mimeType}'`);
        // Lazy-init the drive client — matches every other handler in this file.
        if (!this.drive) {
            const auth = oauthManager.getClient();
            this.drive = google.drive({ version: 'v3', auth });
        }
        try {
            const response = await this.drive.files.list({
                q: qParts.join(' and '),
                fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
                pageSize: limit,
                orderBy: 'modifiedTime desc',
            });
            const files = response.data.files || [];
            if (files.length === 0) {
                return { content: [{ type: 'text', text: `📁 Folder ${folderId} is empty${mimeType ? ` (filtered by ${mimeType})` : ''}.` }] };
            }
            const lines = files.map((f) => {
                const modAt = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString() : 'unknown';
                return `• ${f.name}\n  id: ${f.id}\n  type: ${f.mimeType}\n  modified: ${modAt}\n  link: ${f.webViewLink || '(no link)'}`;
            });
            return { content: [{ type: 'text', text: `📁 Folder contents (${files.length}, most-recent first):\n\n${lines.join('\n\n')}` }] };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `❌ drive_list_folder error: ${error.message}` }], isError: true };
        }
    }
    async moveFileToFolder(fileId, folderName) {
        try {
            // Find the folder by name
            const searchResponse = await this.drive.files.list({
                q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder'`,
                fields: 'files(id, name)',
            });
            if (searchResponse.data.files && searchResponse.data.files.length > 0) {
                const folderId = searchResponse.data.files[0].id;
                // Get current file metadata to find current parents
                const fileResponse = await this.drive.files.get({
                    fileId: fileId,
                    fields: 'parents',
                });
                const previousParents = fileResponse.data.parents ? fileResponse.data.parents.join(',') : '';
                // Move the file to the new folder
                await this.drive.files.update({
                    fileId: fileId,
                    addParents: folderId,
                    removeParents: previousParents,
                });
            }
        }
        catch (error) {
            // If folder move fails, continue without error (file will stay in root)
            console.error('Failed to move file to folder:', error);
        }
    }
    async run() {
        await oauthManager.initialize();
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Flo Docs MCP server running');
    }
}
const server = new DocsMCPServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map