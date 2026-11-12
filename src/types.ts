export interface GLPITicket {
  id: number;
  name: string; // Predmet / názov tiketu
  content: string; // Popis problému (môže obsahovať HTML)
  status: number; // 1: New, 2: Assigned, 3: Planned, 4: Pending, 5: Solved, 6: Closed
  date: string;
  date_mod?: string;
  urgency?: number;
  priority?: number;
  itilcategories_id?: number;
  users_id_recipient?: number;
  solvedate?: string;
  closedate?: string;
}

export interface GLPISolution {
  id: number;
  items_id: number;
  itemtype: string;
  solutiontypes_id?: number;
  status: number; // 2: Accepted, 3: Refused, etc.
  content: string; // Text riešenia
  date_creation: string;
  date_mod?: string;
  users_id?: number;
}

export interface GLPIFollowup {
  id: number;
  items_id: number;
  itemtype: string;
  content: string;
  is_private: number; // 1 = privátne, 0 = verejné
  date_creation: string;
  users_id?: number;
}

export interface KnowledgeItem {
  id: string; // Unikátne ID záznamu (napr. glpi-ticket-1234)
  ticketId: number;
  title: string;
  problem: string; // Očistený popis problému
  solution: string; // Skutočné schválené riešenie
  category?: string;
  resolvedAt?: string;
  embedding: number[]; // Vektorová reprezentácia (text-embedding)
}

export interface SearchMatch {
  item: KnowledgeItem;
  similarity: number; // Cosine similarity (0.0 - 1.0)
}

export interface AISuggestion {
  ticketId: number;
  probableRootCause: string;
  recommendedSteps: string[];
  draftResponseToUser: string;
  missingInformationWarnings: string[];
  similarTickets: Array<{
    ticketId: number;
    title: string;
    similarity: number;
    solutionSnippet: string;
  }>;
  formattedHtml: string;
  formattedMarkdown: string;
}

export interface AppConfig {
  glpiUrl: string;
  glpiAppToken: string;
  glpiUserToken: string;
  glpiAllowSelfSigned: boolean;
  aiProvider: 'gemini' | 'openai';
  geminiApiKey: string;
  geminiModel: string;
  geminiEmbeddingModel: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  similarityThreshold: number;
  topKMatches: number;
  pollIntervalSeconds: number;
  noteIsPrivate: number;
  dataDir: string;
}
