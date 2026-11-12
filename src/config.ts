import type { AppConfig } from './types.ts';

export function loadConfig(): AppConfig {
  const env = process.env;

  const geminiApiKey = env.GEMINI_API_KEY && !env.GEMINI_API_KEY.startsWith('vas_gemini') ? env.GEMINI_API_KEY : '';
  const openaiApiKey = env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith('vas_openai') ? env.OPENAI_API_KEY : '';

  let aiProvider: 'gemini' | 'openai' = 'gemini';
  if (env.AI_PROVIDER === 'openai' || (!geminiApiKey && openaiApiKey)) {
    aiProvider = 'openai';
  }

  let openaiModel = env.OPENAI_MODEL || 'gpt-4o-mini';
  // Ak je preklep v modeli
  if (openaiModel.includes('gpt-6')) {
    openaiModel = 'gpt-4o-mini';
  }

  return {
    glpiUrl: (env.GLPI_URL || 'https://glpi.firma.sk/apirest.php').replace(/\/+$/, ''),
    glpiAppToken: env.GLPI_APP_TOKEN || '',
    glpiUserToken: env.GLPI_USER_TOKEN || '',
    glpiAllowSelfSigned: env.GLPI_ALLOW_SELF_SIGNED === 'true',
    aiProvider,
    geminiApiKey,
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    geminiEmbeddingModel: env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
    openaiApiKey,
    openaiModel,
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    similarityThreshold: parseFloat(env.SIMILARITY_THRESHOLD || '0.60'),
    topKMatches: parseInt(env.TOP_K_MATCHES || '3', 10),
    pollIntervalSeconds: parseInt(env.POLL_INTERVAL_SECONDS || '60', 10),
    noteIsPrivate: parseInt(env.NOTE_IS_PRIVATE || '1', 10),
    dataDir: env.DATA_DIR || './data',
  };
}
