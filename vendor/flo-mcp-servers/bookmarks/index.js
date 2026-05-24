#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

// Chrome stores `date_added` as microseconds since the WebKit epoch
// (1601-01-01 UTC), not the Unix epoch. Using Date.now() directly produces
// values Chrome can't parse correctly and causes folders to render in
// unexpected positions. Convert Unix ms -> WebKit microseconds.
const WEBKIT_EPOCH_OFFSET_MS = 11644473600000;
function webkitTimestampNow() {
    return ((Date.now() + WEBKIT_EPOCH_OFFSET_MS) * 1000).toString();
}

// Detect whether Chrome is currently running. On macOS Chrome doesn't lock
// the Bookmarks file, so writes succeed even while Chrome is open — but
// Chrome's in-memory state will overwrite our changes on its next autosave
// (every few minutes, on tab change, or on quit). Refuse to save when
// Chrome is detected, so the user gets a clear instruction instead of a
// silent revert.
function isChromeRunning() {
    try {
        if (process.platform === 'darwin') {
            const out = execFileSync('pgrep', ['-x', 'Google Chrome'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            return out.trim().length > 0;
        }
        if (process.platform === 'win32') {
            const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            return /chrome\.exe/i.test(out);
        }
        // Linux/other — pgrep covers it
        const out = execFileSync('pgrep', ['-f', 'chrome'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        return out.trim().length > 0;
    }
    catch {
        // pgrep exits 1 when no match — not an error, just "not running"
        return false;
    }
}
// Tool schemas
const AddBookmarkSchema = z.object({
    title: z.string(),
    url: z.string().url(),
    folder_name: z.string().optional().describe('Which folder to add to (e.g., "Important", "AI Programs") - defaults to Bookmarks Bar'),
});
const CreateFolderSchema = z.object({
    folder_name: z.string(),
    parent_folder: z.string().optional().describe('Parent folder name (defaults to Bookmarks Bar)'),
});
const MoveBookmarkSchema = z.object({
    bookmark_title: z.string(),
    target_folder: z.string().describe('Target folder name (can be the same folder to reorder)'),
    position: z.string().optional().describe('Position in target folder: "first", "last", "after:[name]", "before:[name]" (defaults to end)'),
});
const ListBookmarksSchema = z.object({
    folder_name: z.string().optional().describe('Specific folder to list (defaults to Bookmarks Bar)'),
});
const DeleteFolderSchema = z.object({
    folder_name: z.string().describe('Name of the folder to delete'),
    parent_folder: z.string().optional().describe('Parent folder name (defaults to Bookmarks Bar if not specified)'),
});
class ChromeBookmarksServer {
    server;
    bookmarksPath;
    bookmarksData = null;
    constructor() {
        this.bookmarksPath = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default/Bookmarks');
        this.server = new Server({
            name: 'flo-chrome-bookmarks',
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
                    name: 'bookmarks_list',
                    description: 'List all bookmarks and folders in your Chrome bookmarks bar. Shows your folder structure and bookmarks.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            folder_name: {
                                type: 'string',
                                description: 'Specific folder to list (e.g., "Important", "AI Programs") - defaults to showing Bookmarks Bar',
                            },
                        },
                    },
                },
                {
                    name: 'bookmarks_add',
                    description: 'Add a new bookmark to your Chrome bookmarks. You can add it to the main bar or a specific folder.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            title: {
                                type: 'string',
                                description: 'Name of the bookmark (e.g., "My Project", "Important Doc")',
                            },
                            url: {
                                type: 'string',
                                description: 'URL or file path to bookmark (e.g., "https://example.com" or "file:///path/to/file")',
                            },
                            folder_name: {
                                type: 'string',
                                description: 'Which folder to add to (e.g., "Important", "AI Programs") - defaults to Bookmarks Bar',
                            },
                        },
                        required: ['title', 'url'],
                    },
                },
                {
                    name: 'bookmarks_create_folder',
                    description: 'Create a new folder in your bookmarks bar to organize your bookmarks.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            folder_name: {
                                type: 'string',
                                description: 'Name of the new folder (e.g., "Important", "AI Programs")',
                            },
                            parent_folder: {
                                type: 'string',
                                description: 'Parent folder name (defaults to Bookmarks Bar if not specified)',
                            },
                        },
                        required: ['folder_name'],
                    },
                },
                {
                    name: 'bookmarks_move',
                    description: 'Move a bookmark or folder to a different location, or reorder items within the same folder.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            bookmark_title: {
                                type: 'string',
                                description: 'Name of the bookmark or folder to move',
                            },
                            target_folder: {
                                type: 'string',
                                description: 'Name of the folder to move it to (e.g., "Important", "AI Programs"). Can be the same folder to reorder.',
                            },
                            position: {
                                type: 'string',
                                description: 'Optional position in target folder: "first", "last", "after:[name]", "before:[name]" (defaults to end)',
                            },
                        },
                        required: ['bookmark_title', 'target_folder'],
                    },
                },
                {
                    name: 'bookmarks_delete_folder',
                    description: 'Delete a folder from your bookmarks. WARNING: This will delete the folder and all items inside it!',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            folder_name: {
                                type: 'string',
                                description: 'Name of the folder to delete (e.g., "Old Projects", "Archived")',
                            },
                            parent_folder: {
                                type: 'string',
                                description: 'Parent folder name (defaults to Bookmarks Bar if not specified)',
                            },
                        },
                        required: ['folder_name'],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                // Load bookmarks
                this.loadBookmarks();
                if (!this.bookmarksData) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: '❌ Could not load Chrome bookmarks file. Is Chrome installed and have you synced bookmarks?',
                            },
                        ],
                        isError: true,
                    };
                }
                switch (request.params.name) {
                    case 'bookmarks_list':
                        return await this.handleListBookmarks(request.params.arguments);
                    case 'bookmarks_add':
                        return await this.handleAddBookmark(request.params.arguments);
                    case 'bookmarks_create_folder':
                        return await this.handleCreateFolder(request.params.arguments);
                    case 'bookmarks_move':
                        return await this.handleMoveBookmark(request.params.arguments);
                    case 'bookmarks_delete_folder':
                        return await this.handleDeleteFolder(request.params.arguments);
                    default:
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `❌ Unknown tool: ${request.params.name}. Available tools: bookmarks_list, bookmarks_add, bookmarks_create_folder, bookmarks_move, bookmarks_delete_folder`,
                                },
                            ],
                            isError: true,
                        };
                }
            }
            catch (error) {
                console.error('[Bookmarks Error]', error);
                const errorMessage = error.message || 'Unknown error occurred';
                // Provide specific error guidance
                let helpText = '';
                if (errorMessage.includes('ENOENT')) {
                    helpText = '\n\nNote: Chrome bookmarks file not found. Make sure Chrome is installed at the default location.';
                }
                else if (errorMessage.includes('JSON')) {
                    helpText = '\n\nNote: Could not parse bookmarks file. Try closing Chrome and any other instances that might be accessing bookmarks.';
                }
                else if (errorMessage.includes('EACCES')) {
                    helpText = '\n\nNote: Permission denied. Make sure Chrome is not currently running.';
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ Bookmarks Error: ${errorMessage}${helpText}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    loadBookmarks() {
        if (this.bookmarksData)
            return; // Already loaded
        try {
            if (!fs.existsSync(this.bookmarksPath)) {
                throw new Error(`Chrome bookmarks file not found at: ${this.bookmarksPath}`);
            }
            const data = fs.readFileSync(this.bookmarksPath, 'utf-8');
            this.bookmarksData = JSON.parse(data);
        }
        catch (error) {
            if (error.code === 'EACCES') {
                throw new Error('Permission denied: Chrome bookmarks are in use. Please close Chrome completely.');
            }
            else if (error.message.includes('JSON')) {
                throw new Error('Bookmarks file is corrupted or locked. Please close Chrome and try again.');
            }
            else {
                throw error;
            }
        }
    }
    saveBookmarks() {
        if (!this.bookmarksData)
            throw new Error('No bookmarks data loaded');
        // Critical safety check — see isChromeRunning() comment.
        if (isChromeRunning()) {
            throw new Error('Chrome is currently running. Bookmark changes would be silently overwritten by Chrome on its next autosave. Please fully quit Chrome (Cmd+Q on macOS, ensuring no windows remain) and try again.');
        }
        try {
            // Create backup before saving
            const backupPath = this.bookmarksPath + '.backup';
            if (fs.existsSync(this.bookmarksPath)) {
                fs.copyFileSync(this.bookmarksPath, backupPath);
            }
            // Update checksum (simplified - just use a timestamp)
            this.bookmarksData.checksum = Date.now().toString();
            const data = JSON.stringify(this.bookmarksData, null, 2);
            fs.writeFileSync(this.bookmarksPath, data, 'utf-8');
        }
        catch (error) {
            if (error.code === 'EACCES') {
                throw new Error('Permission denied: Cannot write to bookmarks file. Is Chrome running? Please close it and try again.');
            }
            else {
                throw new Error(`Failed to save bookmarks: ${error.message}`);
            }
        }
    }
    findFolderByName(parent, folderName) {
        if (parent.name === folderName)
            return parent;
        if (!parent.children)
            return null;
        for (const child of parent.children) {
            if (child.type === 'folder') {
                const result = this.findFolderByName(child, folderName);
                if (result)
                    return result;
            }
        }
        return null;
    }
    formatBookmarkList(bookmarks, indent = '', maxItems = 50, currentCount = { count: 0, truncated: false }) {
        let output = '';
        if (!bookmarks)
            return output;
        for (const bookmark of bookmarks) {
            // Stop if we've exceeded the max items to prevent context overflow
            if (currentCount.count >= maxItems) {
                currentCount.truncated = true;
                break;
            }
            if (bookmark.type === 'folder') {
                output += `${indent}📁 ${bookmark.name}/\n`;
                currentCount.count++;
                if (bookmark.children && currentCount.count < maxItems) {
                    output += this.formatBookmarkList(bookmark.children, indent + '   ', maxItems, currentCount);
                }
            }
            else {
                output += `${indent}🔗 ${bookmark.name}\n`;
                currentCount.count++;
                if (bookmark.url && currentCount.count < maxItems) {
                    output += `${indent}   ${bookmark.url}\n`;
                }
            }
        }
        return output;
    }
    async handleListBookmarks(args) {
        const parsed = ListBookmarksSchema.parse(args);
        if (!this.bookmarksData) {
            return {
                content: [{ type: 'text', text: '❌ Failed to load bookmarks data' }],
                isError: true,
            };
        }
        let targetFolder = this.bookmarksData.roots.bookmark_bar;
        if (parsed.folder_name) {
            const found = this.findFolderByName(targetFolder, parsed.folder_name);
            if (!found) {
                // Provide available folders
                const availableFolders = (targetFolder.children || [])
                    .filter(b => b.type === 'folder')
                    .map(b => `"${b.name}"`)
                    .join(', ');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ Folder "${parsed.folder_name}" not found.\n\nAvailable folders: ${availableFolders || '(none)'}`,
                        },
                    ],
                    isError: true,
                };
            }
            targetFolder = found;
        }
        const counter = { count: 0, truncated: false };
        const bookmarkList = this.formatBookmarkList(targetFolder.children || [], '', 50, counter);
        const itemCount = (targetFolder.children || []).length;
        const truncationMsg = counter.truncated ? `\n\n⚠️ Note: Showing first ${counter.count} items. You have ${itemCount} total items in this folder. Use specific folder names to see more.` : '';
        return {
            content: [
                {
                    type: 'text',
                    text: `📚 Bookmarks in "${targetFolder.name}" (${itemCount} item${itemCount !== 1 ? 's' : ''})\n\n${bookmarkList || '(Empty)'}${truncationMsg}`,
                },
            ],
        };
    }
    async handleAddBookmark(args) {
        const parsed = AddBookmarkSchema.parse(args);
        if (!this.bookmarksData) {
            return {
                content: [{ type: 'text', text: '❌ Failed to load bookmarks data' }],
                isError: true,
            };
        }
        let targetFolder = this.bookmarksData.roots.bookmark_bar;
        if (parsed.folder_name) {
            const found = this.findFolderByName(targetFolder, parsed.folder_name);
            if (!found) {
                // Provide available folders
                const availableFolders = (targetFolder.children || [])
                    .filter(b => b.type === 'folder')
                    .map(b => `"${b.name}"`)
                    .join(', ');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ Folder "${parsed.folder_name}" not found.\n\nAvailable folders: ${availableFolders || '(none)'}`,
                        },
                    ],
                    isError: true,
                };
            }
            targetFolder = found;
        }
        // Check for duplicate bookmarks in the target folder
        const duplicate = (targetFolder.children || []).find(b => b.type === 'url' && b.name === parsed.title);
        if (duplicate) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ Warning: A bookmark with title "${parsed.title}" already exists in "${targetFolder.name}".\n\n📌 This bookmark will still be added (duplicates are allowed).`,
                    },
                ],
            };
        }
        if (!targetFolder.children) {
            targetFolder.children = [];
        }
        const newBookmark = {
            id: Date.now().toString(),
            name: parsed.title,
            type: 'url',
            url: parsed.url,
            date_added: webkitTimestampNow(),
        };
        targetFolder.children.push(newBookmark);
        this.saveBookmarks();
        return {
            content: [
                {
                    type: 'text',
                    text: `✅ Bookmark Successfully Added!\n\n📁 Folder: ${targetFolder.name}\n🔗 Title: ${parsed.title}\n🌐 URL: ${parsed.url}\n✨ Bookmark is now available in Chrome`,
                },
            ],
        };
    }
    async handleCreateFolder(args) {
        const parsed = CreateFolderSchema.parse(args);
        if (!this.bookmarksData) {
            return {
                content: [{ type: 'text', text: '❌ Failed to load bookmarks data' }],
                isError: true,
            };
        }
        let parentFolder = this.bookmarksData.roots.bookmark_bar;
        if (parsed.parent_folder) {
            const found = this.findFolderByName(parentFolder, parsed.parent_folder);
            if (!found) {
                // Provide available folders
                const availableFolders = (parentFolder.children || [])
                    .filter(b => b.type === 'folder')
                    .map(b => `"${b.name}"`)
                    .join(', ');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ Parent folder "${parsed.parent_folder}" not found.\n\nAvailable folders: ${availableFolders || '(none)'}`,
                        },
                    ],
                    isError: true,
                };
            }
            parentFolder = found;
        }
        if (!parentFolder.children) {
            parentFolder.children = [];
        }
        // Check if folder already exists (case-insensitive)
        const existing = parentFolder.children.find((b) => b.type === 'folder' && b.name.toLowerCase() === parsed.folder_name.toLowerCase());
        if (existing) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ Folder "${parsed.folder_name}" already exists in "${parentFolder.name}".\n\n💡 Suggestion: Try renaming to "${parsed.folder_name} 2" or choose a different name.`,
                    },
                ],
            };
        }
        const newFolder = {
            id: Date.now().toString(),
            name: parsed.folder_name,
            type: 'folder',
            children: [],
            date_added: webkitTimestampNow(),
        };
        parentFolder.children.push(newFolder);
        this.saveBookmarks();
        return {
            content: [
                {
                    type: 'text',
                    text: `✅ Folder Successfully Created!\n\n📁 Folder Name: ${parsed.folder_name}\n📍 Location: ${parentFolder.name}\n✨ Ready to add bookmarks inside this folder`,
                },
            ],
        };
    }
    findBookmarkAndParent(parent, targetName, sourceFolder) {
        if (!parent.children)
            return null;
        for (let i = 0; i < parent.children.length; i++) {
            if (parent.children[i].name === targetName) {
                return { item: parent.children[i], parent };
            }
            if (parent.children[i].type === 'folder') {
                const result = this.findBookmarkAndParent(parent.children[i], targetName);
                if (result)
                    return result;
            }
        }
        return null;
    }
    async handleMoveBookmark(args) {
        const parsed = MoveBookmarkSchema.parse(args);
        if (!this.bookmarksData) {
            return {
                content: [{ type: 'text', text: '❌ Failed to load bookmarks data' }],
                isError: true,
            };
        }
        // Find the bookmark/folder to move
        const bookmarkBar = this.bookmarksData.roots.bookmark_bar;
        const result = this.findBookmarkAndParent(bookmarkBar, parsed.bookmark_title);
        if (!result) {
            // List available items
            const availableItems = (bookmarkBar.children || [])
                .map(b => `"${b.name}"`)
                .join(', ');
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Bookmark/folder "${parsed.bookmark_title}" not found.\n\nAvailable items: ${availableItems || '(none)'}`,
                    },
                ],
                isError: true,
            };
        }
        const { item: itemToMove, parent: sourceFolder } = result;
        // Find target folder (or use Bookmarks Bar if target is "Bookmarks Bar")
        let targetFolder;
        if (parsed.target_folder === 'Bookmarks Bar') {
            targetFolder = bookmarkBar;
        }
        else {
            const found = this.findFolderByName(bookmarkBar, parsed.target_folder);
            if (!found) {
                // List available folders
                const availableFolders = (bookmarkBar.children || [])
                    .filter(b => b.type === 'folder')
                    .map(b => `"${b.name}"`)
                    .join(', ');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ Target folder "${parsed.target_folder}" not found.\n\nAvailable folders: ${availableFolders || '(none)'}`,
                        },
                    ],
                    isError: true,
                };
            }
            targetFolder = found;
        }
        // Check if trying to move folder into itself
        if (itemToMove.type === 'folder' && itemToMove.id === targetFolder.id) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Cannot move a folder into itself!`,
                    },
                ],
                isError: true,
            };
        }
        // Determine target index based on position parameter
        let targetIndex = -1; // -1 means end (push)
        if (parsed.position) {
            const posLower = parsed.position.toLowerCase();
            if (posLower === 'first') {
                targetIndex = 0;
            }
            else if (posLower === 'last') {
                targetIndex = (targetFolder.children || []).length;
            }
            else if (posLower.startsWith('after:')) {
                const afterName = parsed.position.substring(6);
                const afterIdx = (targetFolder.children || []).findIndex(b => b.name === afterName);
                if (afterIdx === -1) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `❌ Reference bookmark/folder "${afterName}" not found in target.\n\nAvailable items: ${(targetFolder.children || []).map(b => `"${b.name}"`).join(', ')}`,
                            },
                        ],
                        isError: true,
                    };
                }
                targetIndex = afterIdx + 1;
            }
            else if (posLower.startsWith('before:')) {
                const beforeName = parsed.position.substring(7);
                const beforeIdx = (targetFolder.children || []).findIndex(b => b.name === beforeName);
                if (beforeIdx === -1) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `❌ Reference bookmark/folder "${beforeName}" not found in target.\n\nAvailable items: ${(targetFolder.children || []).map(b => `"${b.name}"`).join(', ')}`,
                            },
                        ],
                        isError: true,
                    };
                }
                targetIndex = beforeIdx;
            }
        }
        // Remove from source
        if (sourceFolder.children) {
            sourceFolder.children = sourceFolder.children.filter((b) => b.name !== parsed.bookmark_title);
            // Add to target at specific position
            if (!targetFolder.children) {
                targetFolder.children = [];
            }
            if (targetIndex === -1) {
                // Add at end
                targetFolder.children.push(itemToMove);
            }
            else {
                // Insert at specific index
                targetFolder.children.splice(targetIndex, 0, itemToMove);
            }
            this.saveBookmarks();
            const itemType = itemToMove.type === 'folder' ? '📁 Folder' : '🔗 Bookmark';
            const positionText = parsed.position ? ` (Position: ${parsed.position})` : '';
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Successfully Moved!\n\n${itemType}: ${parsed.bookmark_title}\n📍 From: ${sourceFolder.name}\n📍 To: ${targetFolder.name}${positionText}\n✨ Changes saved to Chrome`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: '❌ Failed to move bookmark. Please try again.',
                },
            ],
            isError: true,
        };
    }
    async handleDeleteFolder(args) {
        const parsed = DeleteFolderSchema.parse(args);
        if (!this.bookmarksData) {
            return {
                content: [{ type: 'text', text: '❌ Failed to load bookmarks data' }],
                isError: true,
            };
        }
        const bookmarkBar = this.bookmarksData.roots.bookmark_bar;
        let parentFolder = bookmarkBar;
        if (parsed.parent_folder) {
            const found = this.findFolderByName(bookmarkBar, parsed.parent_folder);
            if (!found) {
                // List available folders
                const availableFolders = (bookmarkBar.children || [])
                    .filter(b => b.type === 'folder')
                    .map(b => `"${b.name}"`)
                    .join(', ');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `❌ Parent folder "${parsed.parent_folder}" not found.\n\nAvailable folders: ${availableFolders || '(none)'}`,
                        },
                    ],
                    isError: true,
                };
            }
            parentFolder = found;
        }
        // Find the folder to delete
        const folderIndex = (parentFolder.children || []).findIndex(b => b.type === 'folder' && b.name === parsed.folder_name);
        if (folderIndex === -1) {
            // List available folders
            const availableFolders = (parentFolder.children || [])
                .filter(b => b.type === 'folder')
                .map(b => `"${b.name}"`)
                .join(', ');
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Folder "${parsed.folder_name}" not found in "${parentFolder.name}".\n\nAvailable folders: ${availableFolders || '(none)'}`,
                    },
                ],
                isError: true,
            };
        }
        const folderToDelete = (parentFolder.children || [])[folderIndex];
        const itemsCount = (folderToDelete.children || []).length;
        // Show warning with details
        if (itemsCount > 0) {
            const itemsList = (folderToDelete.children || [])
                .map(item => {
                if (item.type === 'folder') {
                    const subCount = (item.children || []).length;
                    return `📁 ${item.name} (${subCount} items)`;
                }
                else {
                    return `🔗 ${item.name}`;
                }
            })
                .join('\n');
            return {
                content: [
                    {
                        type: 'text',
                        text: `⚠️ WARNING: You are about to DELETE the folder "${parsed.folder_name}" which contains ${itemsCount} item${itemsCount !== 1 ? 's' : ''}:\n\n${itemsList}\n\n❗ This action cannot be undone. Please use this command again to confirm deletion.`,
                    },
                ],
            };
        }
        // Actually delete the folder
        if (parentFolder.children) {
            parentFolder.children.splice(folderIndex, 1);
            this.saveBookmarks();
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Folder Successfully Deleted!\n\n📁 Folder: ${parsed.folder_name}\n📍 From: ${parentFolder.name}\n✨ Changes saved to Chrome`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: '❌ Failed to delete folder. Please try again.',
                },
            ],
            isError: true,
        };
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Chrome Bookmarks MCP server running on stdio');
    }
}
const server = new ChromeBookmarksServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map