import type { AppConfig, AISuggestion } from '../types.ts';
import { GLPIClient } from '../glpi/client.ts';
import { VectorStore } from '../ai/vectorStore.ts';
import { EmbeddingService } from '../ai/embeddings.ts';
import { TicketSuggester } from '../ai/suggester.ts';
import { cleanTicketDescription } from '../utils/text.ts';

export class TicketProcessor {
  private config: AppConfig;
  private glpi: GLPIClient;
  private store: VectorStore;
  private embedder: EmbeddingService;
  private suggester: TicketSuggester;

  constructor(config: AppConfig) {
    this.config = config;
    this.glpi = new GLPIClient(config);
    this.store = new VectorStore(config.dataDir);
    this.embedder = new EmbeddingService(config);
    this.suggester = new TicketSuggester(config);
  }

  /**
   * Spracuje konkrétny tiket podľa ID
   */
  async processTicket(ticketId: number, dryRun = false): Promise<AISuggestion | null> {
    console.log(`[Processor] Spracovávam tiket #${ticketId}...`);

    await this.glpi.initSession();

    try {
      const ticket = await this.glpi.getTicket(ticketId);
      if (!ticket) {
        console.error(`[Processor] Tiket #${ticketId} nebol nájdený.`);
        return null;
      }

      // Overíme, či už nemá pridaný AI návrh
      if (!dryRun) {
        const alreadyHasNote = await this.glpi.hasAISuggestion(ticketId);
        if (alreadyHasNote) {
          console.log(`[Processor] Tiket #${ticketId} už obsahuje AI návrh. Preskakujem.`);
          return null;
        }
      }

      const problemText = cleanTicketDescription(ticket.content || ticket.name);
      const queryText = `Názov: ${ticket.name}\nProblém: ${problemText}`;

      // 1. Vygenerovanie embeddingu pre nový tiket
      const queryEmbedding = await this.embedder.getEmbedding(queryText);

      // 2. Vyhľadanie v znalostnej databáze
      const matches = this.store.search(
        queryEmbedding,
        this.config.topKMatches,
        this.config.similarityThreshold
      );

      console.log(`[Processor] Nájdených ${matches.length} relevantných historických tiketov.`);

      // 3. Syntéza riešenia cez LLM
      const suggestion = await this.suggester.generateSuggestion(ticket, matches);

      if (dryRun) {
        console.log('\n--- NÁHĽAD NÁVRHU (DRY RUN - NEUKLADÁ SA DO GLPI) ---');
        console.log(suggestion.formattedMarkdown);
        console.log('-----------------------------------------------------\n');
      } else {
        // 4. Pridanie privátnej poznámky do GLPI
        console.log(`[GLPI] Pridávam privátnu poznámku do tiketu #${ticketId}...`);
        await this.glpi.addPrivateFollowup(ticketId, suggestion.formattedHtml);
        console.log(`[GLPI] Privátna poznámka bola úspešne pridaná do tiketu #${ticketId}!`);
      }

      return suggestion;
    } finally {
      await this.glpi.killSession();
    }
  }

  /**
   * Skontroluje nové tikety v GLPI a spracuje tie, ktoré ešte nemajú AI návrh
   */
  async checkAndProcessNewTickets(): Promise<number> {
    await this.glpi.initSession();

    try {
      const newTickets = await this.glpi.getNewTickets(20);
      let count = 0;

      for (const ticket of newTickets) {
        const alreadyHasNote = await this.glpi.hasAISuggestion(ticket.id);
        if (alreadyHasNote) continue;

        console.log(`\n[Watcher] Nájdený nový nevyriešený tiket #${ticket.id}: "${ticket.name}"`);
        await this.processTicket(ticket.id, false);
        count++;
      }

      return count;
    } finally {
      await this.glpi.killSession();
    }
  }
}
