import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
];

// ACOS vendor patch: keep OAuth data inside the app-selected private paths.
const TOKEN_PATH = process.env.FLO_TOKEN_PATH || path.join(process.env.HOME || '', '.flo', 'tokens.json');
const CREDENTIALS_PATH =
  process.env.FLO_CREDENTIALS_PATH || path.join(process.env.HOME || '', '.flo', 'credentials.json');

export class OAuthManager {
  oauth2Client;

  async initialize() {
    const credentials = await this.loadCredentials();
    this.oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uris[0],
    );
    try {
      const tokens = await fs.readFile(TOKEN_PATH, 'utf-8');
      this.oauth2Client.setCredentials(JSON.parse(tokens));
    } catch {
      console.warn('No saved tokens found. Run authentication flow.');
    }
  }

  async loadCredentials() {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed.installed || parsed.web;
  }

  async getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
  }

  async handleCallback(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    return tokens;
  }

  getClient() {
    return this.oauth2Client;
  }

  isAuthenticated() {
    const credentials = this.oauth2Client.credentials;
    return !!(credentials && credentials.access_token);
  }

  async ensureValidToken() {
    const credentials = this.oauth2Client.credentials;
    if (!credentials || !credentials.access_token) return false;
    if (credentials.expiry_date && credentials.expiry_date <= Date.now() + 5 * 60 * 1000) {
      try {
        if (credentials.refresh_token) {
          const { credentials: refreshedCredentials } =
            await this.oauth2Client.refreshAccessToken();
          this.oauth2Client.setCredentials(refreshedCredentials);
          await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });
          await fs.writeFile(TOKEN_PATH, JSON.stringify(refreshedCredentials, null, 2), {
            mode: 0o600,
          });
          return true;
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
        return false;
      }
    }
    return true;
  }
}

export const oauthManager = new OAuthManager();
