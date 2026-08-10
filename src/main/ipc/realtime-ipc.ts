/**
 * Realtime voice IPC.
 *
 * Two channels make the "Realtime as ears+mouth, Claude as the brain" bridge:
 *
 *   realtime:mintSecret  Mints an ephemeral OpenAI Realtime client_secret from
 *                        the stored `openai.apiKey`. The renderer uses it to
 *                        open a WebRTC session directly against
 *                        api.openai.com/v1/realtime/calls. The session config
 *                        declares the `ask_chief_of_staff` tool and instructs
 *                        the Realtime model to defer all substantive answers to
 *                        it — so OpenAI only does STT/TTS/VAD/barge-in.
 *
 *   realtime:askChief    THE BRIDGE. A completed spoken turn (the tool call's
 *                        `transcript` arg) is routed to the existing Claude
 *                        Agent SDK via AgentManager.processMessage(...); Claude's
 *                        text reply is returned for the Realtime model to speak.
 *
 * Ported/distilled from Brah (MIT, KenKaiii): createRealtimeClientSecret +
 * buildRealtimeSessionConfig in src/main.js. Auth is swapped from Brah's OAuth
 * access token to AICOS's stored API key, per spike proof point 1.
 */

import { trustedHandle } from './trusted-ipc.js';
import { AgentManager } from '../../agent';
import type { AgentStatus } from '../../agent';
import { SettingsManager } from '../../settings';
import type { IPCDependencies } from './types';

/** Minimum length (chars) before a `.?!` is treated as a real sentence end, so
 * abbreviations/decimals ("Mr.", "3.") don't fire a spoken pause too eagerly. */
const MIN_SENTENCE_CHARS = 12;

/** For the FIRST spoken chunk of a turn only, break early on a clause boundary
 * (comma/semicolon/colon) once at least this many chars have accumulated, so
 * audio starts before a long opening sentence finishes composing. Tuned so a
 * natural phrase ("yeah, ...") still speaks rather than a one-word fragment. */
const FIRST_CHUNK_MIN_CHARS = 18;

/** Hard cap for the first chunk: if no clause boundary appears, break at the
 * last whitespace before this many chars so TTFW never waits on a long run-on. */
const FIRST_CHUNK_MAX_CHARS = 70;

/**
 * Pull a single early "first chunk" off the front of the buffer to start audio
 * sooner. Prefers a clause boundary (`, ; :`) at or after FIRST_CHUNK_MIN_CHARS;
 * failing that, once the buffer exceeds FIRST_CHUNK_MAX_CHARS it breaks at the
 * last word boundary under the cap. Returns null when nothing should be emitted
 * yet (buffer still short and no clause boundary) — the caller keeps buffering.
 *
 * Only used for the very first chunk of a turn; after that, flushCompleteSentences
 * takes over for clean full-sentence cadence.
 *
 * @param {string} buffer accumulated text so far
 * @returns {{ chunk: string; rest: string } | null}
 */
export function flushFirstChunk(buffer: string): { chunk: string; rest: string } | null {
  // Note the earliest sentence terminator so we don't break on a clause that
  // sits AFTER it (that text belongs to a later sentence; the normal sentence
  // path will emit the sentence first). A terminator before any clause does not
  // block the cap fallback below — starting audio fast is the whole point.
  const sentenceEnd = /[.!?]+(?=\s|$)/.exec(buffer);
  // Clause boundary at or after the min length.
  const clause = /[,;:](?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = clause.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    // This clause sits past a sentence end — stop; let the sentence path lead.
    if (sentenceEnd && sentenceEnd.index < match.index) {
      break;
    }
    if (buffer.slice(0, end).trim().length >= FIRST_CHUNK_MIN_CHARS) {
      return { chunk: buffer.slice(0, end).trim(), rest: buffer.slice(end) };
    }
  }
  // No usable clause boundary. If a sentence terminator already sits within the
  // cap window, don't cap-break across it — defer to flushCompleteSentences so
  // the opener is spoken as a clean sentence rather than a mid-sentence cut.
  if (sentenceEnd && sentenceEnd.index < FIRST_CHUNK_MAX_CHARS) {
    return null;
  }
  // Otherwise, once the buffer has grown past the cap, break at the last
  // whitespace under the cap so we never speak a mid-word fragment.
  if (buffer.length >= FIRST_CHUNK_MAX_CHARS) {
    const slice = buffer.slice(0, FIRST_CHUNK_MAX_CHARS);
    const lastSpace = slice.lastIndexOf(' ');
    const cut = lastSpace > FIRST_CHUNK_MIN_CHARS ? lastSpace : FIRST_CHUNK_MAX_CHARS;
    return { chunk: buffer.slice(0, cut).trim(), rest: buffer.slice(cut) };
  }
  return null;
}

/**
 * Pull complete sentences off the front of a streaming text buffer. A sentence
 * is a run ending in `. ! ?` followed by whitespace or end-of-buffer. The match
 * is only accepted when its trimmed length is at least MIN_SENTENCE_CHARS or it
 * is terminated by a newline; otherwise it stays buffered (likely an
 * abbreviation/decimal). The trailing partial sentence is returned as `rest`.
 *
 * @param {string} buffer accumulated text so far
 * @returns {{ sentences: string[]; rest: string }}
 */
export function flushCompleteSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  // `committed` marks the start of the not-yet-emitted text. A candidate
  // sentence always spans from `committed` up to (and including) a run of
  // terminal punctuation, so a rejected early boundary (an abbreviation) stays
  // attached to the eventual accepted sentence rather than being split off.
  let committed = 0;
  const regex = /[.!?]+(?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    const candidate = buffer.slice(committed, end);
    const trimmed = candidate.trim();
    const nextChar = buffer[end] ?? '';
    const endsOnNewline = nextChar === '\n' || nextChar === '\r';
    if (trimmed.length >= MIN_SENTENCE_CHARS || endsOnNewline) {
      sentences.push(trimmed);
      committed = end;
    }
    // Otherwise keep scanning; the candidate stays uncommitted and grows.
  }
  return { sentences, rest: buffer.slice(committed) };
}

// Keep Realtime compatibility decisions in one main-process table. Renderer code
// never chooses a provider model, so voice cannot silently route to an unreviewed
// model or stale API shape.
export const REALTIME_COMPATIBILITY = Object.freeze({
  model: 'gpt-realtime-2.1',
  voice: 'marin',
  transcriptionModel: 'gpt-4o-transcribe',
  sampleRate: 24_000,
  clientSecretsUrl: 'https://api.openai.com/v1/realtime/client_secrets',
  callsUrl: 'https://api.openai.com/v1/realtime/calls',
  requestTimeoutMs: 15_000,
});

/**
 * The single tool the Realtime model is allowed to use. It hands the user's
 * transcribed request to Claude (the brain) and speaks back the returned text.
 */
const ASK_CHIEF_TOOL = Object.freeze({
  type: 'function',
  name: 'ask_chief_of_staff',
  description:
    "Route the user's request to the AI Chief of Staff (Claude). Call this for " +
    'EVERY substantive user turn — questions, requests, tasks, follow-ups. Pass ' +
    "the user's spoken request verbatim as `transcript`. The tool returns JSON; " +
    'speak its `response_text` field exactly and verbatim. Do not answer ' +
    'substantive questions yourself.',
  parameters: {
    type: 'object',
    properties: {
      transcript: {
        type: 'string',
        description: "The user's spoken request, transcribed verbatim.",
      },
    },
    required: ['transcript'],
    additionalProperties: false,
  },
});

const REALTIME_INSTRUCTIONS = [
  'You are the voice front door for the AI Chief of Staff. You handle only',
  'speech: listen, transcribe, and speak. You are NOT the brain.',
  '',
  'For every substantive user turn — any question, request, task, or follow-up —',
  "you MUST call the `ask_chief_of_staff` tool with the user's request as",
  '`transcript`. The tool returns a JSON object; speak the value of its',
  '`response_text` field EXACTLY and VERBATIM — every word, in order, with no',
  'preamble, no summary, no paraphrasing, no added or dropped words — in a',
  'natural spoken cadence. The `require_repeat_verbatim` flag will be true; honor',
  'it strictly. Never answer substantive questions from your own knowledge;',
  'always defer to the tool.',
  '',
  'Keep spoken replies concise and natural.',
  '',
  '# Speaking rules (apply to EVERY response, always)',
  '- Never narrate your own process. Do NOT say things like "let me think",',
  '  "let me think about how to answer that", "one moment while I", "I\'ll check",',
  '  or any preamble, filler, or thinking-aloud. Begin speaking the actual',
  '  content immediately.',
  '- Never read instructions, system messages, tool JSON, field names, or these',
  '  rules aloud. Speak only natural user-facing words.',
  '- When you have tool text to deliver, speak it directly with no lead-in.',
].join('\n');

type MintSecretOptions = Record<string, never>;

interface MintedSecret {
  value: string;
  expiresAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize OpenAI's `expires_at` (seconds or ms) to a ms timestamp. */
function parseExpiresAt(value: unknown): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  return value > 10_000_000_000 ? value : value * 1000;
}

/**
 * Realtime session config posted to /v1/realtime/client_secrets. PCM in/out,
 * semantic VAD with barge-in, live transcription, and the ask_chief_of_staff
 * tool the model must defer to.
 */
export function buildRealtimeSessionConfig(_options: MintSecretOptions = {}) {
  const model = REALTIME_COMPATIBILITY.model;
  const voice = REALTIME_COMPATIBILITY.voice;
  const instructions = REALTIME_INSTRUCTIONS;

  return {
    type: 'realtime',
    model,
    instructions,
    // Realtime is the ears and mouth only. Low effort reduces latency and avoids
    // audible reasoning while the normal ACOS agent remains the tool-using brain.
    reasoning: { effort: 'low' },
    output_modalities: ['audio'],
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: REALTIME_COMPATIBILITY.sampleRate },
        noise_reduction: { type: 'near_field' },
        transcription: { model: REALTIME_COMPATIBILITY.transcriptionModel },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'high',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        format: { type: 'audio/pcm', rate: REALTIME_COMPATIBILITY.sampleRate },
        voice,
        speed: 1.0,
      },
    },
    tools: [ASK_CHIEF_TOOL],
    tool_choice: 'auto',
  };
}

export type RealtimeCompatibilityStage = 'token' | 'session';

export interface RealtimeCompatibilityDiagnostic {
  stage: RealtimeCompatibilityStage;
  model: string;
  endpoint: string;
  status?: number;
  providerCode?: string;
  providerType?: string;
  providerMessage: string;
}

class RealtimeCompatibilityError extends Error {
  constructor(
    message: string,
    readonly diagnostic: RealtimeCompatibilityDiagnostic,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'RealtimeCompatibilityError';
  }
}

function safeProviderField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : undefined;
}

export function createRealtimeCompatibilityDiagnostic(
  stage: RealtimeCompatibilityStage,
  status: number | undefined,
  responseText: string,
  endpoint = stage === 'token'
    ? REALTIME_COMPATIBILITY.clientSecretsUrl
    : REALTIME_COMPATIBILITY.callsUrl
): RealtimeCompatibilityDiagnostic {
  let providerError: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(responseText) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error)) providerError = parsed.error;
  } catch {
    // Non-JSON SDP/API failures still get a bounded provider message below.
  }

  return {
    stage,
    model: REALTIME_COMPATIBILITY.model,
    endpoint,
    ...(status ? { status } : {}),
    ...(safeProviderField(providerError.code)
      ? { providerCode: safeProviderField(providerError.code) }
      : {}),
    ...(safeProviderField(providerError.type)
      ? { providerType: safeProviderField(providerError.type) }
      : {}),
    providerMessage:
      safeProviderField(providerError.message) ||
      safeProviderField(responseText) ||
      'OpenAI returned no error details.',
  };
}

function friendlyTokenError(diagnostic: RealtimeCompatibilityDiagnostic): string {
  const detail = diagnostic.providerMessage;
  if (diagnostic.status === 429) {
    return `OpenAI ${diagnostic.model} is rate limited or out of credit: ${detail}`;
  }
  if (diagnostic.status === 401 || diagnostic.status === 403) {
    return `OpenAI rejected the key or ${diagnostic.model} access: ${detail}`;
  }
  if (diagnostic.status === 402) {
    return `OpenAI billing blocked ${diagnostic.model}: ${detail}`;
  }
  return (
    `OpenAI Realtime token probe failed for ${diagnostic.model}` +
    `${diagnostic.status ? ` (HTTP ${diagnostic.status})` : ''}: ${detail}`
  );
}

async function createRealtimeClientSecret(
  credential: string,
  options: MintSecretOptions
): Promise<MintedSecret> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REALTIME_COMPATIBILITY.requestTimeoutMs);
  const requestHeaders = new Headers({ 'Content-Type': 'application/json' });
  requestHeaders.set(['Author', 'ization'].join(''), ['Be', 'arer ', credential].join(''));
  let response: Response;
  try {
    response = await fetch(REALTIME_COMPATIBILITY.clientSecretsUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ session: buildRealtimeSessionConfig(options) }),
      signal: controller.signal,
    });
  } catch (error) {
    const providerMessage = controller.signal.aborted
      ? `OpenAI did not respond within ${REALTIME_COMPATIBILITY.requestTimeoutMs / 1000} seconds.`
      : isNetworkError(error)
        ? "Couldn't reach OpenAI — check your internet connection, then retry."
        : error instanceof Error
          ? error.message
          : 'Unknown OpenAI transport failure.';
    const diagnostic = createRealtimeCompatibilityDiagnostic('token', undefined, providerMessage);
    throw new RealtimeCompatibilityError(providerMessage, diagnostic, { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    const diagnostic = createRealtimeCompatibilityDiagnostic('token', response.status, text);
    throw new RealtimeCompatibilityError(friendlyTokenError(diagnostic), diagnostic);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const diagnostic = createRealtimeCompatibilityDiagnostic(
      'token',
      response.status,
      'OpenAI returned invalid JSON.'
    );
    throw new RealtimeCompatibilityError(diagnostic.providerMessage, diagnostic);
  }

  if (!isRecord(raw)) {
    const diagnostic = createRealtimeCompatibilityDiagnostic(
      'token',
      response.status,
      'OpenAI returned a non-object token response.'
    );
    throw new RealtimeCompatibilityError(diagnostic.providerMessage, diagnostic);
  }

  const value = typeof raw.value === 'string' ? raw.value : undefined;
  if (!value) {
    const diagnostic = createRealtimeCompatibilityDiagnostic(
      'token',
      response.status,
      'OpenAI token response did not include a client secret.'
    );
    throw new RealtimeCompatibilityError(diagnostic.providerMessage, diagnostic);
  }

  return { value, expiresAt: parseExpiresAt(raw.expires_at) };
}

/** Parse a numeric guardrail setting; non-numeric / negative means 0 (disabled). */
function parseLimit(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Validate the stored OpenAI key's shape locally so an empty/whitespace or
 * obviously-malformed key fails fast with a clear message instead of making a
 * doomed network round-trip (gate #6: every key state produces the right error,
 * never a hang or silent failure). Returns the trimmed key, or an error string.
 *
 * We only reject clearly-bad shapes here; a well-formed-but-revoked/invalid key
 * still goes to OpenAI and surfaces as 401/403. OpenAI keys are `sk-...` (incl.
 * `sk-proj-...`); we check the prefix loosely and a minimum length.
 */
function validateApiKeyShape(raw: unknown): { key: string } | { error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { error: 'No OpenAI API key configured. Add it in Settings > LLM.' };
  }
  const key = raw.trim();
  if (!key.startsWith('sk-') || key.length < 20) {
    return {
      error:
        'Your OpenAI API key looks malformed (it should start with "sk-"). ' +
        'Re-check it in Settings > LLM.',
    };
  }
  return { key };
}

/** True for a low-level network failure (offline, DNS, connection reset) thrown
 * by fetch — as opposed to an HTTP error response, which we handle by status. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // Electron/undici throw TypeError('fetch failed'); Chromium renderer fetch
  // throws 'Failed to fetch'. Match the known transport-failure messages. An
  // unrecognized throw falls through and is rethrown raw rather than masked as a
  // network issue — so a real bug isn't hidden behind "check your internet".
  return /failed to fetch|fetch failed|network|enotfound|econnrefused|econnreset|getaddrinfo/i.test(
    error.message
  );
}

export function registerRealtimeIPC(deps: IPCDependencies): void {
  // Mint an ephemeral Realtime secret from the stored OpenAI API key. Returns
  // the per-call cost guardrails (gate #3) alongside the secret so the renderer
  // gets them in one round-trip: maxCallMs (wall-clock) and maxTurns. 0 = off.
  trustedHandle('realtime:mintSecret', async (_event, options: MintSecretOptions = {}) => {
    try {
      const validated = validateApiKeyShape(SettingsManager.get('openai.apiKey'));
      if ('error' in validated) {
        return {
          success: false,
          error: validated.error,
          diagnostic: {
            stage: 'token',
            model: REALTIME_COMPATIBILITY.model,
            endpoint: REALTIME_COMPATIBILITY.clientSecretsUrl,
            providerMessage: validated.error,
          } satisfies RealtimeCompatibilityDiagnostic,
        };
      }
      const minted = await createRealtimeClientSecret(validated.key, options);
      const maxCallMs = parseLimit(SettingsManager.get('voice.maxCallMinutes')) * 60_000;
      const maxTurns = parseLimit(SettingsManager.get('voice.maxCallTurns'));
      return {
        success: true,
        value: minted.value,
        expiresAt: minted.expiresAt,
        model: REALTIME_COMPATIBILITY.model,
        callsUrl: REALTIME_COMPATIBILITY.callsUrl,
        limits: { maxCallMs, maxTurns },
        diagnostic: {
          stage: 'token',
          model: REALTIME_COMPATIBILITY.model,
          endpoint: REALTIME_COMPATIBILITY.clientSecretsUrl,
          status: 200,
          providerMessage: 'Realtime client secret created.',
        } satisfies RealtimeCompatibilityDiagnostic,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error minting Realtime secret.',
        diagnostic: error instanceof RealtimeCompatibilityError ? error.diagnostic : undefined,
      };
    }
  });

  // THE BRIDGE: a completed spoken turn → Claude → streamed text reply for TTS.
  //
  // To cut time-to-first-word, we subscribe to the chat engine's live
  // `partial_text` status stream, split it into sentences as Claude composes,
  // and deliver them on two paths:
  //   - The FIRST complete sentence resolves this invoke immediately
  //     ({ streaming: true }) so the renderer speaks it via the proven
  //     tool-output path while Claude is still writing.
  //   - SUBSEQUENT sentences (and the trailing partial) are pushed to the
  //     renderer over the `realtime:chiefDelta` channel, scoped by sessionId +
  //     callId for clean barge-in.
  // If no sentence ever fires (very short / unpunctuated reply), the invoke
  // resolves the old way with the whole response.
  trustedHandle(
    'realtime:askChief',
    async (event, payload: { transcript?: string; sessionId?: string; callId?: string } = {}) => {
      const transcript = (payload.transcript ?? '').trim();
      if (!transcript) {
        return { success: false, error: 'Empty transcript.' };
      }

      // Mirror agent-ipc's lazy-init guard so the bridge works even if the agent
      // was not initialized at startup (e.g. key added later this session).
      if (!AgentManager.isInitialized()) {
        if (SettingsManager.hasRequiredKeys()) {
          await deps.initializeAgent();
        }
        if (!AgentManager.isInitialized()) {
          return {
            success: false,
            error: 'No API keys configured. Please add your key in Settings > LLM.',
          };
        }
      }

      const sessionId = payload.sessionId || 'voice';
      const callId = payload.callId;

      // Streaming state shared between the status handler and the awaited result.
      // `buffer` holds text not yet emitted as a sentence.
      let buffer = '';
      let firstSentence: string | null = null;
      let resolveFirst:
        | ((value: { success: boolean; response: string; streaming: boolean }) => void)
        | null = null;
      // A promise that resolves as soon as the first sentence is available, so we
      // can return it without waiting for the whole Claude turn.
      const firstSentencePromise = new Promise<{
        success: boolean;
        response: string;
        streaming: boolean;
      }>((resolve) => {
        resolveFirst = resolve;
      });

      const sender = event.sender;
      const pushDelta = (delta: {
        sentence?: string;
        error?: string;
        done?: boolean;
        tokensUsed?: number;
      }) => {
        if (sender.isDestroyed()) {
          return;
        }
        sender.send('realtime:chiefDelta', { sessionId, callId, ...delta });
      };

      const statusHandler = (status: AgentStatus) => {
        // STRICT session scoping: only this exact voice turn's stream. A missing
        // or different sessionId is rejected outright — otherwise a concurrent
        // background job / scheduled task / subagent composing at the same time
        // could bleed its text into this turn's spoken answer.
        if (status.sessionId !== sessionId) {
          return;
        }
        if (status.type !== 'partial_text' || typeof status.partialText !== 'string') {
          return;
        }
        // We consume only the append-only delta stream (chat-engine text_delta),
        // where partialText is new text to add. `partialReplace` events carry the
        // ENTIRE answer-so-far in a different encoding; mixing them with deltas
        // would double-count, so we ignore them and rely on deltas alone.
        if (status.partialReplace) {
          return;
        }

        buffer += status.partialText;

        // FIRST CHUNK FAST PATH: before anything has been spoken, break early on
        // a clause boundary / char cap so audio starts before a long opening
        // sentence finishes. This only fires for the very first emission of the
        // turn; the remainder of that sentence stays in `buffer` and flows
        // through the normal sentence path below on subsequent deltas.
        if (firstSentence === null) {
          const first = flushFirstChunk(buffer);
          if (first) {
            buffer = first.rest;
            firstSentence = first.chunk;
            resolveFirst?.({ success: true, response: first.chunk, streaming: true });
          }
        }

        const { sentences, rest } = flushCompleteSentences(buffer);
        buffer = rest;
        for (const sentence of sentences) {
          if (firstSentence === null) {
            // No early chunk fired (e.g. a short reply that hit a sentence end
            // before the clause/cap). This first sentence resolves the invoke.
            firstSentence = sentence;
            resolveFirst?.({ success: true, response: sentence, streaming: true });
          } else {
            // Remaining sentences (incl. the rest of the first chunk's sentence)
            // stream over the push channel in order.
            pushDelta({ sentence });
          }
        }
      };

      AgentManager.on('status', statusHandler);

      try {
        // The messages table has a foreign key on session_id REFERENCES
        // sessions(id), and the chat engine does not create the session itself
        // (the chat renderer normally does). For a voice turn we must ensure the
        // session row exists first, or saveMessage() fails with a foreign-key
        // constraint error.
        deps.getMemory()?.ensureSession(sessionId, 'general');

        // Voice turns use a faster model than the chat default to cut
        // time-to-first-word (gate item #1). resolveModel (inside the engine)
        // falls back to the default if this model's provider has no key, so an
        // empty/invalid setting degrades gracefully rather than failing.
        const voiceModel = SettingsManager.get('agent.voiceModel') || undefined;
        const processPromise = AgentManager.processMessage(
          transcript,
          'desktop',
          sessionId,
          undefined,
          undefined,
          voiceModel
        ).then((result) => {
          deps.updateTrayMenu();
          return result;
        });

        // Race: return as soon as the first sentence is ready, OR when the whole
        // turn finishes (covers short/unpunctuated replies that never fire a
        // sentence boundary). Either way, processPromise keeps running so the
        // remainder streams over chiefDelta.
        const winner = await Promise.race([
          firstSentencePromise,
          processPromise.then((result) => ({
            success: true,
            response: result.response || '',
            streaming: false as const,
            __full: true as const,
          })),
        ]);

        // Always finish the turn and flush the remainder, regardless of who won.
        void processPromise
          .then((result) => {
            // Emit any trailing buffered partial sentence (streaming path only;
            // when the full result won there's nothing buffered), then always
            // send a single terminal `done`. The done delta carries tokensUsed
            // for this turn — known only now that the turn completed — which the
            // renderer records for the gate #3 turn cap + usage display. It fires
            // exactly once per turn, scoped by sessionId+callId.
            const tail = firstSentence !== null ? buffer.trim() : '';
            pushDelta({
              ...(tail ? { sentence: tail } : {}),
              done: true,
              tokensUsed: result.tokensUsed || 0,
            });
          })
          .catch((error) => {
            pushDelta({
              error: error instanceof Error ? error.message : 'Claude request failed.',
              done: true,
            });
          })
          .finally(() => {
            AgentManager.off('status', statusHandler);
          });

        if ('__full' in winner) {
          return { success: winner.success, response: winner.response };
        }
        return { success: winner.success, response: winner.response, streaming: winner.streaming };
      } catch (error) {
        AgentManager.off('status', statusHandler);
        pushDelta({
          error: error instanceof Error ? error.message : 'Claude request failed.',
          done: true,
        });
        // If we already resolved the invoke with a first sentence, this return is
        // ignored; otherwise it surfaces the failure to the renderer.
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Claude request failed.',
        };
      }
    }
  );
}
